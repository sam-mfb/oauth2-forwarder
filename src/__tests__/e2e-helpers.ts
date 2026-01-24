import http from "http"
import crypto from "crypto"
import { buildBrowserHelper } from "../client/buildBrowserHelper"
import { buildCredentialForwarder } from "../client/buildCredentialForwarder"
import { buildRedirect } from "../client/buildRedirect"
import { buildCredentialProxy } from "../server/buildCredentialProxy"
import { buildInteractiveLogin } from "../server/buildInteractiveLogin"
import { WhitelistConfig } from "../server/whitelist"
import { parseOauth2Url } from "../parseOauth2Url"
import { Result } from "../result"
import { RedirectResult } from "../redirect-types"

export const LOCALHOST = "127.0.0.1"

// Disabled whitelist for e2e tests
const DISABLED_WHITELIST: WhitelistConfig = {
  enabled: false,
  domains: new Set(),
  configPath: ""
}

// No-op logger for e2e tests
const NO_OP_LOGGER = (_str: string): void => {}

// Port allocator to avoid conflicts
// Use a random starting point to avoid conflicts between test runs
let nextPort = 30000 + Math.floor(Math.random() * 10000)
export function getNextPort(): number {
  return nextPort++
}

type CallbackParams = {
  code?: string
  state?: string
  error?: string
  error_description?: string
}

type ContainerResponse =
  | { type: "status"; statusCode: number; body?: string }
  | { type: "redirect"; statusCode: 301 | 302; location: string }
  | {
      type: "redirect-chain"
      chain: Array<{ statusCode: 301 | 302; location: string }>
      final: { statusCode: number; body?: string }
    }

/**
 * Creates a mock container server that can be configured to return different responses
 */
export function createMockContainer(
  port: number,
  response: ContainerResponse
): Promise<{ close: () => void }> {
  return new Promise(resolve => {
    let redirectIndex = 0

    const server = http.createServer((req, res) => {
      if (response.type === "status") {
        res.writeHead(response.statusCode)
        res.end(response.body ?? "")
      } else if (response.type === "redirect") {
        res.writeHead(response.statusCode, { Location: response.location })
        res.end()
      } else if (response.type === "redirect-chain") {
        const redirect = response.chain[redirectIndex]
        if (redirectIndex < response.chain.length && redirect) {
          redirectIndex++
          res.writeHead(redirect.statusCode, { Location: redirect.location })
          res.end()
        } else {
          res.writeHead(response.final.statusCode)
          res.end(response.final.body ?? "")
        }
      }
    })

    server.listen(port, LOCALHOST, () => {
      resolve({ close: () => server.close() })
    })
  })
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
      const req = http.get(redirectUrl.toString(), () => {
        // Response received - resolve immediately, don't wait for body.
        // The browser response is now delayed until after completion,
        // so we just need to trigger the callback request.
        resolve()
      })
      req.on("error", e => reject(e.message))
    })
  }
}

type BrowserResponse = {
  statusCode: number
  headers: http.IncomingHttpHeaders
  body: string
}

/**
 * Creates a mock that simulates browser OAuth callback and captures the response
 */
export function createMockBrowserCallbackWithCapture(
  params: CallbackParams,
  onResponse: (response: BrowserResponse) => void
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
          const chunks: Buffer[] = []
          res.on("data", (chunk: Buffer) => chunks.push(chunk))
          res.on("end", () => {
            onResponse({
              statusCode: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString("utf8")
            })
            resolve()
          })
        })
        .on("error", e => reject(e.message))
    })
  }
}

/**
 * Creates a mock interactiveLogin that doesn't bind to any port.
 * Used for container redirect tests where the mock container needs
 * to use the callback port.
 */
function createMockInteractiveLogin(callbackParams: CallbackParams): (
  url: string,
  port: number
) => Promise<{
  callbackUrl: string
  requestId: string
  complete: (result: RedirectResult) => void
}> {
  return async (url: string, port: number) => {
    const paramsResult = parseOauth2Url(url)
    if (Result.isFailure(paramsResult)) {
      throw new Error("Invalid OAuth URL")
    }

    // Build the callback URL with the params
    const callbackUrl = new URL(paramsResult.value.redirect_uri)
    Object.entries(callbackParams).forEach(([key, value]) => {
      if (value !== undefined) {
        callbackUrl.searchParams.set(key, value)
      }
    })

    const requestId = crypto.randomUUID()

    return {
      callbackUrl: callbackUrl.toString(),
      requestId,
      complete: () => {
        // Mock complete - no actual browser to respond to
      }
    }
  }
}

type TestHarness = {
  server: () => Promise<{ close: () => void }>
  client: (requestUrl: string | undefined) => Promise<void>
  getRedirectUrl: () => string
  getRedirectResult: () => RedirectResult | undefined
  didFail: () => boolean
}

/**
 * Creates a complete e2e test harness
 */
export function createTestHarness(options: {
  port: number
  callbackParams?: CallbackParams
  passthrough?: boolean
  interactiveLogin?: (
    url: string,
    port: number
  ) => Promise<{
    callbackUrl: string
    requestId: string
    complete: (result: RedirectResult) => void
  }>
  openBrowser?: (url: string) => Promise<void>
  onFailure?: () => void
  // For testing different container responses, provide a containerPort
  // and the container will be created at that port
  containerPort?: number
  containerResponse?: ContainerResponse
}): TestHarness {
  let capturedRedirectUrl = ""
  let capturedRedirectResult: RedirectResult | undefined

  // For container redirect tests, use a mock interactiveLogin that doesn't bind to ports
  // For regular tests, use the real interactiveLogin with mock browser callback
  let interactiveLogin: (
    url: string,
    port: number
  ) => Promise<{
    callbackUrl: string
    requestId: string
    complete: (result: RedirectResult) => void
  }>

  if (options.interactiveLogin) {
    interactiveLogin = options.interactiveLogin
  } else if (options.containerPort && options.callbackParams) {
    // Container tests: use mock interactiveLogin to avoid port conflicts
    interactiveLogin = createMockInteractiveLogin(options.callbackParams)
  } else if (options.callbackParams) {
    // Regular tests: use real interactiveLogin with mock browser callback
    const mockCallback = createMockBrowserCallback(options.callbackParams)
    interactiveLogin = buildInteractiveLogin({
      openBrowser: async url => {
        await mockCallback(url)
      }
    })
  } else {
    // No callback params: use real interactiveLogin with no-op browser
    interactiveLogin = buildInteractiveLogin({
      openBrowser: async () => {}
    })
  }

  const server = buildCredentialProxy({
    host: LOCALHOST,
    port: options.port,
    interactiveLogin,
    openBrowser: options.openBrowser ?? (async () => {}),
    passthrough: options.passthrough ?? false,
    whitelist: DISABLED_WHITELIST,
    logger: NO_OP_LOGGER
  })

  // If containerPort is specified, use real redirect against mock container
  // Otherwise use a mock redirect that just captures the URL
  const redirect = options.containerPort
    ? buildRedirect({})
    : async (url: string): Promise<RedirectResult> => {
        capturedRedirectUrl = url
        return { type: "success" }
      }

  const forwarder = buildCredentialForwarder({
    host: LOCALHOST,
    port: options.port,
    redirect
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
    credentialForwarder: async (url: string) => {
      const result = await forwarder(url)
      capturedRedirectResult = result
      // Also capture the URL from redirect result or callback URL
      if (result.type === "redirect") {
        capturedRedirectUrl = result.location
      }
      return result
    }
  })

  // Wrap server to also start container if needed
  const wrappedServer = async (): Promise<{ close: () => void }> => {
    let containerClose: (() => void) | undefined
    if (options.containerPort && options.containerResponse) {
      const container = await createMockContainer(
        options.containerPort,
        options.containerResponse
      )
      containerClose = container.close
    }

    const { close: serverClose } = await server()

    return {
      close: () => {
        serverClose()
        containerClose?.()
      }
    }
  }

  return {
    server: wrappedServer,
    client,
    getRedirectUrl: () => capturedRedirectUrl,
    getRedirectResult: () => capturedRedirectResult,
    didFail: () => failed
  }
}

/**
 * Helper for direct HTTP requests to server (for error tests)
 */
export function sendRawRequest(
  port: number,
  body: string,
  path: string = "/"
): Promise<{ statusCode: number; statusMessage: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: LOCALHOST,
        port,
        path,
        method: "POST",
        headers: { "Content-Type": "application/json" }
      },
      res => {
        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            statusMessage: res.statusMessage ?? "",
            body: Buffer.concat(chunks).toString("utf8")
          })
        })
      }
    )
    req.on("error", reject)
    req.write(body)
    req.end()
  })
}
