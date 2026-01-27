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
  stream?: NodeJS.WriteStream
  prefix?: string
}

/**
 * Creates a logger with standard log levels.
 * Messages at or above the configured level will be output.
 */
export function buildLogger(options: LoggerOptions): Logger {
  const { level, stream = process.stderr, prefix = "" } = options
  const minPriority = LOG_LEVEL_PRIORITY[level]

  const log = (msgLevel: LogLevel, msg: string): void => {
    if (LOG_LEVEL_PRIORITY[msgLevel] >= minPriority) {
      const colorCode = LOG_LEVEL_COLORS[msgLevel] as AnsiColor
      const prefixStr = prefix ? `[${prefix}] ` : ""
      const levelStr = `[${msgLevel.toUpperCase()}]`
      stream.write(color(`${prefixStr}${levelStr} ${sanitize(msg)}`, colorCode) + "\n")
    }
  }

  return {
    error: (msg: string) => log("error", msg),
    warn: (msg: string) => log("warn", msg),
    info: (msg: string) => log("info", msg),
    debug: (msg: string) => log("debug", msg)
  }
}
