import http from "http"
import open from "open"

export function buildCredentialQuerier(deps: {
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

        req.on("end", () => {
          debug("Request ended")

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
      open(url)
    })
  }
}
