import { RedirectResult } from "../redirect-types"

export function buildBrowserHelper(deps: {
  onExit: {
    success: () => void
    failure: () => void
  }
  credentialForwarder: (url: string) => Promise<RedirectResult>
  debugger?: (str: string) => void
}): (requestUrl: string | undefined) => Promise<void> {
  return async requestUrl => {
    const debug = deps.debugger ? deps.debugger : () => {}

    if (!requestUrl) {
      debug("No url argument present")
      deps.onExit.failure()
      return
    }
    debug(`Received url "${requestUrl}"`)
    try {
      const result = await deps.credentialForwarder(requestUrl)
      debug(`Credential forwarding completed with result type: ${result.type}`)

      if (result.type === "error") {
        debug(`Error during credential forwarding: ${result.message}`)
        deps.onExit.failure()
        return
      }

      debug(`Exiting on success...`)
      deps.onExit.success()
    } catch (err) {
      debug(`Browser helper error "${err}"`)
      debug(`Exiting on failure...`)
      deps.onExit.failure()
    }
  }
}
