import http from "http"

export function buildRedirect(deps: {
  debugger?: (str: string) => void
}): (url: string) => Promise<void> {
  const debug = deps.debugger ? deps.debugger : () => {}
  return async url => {
    debug(`Making GET request to url: "${url}"`)
    return new Promise((resolve, reject) => {
      http
        .get(url, res => {
          //A 302 is the expected response but we will take a 200 as well
          if (res.statusCode !== 200 && res.statusCode !== 302) {
            reject(`Request returned unexpected status: ${res.statusCode}`)
          } else {
            debug(`Received status ${res.statusCode}`)
            resolve()
          }
        })
        .on("error", error => {
          debug(`Received error "${JSON.stringify(error)}"`)
          reject(error.message)
        })
    })
  }
}
