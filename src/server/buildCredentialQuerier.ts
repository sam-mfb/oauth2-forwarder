export function buildCredentialQuerier(deps: {
  debugger?: (str: string) => void
}): () => Promise<void> {
  const debug = deps.debugger ? deps.debugger : () => {}

  return async () => {
    debug("Running stub querier...")
  }
}
