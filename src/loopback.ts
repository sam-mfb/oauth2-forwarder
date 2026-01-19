// Matches localhost, 127.0.0.1, or [::1] (IPv6 loopback in bracket notation)
// Per RFC 8252, loopback redirects should use IP literals for reliability
export const LOOPBACK_PATTERNS = [
  /^http:\/\/localhost(?::(\d{1,5}))?(?:\/.*)?$/, // localhost
  /^http:\/\/127\.0\.0\.1(?::(\d{1,5}))?(?:\/.*)?$/, // IPv4 loopback
  /^http:\/\/\[::1\](?::(\d{1,5}))?(?:\/.*)?$/ // IPv6 loopback
]

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
