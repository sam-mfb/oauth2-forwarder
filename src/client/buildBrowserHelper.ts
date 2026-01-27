import { RedirectResult } from "../redirect-types"
import { type Logger } from "../logger"

// Extract domain from URL for cleaner logging
const getDomain = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return "unknown"
  }
}

export function buildBrowserHelper(deps: {
  onExit: {
    success: () => void
    failure: () => void
  }
  credentialForwarder: (url: string) => Promise<RedirectResult>
  logger: Logger
}): (requestUrl: string | undefined) => Promise<void> {
  return async requestUrl => {
    const { logger } = deps

    if (!requestUrl) {
      logger.warn("No URL argument present")
      deps.onExit.failure()
      return
    }
    logger.debug(`Received url "${requestUrl}"`)
    const domain = getDomain(requestUrl)
    try {
      const result = await deps.credentialForwarder(requestUrl)
      logger.info(`Completed request for ${domain}`)
      logger.debug(`Result type: ${result.type}`)

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
