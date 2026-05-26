import http from "http"
import { nanoid } from "nanoid"
import { buildBrowserHelper } from "../client/buildBrowserHelper"
import { buildCredentialForwarder } from "../client/buildCredentialForwarder"
import { buildRedirect } from "../client/buildRedirect"
import { buildCredentialProxy } from "../server/buildCredentialProxy"
import { buildInteractiveLogin } from "../server/buildInteractiveLogin"
import { WhitelistConfig } from "../server/whitelist"
import { parseOauth2Url } from "../parseOauth2Url"
import { Result } from "../result"
import { RedirectResult } from "../redirect-types"
import { buildNoOpLogger } from "./test-logger"

export const LOCALHOST = "127.0.0.1"

// Disabled whitelist for e2e tests
const DISABLED_WHITELIST: WhitelistConfig = {
  enabled: false,
  domains: new Set(),
  configPath: "",
  usingLegacyPath: false,
  preferredLocation: ""
}

// No-op logger for e2e tests
const NO_OP_LOGGER = buildNoOpLogger()

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
 * Creates a mock that simulates browser OAuth callback (GET, response_mode=query).
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

/**
 * Creates a mock that simulates a browser OAuth callback via response_mode=form_post.
 * The OAuth provider POSTs the auth params as an application/x-www-form-urlencoded
 * body to the redirect_uri, with no query parameters on the URL.
 */
export function createMockFormPostBrowserCallback(
  params: CallbackParams
): (requestUrl: string) => Promise<void> {
  return async (requestUrl: string): Promise<void> => {
    const paramsResult = parseOauth2Url(requestUrl)
    if (Result.isFailure(paramsResult)) {
      throw new Error("Invalid request url")
    }
    const redirectUrl = new URL(paramsResult.value.redirect_uri)
    const formBody = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        formBody.set(key, value)
      }
    })
    const body = formBody.toString()
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: redirectUrl.hostname,
          port: redirectUrl.port || 80,
          path: redirectUrl.pathname + redirectUrl.search,
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(body)
          }
        },
        () => {
          // Response received - resolve immediately, don't wait for body.
          // The browser response is now delayed until after completion,
          // so we just need to trigger the callback request.
          resolve()
        }
      )
      req.on("error", e => reject(e.message))
      req.write(body)
      req.end()
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
 * Creates a mock that simulates a form_post browser OAuth callback and
 * captures the response.
 */
export function createMockFormPostBrowserCallbackWithCapture(
  params: CallbackParams,
  onResponse: (response: BrowserResponse) => void
): (requestUrl: string) => Promise<void> {
  return async (requestUrl: string): Promise<void> => {
    const paramsResult = parseOauth2Url(requestUrl)
    if (Result.isFailure(paramsResult)) {
      throw new Error("Invalid request url")
    }
    const redirectUrl = new URL(paramsResult.value.redirect_uri)
    const formBody = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        formBody.set(key, value)
      }
    })
    const body = formBody.toString()
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: redirectUrl.hostname,
          port: redirectUrl.port || 80,
          path: redirectUrl.pathname + redirectUrl.search,
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(body)
          }
        },
        res => {
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
        }
      )
      req.on("error", e => reject(e.message))
      req.write(body)
      req.end()
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
  callbackMethod: "GET" | "POST"
  callbackBody?: string
  callbackContentType?: string
  requestId: string
  complete: (result: RedirectResult) => void
}> {
  return async (url: string, _port: number) => {
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

    const requestId = nanoid()

    return {
      callbackUrl: callbackUrl.toString(),
      callbackMethod: "GET" as const,
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
    callbackMethod: "GET" | "POST"
    callbackBody?: string
    callbackContentType?: string
    requestId: string
    complete: (result: RedirectResult) => void
  }>
  openBrowser?: (url: string) => Promise<void>
  onFailure?: () => void
  // For testing different container responses, provide a containerPort
  // and the container will be created at that port
  containerPort?: number
  containerResponse?: ContainerResponse
  // Optional whitelist configuration for testing whitelist behavior
  whitelist?: WhitelistConfig
  // When true, simulate response_mode=form_post: the browser POSTs the auth
  // params as an application/x-www-form-urlencoded body instead of sending
  // them as URL query parameters.
  formPost?: boolean
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
    callbackMethod: "GET" | "POST"
    callbackBody?: string
    callbackContentType?: string
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
    const mockCallback = options.formPost
      ? createMockFormPostBrowserCallback(options.callbackParams)
      : createMockBrowserCallback(options.callbackParams)
    interactiveLogin = buildInteractiveLogin({
      openBrowser: async url => {
        await mockCallback(url)
      },
      logger: NO_OP_LOGGER
    })
  } else {
    // No callback params: use real interactiveLogin with no-op browser
    interactiveLogin = buildInteractiveLogin({
      openBrowser: async () => {},
      logger: NO_OP_LOGGER
    })
  }

  const server = buildCredentialProxy({
    host: LOCALHOST,
    port: options.port,
    interactiveLogin,
    openBrowser: options.openBrowser ?? (async () => {}),
    passthrough: options.passthrough ?? false,
    whitelist: options.whitelist ?? DISABLED_WHITELIST,
    logger: NO_OP_LOGGER
  })

  // If containerPort is specified, use real redirect against mock container
  // Otherwise use a mock redirect that just captures the URL
  const redirect = options.containerPort
    ? buildRedirect({ logger: NO_OP_LOGGER })
    : async (url: string): Promise<RedirectResult> => {
        capturedRedirectUrl = url
        return { type: "success" }
      }

  const forwarder = buildCredentialForwarder({
    host: LOCALHOST,
    port: options.port,
    redirect,
    logger: NO_OP_LOGGER
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
    },
    logger: NO_OP_LOGGER
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

type ContainerCapturedRequest = {
  method: string
  contentType?: string
  body: string
}

/**
 * Creates a real listening "container" (loopback server) that can capture
 * incoming requests and respond either with a fixed status/body, or based
 * on the captured request. Used to drive end-to-end tests where the real
 * client redirect logic must perform a POST/GET against an actual TCP
 * server.
 */
function createCapturingContainer(
  port: number,
  options: {
    onRequest: (received: ContainerCapturedRequest) => void
    respond: (received: ContainerCapturedRequest) => {
      statusCode: number
      body?: string
      location?: string
    }
  }
): Promise<{ close: () => void }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on("data", (c: Buffer) => chunks.push(c))
      req.on("end", () => {
        const ct = req.headers["content-type"]
        const received: ContainerCapturedRequest = {
          method: req.method ?? "",
          contentType: typeof ct === "string" ? ct : undefined,
          body: Buffer.concat(chunks).toString("utf8")
        }
        options.onRequest(received)
        const reply = options.respond(received)
        if (reply.location) {
          res.setHeader("Location", reply.location)
        }
        res.statusCode = reply.statusCode
        res.end(reply.body ?? "")
      })
    })
    server.listen(port, LOCALHOST, () => {
      resolve({ close: () => server.close() })
    })
  })
}

/**
 * Variant of createTestHarness that uses a *real* TCP listener on the
 * configured container port to capture and inspect the client-side replay.
 *
 * To avoid port collisions with the server-side interactiveLogin temporary
 * listener (which would also bind to the redirect_uri's port in a real run),
 * this harness uses a mock interactiveLogin that doesn't bind to any port.
 * That keeps the test focused on the *client-side* leg: server → client →
 * container replay. The form_post body capture inside buildInteractiveLogin
 * itself is covered by its own unit tests.
 */
export function createTestHarnessWithCustomContainer(options: {
  port: number
  callbackParams: CallbackParams
  containerPort: number
  formPost?: boolean
  onContainerRequest: (received: ContainerCapturedRequest) => void
  containerStatusCode?: number
  containerBody?: string
  respondBasedOnRequest?: (received: ContainerCapturedRequest) => {
    statusCode: number
    body?: string
    location?: string
  }
}): TestHarness {
  let capturedRedirectUrl = ""
  let capturedRedirectResult: RedirectResult | undefined

  // Mock interactiveLogin that synthesizes the InteractiveLoginResult the
  // real server would produce after receiving either a GET or POST callback.
  const mockInteractiveLogin = async (
    url: string,
    _port: number
  ): Promise<{
    callbackUrl: string
    callbackMethod: "GET" | "POST"
    callbackBody?: string
    callbackContentType?: string
    requestId: string
    complete: (result: RedirectResult) => void
  }> => {
    const paramsResult = parseOauth2Url(url)
    if (Result.isFailure(paramsResult)) {
      throw new Error("Invalid OAuth URL")
    }
    const requestId = nanoid()

    if (options.formPost) {
      // form_post: callback URL has no query params; body carries the auth
      // params; method is POST.
      const formBody = new URLSearchParams()
      Object.entries(options.callbackParams).forEach(([key, value]) => {
        if (value !== undefined) {
          formBody.set(key, value)
        }
      })
      return {
        callbackUrl: paramsResult.value.redirect_uri,
        callbackMethod: "POST" as const,
        callbackBody: formBody.toString(),
        callbackContentType: "application/x-www-form-urlencoded",
        requestId,
        complete: () => {}
      }
    }

    // query mode: params on URL, GET
    const callbackUrl = new URL(paramsResult.value.redirect_uri)
    Object.entries(options.callbackParams).forEach(([key, value]) => {
      if (value !== undefined) {
        callbackUrl.searchParams.set(key, value)
      }
    })
    return {
      callbackUrl: callbackUrl.toString(),
      callbackMethod: "GET" as const,
      requestId,
      complete: () => {}
    }
  }

  const server = buildCredentialProxy({
    host: LOCALHOST,
    port: options.port,
    interactiveLogin: mockInteractiveLogin,
    openBrowser: async () => {},
    passthrough: false,
    whitelist: DISABLED_WHITELIST,
    logger: NO_OP_LOGGER
  })

  const redirect = buildRedirect({ logger: NO_OP_LOGGER })

  const forwarder = buildCredentialForwarder({
    host: LOCALHOST,
    port: options.port,
    redirect,
    logger: NO_OP_LOGGER
  })

  let failed = false
  const client = buildBrowserHelper({
    onExit: {
      success: () => {},
      failure: () => {
        failed = true
      }
    },
    credentialForwarder: async (url: string) => {
      const result = await forwarder(url)
      capturedRedirectResult = result
      if (result.type === "redirect") {
        capturedRedirectUrl = result.location
      }
      return result
    },
    logger: NO_OP_LOGGER
  })

  const wrappedServer = async (): Promise<{ close: () => void }> => {
    const container = await createCapturingContainer(options.containerPort, {
      onRequest: options.onContainerRequest,
      respond:
        options.respondBasedOnRequest ??
        (() => ({
          statusCode: options.containerStatusCode ?? 200,
          body: options.containerBody
        }))
    })
    const { close: serverClose } = await server()
    return {
      close: () => {
        serverClose()
        container.close()
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
