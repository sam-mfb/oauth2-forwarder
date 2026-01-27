import { getVersion } from "../version"
import { EnvKey } from "../env"
import { buildLogger, type LogLevel } from "../logger"
import { Result } from "../result"
import { buildBrowserHelper } from "./buildBrowserHelper"
import { buildCredentialForwarder } from "./buildCredentialForwarder"
import { buildRedirect } from "./buildRedirect"
import { parseServerInfo } from "./parseServerInfo"

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(`o2f-client v${getVersion()}`)
  process.exit(0)
}

const DEBUG = process.env[EnvKey.DEBUG]

// Set log level based on DEBUG env variable
const logLevel: LogLevel = DEBUG ? "debug" : "info"
const logger = buildLogger({ level: logLevel, stream: process.stderr, prefix: "client" })

const serverInfoRaw = process.env[EnvKey.SERVER]
if (!serverInfoRaw) {
  logger.error(`The environmental variable ${[EnvKey.SERVER]} was not defined`)
  process.exit(1)
}

const serverInfoResult = parseServerInfo(serverInfoRaw)
if (Result.isFailure(serverInfoResult)) {
  logger.error(`Invalid server info: "${serverInfoResult.error.message}"`)
  process.exit(1)
}

const serverInfo = serverInfoResult.value

const redirect = buildRedirect({
  logger
})

const credentialForwarder = buildCredentialForwarder({
  host: serverInfo.host,
  port: serverInfo.port,
  redirect: redirect,
  logger
})

const browserHelper = buildBrowserHelper({
  onExit: {
    success: function (): void {
      process.exit(0)
    },
    failure: function (): void {
      process.exit(1)
    }
  },
  credentialForwarder: credentialForwarder,
  logger
})

const requestUrl = process.argv[2]

// Extract domain for cleaner info logging
const getDomain = (url: string | undefined): string => {
  if (!url) return "(none)"
  try {
    return new URL(url).hostname
  } catch {
    return "(invalid URL)"
  }
}

logger.info(`Processing request for ${getDomain(requestUrl)}`)
logger.debug(`Full URL: ${requestUrl ?? "(none)"}`)
browserHelper(requestUrl).catch(err => logger.error(String(err)))
