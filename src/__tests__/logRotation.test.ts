import fs from "fs"
import { vi, type Mocked } from "vitest"
import { rotateOnLaunch, rotateIfNeeded, createLogFileStream } from "../logRotation"
import { ensureDirectory } from "../paths"

vi.mock("fs")
vi.mock("../paths", () => ({
  ensureDirectory: vi.fn()
}))

const mockFs = fs as Mocked<typeof fs>
const mockEnsureDirectory = ensureDirectory as Mocked<typeof ensureDirectory>

describe("logRotation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("rotateOnLaunch", () => {
    it("does nothing when log file does not exist", () => {
      mockFs.existsSync.mockReturnValue(false)

      rotateOnLaunch("/test/app.log")

      expect(mockEnsureDirectory).toHaveBeenCalledWith("/test")
      expect(mockFs.renameSync).not.toHaveBeenCalled()
      expect(mockFs.unlinkSync).not.toHaveBeenCalled()
    })

    it("rotates existing log to .1", () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        return p === "/test/app.log"
      })

      rotateOnLaunch("/test/app.log")

      expect(mockFs.renameSync).toHaveBeenCalledWith(
        "/test/app.log",
        "/test/app.log.1"
      )
    })

    it("shifts existing rotated files", () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const path = p.toString()
        return (
          path === "/test/app.log" ||
          path === "/test/app.log.1" ||
          path === "/test/app.log.2"
        )
      })

      rotateOnLaunch("/test/app.log", 5)

      // Should shift .2 -> .3, then .1 -> .2, then current -> .1
      expect(mockFs.renameSync).toHaveBeenCalledWith(
        "/test/app.log.2",
        "/test/app.log.3"
      )
      expect(mockFs.renameSync).toHaveBeenCalledWith(
        "/test/app.log.1",
        "/test/app.log.2"
      )
      expect(mockFs.renameSync).toHaveBeenCalledWith(
        "/test/app.log",
        "/test/app.log.1"
      )
    })

    it("deletes oldest file when at max files limit", () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const path = p.toString()
        return (
          path === "/test/app.log" ||
          path === "/test/app.log.1" ||
          path === "/test/app.log.2" ||
          path === "/test/app.log.3"
        )
      })

      rotateOnLaunch("/test/app.log", 3)

      // Should delete .3 (oldest when max is 3)
      expect(mockFs.unlinkSync).toHaveBeenCalledWith("/test/app.log.3")
    })

    it("respects custom maxFiles parameter", () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        return p === "/test/app.log" || p === "/test/app.log.2"
      })

      rotateOnLaunch("/test/app.log", 2)

      // Should delete .2 when max is 2
      expect(mockFs.unlinkSync).toHaveBeenCalledWith("/test/app.log.2")
    })
  })

  describe("rotateIfNeeded", () => {
    it("returns false when log file does not exist", () => {
      mockFs.existsSync.mockReturnValue(false)

      const result = rotateIfNeeded("/test/app.log")

      expect(result).toBe(false)
      expect(mockFs.renameSync).not.toHaveBeenCalled()
    })

    it("returns false when log file is under size threshold", () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.statSync.mockReturnValue({ size: 1000 } as fs.Stats)

      const result = rotateIfNeeded("/test/app.log", 5 * 1024 * 1024)

      expect(result).toBe(false)
      expect(mockFs.renameSync).not.toHaveBeenCalled()
    })

    it("rotates and returns true when log file exceeds size threshold", () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        return p === "/test/app.log"
      })
      mockFs.statSync.mockReturnValue({ size: 10 * 1024 * 1024 } as fs.Stats)

      const result = rotateIfNeeded("/test/app.log", 5 * 1024 * 1024)

      expect(result).toBe(true)
      expect(mockFs.renameSync).toHaveBeenCalledWith(
        "/test/app.log",
        "/test/app.log.1"
      )
    })

    it("uses default 5MB threshold", () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        return p === "/test/app.log"
      })
      // Just under 5MB
      mockFs.statSync.mockReturnValue({ size: 5 * 1024 * 1024 - 1 } as fs.Stats)

      const result = rotateIfNeeded("/test/app.log")

      expect(result).toBe(false)
    })

    it("uses default 3 max files for client", () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const path = p.toString()
        return (
          path === "/test/app.log" ||
          path === "/test/app.log.1" ||
          path === "/test/app.log.2" ||
          path === "/test/app.log.3"
        )
      })
      mockFs.statSync.mockReturnValue({ size: 10 * 1024 * 1024 } as fs.Stats)

      rotateIfNeeded("/test/app.log")

      // Default maxFiles for client is 3, so .3 should be deleted
      expect(mockFs.unlinkSync).toHaveBeenCalledWith("/test/app.log.3")
    })

    it("returns false when statSync throws", () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.statSync.mockImplementation(() => {
        throw new Error("Permission denied")
      })

      const result = rotateIfNeeded("/test/app.log")

      expect(result).toBe(false)
    })
  })

  describe("createLogFileStream", () => {
    it("ensures directory exists before creating stream", () => {
      const mockStream = {} as fs.WriteStream
      mockFs.createWriteStream.mockReturnValue(mockStream)

      createLogFileStream("/test/logs/app.log")

      expect(mockEnsureDirectory).toHaveBeenCalledWith("/test/logs")
    })

    it("creates write stream with append mode", () => {
      const mockStream = {} as fs.WriteStream
      mockFs.createWriteStream.mockReturnValue(mockStream)

      const result = createLogFileStream("/test/app.log")

      expect(mockFs.createWriteStream).toHaveBeenCalledWith("/test/app.log", {
        flags: "a"
      })
      expect(result).toBe(mockStream)
    })
  })
})
