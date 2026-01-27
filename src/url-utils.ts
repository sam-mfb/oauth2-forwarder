/**
 * Extracts the hostname (domain) from a URL.
 * Returns null if the URL cannot be parsed.
 */
export function getDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}
