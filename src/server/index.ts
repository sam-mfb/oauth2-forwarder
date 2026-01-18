import { EnvKey } from "../env"
import { buildOutputWriter } from "../output"
import { buildInteractiveLogin } from "./buildInteractiveLogin"
import { buildCredentialProxy } from "./buildCredentialProxy"
import { findAvailablePort } from "./findAvailablePort"
import open from "open"

const DEBUG = process.env[EnvKey.DEBUG]
const PASSTHROUGH = process.env[EnvKey.PASSTHROUGH] === "true"
const LOCALHOST = "127.0.0.1"
const DOCKER_HOST_IP = "host.docker.internal"

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
    : undefined
})

;(async () => {
  if (userSpecifiedPort) {
    appOutput(`Attempting to use user specified port ${userSpecifiedPort}`)
  }
  const port = userSpecifiedPort ?? (await findAvailablePort(LOCALHOST))

  const credentialProxy = buildCredentialProxy({
    host: LOCALHOST,
    port,
    interactiveLogin: interactiveLogin,
    openBrowser: openBrowser,
    passthrough: PASSTHROUGH,
    debugger: DEBUG
      ? buildOutputWriter({ color: "green", stream: process.stdout })
      : undefined
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
    `\nIn addition, you need to set the BROWSER env variable to point to the client script in the docker container. If you are using the default locations, this will work:\n`
  )
  configOutput(`     export BROWSER=~/o2f/browser.sh\n`)

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
