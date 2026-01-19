import { Result } from "./result"

// Matches localhost, 127.0.0.1, or [::1] (IPv6 loopback in bracket notation)
// Per RFC 8252, loopback redirects should use IP literals for reliability
const LOOPBACK_PATTERNS = [
  /^http:\/\/localhost(?::(\d{1,5}))?(?:\/.*)?$/, // localhost
  /^http:\/\/127\.0\.0\.1(?::(\d{1,5}))?(?:\/.*)?$/, // IPv4 loopback
  /^http:\/\/\[::1\](?::(\d{1,5}))?(?:\/.*)?$/, // IPv6 loopback
]

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

/**
 * Checks if a URL is a loopback address (localhost, 127.0.0.1, or [::1])
 */
export function isLoopbackUrl(uri: string): boolean {
  return LOOPBACK_PATTERNS.some(pattern => pattern.test(uri))
}

/**
 * Converts a loopback URL to use a specific IP address.
 * Useful for trying both IPv4 and IPv6 connections.
 */
export function convertLoopbackUrl(
  uri: string,
  targetAddress: "127.0.0.1" | "[::1]"
): string {
  // Replace localhost, 127.0.0.1, or [::1] with the target address
  return uri
    .replace(/^(http:\/\/)localhost(:\d+)?/, `$1${targetAddress}$2`)
    .replace(/^(http:\/\/)127\.0\.0\.1(:\d+)?/, `$1${targetAddress}$2`)
    .replace(/^(http:\/\/)\[::1\](:\d+)?/, `$1${targetAddress}$2`)
}
