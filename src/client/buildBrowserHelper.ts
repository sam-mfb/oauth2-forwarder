export function buildBrowserHelper(deps: {
  onExit: {
    success: () => void
    failure: () => void
  }
  credentialForwarder: (url: string) => Promise<{ redirectUrl: string }>
  redirect: (url: string) => Promise<void>
  debugger?: (str: string) => void
}): (argv: string[]) => Promise<void> {
  return async argv => {
    const debug = deps.debugger ? deps.debugger : () => {}

    const requestUrl = argv[2]

    if (!requestUrl) {
      debug("No url argument present")
      deps.onExit.failure()
      return
    }
    debug(`Received url "${requestUrl}"`)
    try {
      const { redirectUrl } = await deps.credentialForwarder(requestUrl)
      debug(`Received redirect url ${redirectUrl}`)
      debug(`Redirecting ...`)
      await deps.redirect(redirectUrl)
      debug(`Exiting on success...`)
      deps.onExit.success()
    } catch (err) {
      debug(`Browser helper error "${err}"`)
      debug(`Exiting on failure...`)
      deps.onExit.failure()
    }
  }
}
