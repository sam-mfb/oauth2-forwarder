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
        const rawData: Buffer[] = []

        req.on("open", () => {
          debug(`Received: "${req.url}"`)
          response = req.url ?? ""
        })
        req.on("close", () => {
          debug("Request closed.")
        })
        req.on("error", err => {
          debug(`Request received error "${err}"`)
          reject(err)
        })

        req.on("data", (chunk: Buffer) => {
          rawData.push(chunk)
        })

        req.on("end", () => {
          debug("Request ended")

          debug(`Received body: "${rawData.join("")}"`)
          res.writeHead(200)

          debug("Closing server on success")
          server.close()
          resolve(response)
        })
      })

      debug("Starting temporary redirect server...")
      server.listen(responsePort, LOCALHOST)

      debug("Opening browser for interactive login...")
      open(url)
    })
  }
}
