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

export function buildCredentialProxy(deps: {
  host: string
  port: number
  interactiveLogin: (
    url: string,
    responsePort: number
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
      const logPrefix = isPassthrough ? "Whitelist rejection (passthrough)" : "Whitelist rejection"
      logger.warn(`${logPrefix}: ${reason}`)
      res.writeHead(403, reason)
      res.end()
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

        // Route based on path
        if (path === "/complete") {
          handleComplete(rawBody, res)
        } else {
          handleOauth2(rawBody, res)
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
        res.writeHead(400, reason)
        res.end()
        return
      }

      if (!report.requestId || !report.result) {
        const reason = "Completion request missing requestId or result"
        logger.warn(reason)
        res.writeHead(400, reason)
        res.end()
        return
      }

      const pending = pendingRequests.get(report.requestId)
      if (!pending) {
        const reason = `No pending request found for requestId: ${report.requestId}`
        logger.warn(reason)
        res.writeHead(404, reason)
        res.end()
        return
      }

      // Clear the TTL timeout and remove from pending
      clearTimeout(pending.timeoutId)
      pendingRequests.delete(report.requestId)
      logger.info(`Completed OAuth request for ${pending.domain}`)
      logger.debug(`Request ${report.requestId} completed with result: ${report.result.type}`)
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
        res.writeHead(400, reason)
        res.end()
        return
      }

      let oauthParams: Oauth2AuthCodeRequestParams
      if ("url" in deserializedBody) {
        const oauthParamsResponse = parseOauth2Url(deserializedBody.url)
        if (Result.isFailure(oauthParamsResponse)) {
          logger.debug(`OAuth parse error: ${oauthParamsResponse.error.message}`)
          if (deps.passthrough) {
            if (rejectIfNotWhitelisted(deserializedBody.url, res, true)) {
              return
            }
            const passthroughDomain = getDomain(deserializedBody.url) ?? "unknown"
            logger.info(`Passthrough: opening ${passthroughDomain} in browser`)
            deps.openBrowser(deserializedBody.url).catch(err => {
              logger.error(`Failed to open browser: ${err}`)
            })
            res.writeHead(
              400,
              `${oauthParamsResponse.error.message}; URL opened in browser (passthrough mode)`
            )
          } else {
            res.writeHead(400, oauthParamsResponse.error.message)
          }
          res.end()
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
        res.writeHead(400, reason)
        res.end()
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
          res.writeHead(
            400,
            `${portResult.error.message}; URL opened in browser (passthrough mode)`
          )
        } else {
          res.writeHead(400, portResult.error.message)
        }
        res.end()
        return
      }
      const port = portResult.value ?? 80
      logger.debug(`Using port number: ${port}`)

      const domain = getDomain(deserializedBody.url) ?? "unknown"
      logger.info(`Received OAuth request for ${domain}`)
      deps
        .interactiveLogin(deserializedBody.url, port)
        .then(({ callbackUrl, requestId, complete }) => {
          logger.debug(`Interactive login received callback, requestId: ${requestId}`)

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
          const responseBody = { url: callbackUrl, requestId }
          logger.debug(
            `Ending response with output: "${JSON.stringify(responseBody)}"`
          )
          res.end(JSON.stringify(responseBody))
        })
        .catch(error => {
          logger.error(`Interactive login error: "${JSON.stringify(error)}"`)
          res.writeHead(500, JSON.stringify(error))
          res.end()
        })
    }

    logger.debug("Starting credential proxy...")
    server.listen(deps.port, deps.host)
    return {
      close: () => {
        // Clear all pending request timeouts on shutdown
        for (const [requestId, pending] of pendingRequests) {
          logger.debug(`Clearing pending request timeout for ${requestId} on shutdown`)
          clearTimeout(pending.timeoutId)
        }
        pendingRequests.clear()
        server.close()
      }
    }
  }
}
