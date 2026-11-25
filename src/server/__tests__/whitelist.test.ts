import fs from "fs"
import { vi } from "vitest"
import {
  loadWhitelist,
  isUrlAllowed,
  getDomain,
  wildcardSuffix,
  WhitelistConfig
} from "../whitelist"

// Mock fs and paths modules
vi.mock("fs")
vi.mock("../../paths", () => ({
  resolveConfigFile: vi.fn(),
  getPreferredConfigDescription: vi.fn()
}))

import { resolveConfigFile, getPreferredConfigDescription } from "../../paths"

const mockFs = vi.mocked(fs)
const mockResolveConfigFile = vi.mocked(resolveConfigFile)
const mockGetPreferredConfigDescription = vi.mocked(
  getPreferredConfigDescription
)

describe("whitelist", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveConfigFile.mockReturnValue({
      path: "/home/testuser/.oauth2-forwarder/whitelist.json",
      isLegacy: false
    })
    mockGetPreferredConfigDescription.mockReturnValue(
      "~/.config/oauth2-forwarder/"
    )
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
      expect(config.disabledReason).toBe("file-not-found")
    })

    it("returns disabled config when file has empty domains array", () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ domains: [] }))

      const config = loadWhitelist()

      expect(config.enabled).toBe(false)
      expect(config.domains.size).toBe(0)
      expect(config.disabledReason).toBe("empty-domains")
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
      expect(config.disabledReason).toBeUndefined()
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
          domains: [
            "login.microsoftonline.com",
            "",
            "  ",
            "accounts.google.com"
          ]
        })
      )

      const config = loadWhitelist()

      expect(config.enabled).toBe(true)
      expect(config.domains.size).toBe(2)
    })

    it("disables config when all domains are empty or whitespace", () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          domains: ["", "  ", "   "]
        })
      )

      const config = loadWhitelist()

      expect(config.enabled).toBe(false)
      expect(config.domains.size).toBe(0)
      expect(config.disabledReason).toBe("empty-domains")
    })

    it("returns disabled config with parse error when file contains invalid JSON", () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue("not valid json")

      const config = loadWhitelist()

      expect(config.enabled).toBe(false)
      expect(config.domains.size).toBe(0)
      expect(config.disabledReason).toBe("parse-error")
      expect(config.parseError).toBeDefined()
    })

    it("returns disabled config when domains is not an array", () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ domains: "not-an-array" })
      )

      const config = loadWhitelist()

      expect(config.enabled).toBe(false)
      expect(config.domains.size).toBe(0)
      expect(config.disabledReason).toBe("empty-domains")
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
      expect(config.disabledReason).toBe("file-not-found")
    })
  })

  describe("loadWhitelist wildcard entries", () => {
    it("keeps valid wildcard entries and reports no invalid entries", () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ domains: ["*.ChatGPT.site", "accounts.google.com"] })
      )

      const config = loadWhitelist()

      expect(config.enabled).toBe(true)
      expect(config.domains.has("*.chatgpt.site")).toBe(true)
      expect(config.invalidEntries).toEqual([])
    })

    it("reports malformed wildcard entries as invalid", () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          domains: ["*chatgpt.site", "foo.*.com", "*.example.com", "*"]
        })
      )

      const config = loadWhitelist()

      expect(config.invalidEntries).toEqual(["*chatgpt.site", "foo.*.com", "*"])
    })

    it("stays enabled when every entry is invalid, so nothing is allowed", () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ domains: ["*chatgpt.site"] })
      )

      const config = loadWhitelist()

      expect(config.enabled).toBe(true)
      expect(config.invalidEntries).toEqual(["*chatgpt.site"])
      expect(isUrlAllowed("https://demo.chatgpt.site/", config)).toBe(false)
      expect(isUrlAllowed("https://xchatgpt.site/", config)).toBe(false)
    })

    it("reports no invalid entries when the whitelist file is missing", () => {
      mockFs.existsSync.mockReturnValue(false)

      expect(loadWhitelist().invalidEntries).toEqual([])
    })
  })

  describe("loadWhitelist broad wildcard entries", () => {
    it("reports wildcards with a single-label suffix as broad", () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          domains: ["*.com", "*.CO", "*.chatgpt.site", "example.com"]
        })
      )

      const config = loadWhitelist()

      expect(config.broadEntries).toEqual(["*.com", "*.co"])
      expect(config.invalidEntries).toEqual([])
    })

    it("does not report malformed wildcards as broad", () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ domains: ["*com", "*.", "*"] })
      )

      expect(loadWhitelist().broadEntries).toEqual([])
    })

    it("still allows hostnames matched by a broad wildcard", () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ domains: ["*.com"] })
      )

      const config = loadWhitelist()

      expect(config.enabled).toBe(true)
      expect(isUrlAllowed("https://login.example.com/", config)).toBe(true)
      expect(isUrlAllowed("https://example.org/", config)).toBe(false)
    })

    it("reports no broad entries when the whitelist file is missing", () => {
      mockFs.existsSync.mockReturnValue(false)

      expect(loadWhitelist().broadEntries).toEqual([])
    })
  })

  describe("wildcardSuffix", () => {
    it("returns the suffix of a valid wildcard entry", () => {
      expect(wildcardSuffix("*.chatgpt.site")).toBe("chatgpt.site")
      expect(wildcardSuffix("*.com")).toBe("com")
    })

    it("returns null for exact entries", () => {
      expect(wildcardSuffix("chatgpt.site")).toBeNull()
    })

    it.each([
      "*",
      "*.",
      "*chatgpt.site",
      "*..site",
      "*.site.",
      "*.*.site",
      "foo.*.com",
      "**.site"
    ])("returns null for malformed wildcard %s", entry => {
      expect(wildcardSuffix(entry)).toBeNull()
    })
  })

  describe("isUrlAllowed", () => {
    const baseConfig = {
      configPath: "/test/path",
      invalidEntries: [],
      broadEntries: [],
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

    describe("wildcard entries", () => {
      const wildcardConfig: WhitelistConfig = {
        ...baseConfig,
        enabled: true,
        domains: new Set(["*.chatgpt.site", "accounts.google.com"])
      }

      it("matches a subdomain one label deep", () => {
        expect(isUrlAllowed("https://demo.chatgpt.site/", wildcardConfig)).toBe(
          true
        )
      })

      it("matches a subdomain several labels deep", () => {
        expect(
          isUrlAllowed("https://demo.workspace.chatgpt.site/", wildcardConfig)
        ).toBe(true)
      })

      it("does not match the bare suffix", () => {
        expect(isUrlAllowed("https://chatgpt.site/", wildcardConfig)).toBe(
          false
        )
      })

      it("matches the bare suffix when it is listed separately", () => {
        const config: WhitelistConfig = {
          ...wildcardConfig,
          domains: new Set(["*.chatgpt.site", "chatgpt.site"])
        }
        expect(isUrlAllowed("https://chatgpt.site/", config)).toBe(true)
        expect(isUrlAllowed("https://demo.chatgpt.site/", config)).toBe(true)
      })

      it("does not match lookalike hostnames outside the label boundary", () => {
        expect(isUrlAllowed("https://notchatgpt.site/", wildcardConfig)).toBe(
          false
        )
        expect(
          isUrlAllowed("https://demo.notchatgpt.site/", wildcardConfig)
        ).toBe(false)
        expect(
          isUrlAllowed("https://chatgpt.site.evil.com/", wildcardConfig)
        ).toBe(false)
      })

      it("matches case-insensitively", () => {
        expect(isUrlAllowed("https://Demo.ChatGPT.Site/", wildcardConfig)).toBe(
          true
        )
      })

      it("still matches exact entries alongside wildcards", () => {
        expect(
          isUrlAllowed(
            "https://accounts.google.com/o/oauth2/auth",
            wildcardConfig
          )
        ).toBe(true)
        expect(
          isUrlAllowed("https://mail.accounts.google.com/", wildcardConfig)
        ).toBe(false)
      })

      it("never matches malformed wildcard entries", () => {
        const config: WhitelistConfig = {
          ...baseConfig,
          enabled: true,
          domains: new Set(["*chatgpt.site", "*.", "*"]),
          invalidEntries: ["*chatgpt.site", "*.", "*"]
        }
        expect(isUrlAllowed("https://demo.chatgpt.site/", config)).toBe(false)
        expect(isUrlAllowed("https://xchatgpt.site/", config)).toBe(false)
        expect(isUrlAllowed("https://example.com/", config)).toBe(false)
      })

      it("rejects hostnames that contain *", () => {
        const config: WhitelistConfig = {
          ...baseConfig,
          enabled: true,
          domains: new Set(["*chatgpt.site", "*.chatgpt.site"]),
          invalidEntries: ["*chatgpt.site"]
        }
        expect(isUrlAllowed("https://*chatgpt.site/", config)).toBe(false)
        expect(isUrlAllowed("https://*.chatgpt.site/", config)).toBe(false)
      })
    })
  })

  describe("getDomain", () => {
    it("extracts hostname from valid URL", () => {
      expect(
        getDomain("https://login.microsoftonline.com/tenant/oauth2/authorize")
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
