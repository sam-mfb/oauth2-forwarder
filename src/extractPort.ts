import { Result } from "./result"
import { LOOPBACK_PATTERNS } from "./loopback"

export function extractPort(uri: string): Result<number | undefined> {
  let match: RegExpMatchArray | null = null

  for (const pattern of LOOPBACK_PATTERNS) {
    match = uri.match(pattern)
    if (match) break
  }

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
