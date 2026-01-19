import http from "http"
import { isLoopbackUrl, convertLoopbackUrl } from "../loopback"

/**
 * Makes an HTTP GET request to the given URL.
 * For loopback URLs, implements RFC 8252 best practice of trying both
 * IPv4 (127.0.0.1) and IPv6 ([::1]) addresses to handle cases where
 * servers may bind to one or the other.
 */
export function buildRedirect(deps: {
  debugger?: (str: string) => void
}): (url: string) => Promise<void> {
  const debug = deps.debugger ? deps.debugger : () => {}

  const makeRequest = (url: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      http
        .get(url, res => {
          // A 302 is the expected response but we will take a 200 as well
          if (res.statusCode !== 200 && res.statusCode !== 302) {
            reject(
              new Error(`Request returned unexpected status: ${res.statusCode}`)
            )
          } else {
            debug(`Received status ${res.statusCode}`)
            resolve()
          }
        })
        .on("error", error => {
          debug(`Received error "${JSON.stringify(error)}"`)
          reject(error)
        })
    })
  }

  return async url => {
    debug(`Making GET request to url: "${url}"`)

    // For loopback URLs, try both IPv4 and IPv6 per RFC 8252 recommendation
    if (isLoopbackUrl(url)) {
      const ipv4Url = convertLoopbackUrl(url, "127.0.0.1")
      const ipv6Url = convertLoopbackUrl(url, "[::1]")

      // Try IPv4 first (more commonly supported), then fall back to IPv6
      debug(`Loopback URL detected, will try IPv4 then IPv6`)
      try {
        debug(`Trying IPv4: ${ipv4Url}`)
        await makeRequest(ipv4Url)
        return
      } catch (ipv4Error) {
        const err = ipv4Error as NodeJS.ErrnoException
        // Only try IPv6 if the error was a connection refusal
        // (indicating the server isn't listening on IPv4)
        if (err.code === "ECONNREFUSED") {
          debug(`IPv4 connection refused, trying IPv6: ${ipv6Url}`)
          try {
            await makeRequest(ipv6Url)
            return
          } catch (ipv6Error) {
            const err6 = ipv6Error as NodeJS.ErrnoException
            // Both failed - throw a descriptive error
            throw new Error(
              `Connection refused on both IPv4 and IPv6. ` +
                `IPv4 error: ${err.message}, IPv6 error: ${err6.message}`
            )
          }
        }
        // For other errors (not ECONNREFUSED), rethrow
        throw ipv4Error
      }
    }

    // Non-loopback URLs: make the request directly
    await makeRequest(url)
  }
}
