import fs from "fs"
import { getDomain } from "../url-utils"
import { resolveConfigFile, getPreferredConfigDescription } from "../paths"

// Re-export for backward compatibility
export { getDomain }

const WHITELIST_FILE = "whitelist.json"

export type WhitelistDisabledReason =
  "file-not-found" | "empty-domains" | "parse-error"

export type WhitelistConfig = {
  enabled: boolean
  /**
   * Normalized (lowercase, trimmed) entries. Each is either an exact hostname
   * or a wildcard of the form `*.suffix`, which matches any hostname ending in
   * `.suffix` (one or more labels deep) but not `suffix` itself.
   */
  domains: Set<string>
  /**
   * Entries that contain `*` but are not of the form `*.suffix`. They stay in
   * `domains`, where they never match, so a typo cannot turn the whitelist off.
   * Empty when every entry is valid.
   */
  invalidEntries: string[]
  configPath: string
  /** True if using deprecated ~/.oauth2-forwarder/ location */
  usingLegacyPath: boolean
  /** Human-readable description of the preferred config location */
  preferredLocation: string
  /** Why the whitelist is disabled (only set when enabled is false) */
  disabledReason?: WhitelistDisabledReason
  /** The parse error message if disabledReason is "parse-error" */
  parseError?: string
}

type WhitelistFile = {
  domains: string[]
}

export function loadWhitelist(): WhitelistConfig {
  const { path: configPath, isLegacy } = resolveConfigFile(WHITELIST_FILE)
  const preferredLocation = getPreferredConfigDescription()

  if (!fs.existsSync(configPath)) {
    return {
      enabled: false,
      domains: new Set(),
      invalidEntries: [],
      configPath,
      usingLegacyPath: false,
      preferredLocation,
      disabledReason: "file-not-found"
    }
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8")
    const data = JSON.parse(content) as WhitelistFile

    if (!Array.isArray(data.domains) || data.domains.length === 0) {
      return {
        enabled: false,
        domains: new Set(),
        invalidEntries: [],
        configPath,
        usingLegacyPath: isLegacy,
        preferredLocation,
        disabledReason: "empty-domains"
      }
    }

    // Normalize domains to lowercase for case-insensitive matching
    const normalizedDomains = new Set(
      data.domains.map(d => d.toLowerCase().trim()).filter(d => d.length > 0)
    )

    return {
      enabled: normalizedDomains.size > 0,
      domains: normalizedDomains,
      invalidEntries: Array.from(normalizedDomains).filter(
        d => d.includes("*") && wildcardSuffix(d) === null
      ),
      configPath,
      usingLegacyPath: isLegacy,
      preferredLocation,
      disabledReason: normalizedDomains.size > 0 ? undefined : "empty-domains"
    }
  } catch (err) {
    return {
      enabled: false,
      domains: new Set(),
      invalidEntries: [],
      configPath,
      usingLegacyPath: isLegacy,
      preferredLocation,
      disabledReason: "parse-error",
      parseError: err instanceof Error ? err.message : String(err)
    }
  }
}

export function isUrlAllowed(url: string, config: WhitelistConfig): boolean {
  if (!config.enabled) {
    return true
  }

  const hostname = getDomain(url)
  if (!hostname) {
    // If URL is invalid, reject it
    return false
  }
  // A hostname containing `*` is never allowed, so it cannot match a
  // wildcard or malformed entry literally.
  if (hostname.includes("*")) {
    return false
  }
  if (config.domains.has(hostname)) {
    return true
  }
  for (const entry of config.domains) {
    const suffix = wildcardSuffix(entry)
    if (suffix !== null && hostname.endsWith(`.${suffix}`)) {
      return true
    }
  }
  return false
}

/**
 * Returns the suffix of a wildcard entry such as `*.example.com` (here
 * `example.com`), or null if the entry is not a valid wildcard. A valid
 * wildcard is `*.` followed by one or more non-empty labels with no further `*`.
 */
export function wildcardSuffix(entry: string): string | null {
  if (!entry.startsWith("*.")) {
    return null
  }
  const suffix = entry.slice(2)
  const labels = suffix.split(".")
  if (labels.some(label => label.length === 0 || label.includes("*"))) {
    return null
  }
  return suffix
}
