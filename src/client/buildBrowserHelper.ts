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
  // TODO: this will need a real type, not unknown
  credentialForwarder: (url: string) => Promise<unknown>
  localhostRedirect: (port: number, response: unknown) => Promise<void>
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
    // TODO: actually need to parse the url and get the localhost port it will be listening on
    const port = 99999
    try {
      const output = await deps.credentialForwarder(requestUrl)
      debug(`Received credential output ${output}`)
      debug(`Sending to localhost port ${port}`)
      await deps.localhostRedirect(port, output)
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
