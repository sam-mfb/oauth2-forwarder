import http from "http"
import crypto from "crypto"
import { RedirectResult } from "../redirect-types"

export type InteractiveLoginResult = {
  callbackUrl: string
  requestId: string
  complete: (result: RedirectResult) => void
}

export function buildInteractiveLogin(deps: {
  openBrowser: (url: string) => Promise<void>
  debugger?: (str: string) => void
}): (url: string, responsePort: number) => Promise<InteractiveLoginResult> {
  const LOCALHOST = "127.0.0.1"

  const debug = deps.debugger ? deps.debugger : () => {}

  return async (url, responsePort) => {
    return new Promise<InteractiveLoginResult>((resolve, reject) => {
      const requestId = crypto.randomUUID()
      debug(`Generated requestId: ${requestId}`)

      const server = http.createServer((req, res) => {
        debug(`Received a ${req.method ?? "undefined"} request`)
        req.on("error", error => {
          debug(`Error: ${JSON.stringify(error)}`)

          debug("Terminating request on error")
          res.writeHead(500, JSON.stringify(error))
          debug("Ending response")
          res.end()

          debug("Closing temporary redirect server on error")
          server.close()
          reject(error)
        })

        req.on("data", chunk => {
          debug(`Received data chunk: ${chunk}`)
        })

        req.on("close", () => {
          debug("Redirect request closed")
        })

        req.on("end", () => {
          debug("Request ended")

          if (!req.headers.host) {
            const reason = "Missing Host header in redirect request"
            debug(`Error: ${reason}`)
            res.writeHead(400, reason)
            res.end()
            server.close()
            reject(new Error(reason))
            return
          }
          const callbackUrl = "http://" + req.headers.host + req.url

          debug(`Received callback url: "${callbackUrl}"`)
          debug("Holding browser response pending completion")

          // Close the listening socket immediately to free the port
          // The existing connection (browser response) stays open
          debug("Closing listening socket (keeping response connection open)")
          server.close()

          // Create completion function that will respond to browser
          const complete = (result: RedirectResult) => {
            debug(`Completing request ${requestId} with result type: ${result.type}`)

            switch (result.type) {
              case "redirect":
                debug(`Redirecting browser to: ${result.location}`)
                res.writeHead(302, { Location: result.location })
                res.end()
                break

              case "success":
                debug("Sending success response to browser")
                res.writeHead(200, { "Content-Type": "text/html" })
                if (result.body) {
                  res.end(result.body)
                } else {
                  res.end("Authentication completed. You may close this page now.")
                }
                break

              case "error":
                debug(`Sending error response to browser: ${result.message}`)
                res.writeHead(500, { "Content-Type": "text/html" })
                res.end(`Authentication failed: ${result.message}`)
                break
            }
          }

          resolve({ callbackUrl, requestId, complete })
        })
      })

      debug(`Starting temporary redirect server on port ${responsePort}...`)
      server.listen(responsePort, LOCALHOST, () => {
        debug("Temporary redirect server is listening")
        debug("Opening browser for interactive login...")
        deps.openBrowser(url)
      })
    })
  }
}
