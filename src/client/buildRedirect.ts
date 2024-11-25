import http from "http"

export function buildRedirect(deps: {
  debugger?: (str: string) => void
}): (url: string) => Promise<void> {
  const debug = deps.debugger ? deps.debugger : () => {}
  return async url => {
    debug(`Making GET request to url: "${url}"`)
    return new Promise((resolve, reject) => {
      http.get(url, res => {
        if (res.statusCode !== 200) {
          reject(`Request returned unexpected status: ${res.statusCode}`)
        } else {
          resolve()
        }
      })
    })
  }
}
