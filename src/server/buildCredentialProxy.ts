import http from "http"
import { parseOauth2Url } from "../parseOauth2Url"
import { Result } from "../result"
import { Oauth2AuthCodeRequestParams } from "../oauth2-types"
import { extractPort } from "../extractPort"
import { CompletionReport, RedirectResult } from "../redirect-types"
import { InteractiveLoginResult } from "./buildInteractiveLogin"
import { WhitelistConfig, isUrlAllowed, getDomain } from "./whitelist"
import { type Logger } from "../logger"

// Default TTL: 5 minutes for pending requests before cleanup
const DEFAULT_PENDING_REQUEST_TTL_MS = 5 * 60 * 1000

type PendingRequest = {
  complete: (result: RedirectResult) => void
  timeoutId: ReturnType<typeof setTimeout>
  domain: string
}

/**
 * Node throws when a status message contains a character it doesn't allow,
 * such as a newline or a non-Latin-1 character copied from a malformed URL.
 * Replace everything outside printable ASCII so that a bad request can
 * always be answered.
 */
export function toStatusMessage(reason: string): string {
  return reason.replace(/[^\t\x20-\x7e]/g, "?")
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : JSON.stringify(error)

/**
 * Answer a request with an error status. If the response has already
 * started or the connection is gone, the request can't be answered, so
 * the connection is closed instead.
 */
const sendStatus = (
  res: http.ServerResponse,
  statusCode: number,
  reason?: string
): void => {
  if (res.headersSent || res.destroyed) {
    res.destroy()
    return
  }
  if (reason === undefined) {
    res.writeHead(statusCode)
  } else {
    res.writeHead(statusCode, toStatusMessage(reason))
  }
  res.end()
}

export function buildCredentialProxy(deps: {
  host: string
  port: number
  interactiveLogin: (
    url: string,
    responsePort: number,
    signal?: AbortSignal
  ) => Promise<InteractiveLoginResult>
  openBrowser: (url: string) => Promise<void>
  passthrough: boolean
  pendingRequestTtlMs?: number
  whitelist: WhitelistConfig
  logger: Logger
}): () => Promise<{ close: () => void }> {
  return async () => {
    const { logger } = deps
    const pendingRequestTtlMs =
      deps.pendingRequestTtlMs ?? DEFAULT_PENDING_REQUEST_TTL_MS

    // Store pending completion handlers keyed by requestId
    const pendingRequests = new Map<string, PendingRequest>()

    // Helper to check whitelist and send 403 if rejected
    // Returns true if request was rejected, false if allowed
    const rejectIfNotWhitelisted = (
      url: string,
      res: http.ServerResponse,
      isPassthrough: boolean
    ): boolean => {
      if (isUrlAllowed(url, deps.whitelist)) {
        return false
      }
      const hostname = getDomain(url) ?? "unknown"
      const reason = `Domain '${hostname}' is not in the whitelist`
      const logPrefix = isPassthrough
        ? "Whitelist rejection (passthrough)"
        : "Whitelist rejection"
      logger.warn(`${logPrefix}: ${reason}`)
      sendStatus(res, 403, reason)
      return true
    }

    const server = http.createServer((req, res) => {
      logger.debug(`Request received at ${req.headers.host}${req.url ?? "/"}`)
      const rawData: Buffer[] = []

      req.on("close", () => {
        logger.debug("Request closed")
      })
      req.on("error", err => {
        logger.error(`Request error: ${err}`)
      })

      req.on("data", (chunk: Buffer) => {
        rawData.push(chunk)
      })
      req.on("end", () => {
        logger.debug("Request ended")
        const rawBody = rawData.join("")
        logger.debug(`Received body: "${rawBody}"`)

        const path = req.url ?? "/"

        // Request boundary: an unexpected error while handling one request
        // fails that request only, and the server keeps running.
        try {
          if (path === "/complete") {
            handleComplete(rawBody, res)
          } else {
            handleOauth2(rawBody, res)
          }
        } catch (error) {
          logger.error(`Error handling request: ${describeError(error)}`)
          sendStatus(res, 500, "Internal server error")
        }
      })
    })

    const handleComplete = (
      rawBody: string,
      res: http.ServerResponse
    ): void => {
      logger.debug("Handling /complete request")

      let report: CompletionReport
      try {
        report = JSON.parse(rawBody) as CompletionReport
      } catch {
        const reason = "Invalid JSON in completion request body"
        logger.warn(reason)
        sendStatus(res, 400, reason)
        return
      }

      if (!report.requestId || !report.result) {
        const reason = "Completion request missing requestId or result"
        logger.warn(reason)
        sendStatus(res, 400, reason)
        return
      }

      const pending = pendingRequests.get(report.requestId)
      if (!pending) {
        const reason = `No pending request found for requestId: ${report.requestId}`
        logger.warn(reason)
        sendStatus(res, 404, reason)
        return
      }

      // Clear the TTL timeout and remove from pending
      clearTimeout(pending.timeoutId)
      pendingRequests.delete(report.requestId)
      logger.info(`Completed OAuth request for ${pending.domain}`)
      logger.debug(
        `Request ${report.requestId} completed with result: ${report.result.type}`
      )
      pending.complete(report.result)

      res.writeHead(200)
      res.end()
    }

    const handleOauth2 = (rawBody: string, res: http.ServerResponse): void => {
      let deserializedBody: Record<string, string>
      try {
        deserializedBody = JSON.parse(rawBody)
      } catch {
        const reason = "Invalid JSON in request body"
        logger.warn(reason)
        sendStatus(res, 400, reason)
        return
      }

      let oauthParams: Oauth2AuthCodeRequestParams
      if ("url" in deserializedBody) {
        const oauthParamsResponse = parseOauth2Url(deserializedBody.url, logger)
        if (Result.isFailure(oauthParamsResponse)) {
          logger.debug(
            `OAuth parse error: ${oauthParamsResponse.error.message}`
          )
          if (deps.passthrough) {
            if (rejectIfNotWhitelisted(deserializedBody.url, res, true)) {
              return
            }
            const passthroughDomain =
              getDomain(deserializedBody.url) ?? "unknown"
            logger.info(`Passthrough: opening ${passthroughDomain} in browser`)
            deps.openBrowser(deserializedBody.url).catch(err => {
              logger.error(`Failed to open browser: ${err}`)
            })
            sendStatus(
              res,
              400,
              `${oauthParamsResponse.error.message}; URL opened in browser (passthrough mode)`
            )
          } else {
            sendStatus(res, 400, oauthParamsResponse.error.message)
          }
          return
        }
        oauthParams = oauthParamsResponse.value
        if (!oauthParams.code_challenge) {
          logger.debug("OAuth2 request does not include PKCE parameters")
        }

        if (rejectIfNotWhitelisted(deserializedBody.url, res, false)) {
          return
        }
      } else {
        const reason = "Received body does not contain a 'url' property"
        logger.warn(reason)
        sendStatus(res, 400, reason)
        return
      }
      const portResult = extractPort(oauthParams.redirect_uri)
      if (Result.isFailure(portResult)) {
        logger.debug(`Port extraction error: ${portResult.error.message}`)
        if (deps.passthrough) {
          if (rejectIfNotWhitelisted(deserializedBody.url, res, true)) {
            return
          }
          const passthroughDomain = getDomain(deserializedBody.url) ?? "unknown"
          logger.info(`Passthrough: opening ${passthroughDomain} in browser`)
          deps.openBrowser(deserializedBody.url).catch(err => {
            logger.error(`Failed to open browser: ${err}`)
          })
          sendStatus(
            res,
            400,
            `${portResult.error.message}; URL opened in browser (passthrough mode)`
          )
        } else {
          sendStatus(res, 400, portResult.error.message)
        }
        return
      }
      const port = portResult.value ?? 80
      logger.debug(`Using port number: ${port}`)

      const domain = getDomain(deserializedBody.url) ?? "unknown"
      logger.info(`Received OAuth request for ${domain}`)

      // If the client disconnects before it gets an answer, cancel its
      // login so the temporary listener releases the port.
      const loginAbort = new AbortController()
      res.on("close", () => {
        if (!res.writableFinished) {
          logger.info(
            `Client disconnected before login finished for ${domain}, cancelling it`
          )
          loginAbort.abort()
        }
      })

      deps
        .interactiveLogin(deserializedBody.url, port, loginAbort.signal)
        .then(
          ({
            callbackUrl,
            callbackMethod,
            callbackBody,
            callbackContentType,
            requestId,
            complete
          }) => {
            logger.debug(
              `Interactive login received callback, requestId: ${requestId}`
            )

            // The client left after the browser callback arrived. No one
            // can complete this login, so answer the browser now instead of
            // holding it until the TTL expires.
            if (res.destroyed) {
              logger.warn(
                `Client disconnected before receiving callback for ${domain}`
              )
              complete({
                type: "error",
                message: "The client disconnected before login completed"
              })
              return
            }

            // Store the completion handler with TTL timeout for cleanup
            const timeoutId = setTimeout(() => {
              logger.warn(
                `Pending request ${requestId} expired after ${pendingRequestTtlMs}ms, cleaning up`
              )
              pendingRequests.delete(requestId)
            }, pendingRequestTtlMs)

            pendingRequests.set(requestId, { complete, timeoutId, domain })
            logger.debug(
              `Stored pending request ${requestId} with TTL ${pendingRequestTtlMs}ms`
            )

            logger.debug("Sending callback URL and requestId to client")
            res.writeHead(200)
            const responseBody: {
              url: string
              requestId: string
              method?: "GET" | "POST"
              body?: string
              contentType?: string
            } = { url: callbackUrl, requestId }
            // Only include the method/body fields when the callback was a POST
            // (response_mode=form_post). Keeping the wire format minimal for
            // the common GET case preserves backward compatibility with older
            // clients that don't know about these fields.
            if (callbackMethod === "POST") {
              responseBody.method = "POST"
              if (callbackBody !== undefined) {
                responseBody.body = callbackBody
              }
              if (callbackContentType !== undefined) {
                responseBody.contentType = callbackContentType
              }
            }
            // Don't log the serialized response body verbatim: for form_post
            // callbacks it contains the raw OAuth form body (state,
            // client_info, session_state, etc., and potentially tokens). The
            // general log sanitizer only redacts `code`/`code_challenge`. Log
            // a summary that omits the body content but preserves enough info
            // for debugging.
            const responseSummary = {
              url: responseBody.url,
              requestId: responseBody.requestId,
              ...(responseBody.method !== undefined && {
                method: responseBody.method
              }),
              ...(responseBody.contentType !== undefined && {
                contentType: responseBody.contentType
              }),
              ...(responseBody.body !== undefined && {
                bodyLength: responseBody.body.length
              })
            }
            logger.debug(
              `Ending response with output: ${JSON.stringify(responseSummary)}`
            )
            res.end(JSON.stringify(responseBody))
          }
        )
        .catch((error: unknown) => {
          const message = describeError(error)
          logger.error(`Interactive login error: "${message}"`)
          sendStatus(res, 500, message)
        })
    }

    logger.debug("Starting credential proxy...")
    server.listen(deps.port, deps.host)
    return {
      close: () => {
        // Clear all pending request timeouts on shutdown
        for (const [requestId, pending] of pendingRequests) {
          logger.debug(
            `Clearing pending request timeout for ${requestId} on shutdown`
          )
          clearTimeout(pending.timeoutId)
        }
        pendingRequests.clear()
        server.close()
      }
    }
  }
}
