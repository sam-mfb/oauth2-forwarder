import fs from "fs"
import path from "path"
import { ensureDirectory } from "./paths"

/**
 * Log rotation utilities for oauth2-forwarder.
 *
 * Server: rotates on every launch (rotateOnLaunch)
 * Client: rotates when file exceeds size threshold (rotateIfNeeded)
 */

const DEFAULT_MAX_FILES = 5
const DEFAULT_MAX_SIZE_BYTES = 5 * 1024 * 1024 // 5MB

/**
 * Rotates log files by renaming existing logs with numeric suffixes.
 * Example: log.txt -> log.txt.1, log.txt.1 -> log.txt.2, etc.
 *
 * Used by the server on startup.
 */
export function rotateOnLaunch(logPath: string, maxFiles: number = DEFAULT_MAX_FILES): void {
  // Ensure parent directory exists
  ensureDirectory(path.dirname(logPath))

  // If current log doesn't exist, nothing to rotate
  if (!fs.existsSync(logPath)) {
    return
  }

  // Delete the oldest file if it would exceed maxFiles after rotation
  const oldestPath = `${logPath}.${maxFiles}`
  if (fs.existsSync(oldestPath)) {
    fs.unlinkSync(oldestPath)
  }

  // Shift existing rotated files: .4 -> .5, .3 -> .4, etc.
  for (let i = maxFiles - 1; i >= 1; i--) {
    const currentPath = `${logPath}.${i}`
    const nextPath = `${logPath}.${i + 1}`
    if (fs.existsSync(currentPath)) {
      fs.renameSync(currentPath, nextPath)
    }
  }

  // Rotate the current log file to .1
  fs.renameSync(logPath, `${logPath}.1`)
}

/**
 * Rotates the log file if it exceeds the size threshold.
 * Returns true if rotation occurred, false otherwise.
 *
 * Used by the client which launches frequently.
 */
export function rotateIfNeeded(
  logPath: string,
  maxSizeBytes: number = DEFAULT_MAX_SIZE_BYTES,
  maxFiles: number = 3
): boolean {
  // Ensure parent directory exists
  ensureDirectory(path.dirname(logPath))

  // If file doesn't exist or is under threshold, no rotation needed
  if (!fs.existsSync(logPath)) {
    return false
  }

  try {
    const stats = fs.statSync(logPath)
    if (stats.size < maxSizeBytes) {
      return false
    }
  } catch {
    // If we can't stat the file, don't rotate
    return false
  }

  // File exceeds threshold, perform rotation
  rotateOnLaunch(logPath, maxFiles)
  return true
}

/**
 * Creates a write stream for logging to a file.
 * Ensures the parent directory exists before creating the stream.
 */
export function createLogFileStream(logPath: string): fs.WriteStream {
  ensureDirectory(path.dirname(logPath))
  return fs.createWriteStream(logPath, { flags: "a" })
}
