import { getVersion } from "../version"
import { EnvKey } from "../env"
import { buildOutputWriter } from "../output"
import { buildInteractiveLogin } from "./buildInteractiveLogin"
import { buildCredentialProxy } from "./buildCredentialProxy"
import { findAvailablePort } from "./findAvailablePort"
import { loadWhitelist } from "./whitelist"
import open from "open"

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(`o2f-server v${getVersion()}`)
  process.exit(0)
}

const DEBUG = process.env[EnvKey.DEBUG]
const PASSTHROUGH = process.env[EnvKey.PASSTHROUGH] === "true"
const LOCALHOST = "127.0.0.1"
const DOCKER_HOST_IP = "host.docker.internal"

// Parse login timeout from env (in seconds), default handled by buildInteractiveLogin
let loginTimeoutMs: number | undefined
const loginTimeoutEnv = process.env[EnvKey.LOGIN_TIMEOUT]
if (loginTimeoutEnv) {
  const parsedTimeout = parseInt(loginTimeoutEnv)
  if (!isNaN(parsedTimeout) && parsedTimeout > 0) {
    loginTimeoutMs = parsedTimeout * 1000 // Convert seconds to milliseconds
  }
}

const appOutput = buildOutputWriter({ color: "cyan", stream: process.stdout })
const instructions = buildOutputWriter({
  color: "yellow",
  stream: process.stdout
})
const configOutput = buildOutputWriter({
  color: "white",
  stream: process.stdout
})
const errorOutput = buildOutputWriter({ color: "red", stream: process.stderr })

let userSpecifiedPort: number | null = null
const portEnv = process.env[EnvKey.PORT]
if (portEnv) {
  const parsedPort = parseInt(portEnv)
  if (!isNaN(parsedPort)) {
    userSpecifiedPort = parsedPort
  }
}

const openBrowser = async (url: string): Promise<void> => {
  await open(url)
  return
}

const interactiveLogin = buildInteractiveLogin({
  openBrowser: openBrowser,
  debugger: DEBUG
    ? buildOutputWriter({ color: "magenta", stream: process.stdout })
    : undefined,
  loginTimeoutMs
})

;(async () => {
  if (userSpecifiedPort) {
    appOutput(`Attempting to use user specified port ${userSpecifiedPort}`)
  }
  const port = userSpecifiedPort ?? (await findAvailablePort(LOCALHOST))

  // Load whitelist configuration
  const whitelist = loadWhitelist()
  if (whitelist.enabled) {
    appOutput(
      `URL whitelist enabled with ${whitelist.domains.size} domain(s): ${Array.from(whitelist.domains).join(", ")}`
    )
  } else {
    appOutput(`URL whitelist disabled (no whitelist file at ${whitelist.configPath})`)
  }

  const credentialProxy = buildCredentialProxy({
    host: LOCALHOST,
    port,
    interactiveLogin: interactiveLogin,
    openBrowser: openBrowser,
    passthrough: PASSTHROUGH,
    debugger: DEBUG
      ? buildOutputWriter({ color: "green", stream: process.stdout })
      : undefined,
    pendingRequestTtlMs: loginTimeoutMs,
    whitelist,
    logger: appOutput
  })

  appOutput(`Starting TCP server listening on ${LOCALHOST}:${port}`)
  if (PASSTHROUGH) {
    appOutput(
      "Passthrough mode enabled: malformed URLs will be opened in browser"
    )
  }
  instructions(`Run the following command in your docker container:\n`)
  configOutput(`    export ${EnvKey.SERVER}="${DOCKER_HOST_IP}:${port}"\n`)
  instructions(
    `\nIn addition, you need to set the BROWSER env variable to point to the client script in the docker container.\n`
  )
  instructions(`If you installed via npm (recommended):\n`)
  configOutput(`    export BROWSER=o2f-browser\n`)
  instructions(`If you installed manually to the default location:\n`)
  configOutput(`    export BROWSER=~/o2f/browser.sh\n`)

  try {
    // note even though this is async it only awaits the start of the server--execution will proceed
    // after the server successfully starts
    await credentialProxy()
    appOutput("Ctrl+c to stop server.")
  } catch (err) {
    errorOutput(JSON.stringify(err))
    process.exit(1)
  }
})().catch(err => {
  errorOutput(JSON.stringify(err))
  process.exit(1)
})
