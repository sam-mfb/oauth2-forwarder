import http from "http"
import { CompletionReport, RedirectResult } from "../redirect-types"

export function buildCredentialForwarder(deps: {
  host: string
  port: number
  redirect: (url: string) => Promise<RedirectResult>
  debugger?: (str: string) => void
}): (url: string) => Promise<RedirectResult> {
  const debug = deps.debugger ? deps.debugger : () => {}

  const sendOauth2Request = (
    url: string
  ): Promise<{ redirectUrl: string; requestId: string }> => {
    return new Promise((resolve, reject) => {
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
            return
          }
          if (!("requestId" in outputSerialized)) {
            reject("Response did not contain 'requestId' property")
            return
          }
          resolve({
            redirectUrl: outputSerialized.url,
            requestId: outputSerialized.requestId
          })
        })
        res.on("close", () => {
          debug("Response closed")
        })
      })

      req.on("error", err => {
        debug(`Request error: "${err}"`)
        reject(err)
      })

      const requestBody = { url }
      const serializedRequestBody = JSON.stringify(requestBody)
      debug(`Sending request body: "${serializedRequestBody}"`)
      req.write(serializedRequestBody)
      debug("Ending request")
      req.end()
    })
  }

  const sendCompletionReport = (report: CompletionReport): Promise<void> => {
    return new Promise((resolve, reject) => {
      const requestOptions: http.RequestOptions = {
        path: "/complete",
        method: "POST"
      }
      requestOptions.port = deps.port
      requestOptions.host = deps.host
      const req = http.request(requestOptions, res => {
        res.on("error", err => {
          debug(`Completion response error: "${err}"`)
          reject(err)
        })
        res.on("end", () => {
          const { statusCode, statusMessage } = res
          debug(
            `Completion status: ${statusCode ?? "No Code"}-${
              statusMessage ?? "No message"
            }`
          )
          if (statusCode !== 200) {
            reject(
              `Completion request failed: Status: ${statusCode ?? "No Code"}-${
                statusMessage ?? "No message"
              }`
            )
            return
          }
          resolve()
        })
        // Drain the response body
        res.on("data", () => {})
      })

      req.on("error", err => {
        debug(`Completion request error: "${err}"`)
        reject(err)
      })

      const serializedBody = JSON.stringify(report)
      debug(`Sending completion report: "${serializedBody}"`)
      req.write(serializedBody)
      req.end()
    })
  }

  return async url => {
    // Step 1: Send OAuth2 URL to server
    debug(`Starting credential forwarding for url: "${url}"`)
    const { redirectUrl, requestId } = await sendOauth2Request(url)
    debug(`Received redirectUrl: "${redirectUrl}", requestId: "${requestId}"`)

    // Step 2: Perform the redirect (follows localhost redirects, returns non-localhost)
    debug(`Performing redirect to: "${redirectUrl}"`)
    const result = await deps.redirect(redirectUrl)
    debug(`Redirect result type: "${result.type}"`)

    // Step 3: Send completion report to server
    debug(`Sending completion report for requestId: "${requestId}"`)
    await sendCompletionReport({ requestId, result })
    debug("Completion report sent successfully")

    return result
  }
}
