import http from "http"

export function buildCredentialForwarder(deps: {
  host: string
  port: number
  debugger?: (str: string) => void
}): (url: string) => Promise<{ redirectUrl: string }> {
  const debug = deps.debugger ? deps.debugger : () => {}
  return url => {
    return new Promise<{ redirectUrl: string }>((resolve, reject) => {
      const requestOptions: http.RequestOptions = {
        path: "/",
        method: "POST"
      }
      requestOptions.port = deps.port
      requestOptions.host = deps.host
      const req = http.request(requestOptions, res => {
        let outputRaw: string = ""
        res.setEncoding("utf8")
        res.on("data", (chunk: string) => {
          debug(`Data chunk received: "${chunk}"`)
          outputRaw += chunk
        })
        res.on("error", err => {
          debug(`Response received error: "${err}"`)
          reject(err)
        })
        res.on("end", () => {
          const { statusCode, statusMessage } = res
          debug(
            `Status: ${statusCode ?? "No Code"}-${
              statusMessage ?? "No message"
            }`
          )
          if (statusCode !== 200) {
            reject(
              `Http request failed: Status: ${statusCode ?? "No Code"}-${
                statusMessage ?? "No message"
              }`
            )
            return
          }
          debug(`Final output: "${outputRaw}"`)
          const outputSerialized = JSON.parse(outputRaw)
          if (!("url" in outputSerialized)) {
            reject("Response did not contain 'url' property")
          }
          resolve({ redirectUrl: outputSerialized.url })
        })
        res.on("close", () => {
          debug("Response closed")
        })
      })

      req.on("error", err => {
        debug(`Request error: "${err}"`)
        reject(err)
      })

      const requestBody = {
        url
      }
      const serializedRequestBody = JSON.stringify(requestBody)
      debug(`Sending request body: "${serializedRequestBody}"`)
      req.write(serializedRequestBody)
      debug("Ending request")
      req.end()
    })
  }
}
