import { color } from "../color"
import { sanitize } from "../sanitize"

export function buildBrowserHelper(deps: {
  streams: {
    error: NodeJS.WriteStream
  }
  onExit: {
    success: () => void
    failure: () => void
  }
  credentialForwarder: (url: string) => Promise<{ url: string }>
  redirect: (url: string) => Promise<void>
  debugger?: (str: string) => void
}): (argv: string[]) => Promise<void> {
  return async argv => {
    const debug = deps.debugger ? deps.debugger : () => {}

    const requestUrl = argv[2]

    if (!requestUrl) {
      debug("No url argument present")
      deps.streams.error.write("No url argument present")
      deps.onExit.failure()
      return
    }
    debug(`Received url "${requestUrl}"`)
    try {
      const output = await deps.credentialForwarder(requestUrl)
      debug(`Received redirect url ${output.url}`)
      debug(`Redirecting ...`)
      await deps.redirect(output.url)
      debug(`Exiting on success...`)
      deps.onExit.success()
    } catch (err) {
      debug(`Credential handler error "${err}"`)
      deps.streams.error.write(
        color("\n" + sanitize(JSON.stringify(err)) + "\n", "red")
      )
      debug(`Exiting on failure...`)
      deps.onExit.failure()
    }
  }
}
