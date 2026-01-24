import fs from "fs"
import path from "path"
import os from "os"

const CONFIG_DIR = ".oauth2-forwarder"
const WHITELIST_FILE = "whitelist.json"

export type WhitelistConfig = {
  enabled: boolean
  domains: Set<string>
  configPath: string
}

type WhitelistFile = {
  domains: string[]
}

function getConfigPath(): string {
  return path.join(os.homedir(), CONFIG_DIR, WHITELIST_FILE)
}

export function loadWhitelist(): WhitelistConfig {
  const configPath = getConfigPath()

  if (!fs.existsSync(configPath)) {
    return {
      enabled: false,
      domains: new Set(),
      configPath
    }
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8")
    const data = JSON.parse(content) as WhitelistFile

    if (!Array.isArray(data.domains) || data.domains.length === 0) {
      return {
        enabled: false,
        domains: new Set(),
        configPath
      }
    }

    // Normalize domains to lowercase for case-insensitive matching
    const normalizedDomains = new Set(
      data.domains.map(d => d.toLowerCase().trim()).filter(d => d.length > 0)
    )

    return {
      enabled: normalizedDomains.size > 0,
      domains: normalizedDomains,
      configPath
    }
  } catch {
    // If file is malformed, treat as disabled
    return {
      enabled: false,
      domains: new Set(),
      configPath
    }
  }
}

export function isUrlAllowed(url: string, config: WhitelistConfig): boolean {
  if (!config.enabled) {
    return true
  }

  try {
    const parsedUrl = new URL(url)
    const hostname = parsedUrl.hostname.toLowerCase()
    return config.domains.has(hostname)
  } catch {
    // If URL is invalid, reject it
    return false
  }
}

export function getHostnameFromUrl(url: string): string | null {
  try {
    const parsedUrl = new URL(url)
    return parsedUrl.hostname.toLowerCase()
  } catch {
    return null
  }
}

