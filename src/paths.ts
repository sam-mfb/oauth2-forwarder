import fs from "fs"
import path from "path"
import os from "os"

/**
 * OS-aware path resolution for oauth2-forwarder.
 *
 * Log directories:
 *   - Linux: $XDG_STATE_HOME/oauth2-forwarder/ (default: ~/.local/state/oauth2-forwarder/)
 *   - macOS: ~/Library/Logs/oauth2-forwarder/
 *   - Windows: %LOCALAPPDATA%\oauth2-forwarder\logs\
 *
 * Config directories:
 *   - Linux: $XDG_CONFIG_HOME/oauth2-forwarder/ (default: ~/.config/oauth2-forwarder/)
 *   - macOS: ~/Library/Application Support/oauth2-forwarder/
 *   - Windows: %LOCALAPPDATA%\oauth2-forwarder\
 *
 * Legacy config directory (all platforms): ~/.oauth2-forwarder/
 */

const APP_NAME = "oauth2-forwarder"
const LEGACY_CONFIG_DIR = ".oauth2-forwarder"

export type PathConfig = {
  configDir: string
  logDir: string
  legacyConfigDir: string
  usingLegacyConfig: boolean
}

function getLogDirectory(): string {
  const platform = os.platform()
  const home = os.homedir()

  switch (platform) {
    case "darwin":
      // macOS: ~/Library/Logs/oauth2-forwarder/
      return path.join(home, "Library", "Logs", APP_NAME)

    case "win32": {
      // Windows: %LOCALAPPDATA%\oauth2-forwarder\logs\
      const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")
      return path.join(localAppData, APP_NAME, "logs")
    }

    default: {
      // Linux and others: $XDG_STATE_HOME/oauth2-forwarder/ (default: ~/.local/state/oauth2-forwarder/)
      const xdgStateHome = process.env.XDG_STATE_HOME || path.join(home, ".local", "state")
      return path.join(xdgStateHome, APP_NAME)
    }
  }
}

function getConfigDirectory(): string {
  const platform = os.platform()
  const home = os.homedir()

  switch (platform) {
    case "darwin":
      // macOS: ~/Library/Application Support/oauth2-forwarder/
      return path.join(home, "Library", "Application Support", APP_NAME)

    case "win32": {
      // Windows: %LOCALAPPDATA%\oauth2-forwarder\
      const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")
      return path.join(localAppData, APP_NAME)
    }

    default: {
      // Linux and others: $XDG_CONFIG_HOME/oauth2-forwarder/ (default: ~/.config/oauth2-forwarder/)
      const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config")
      return path.join(xdgConfigHome, APP_NAME)
    }
  }
}

function getLegacyConfigDirectory(): string {
  return path.join(os.homedir(), LEGACY_CONFIG_DIR)
}

/**
 * Ensures the directory exists, creating it if necessary.
 */
export function ensureDirectory(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * Gets the full path to a log file.
 */
export function getLogFilePath(component: "server" | "client"): string {
  const logDir = getLogDirectory()
  return path.join(logDir, `o2f-${component}.log`)
}

/**
 * Gets the log directory path.
 */
export function getLogDir(): string {
  return getLogDirectory()
}

/**
 * Gets the preferred (OS-standard) config directory path.
 */
export function getConfigDir(): string {
  return getConfigDirectory()
}

/**
 * Gets the legacy config directory path (~/.oauth2-forwarder/).
 */
export function getLegacyConfigDir(): string {
  return getLegacyConfigDirectory()
}

/**
 * Resolves the config file path, checking legacy location first for backwards compatibility.
 * Returns both the path to use and whether it's using the legacy location.
 */
export function resolveConfigFile(filename: string): { path: string; isLegacy: boolean } {
  const legacyPath = path.join(getLegacyConfigDirectory(), filename)
  const preferredPath = path.join(getConfigDirectory(), filename)

  // Check if file exists in legacy location
  if (fs.existsSync(legacyPath)) {
    return { path: legacyPath, isLegacy: true }
  }

  // Use preferred location (may or may not exist)
  return { path: preferredPath, isLegacy: false }
}

/**
 * Gets a human-readable description of the preferred config location for the current OS.
 * Used in deprecation warnings.
 */
export function getPreferredConfigDescription(): string {
  const platform = os.platform()

  switch (platform) {
    case "darwin":
      return "~/Library/Application Support/oauth2-forwarder/"
    case "win32":
      return "%LOCALAPPDATA%\\oauth2-forwarder\\"
    default:
      return "~/.config/oauth2-forwarder/ (or $XDG_CONFIG_HOME/oauth2-forwarder/)"
  }
}
