import { type AnsiColor, color } from "./color"
import { sanitize } from "./sanitize"

export type LogLevel = "debug" | "info" | "warn" | "error"

export type Logger = {
  error: (msg: string) => void
  warn: (msg: string) => void
  info: (msg: string) => void
  debug: (msg: string) => void
}

const LOG_LEVEL_PRIORITY = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
} as const

const LOG_LEVEL_COLORS = {
  error: "red",
  warn: "yellow",
  info: "cyan",
  debug: "magenta"
} as const

export type LoggerOptions = {
  level: LogLevel
  stream?: NodeJS.WritableStream
  prefix?: string
  /** When true, disables ANSI color codes and adds timestamps. Use for file output. */
  useFileFormat?: boolean
}

function formatTimestamp(): string {
  return new Date().toISOString()
}

/**
 * Creates a logger with standard log levels.
 * Messages at or above the configured level will be output.
 */
export function buildLogger(options: LoggerOptions): Logger {
  const { level, stream = process.stderr, prefix = "", useFileFormat = false } = options
  const minPriority = LOG_LEVEL_PRIORITY[level]

  const log = (msgLevel: LogLevel, msg: string): void => {
    if (LOG_LEVEL_PRIORITY[msgLevel] >= minPriority) {
      const prefixStr = prefix ? `[${prefix}] ` : ""
      const levelStr = `[${msgLevel.toUpperCase()}]`
      const sanitizedMsg = sanitize(msg)

      let output: string
      if (useFileFormat) {
        // File format: timestamp, no colors
        const timestamp = formatTimestamp()
        output = `${timestamp} ${prefixStr}${levelStr} ${sanitizedMsg}\n`
      } else {
        // Console format: colored, no timestamp
        const colorCode = LOG_LEVEL_COLORS[msgLevel] as AnsiColor
        output = color(`${prefixStr}${levelStr} ${sanitizedMsg}`, colorCode) + "\n"
      }

      stream.write(output)
    }
  }

  return {
    error: (msg: string) => log("error", msg),
    warn: (msg: string) => log("warn", msg),
    info: (msg: string) => log("info", msg),
    debug: (msg: string) => log("debug", msg)
  }
}
