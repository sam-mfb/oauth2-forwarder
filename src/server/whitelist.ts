import fs from "fs"
import { getDomain } from "../url-utils"
import { resolveConfigFile, getPreferredConfigDescription } from "../paths"

// Re-export for backward compatibility
export { getDomain }

const WHITELIST_FILE = "whitelist.json"

export type WhitelistConfig = {
  enabled: boolean
  domains: Set<string>
  configPath: string
  /** True if using deprecated ~/.oauth2-forwarder/ location */
  usingLegacyPath: boolean
  /** Human-readable description of the preferred config location */
  preferredLocation: string
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
      preferredLocation
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
        preferredLocation
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
  } catch {
    // If file is malformed, treat as disabled
    return {
      enabled: false,
      domains: new Set(),
      configPath,
      usingLegacyPath: isLegacy,
      preferredLocation
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

