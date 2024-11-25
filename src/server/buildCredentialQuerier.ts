export function buildCredentialQuerier(deps: {
  debugger?: (str: string) => void
}): (url: string, responsePort: number) => Promise<string> {
  const debug = deps.debugger ? deps.debugger : () => {}

  return async (url, responsePort) => {
    debug(
      `Will send query to url "${url}" and listen for response at http://localhost:${responsePort}`
    )
    return "Fake response"
  }
}
