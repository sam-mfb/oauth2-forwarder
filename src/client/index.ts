import { EnvKey } from "../env"
import { buildOutputWriter } from "../output"
import { Result } from "../result"
import { buildBrowserHelper } from "./buildBrowserHelper"
import { buildCredentialForwarder } from "./buildCredentialForwarder"
import { parseServerInfo } from "./parseServerInfo"

const DEBUG = process.env[EnvKey.DEBUG]

const errorOutput = buildOutputWriter({ color: "red", stream: process.stderr })

const serverInfoRaw = process.env[EnvKey.SERVER]
if (!serverInfoRaw) {
  errorOutput(`The environmental variable ${[EnvKey.SERVER]} was not defined`)
  process.exit(1)
}

const serverInfoResult = parseServerInfo(serverInfoRaw)
if (Result.isFailure(serverInfoResult)) {
  errorOutput(`Invalid server info: "${serverInfoResult.error.message}"`)
  process.exit(1)
}

const serverInfo = serverInfoResult.value

const credentialForwarder = buildCredentialForwarder({
  host: serverInfo.host,
  port: serverInfo.port,
  debugger: DEBUG
    ? buildOutputWriter({ color: "cyan", stream: process.stderr })
    : undefined
})

const browserHelper = buildBrowserHelper({
  streams: {
    error: process.stderr
  },
  onExit: {
    success: function (): void {
      process.exit(0)
    },
    failure: function (): void {
      process.exit(1)
    }
  },
  credentialForwarder: credentialForwarder,
  localhostRedirect: async (port, response) => {
    console.log(`Will send ${response} to localhost:${port}`)
  },
  debugger: DEBUG
    ? buildOutputWriter({ color: "green", stream: process.stderr })
    : undefined
})

browserHelper(process.argv).catch(
  buildOutputWriter({ color: "red", stream: process.stderr })
)
