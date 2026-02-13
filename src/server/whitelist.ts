import fs from "fs"
import { getDomain } from "../url-utils"
import { resolveConfigFile, getPreferredConfigDescription } from "../paths"

// Re-export for backward compatibility
export { getDomain }

const WHITELIST_FILE = "whitelist.json"

export type WhitelistDisabledReason =
  | "file-not-found"
  | "empty-domains"
  | "parse-error"

export type WhitelistConfig = {
  enabled: boolean
  domains: Set<string>
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
      configPath,
      usingLegacyPath: isLegacy,
      preferredLocation
    }
  } catch (err) {
    return {
      enabled: false,
      domains: new Set(),
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
  return config.domains.has(hostname)
}

