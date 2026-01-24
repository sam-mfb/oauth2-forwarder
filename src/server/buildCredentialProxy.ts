import http from "http"
import { parseOauth2Url } from "../parseOauth2Url"
import { Result } from "../result"
import { Oauth2AuthCodeRequestParams } from "../oauth2-types"
import { extractPort } from "../extractPort"
import { CompletionReport, RedirectResult } from "../redirect-types"
import { InteractiveLoginResult } from "./buildInteractiveLogin"

// Default TTL: 5 minutes for pending requests before cleanup
const DEFAULT_PENDING_REQUEST_TTL_MS = 5 * 60 * 1000

type PendingRequest = {
  complete: (result: RedirectResult) => void
  timeoutId: ReturnType<typeof setTimeout>
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
  debugger?: (str: string) => void
  pendingRequestTtlMs?: number
}): () => Promise<{ close: () => void }> {
  return async () => {
    const debug = deps.debugger ? deps.debugger : () => {}
    const pendingRequestTtlMs =
      deps.pendingRequestTtlMs ?? DEFAULT_PENDING_REQUEST_TTL_MS

    // Store pending completion handlers keyed by requestId
    const pendingRequests = new Map<string, PendingRequest>()

    const server = http.createServer((req, res) => {
      debug(`Request received at ${req.headers.host}${req.url ?? "/"}`)
      const rawData: Buffer[] = []

      req.on("close", () => {
        debug("Request closed.")
      })
      req.on("error", err => {
        debug(`Request received error "${err}"`)
      })

      req.on("data", (chunk: Buffer) => {
        rawData.push(chunk)
      })
      req.on("end", () => {
        debug("Request ended")
        const rawBody = rawData.join("")
        debug(`Received body: "${rawBody}"`)

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
      debug("Handling /complete request")

      let report: CompletionReport
      try {
        report = JSON.parse(rawBody) as CompletionReport
      } catch {
        const reason = "Invalid JSON in completion request body"
        debug(`Error: ${reason}`)
        res.writeHead(400, reason)
        res.end()
        return
      }

      if (!report.requestId || !report.result) {
        const reason = "Completion request missing requestId or result"
        debug(`Error: ${reason}`)
        res.writeHead(400, reason)
        res.end()
        return
      }

      const pending = pendingRequests.get(report.requestId)
      if (!pending) {
        const reason = `No pending request found for requestId: ${report.requestId}`
        debug(`Error: ${reason}`)
        res.writeHead(404, reason)
        res.end()
        return
      }

      // Clear the TTL timeout and remove from pending
      clearTimeout(pending.timeoutId)
      pendingRequests.delete(report.requestId)
      debug(`Completing request ${report.requestId} with result type: ${report.result.type}`)
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
        debug(`Error: ${reason}`)
        res.writeHead(400, reason)
        res.end()
        return
      }

      let oauthParams: Oauth2AuthCodeRequestParams
      if ("url" in deserializedBody) {
        const oauthParamsResponse = parseOauth2Url(deserializedBody.url)
        if (Result.isFailure(oauthParamsResponse)) {
          debug(`Error: ${oauthParamsResponse.error.message}`)
          if (deps.passthrough) {
            debug(`Passthrough mode: opening URL in browser`)
            deps.openBrowser(deserializedBody.url).catch(err => {
              debug(`Failed to open browser: ${err}`)
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
          debug("OAuth2 request does not include PKCE parameters")
        }
      } else {
        const reason = "Received body does not contain a 'url' property"
        debug(`Error: ${reason}`)
        res.writeHead(400, reason)
        res.end()
        return
      }
      const portResult = extractPort(oauthParams.redirect_uri)
      if (Result.isFailure(portResult)) {
        debug(`Error: ${portResult.error.message}`)
        if (deps.passthrough) {
          debug(`Passthrough mode: opening URL in browser`)
          deps.openBrowser(deserializedBody.url).catch(err => {
            debug(`Failed to open browser: ${err}`)
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
      debug(`Using port number: ${port}`)

      deps
        .interactiveLogin(deserializedBody.url, port)
        .then(({ callbackUrl, requestId, complete }) => {
          debug(`Interactive login received callback, requestId: ${requestId}`)

          // Store the completion handler with TTL timeout for cleanup
          const timeoutId = setTimeout(() => {
            debug(
              `Pending request ${requestId} expired after ${pendingRequestTtlMs}ms, cleaning up`
            )
            pendingRequests.delete(requestId)
          }, pendingRequestTtlMs)

          pendingRequests.set(requestId, { complete, timeoutId })
          debug(`Stored pending request ${requestId} with TTL ${pendingRequestTtlMs}ms`)

          debug("Sending callback URL and requestId to client")
          res.writeHead(200)
          const responseBody = { url: callbackUrl, requestId }
          debug(`Ending response with output: "${JSON.stringify(responseBody)}"`)
          res.end(JSON.stringify(responseBody))
        })
        .catch(error => {
          debug(`Interactive login errored: "${JSON.stringify(error)}"`)
          debug("Sending error header")
          res.writeHead(500, JSON.stringify(error))
          debug("Ending response")
          res.end()
        })
    }

    debug("Starting credential proxy...")
    server.listen(deps.port, deps.host)
    return {
      close: () => {
        // Clear all pending request timeouts on shutdown
        for (const [requestId, pending] of pendingRequests) {
          debug(`Clearing pending request timeout for ${requestId} on shutdown`)
          clearTimeout(pending.timeoutId)
        }
        pendingRequests.clear()
        server.close()
      }
    }
  }
}
