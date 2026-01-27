import { type Logger } from "../logger"

/**
 * Creates a no-op logger that discards all messages.
 * Used in tests where logging output is not needed.
 */
export function buildNoOpLogger(): Logger {
  const noop = (): void => {}
  return {
    error: noop,
    warn: noop,
    info: noop,
    debug: noop
  }
}

/**
 * Creates a test logger that captures all messages.
 * Useful for asserting on log output in tests.
 */
export function buildTestLogger(): { logger: Logger; messages: string[] } {
  const messages: string[] = []
  const logger: Logger = {
    error: (msg: string) => messages.push(`[ERROR] ${msg}`),
    warn: (msg: string) => messages.push(`[WARN] ${msg}`),
    info: (msg: string) => messages.push(`[INFO] ${msg}`),
    debug: (msg: string) => messages.push(`[DEBUG] ${msg}`)
  }
  return { logger, messages }
}
