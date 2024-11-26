import { EnvKey } from "../env"
import { buildOutputWriter } from "../output"
import { buildCredentialQuerier } from "./buildCredentialQuerier"
import { type Deps, buildCredentialReceiver } from "./buildCredentialReceiver"
import { findAvailablePort } from "./findAvailablePort"

const DEBUG = process.env[EnvKey.DEBUG]
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

;(async () => {
  const credentialQuerier = buildCredentialQuerier({
    debugger: DEBUG
      ? buildOutputWriter({ color: "magenta", stream: process.stdout })
      : undefined
  })

  const baseDeps = {
    credentialQuerier: credentialQuerier,
    debugger: DEBUG
      ? buildOutputWriter({ color: "green", stream: process.stdout })
      : undefined
  }

  let deps: Deps

  if (userSpecifiedPort) {
    appOutput(`Attempting to use user specified port ${userSpecifiedPort}`)
  }
  const port = userSpecifiedPort ?? (await findAvailablePort(LOCALHOST))
  deps = {
    ...baseDeps,
    host: LOCALHOST,
    port
  }
  const credentialReceiver = buildCredentialReceiver(deps)
  appOutput(`Starting TCP server listening on ${deps.host}:${deps.port}`)
  instructions(`Run the following command in your docker container:\n`)
  configOutput(
    `    export ${EnvKey.SERVER}="${
      deps.host === LOCALHOST ? DOCKER_HOST_IP : deps.host
    }:${deps.port}"\n`
  )
  instructions(
    `\nIn addition, you need to set the BROWSER env variable to point to the client script in the docker container. If you are using the default locations, this will work:\n`
  )
  configOutput(`     export BROWSER=~/oauth2-forwarder/browser.sh\n`)

  try {
    await credentialReceiver()
  } catch (err) {
    errorOutput(JSON.stringify(err))
    process.exit(1)
  }

  appOutput("Ctrl+c to stop server.")
})().catch(err => {
  errorOutput(JSON.stringify(err))
  process.exit(1)
})
