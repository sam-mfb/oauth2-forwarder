import fs from "fs"
import { vi, type Mocked } from "vitest"
import {
  loadWhitelist,
  isUrlAllowed,
  getDomain,
  WhitelistConfig
} from "../whitelist"

// Mock fs and paths modules
vi.mock("fs")
vi.mock("../../paths", () => ({
  resolveConfigFile: vi.fn(),
  getPreferredConfigDescription: vi.fn()
}))

import { resolveConfigFile, getPreferredConfigDescription } from "../../paths"

const mockFs = fs as Mocked<typeof fs>
const mockResolveConfigFile = resolveConfigFile as Mocked<typeof resolveConfigFile>
const mockGetPreferredConfigDescription = getPreferredConfigDescription as Mocked<
  typeof getPreferredConfigDescription
>

describe("whitelist", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveConfigFile.mockReturnValue({
      path: "/home/testuser/.oauth2-forwarder/whitelist.json",
      isLegacy: false
    })
    mockGetPreferredConfigDescription.mockReturnValue("~/.config/oauth2-forwarder/")
  })

  describe("loadWhitelist", () => {
    it("returns disabled config when whitelist file does not exist", () => {
      mockFs.existsSync.mockReturnValue(false)

      const config = loadWhitelist()

      expect(config.enabled).toBe(false)
      expect(config.domains.size).toBe(0)
      expect(config.configPath).toBe(
        "/home/testuser/.oauth2-forwarder/whitelist.json"
      )
    })

    it("returns disabled config when file has empty domains array", () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ domains: [] }))

      const config = loadWhitelist()

      expect(config.enabled).toBe(false)
      expect(config.domains.size).toBe(0)
    })

    it("returns enabled config with domains from file", () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          domains: ["login.microsoftonline.com", "accounts.google.com"]
        })
      )

      const config = loadWhitelist()

      expect(config.enabled).toBe(true)
      expect(config.domains.size).toBe(2)
      expect(config.domains.has("login.microsoftonline.com")).toBe(true)
      expect(config.domains.has("accounts.google.com")).toBe(true)
    })

    it("normalizes domains to lowercase", () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          domains: ["Login.MicrosoftOnline.COM", "ACCOUNTS.GOOGLE.COM"]
        })
      )

      const config = loadWhitelist()

      expect(config.domains.has("login.microsoftonline.com")).toBe(true)
      expect(config.domains.has("accounts.google.com")).toBe(true)
    })

    it("trims whitespace from domains", () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          domains: ["  login.microsoftonline.com  ", " accounts.google.com "]
        })
      )

      const config = loadWhitelist()

      expect(config.domains.has("login.microsoftonline.com")).toBe(true)
      expect(config.domains.has("accounts.google.com")).toBe(true)
    })

    it("filters out empty strings from domains", () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          domains: ["login.microsoftonline.com", "", "  ", "accounts.google.com"]
        })
      )

      const config = loadWhitelist()

      expect(config.enabled).toBe(true)
      expect(config.domains.size).toBe(2)
    })

    it("returns disabled config when file contains invalid JSON", () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue("not valid json")

      const config = loadWhitelist()

      expect(config.enabled).toBe(false)
      expect(config.domains.size).toBe(0)
    })

    it("returns disabled config when domains is not an array", () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ domains: "not-an-array" })
      )

      const config = loadWhitelist()

      expect(config.enabled).toBe(false)
      expect(config.domains.size).toBe(0)
    })

    it("sets usingLegacyPath to true when config is in legacy location", () => {
      mockResolveConfigFile.mockReturnValue({
        path: "/home/testuser/.oauth2-forwarder/whitelist.json",
        isLegacy: true
      })
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ domains: ["example.com"] })
      )

      const config = loadWhitelist()

      expect(config.usingLegacyPath).toBe(true)
      expect(config.preferredLocation).toBe("~/.config/oauth2-forwarder/")
    })

    it("sets usingLegacyPath to false when config is in preferred location", () => {
      mockResolveConfigFile.mockReturnValue({
        path: "/home/testuser/.config/oauth2-forwarder/whitelist.json",
        isLegacy: false
      })
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ domains: ["example.com"] })
      )

      const config = loadWhitelist()

      expect(config.usingLegacyPath).toBe(false)
    })

    it("includes preferredLocation in config", () => {
      mockGetPreferredConfigDescription.mockReturnValue(
        "~/Library/Application Support/oauth2-forwarder/"
      )
      mockFs.existsSync.mockReturnValue(false)

      const config = loadWhitelist()

      expect(config.preferredLocation).toBe(
        "~/Library/Application Support/oauth2-forwarder/"
      )
    })
  })

  describe("isUrlAllowed", () => {
    const baseConfig = {
      configPath: "/test/path",
      usingLegacyPath: false,
      preferredLocation: "~/.config/oauth2-forwarder/"
    }

    it("allows all URLs when whitelist is disabled", () => {
      const config: WhitelistConfig = {
        ...baseConfig,
        enabled: false,
        domains: new Set()
      }

      expect(isUrlAllowed("https://any-domain.com/oauth", config)).toBe(true)
      expect(isUrlAllowed("https://evil.com/hack", config)).toBe(true)
    })

    it("allows URLs with whitelisted domains", () => {
      const config: WhitelistConfig = {
        ...baseConfig,
        enabled: true,
        domains: new Set(["login.microsoftonline.com", "accounts.google.com"])
      }

      expect(
        isUrlAllowed(
          "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize",
          config
        )
      ).toBe(true)
      expect(
        isUrlAllowed("https://accounts.google.com/o/oauth2/auth", config)
      ).toBe(true)
    })

    it("rejects URLs with non-whitelisted domains", () => {
      const config: WhitelistConfig = {
        ...baseConfig,
        enabled: true,
        domains: new Set(["login.microsoftonline.com"])
      }

      expect(isUrlAllowed("https://evil.com/oauth", config)).toBe(false)
      expect(isUrlAllowed("https://accounts.google.com/oauth", config)).toBe(
        false
      )
    })

    it("performs case-insensitive matching", () => {
      const config: WhitelistConfig = {
        ...baseConfig,
        enabled: true,
        domains: new Set(["login.microsoftonline.com"])
      }

      expect(
        isUrlAllowed("https://LOGIN.MICROSOFTONLINE.COM/oauth", config)
      ).toBe(true)
      expect(
        isUrlAllowed("https://Login.MicrosoftOnline.Com/oauth", config)
      ).toBe(true)
    })

    it("rejects invalid URLs", () => {
      const config: WhitelistConfig = {
        ...baseConfig,
        enabled: true,
        domains: new Set(["login.microsoftonline.com"])
      }

      expect(isUrlAllowed("not-a-url", config)).toBe(false)
      expect(isUrlAllowed("", config)).toBe(false)
    })

    it("matches exact domain only (no subdomain matching)", () => {
      const config: WhitelistConfig = {
        ...baseConfig,
        enabled: true,
        domains: new Set(["microsoftonline.com"])
      }

      // Subdomain should NOT match
      expect(
        isUrlAllowed("https://login.microsoftonline.com/oauth", config)
      ).toBe(false)
      // Exact domain should match
      expect(isUrlAllowed("https://microsoftonline.com/oauth", config)).toBe(
        true
      )
    })
  })

  describe("getDomain", () => {
    it("extracts hostname from valid URL", () => {
      expect(
        getDomain(
          "https://login.microsoftonline.com/tenant/oauth2/authorize"
        )
      ).toBe("login.microsoftonline.com")
    })

    it("returns lowercase hostname", () => {
      expect(getDomain("https://LOGIN.EXAMPLE.COM/path")).toBe(
        "login.example.com"
      )
    })

    it("returns null for invalid URL", () => {
      expect(getDomain("not-a-url")).toBe(null)
      expect(getDomain("")).toBe(null)
    })
  })

})
