import http from "http"
import {
  CompletionReport,
  RedirectResult,
  RedirectRequestOptions
} from "../redirect-types"
import { type Logger } from "../logger"

export function buildCredentialForwarder(deps: {
  host: string
  port: number
  redirect: (
    url: string,
    options?: RedirectRequestOptions
  ) => Promise<RedirectResult>
  logger: Logger
}): (url: string) => Promise<RedirectResult> {
  const { logger } = deps

  const sendOauth2Request = (
    url: string
  ): Promise<{
    redirectUrl: string
    requestId: string
    method?: "GET" | "POST"
    body?: string
    contentType?: string
  }> => {
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
          logger.debug(`Data chunk received: "${chunk}"`)
          outputRaw += chunk
        })
        res.on("error", err => {
          logger.error(`Response error: ${err}`)
          reject(err)
        })
        res.on("end", () => {
          const { statusCode, statusMessage } = res
          logger.debug(
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
          logger.debug(`Final output: "${outputRaw}"`)
          const outputSerialized = JSON.parse(outputRaw)
          if (!("url" in outputSerialized)) {
            reject("Response did not contain 'url' property")
            return
          }
          if (!("requestId" in outputSerialized)) {
            reject("Response did not contain 'requestId' property")
            return
          }
          const method = outputSerialized.method === "POST" ? "POST" : undefined
          resolve({
            redirectUrl: outputSerialized.url,
            requestId: outputSerialized.requestId,
            method,
            body:
              typeof outputSerialized.body === "string"
                ? outputSerialized.body
                : undefined,
            contentType:
              typeof outputSerialized.contentType === "string"
                ? outputSerialized.contentType
                : undefined
          })
        })
        res.on("close", () => {
          logger.debug("Response closed")
        })
      })

      req.on("error", err => {
        logger.error(`Request error: ${err}`)
        reject(err)
      })

      const requestBody = { url }
      const serializedRequestBody = JSON.stringify(requestBody)
      logger.debug(`Sending request body: "${serializedRequestBody}"`)
      req.write(serializedRequestBody)
      logger.debug("Ending request")
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
          logger.error(`Completion response error: ${err}`)
          reject(err)
        })
        res.on("end", () => {
          const { statusCode, statusMessage } = res
          logger.debug(
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
        logger.error(`Completion request error: ${err}`)
        reject(err)
      })

      const serializedBody = JSON.stringify(report)
      logger.debug(`Sending completion report: "${serializedBody}"`)
      req.write(serializedBody)
      req.end()
    })
  }

  return async url => {
    // Step 1: Send OAuth2 URL to server
    logger.debug(`Starting credential forwarding for URL: "${url}"`)
    const { redirectUrl, requestId, method, body, contentType } =
      await sendOauth2Request(url)
    logger.debug(
      `Received redirectUrl: "${redirectUrl}", requestId: "${requestId}", method: "${method ?? "GET"}"`
    )

    // Step 2: Perform the redirect (follows localhost redirects, returns non-localhost)
    // For response_mode=form_post the server delivers method=POST plus the
    // form-urlencoded body, so we replay the exact request the OAuth provider
    // made — the local OAuth listener (e.g. MSAL) needs the original POST.
    logger.debug(`Performing redirect to: "${redirectUrl}"`)
    const result = await deps.redirect(redirectUrl, {
      method: method ?? "GET",
      body,
      contentType
    })
    logger.debug(`Redirect result type: "${result.type}"`)

    // Step 3: Send completion report to server
    logger.debug(`Sending completion report for requestId: "${requestId}"`)
    await sendCompletionReport({ requestId, result })
    logger.debug("Completion report sent successfully")

    return result
  }
}
