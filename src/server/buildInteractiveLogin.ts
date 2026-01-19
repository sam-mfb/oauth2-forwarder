import http from "http"

export function buildInteractiveLogin(deps: {
  openBrowser: (url: string) => Promise<void>
  debugger?: (str: string) => void
}): (url: string, responsePort: number) => Promise<string> {
  const LOCALHOST = "127.0.0.1"

  const debug = deps.debugger ? deps.debugger : () => {}

  return async (url, responsePort) => {
    return new Promise<string>((resolve, reject) => {
      let response: string = ""
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
          response = "http://" + req.headers.host + req.url

          debug(`Received request url: "${response}"`)

          debug("Successfully terminating request")
          res.writeHead(200)
          res.end("Authentication completed. You may close this page now.")

          debug("Closing temporary redirect server on success")
          server.close()
          resolve(response)
        })
      })

      debug(`Starting temporary redirect server on port ${responsePort}...`)
      server.listen(responsePort, LOCALHOST)

      debug("Opening browser for interactive login...")
      deps.openBrowser(url)
    })
  }
}
