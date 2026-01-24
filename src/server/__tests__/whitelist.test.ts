import fs from "fs"
import path from "path"
import os from "os"
import {
  loadWhitelist,
  isUrlAllowed,
  getHostnameFromUrl,
  WhitelistConfig
} from "../whitelist"

// Mock fs and os modules
jest.mock("fs")
jest.mock("os")

const mockFs = fs as jest.Mocked<typeof fs>
const mockOs = os as jest.Mocked<typeof os>

describe("whitelist", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOs.homedir.mockReturnValue("/home/testuser")
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
  })

  describe("isUrlAllowed", () => {
    it("allows all URLs when whitelist is disabled", () => {
      const config: WhitelistConfig = {
        enabled: false,
        domains: new Set(),
        configPath: "/test/path"
      }

      expect(isUrlAllowed("https://any-domain.com/oauth", config)).toBe(true)
      expect(isUrlAllowed("https://evil.com/hack", config)).toBe(true)
    })

    it("allows URLs with whitelisted domains", () => {
      const config: WhitelistConfig = {
        enabled: true,
        domains: new Set(["login.microsoftonline.com", "accounts.google.com"]),
        configPath: "/test/path"
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
        enabled: true,
        domains: new Set(["login.microsoftonline.com"]),
        configPath: "/test/path"
      }

      expect(isUrlAllowed("https://evil.com/oauth", config)).toBe(false)
      expect(isUrlAllowed("https://accounts.google.com/oauth", config)).toBe(
        false
      )
    })

    it("performs case-insensitive matching", () => {
      const config: WhitelistConfig = {
        enabled: true,
        domains: new Set(["login.microsoftonline.com"]),
        configPath: "/test/path"
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
        enabled: true,
        domains: new Set(["login.microsoftonline.com"]),
        configPath: "/test/path"
      }

      expect(isUrlAllowed("not-a-url", config)).toBe(false)
      expect(isUrlAllowed("", config)).toBe(false)
    })

    it("matches exact domain only (no subdomain matching)", () => {
      const config: WhitelistConfig = {
        enabled: true,
        domains: new Set(["microsoftonline.com"]),
        configPath: "/test/path"
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

  describe("getHostnameFromUrl", () => {
    it("extracts hostname from valid URL", () => {
      expect(
        getHostnameFromUrl(
          "https://login.microsoftonline.com/tenant/oauth2/authorize"
        )
      ).toBe("login.microsoftonline.com")
    })

    it("returns lowercase hostname", () => {
      expect(getHostnameFromUrl("https://LOGIN.EXAMPLE.COM/path")).toBe(
        "login.example.com"
      )
    })

    it("returns null for invalid URL", () => {
      expect(getHostnameFromUrl("not-a-url")).toBe(null)
      expect(getHostnameFromUrl("")).toBe(null)
    })
  })

})
