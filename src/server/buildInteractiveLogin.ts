import http from "http"
import { nanoid } from "nanoid"
import { RedirectResult } from "../redirect-types"
import { type Logger } from "../logger"

// Default timeout: 5 minutes for user to complete OAuth2 flow
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000

export type InteractiveLoginResult = {
  callbackUrl: string
  /**
   * HTTP method the OAuth provider used when delivering the callback.
   * "GET" for response_mode=query (default), "POST" for response_mode=form_post.
   */
  callbackMethod: "GET" | "POST"
  /**
   * Raw request body when the callback arrived as a POST (form_post).
   * Undefined for GET callbacks.
   */
  callbackBody?: string
  /**
   * Content-Type header from the inbound callback, if present. Forwarded so
   * that the in-container loopback server (e.g. MSAL) sees the same media
   * type the OAuth provider used (typically application/x-www-form-urlencoded).
   */
  callbackContentType?: string
  requestId: string
  complete: (result: RedirectResult) => void
}

export function buildInteractiveLogin(deps: {
  openBrowser: (url: string) => Promise<void>
  logger: Logger
  loginTimeoutMs?: number
}): (
  url: string,
  responsePort: number,
  signal?: AbortSignal
) => Promise<InteractiveLoginResult> {
  const LOCALHOST = "127.0.0.1"
  const loginTimeoutMs = deps.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS
  const { logger } = deps

  // Logins whose temporary listener is still waiting for the browser
  // callback, keyed by port. Each entry fails its login and resolves once
  // the listener has released the port.
  const waitingLogins = new Map<number, (reason: Error) => Promise<void>>()

  return async (url, responsePort, signal) => {
    // Only one listener can hold a port. A new login for the same port
    // means the tool in the container was restarted (typically after the
    // user cancelled), so the old login can never receive its callback.
    // Replace it rather than fail the new one.
    const previous = waitingLogins.get(responsePort)
    if (previous) {
      logger.warn(
        `New login request for port ${responsePort} supersedes a login still waiting for its callback`
      )
      await previous(
        new Error(
          `Login superseded by a newer login request on port ${responsePort}`
        )
      )
    }

    return new Promise<InteractiveLoginResult>((resolve, reject) => {
      const requestId = nanoid()
      logger.debug(`Generated requestId: ${requestId}`)

      let timeoutId: ReturnType<typeof setTimeout> | undefined
      // True once the login has resolved or failed.
      let settled = false

      const releaseState = (): void => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = undefined
        }
        if (waitingLogins.get(responsePort) === fail) {
          waitingLogins.delete(responsePort)
        }
        signal?.removeEventListener("abort", onAbort)
      }

      // Fail this login: release its port, timer and state, then reject.
      // Resolves once the listening socket is closed.
      const fail = (reason: Error): Promise<void> => {
        if (settled) {
          return Promise.resolve()
        }
        settled = true
        logger.debug(`Login ${requestId} failed: ${reason.message}`)
        releaseState()
        reject(reason)
        return new Promise<void>(closed => {
          if (!server.listening) {
            closed()
            return
          }
          server.close(() => closed())
          server.closeAllConnections()
        })
      }

      const onAbort = (): void => {
        void fail(new Error("Login cancelled: the client disconnected"))
      }

      const server = http.createServer((req, res) => {
        // Clear timeout as soon as we receive a request
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = undefined
        }
        logger.debug(`Received a ${req.method ?? "undefined"} request`)
        const bodyChunks: Buffer[] = []

        req.on("error", error => {
          logger.error(`Request error: ${error.message}`)
          if (!res.headersSent) {
            res.writeHead(500)
          }
          res.end()
          void fail(error)
        })

        req.on("data", (chunk: Buffer) => {
          bodyChunks.push(chunk)
          // Don't log the chunk payload: with response_mode=form_post the body
          // carries OAuth params (code, state, client_info, session_state,
          // and in some flows tokens). The general log sanitizer only redacts
          // `code`/`code_challenge`, so logging the raw chunk would leak the
          // rest into debug logs.
          logger.debug(`Received data chunk (${chunk.length} bytes)`)
        })

        req.on("close", () => {
          logger.debug("Redirect request closed")
        })

        req.on("end", () => {
          logger.debug("Request ended")

          // After the first callback we've already resolved the promise and
          // closed the listening socket. Some browsers reuse the underlying
          // keep-alive connection for follow-up requests (favicon, prefetch,
          // etc.); ignore those rather than re-resolving.
          if (settled) {
            logger.debug("Ignoring follow-up request after callback resolved")
            res.writeHead(404)
            res.end()
            return
          }

          if (!req.headers.host) {
            const reason = "Missing Host header in redirect request"
            logger.warn(reason)
            res.writeHead(400, reason)
            res.end()
            void fail(new Error(reason))
            return
          }
          const callbackUrl = "http://" + req.headers.host + req.url
          const method = (req.method ?? "GET").toUpperCase()
          const callbackMethod: "GET" | "POST" =
            method === "POST" ? "POST" : "GET"

          let callbackBody: string | undefined
          let callbackContentType: string | undefined
          if (callbackMethod === "POST") {
            callbackBody = Buffer.concat(bodyChunks).toString("utf8")
            const ct = req.headers["content-type"]
            if (typeof ct === "string") {
              callbackContentType = ct
            }
            logger.debug(
              `Captured form_post callback: contentType="${callbackContentType ?? "(none)"}", bodyLength=${callbackBody.length}`
            )
          }

          logger.debug(`Received callback url: "${callbackUrl}"`)
          logger.debug(`Callback method: ${callbackMethod}`)
          logger.debug("Holding browser response pending completion")

          // Close the listening socket immediately to free the port
          // The existing connection (browser response) stays open
          logger.debug(
            "Closing listening socket (keeping response connection open)"
          )
          server.close()

          // Create completion function that will respond to browser
          const complete = (result: RedirectResult): void => {
            logger.debug(
              `Completing request ${requestId} with result type: ${result.type}`
            )

            // A response the browser can't receive (e.g. a header with
            // invalid characters) must not leave its connection hanging.
            // Close it and pass the error to the caller.
            try {
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
                  logger.debug(
                    `Sending error response to browser: ${result.message}`
                  )
                  res.writeHead(500, { "Content-Type": "text/html" })
                  res.end(`Authentication failed: ${result.message}`)
                  break
              }
            } catch (error) {
              res.destroy()
              throw error
            }
          }

          settled = true
          releaseState()
          resolve({
            callbackUrl,
            callbackMethod,
            callbackBody,
            callbackContentType,
            requestId,
            complete
          })
        })
      })

      // Errors on the listening socket, such as EADDRINUSE when another
      // program holds the port, fail this login only.
      server.on("error", error => {
        logger.error(
          `Temporary redirect server on port ${responsePort} failed: ${error.message}`
        )
        void fail(
          new Error(
            `Could not listen for the OAuth callback on port ${responsePort}: ${error.message}`
          )
        )
      })

      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener("abort", onAbort, { once: true })
      waitingLogins.set(responsePort, fail)

      logger.debug(
        `Starting temporary redirect server on port ${responsePort}...`
      )
      server.listen(responsePort, LOCALHOST, () => {
        logger.debug("Temporary redirect server is listening")

        // Set timeout to close the server if user doesn't complete OAuth2 flow
        logger.debug(`Setting login timeout: ${loginTimeoutMs}ms`)
        timeoutId = setTimeout(() => {
          logger.warn(
            `Login timeout exceeded (${loginTimeoutMs}ms), closing server on port ${responsePort}`
          )
          void fail(
            new Error(
              `Login timeout: user did not complete OAuth2 flow within ${loginTimeoutMs}ms`
            )
          )
        }, loginTimeoutMs)

        logger.info("Opening browser for interactive login")
        // Wrapped so that a synchronous throw is caught as well.
        Promise.resolve()
          .then(() => deps.openBrowser(url))
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error)
            logger.error(`Failed to open browser: ${message}`)
            void fail(new Error(`Failed to open browser: ${message}`))
          })
      })
    })
  }
}
