import fs from "fs"
import os from "os"
import path from "path"
import { vi, type Mocked } from "vitest"
import {
  getLogFilePath,
  getLogDir,
  getConfigDir,
  getLegacyConfigDir,
  resolveConfigFile,
  getPreferredConfigDescription,
  ensureDirectory
} from "../paths"

vi.mock("fs")
vi.mock("os")

const mockFs = fs as Mocked<typeof fs>
const mockOs = os as Mocked<typeof os>

describe("paths", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOs.homedir.mockReturnValue("/home/testuser")
    // Reset platform mock
    vi.spyOn(os, "platform").mockReturnValue("linux")
    // Reset env vars
    delete process.env.XDG_STATE_HOME
    delete process.env.XDG_CONFIG_HOME
    delete process.env.LOCALAPPDATA
  })

  describe("getLogDir", () => {
    it("returns XDG_STATE_HOME path on Linux when set", () => {
      vi.spyOn(os, "platform").mockReturnValue("linux")
      process.env.XDG_STATE_HOME = "/custom/state"

      const result = getLogDir()

      expect(result).toBe("/custom/state/oauth2-forwarder")
    })

    it("returns default state path on Linux when XDG_STATE_HOME not set", () => {
      vi.spyOn(os, "platform").mockReturnValue("linux")

      const result = getLogDir()

      expect(result).toBe("/home/testuser/.local/state/oauth2-forwarder")
    })

    it("returns Library/Logs path on macOS", () => {
      vi.spyOn(os, "platform").mockReturnValue("darwin")

      const result = getLogDir()

      expect(result).toBe("/home/testuser/Library/Logs/oauth2-forwarder")
    })

    it("returns LOCALAPPDATA path on Windows when set", () => {
      vi.spyOn(os, "platform").mockReturnValue("win32")
      process.env.LOCALAPPDATA = "C:\\Users\\testuser\\AppData\\Local"

      const result = getLogDir()

      expect(result).toBe(
        path.join("C:\\Users\\testuser\\AppData\\Local", "oauth2-forwarder", "logs")
      )
    })

    it("returns default AppData path on Windows when LOCALAPPDATA not set", () => {
      vi.spyOn(os, "platform").mockReturnValue("win32")

      const result = getLogDir()

      expect(result).toBe(
        path.join("/home/testuser", "AppData", "Local", "oauth2-forwarder", "logs")
      )
    })
  })

  describe("getConfigDir", () => {
    it("returns XDG_CONFIG_HOME path on Linux when set", () => {
      vi.spyOn(os, "platform").mockReturnValue("linux")
      process.env.XDG_CONFIG_HOME = "/custom/config"

      const result = getConfigDir()

      expect(result).toBe("/custom/config/oauth2-forwarder")
    })

    it("returns default config path on Linux when XDG_CONFIG_HOME not set", () => {
      vi.spyOn(os, "platform").mockReturnValue("linux")

      const result = getConfigDir()

      expect(result).toBe("/home/testuser/.config/oauth2-forwarder")
    })

    it("returns Library/Application Support path on macOS", () => {
      vi.spyOn(os, "platform").mockReturnValue("darwin")

      const result = getConfigDir()

      expect(result).toBe(
        "/home/testuser/Library/Application Support/oauth2-forwarder"
      )
    })

    it("returns LOCALAPPDATA path on Windows", () => {
      vi.spyOn(os, "platform").mockReturnValue("win32")
      process.env.LOCALAPPDATA = "C:\\Users\\testuser\\AppData\\Local"

      const result = getConfigDir()

      expect(result).toBe(
        path.join("C:\\Users\\testuser\\AppData\\Local", "oauth2-forwarder")
      )
    })
  })

  describe("getLegacyConfigDir", () => {
    it("returns ~/.oauth2-forwarder path", () => {
      const result = getLegacyConfigDir()

      expect(result).toBe("/home/testuser/.oauth2-forwarder")
    })
  })

  describe("getLogFilePath", () => {
    it("returns correct path for server log", () => {
      vi.spyOn(os, "platform").mockReturnValue("linux")

      const result = getLogFilePath("server")

      expect(result).toBe(
        "/home/testuser/.local/state/oauth2-forwarder/o2f-server.log"
      )
    })

    it("returns correct path for client log", () => {
      vi.spyOn(os, "platform").mockReturnValue("linux")

      const result = getLogFilePath("client")

      expect(result).toBe(
        "/home/testuser/.local/state/oauth2-forwarder/o2f-client.log"
      )
    })
  })

  describe("resolveConfigFile", () => {
    it("returns legacy path when file exists in legacy location", () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        return p === "/home/testuser/.oauth2-forwarder/whitelist.json"
      })

      const result = resolveConfigFile("whitelist.json")

      expect(result.path).toBe("/home/testuser/.oauth2-forwarder/whitelist.json")
      expect(result.isLegacy).toBe(true)
    })

    it("returns preferred path when file does not exist in legacy location", () => {
      vi.spyOn(os, "platform").mockReturnValue("linux")
      mockFs.existsSync.mockReturnValue(false)

      const result = resolveConfigFile("whitelist.json")

      expect(result.path).toBe(
        "/home/testuser/.config/oauth2-forwarder/whitelist.json"
      )
      expect(result.isLegacy).toBe(false)
    })
  })

  describe("getPreferredConfigDescription", () => {
    it("returns XDG path description on Linux", () => {
      vi.spyOn(os, "platform").mockReturnValue("linux")

      const result = getPreferredConfigDescription()

      expect(result).toBe(
        "~/.config/oauth2-forwarder/ (or $XDG_CONFIG_HOME/oauth2-forwarder/)"
      )
    })

    it("returns Library path description on macOS", () => {
      vi.spyOn(os, "platform").mockReturnValue("darwin")

      const result = getPreferredConfigDescription()

      expect(result).toBe("~/Library/Application Support/oauth2-forwarder/")
    })

    it("returns LOCALAPPDATA path description on Windows", () => {
      vi.spyOn(os, "platform").mockReturnValue("win32")

      const result = getPreferredConfigDescription()

      expect(result).toBe("%LOCALAPPDATA%\\oauth2-forwarder\\")
    })
  })

  describe("ensureDirectory", () => {
    it("creates directory when it does not exist", () => {
      mockFs.existsSync.mockReturnValue(false)

      ensureDirectory("/test/path")

      expect(mockFs.mkdirSync).toHaveBeenCalledWith("/test/path", {
        recursive: true
      })
    })

    it("does not create directory when it already exists", () => {
      mockFs.existsSync.mockReturnValue(true)

      ensureDirectory("/test/path")

      expect(mockFs.mkdirSync).not.toHaveBeenCalled()
    })
  })
})
