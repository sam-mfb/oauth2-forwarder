import http from "http"
import { nanoid } from "nanoid"
import { RedirectResult } from "../redirect-types"
import { type Logger } from "../logger"

// Default timeout: 5 minutes for user to complete OAuth2 flow
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000

export type InteractiveLoginResult = {
  callbackUrl: string
  requestId: string
  complete: (result: RedirectResult) => void
}

export function buildInteractiveLogin(deps: {
  openBrowser: (url: string) => Promise<void>
  logger: Logger
  loginTimeoutMs?: number
}): (url: string, responsePort: number) => Promise<InteractiveLoginResult> {
  const LOCALHOST = "127.0.0.1"
  const loginTimeoutMs = deps.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS
  const { logger } = deps

  return async (url, responsePort) => {
    return new Promise<InteractiveLoginResult>((resolve, reject) => {
      const requestId = nanoid()
      logger.debug(`Generated requestId: ${requestId}`)

      let timeoutId: ReturnType<typeof setTimeout> | undefined

      const server = http.createServer((req, res) => {
        // Clear timeout as soon as we receive a request
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = undefined
        }
        logger.debug(`Received a ${req.method ?? "undefined"} request`)
        req.on("error", error => {
          logger.error(`Request error: ${JSON.stringify(error)}`)
          res.writeHead(500, JSON.stringify(error))
          res.end()
          server.close()
          reject(error)
        })

        req.on("data", chunk => {
          logger.debug(`Received data chunk: ${chunk}`)
        })

        req.on("close", () => {
          logger.debug("Redirect request closed")
        })

        req.on("end", () => {
          logger.debug("Request ended")

          if (!req.headers.host) {
            const reason = "Missing Host header in redirect request"
            logger.warn(reason)
            res.writeHead(400, reason)
            res.end()
            server.close()
            reject(new Error(reason))
            return
          }
          const callbackUrl = "http://" + req.headers.host + req.url

          logger.debug(`Received callback url: "${callbackUrl}"`)
          logger.debug("Holding browser response pending completion")

          // Close the listening socket immediately to free the port
          // The existing connection (browser response) stays open
          logger.debug("Closing listening socket (keeping response connection open)")
          server.close()

          // Create completion function that will respond to browser
          const complete = (result: RedirectResult): void => {
            logger.debug(
              `Completing request ${requestId} with result type: ${result.type}`
            )

            switch (result.type) {
              case "redirect":
                logger.debug(`Redirecting browser to: ${result.location}`)
                res.writeHead(302, { Location: result.location })
                res.end()
                break

              case "success":
                logger.debug("Sending success response to browser")
                res.writeHead(200, { "Content-Type": "text/html" })
                if (result.body) {
                  res.end(result.body)
                } else {
                  res.end(
                    "Authentication completed. You may close this page now."
                  )
                }
                break

              case "error":
                logger.debug(`Sending error response to browser: ${result.message}`)
                res.writeHead(500, { "Content-Type": "text/html" })
                res.end(`Authentication failed: ${result.message}`)
                break
            }
          }

          resolve({ callbackUrl, requestId, complete })
        })
      })

      logger.debug(`Starting temporary redirect server on port ${responsePort}...`)
      server.listen(responsePort, LOCALHOST, () => {
        logger.debug("Temporary redirect server is listening")

        // Set timeout to close the server if user doesn't complete OAuth2 flow
        logger.debug(`Setting login timeout: ${loginTimeoutMs}ms`)
        timeoutId = setTimeout(() => {
          logger.warn(
            `Login timeout exceeded (${loginTimeoutMs}ms), closing server on port ${responsePort}`
          )
          server.close()
          reject(
            new Error(
              `Login timeout: user did not complete OAuth2 flow within ${loginTimeoutMs}ms`
            )
          )
        }, loginTimeoutMs)

        logger.info("Opening browser for interactive login")
        deps.openBrowser(url)
      })
    })
  }
}
