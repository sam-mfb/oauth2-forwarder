import http from "http"

export type Deps = {
  host: string
  port: number
  credentialOperationHandler: () => {}
  debugger?: (str: string) => void
}

export function buildCredentialReceiver(deps: Deps): () => Promise<void> {
  return async () => {
    const debug = deps.debugger ? deps.debugger : () => {}

    const server = http.createServer((req, res) => {
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
        const deserializedBody = JSON.parse(rawData.join(""))
        debug(`Received body: "${rawData.join("")}"`)

        debug("Sending success header")
        res.writeHead(200)
        debug(`Sending serialized "${deserializedBody}"`)
        res.end(`Thank you for sending: "${JSON.stringify(deserializedBody)}"`)

        // if (!isCredentialRequestBody(deserializedBody)) {
        //   throw new Error(`Body is not in expected format: ${deserializedBody}`)
        // }
        // const credentialRequestBody = deserializedBody
        // debug("Running credential operation handler...")
        // deps
        //   .credentialOperationHandler(
        //     credentialRequestBody.operation,
        //     credentialRequestBody.input
        //   )
        //   .then(
        //     output => {
        //       debug("Credential operation handler completed")
        //       debug("Sending success header")
        //       res.writeHead(200)
        //       debug(`Ending response with output: "${JSON.stringify(output)}"`)
        //       res.end(gitCredentialIoApi.serialize(output))
        //     },
        //     reason => {
        //       debug(
        //         `Credential operation handler errored: "${JSON.stringify(
        //           reason
        //         )}"`
        //       )
        //       debug("Sending error header")
        //       res.writeHead(500, JSON.stringify(reason))
        //       debug("Ending response")
        //       res.end()
        //     }
        //   )
      })
    })

    server.listen(deps.port, deps.host)
  }
}
