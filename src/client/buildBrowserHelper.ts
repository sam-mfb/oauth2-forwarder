import { RedirectResult } from "../redirect-types"
import { type Logger, buildNoOpLogger } from "../logger"

export function buildBrowserHelper(deps: {
  onExit: {
    success: () => void
    failure: () => void
  }
  credentialForwarder: (url: string) => Promise<RedirectResult>
  logger?: Logger
}): (requestUrl: string | undefined) => Promise<void> {
  return async requestUrl => {
    const logger = deps.logger ?? buildNoOpLogger()

    if (!requestUrl) {
      logger.warn("No URL argument present")
      deps.onExit.failure()
      return
    }
    logger.debug(`Received url "${requestUrl}"`)
    try {
      const result = await deps.credentialForwarder(requestUrl)
      logger.info(`Credential forwarding completed with result: ${result.type}`)

      if (result.type === "error") {
        logger.error(`Error during credential forwarding: ${result.message}`)
        deps.onExit.failure()
        return
      }

      logger.debug("Exiting on success")
      deps.onExit.success()
    } catch (err) {
      logger.error(`Browser helper error: ${err}`)
      deps.onExit.failure()
    }
  }
}
