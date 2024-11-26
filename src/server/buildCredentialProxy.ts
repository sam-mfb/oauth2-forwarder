import http from "http"
import { parseOauth2Url } from "../parseOauth2Url"
import { Result } from "../result"
import { Oauth2AuthCodeRequestParams } from "../oauth2-types"
import { extractPort } from "../extractPort"

export function buildCredentialProxy(deps: {
  host: string
  port: number
  interactiveLogin: (url: string, responsePort: number) => Promise<string>
  debugger?: (str: string) => void
}): () => Promise<{ close: () => void }> {
  return async () => {
    const debug = deps.debugger ? deps.debugger : () => {}

    const server = http.createServer((req, res) => {
      debug(`Request received at ${req.headers.host}`)
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
        const deserializedBody: Record<string, string> = JSON.parse(
          rawData.join("")
        )
        debug(`Received body: "${rawData.join("")}"`)

        let oauthParams: Oauth2AuthCodeRequestParams
        if ("url" in deserializedBody) {
          const oauthParamsResponse = parseOauth2Url(deserializedBody.url)
          if (Result.isFailure(oauthParamsResponse)) {
            debug(`Error: ${oauthParamsResponse.error.message}`)
            res.writeHead(400, oauthParamsResponse.error.message)
            res.end()
            return
          }
          oauthParams = oauthParamsResponse.value
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
          res.writeHead(400, portResult.error.message)
          res.end()
          return
        }
        const port = portResult.value ?? 80
        debug(`Using port number: ${port}`)

        deps
          .interactiveLogin(deserializedBody.url, port)
          .then(successUrl => {
            debug("Interactive login completed")
            debug("Sending success header")
            res.writeHead(200)
            const responseBody = { url: successUrl }
            debug(
              `Ending response with output: "${JSON.stringify(responseBody)}"`
            )
            res.end(JSON.stringify(responseBody))
          })
          .catch(error => {
            debug(`Interactive login errored: "${JSON.stringify(error)}"`)
            debug("Sending error header")
            res.writeHead(500, JSON.stringify(error))
            debug("Ending response")
            res.end()
          })
      })
    })

    debug("Starting credential proxy...")
    server.listen(deps.port, deps.host)
    return { close: () => server.close() }
  }
}
