import http from "http"

export function buildCredentialForwarder(deps: {
  host: string
  port: number
  debugger?: (str: string) => void
}): (url: string) => Promise<unknown> {
  const debug = deps.debugger ? deps.debugger : () => {}
  return url => {
    return new Promise<unknown>((resolve, reject) => {
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
          }
          debug(`Final output: "${outputRaw}"`)
          resolve(outputRaw)
        })
        res.on("close", () => {
          debug("Response closed")
        })
      })

      req.on("error", reject)
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
