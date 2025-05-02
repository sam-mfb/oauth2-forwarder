import { Result } from "./result"

export function extractPort(uri: string): Result<number | undefined> {
  const localhostUrlRegex = /^http:\/\/localhost(?::(\d{1,5}))?$/
  const match = uri.match(localhostUrlRegex)

  if (!match) {
    return Result.failure(new Error("Invalid URL format"))
  }

  const port = match[1] ? parseInt(match[1], 10) : undefined
  if (port === undefined) {
    return Result.success(undefined)
  }
  if (isNaN(port) || port < 0 || port > 65535) {
    return Result.failure(new Error(`Not a valid port: ${port}`))
  }

  return Result.success(port)
}
