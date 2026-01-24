import http from "http"
import { isLoopbackUrl, convertLoopbackUrl } from "../loopback"
import { RedirectResult } from "../redirect-types"

const MAX_REDIRECTS = 10
const TIMEOUT_MS = 30000

type RequestResult = {
  statusCode: number
  location?: string
  body: string
}

/**
 * Makes an HTTP GET request to the given URL and returns the result.
 * For loopback URLs, implements RFC 8252 best practice of trying both
 * IPv4 (127.0.0.1) and IPv6 ([::1]) addresses to handle cases where
 * servers may bind to one or the other.
 */
export function buildRedirect(deps: {
  debugger?: (str: string) => void
}): (url: string) => Promise<RedirectResult> {
  const debug = deps.debugger ? deps.debugger : () => {}

  const makeRequest = (url: string): Promise<RequestResult> => {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Request timed out after ${TIMEOUT_MS}ms`))
      }, TIMEOUT_MS)

      const req = http.get(url, res => {
        clearTimeout(timeoutId)
        const chunks: Buffer[] = []

        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk)
        })

        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8")
          const location = res.headers.location
          resolve({
            statusCode: res.statusCode ?? 0,
            location,
            body
          })
        })

        res.on("error", error => {
          reject(error)
        })
      })

      req.on("error", error => {
        clearTimeout(timeoutId)
        debug(`Received error "${JSON.stringify(error)}"`)
        reject(error)
      })
    })
  }

  const makeRequestWithLoopbackFallback = async (
    url: string
  ): Promise<RequestResult> => {
    if (isLoopbackUrl(url)) {
      const ipv4Url = convertLoopbackUrl(url, "127.0.0.1")
      const ipv6Url = convertLoopbackUrl(url, "[::1]")

      debug(`Loopback URL detected, will try IPv4 then IPv6`)
      try {
        debug(`Trying IPv4: ${ipv4Url}`)
        return await makeRequest(ipv4Url)
      } catch (ipv4Error) {
        const err = ipv4Error as NodeJS.ErrnoException
        if (err.code === "ECONNREFUSED") {
          debug(`IPv4 connection refused, trying IPv6: ${ipv6Url}`)
          try {
            return await makeRequest(ipv6Url)
          } catch (ipv6Error) {
            const err6 = ipv6Error as NodeJS.ErrnoException
            throw new Error(
              `Connection refused on both IPv4 and IPv6. ` +
                `IPv4 error: ${err.message}, IPv6 error: ${err6.message}`
            )
          }
        }
        throw ipv4Error
      }
    }
    return await makeRequest(url)
  }

  const followRedirects = async (
    url: string,
    remainingRedirects: number
  ): Promise<RedirectResult> => {
    debug(`Making GET request to url: "${url}" (${remainingRedirects} redirects remaining)`)

    if (remainingRedirects <= 0) {
      return {
        type: "error",
        message: `Exceeded maximum number of redirects (${MAX_REDIRECTS})`
      }
    }

    let result: RequestResult
    try {
      result = await makeRequestWithLoopbackFallback(url)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { type: "error", message }
    }

    debug(`Received status ${result.statusCode}`)

    if (result.statusCode === 301 || result.statusCode === 302) {
      const location = result.location
      if (!location) {
        return {
          type: "error",
          message: `Received ${result.statusCode} without Location header`
        }
      }

      debug(`Redirect to: ${location}`)

      // If redirect is to a loopback URL, follow it
      if (isLoopbackUrl(location)) {
        debug(`Following localhost redirect`)
        return followRedirects(location, remainingRedirects - 1)
      }

      // Non-localhost redirect: return it for the server to forward to browser
      return { type: "redirect", location }
    }

    if (result.statusCode === 200) {
      debug(`Success with body length: ${result.body.length}`)
      return { type: "success", body: result.body || undefined }
    }

    return {
      type: "error",
      message: `Request returned unexpected status: ${result.statusCode}`
    }
  }

  return url => followRedirects(url, MAX_REDIRECTS)
}
