export function buildRedirect(deps: {
  debugger?: (str: string) => void
}): (url: string) => Promise<void> {
  const debug = deps.debugger ? deps.debugger : () => {}
  return async url => {
    debug(`Making GET request to url: "${url}"`)
    return
  }
}
