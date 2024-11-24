import { Result } from "../result"

type ServerInfo = {
  host: string
  port: number
}

/*
 * Parses a string that contains either host:port information. Returns
 * an error result if the string is not valid.
 */
export function parseServerInfo(info: string): Result<ServerInfo> {
  const tcpRegex = /^(.+):(\d+)$/
  const tcpMatch = info.match(tcpRegex)

  if (tcpMatch) {
    const [, host, portStr] = tcpMatch
    if (!host) {
      return Result.failure(new Error(`No host defined`))
    }
    if (!portStr) {
      return Result.failure(new Error(`No port defined`))
    }
    const port = parseInt(portStr, 10)
    if (isNaN(port) || port < 0 || port > 65535) {
      return Result.failure(new Error(`Not a valid port: ${port}`))
    }
    return Result.success({
      host,
      port
    })
  }

  return Result.failure(
    new Error(
      "Invalid server info format, must be either a host:port or a valid socket path"
    )
  )
}
