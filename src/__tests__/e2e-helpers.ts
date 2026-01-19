import http from "http"
import { buildBrowserHelper } from "../client/buildBrowserHelper"
import { buildCredentialForwarder } from "../client/buildCredentialForwarder"
import { buildCredentialProxy } from "../server/buildCredentialProxy"
import { buildInteractiveLogin } from "../server/buildInteractiveLogin"
import { parseOauth2Url } from "../parseOauth2Url"
import { Result } from "../result"

export const LOCALHOST = "127.0.0.1"

// Port allocator to avoid conflicts
let nextPort = 45999
export function getNextPort(): number {
  return nextPort--
}

type CallbackParams = {
  code?: string
  state?: string
  error?: string
  error_description?: string
}

/**
 * Creates a mock that simulates browser OAuth callback
 */
export function createMockBrowserCallback(
  params: CallbackParams
): (requestUrl: string) => Promise<void> {
  return async (requestUrl: string): Promise<void> => {
    const paramsResult = parseOauth2Url(requestUrl)
    if (Result.isFailure(paramsResult)) {
      throw new Error("Invalid request url")
    }
    const redirectUrl = new URL(paramsResult.value.redirect_uri)
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        redirectUrl.searchParams.set(key, value)
      }
    })
    return new Promise((resolve, reject) => {
      http
        .get(redirectUrl.toString(), res => {
          if (res.statusCode === 200) {
            resolve()
          } else {
            reject(`Status: ${res.statusCode}`)
          }
        })
        .on("error", e => reject(e.message))
    })
  }
}

type TestHarness = {
  server: () => Promise<{ close: () => void }>
  client: (requestUrl: string | undefined) => Promise<void>
  getRedirectUrl: () => string
  didFail: () => boolean
}

/**
 * Creates a complete e2e test harness
 */
export function createTestHarness(options: {
  port: number
  callbackParams?: CallbackParams
  passthrough?: boolean
  interactiveLogin?: (url: string, port: number) => Promise<string>
  openBrowser?: (url: string) => Promise<void>
  onFailure?: () => void
}): TestHarness {
  let capturedRedirectUrl = ""

  const mockCallback = options.callbackParams
    ? createMockBrowserCallback(options.callbackParams)
    : undefined

  const interactiveLogin =
    options.interactiveLogin ??
    buildInteractiveLogin({
      openBrowser: async url => {
        await mockCallback?.(url)
      }
    })

  const server = buildCredentialProxy({
    host: LOCALHOST,
    port: options.port,
    interactiveLogin,
    openBrowser: options.openBrowser ?? (async () => {}),
    passthrough: options.passthrough ?? false
  })

  const forwarder = buildCredentialForwarder({
    host: LOCALHOST,
    port: options.port
  })

  let failed = false
  const client = buildBrowserHelper({
    onExit: {
      success: () => {},
      failure: () => {
        failed = true
        options.onFailure?.()
      }
    },
    credentialForwarder: forwarder,
    redirect: async url => {
      capturedRedirectUrl = url
    }
  })

  return {
    server,
    client,
    getRedirectUrl: () => capturedRedirectUrl,
    didFail: () => failed
  }
}

/**
 * Helper for direct HTTP requests to server (for error tests)
 */
export function sendRawRequest(
  port: number,
  body: string
): Promise<{ statusCode: number; statusMessage: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: LOCALHOST,
        port,
        method: "POST",
        headers: { "Content-Type": "application/json" }
      },
      res => {
        resolve({
          statusCode: res.statusCode ?? 0,
          statusMessage: res.statusMessage ?? ""
        })
      }
    )
    req.on("error", reject)
    req.write(body)
    req.end()
  })
}
