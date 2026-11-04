import http from "http"
import net from "net"
import {
  createTestHarness,
  createTestHarnessWithCustomContainer,
  createMockBrowserCallback,
  createMockContainer,
  getNextPort,
  sendRawRequest,
  LOCALHOST
} from "./e2e-helpers"
import { buildCredentialForwarder } from "../client/buildCredentialForwarder"
import { buildCredentialProxy } from "../server/buildCredentialProxy"
import {
  buildInteractiveLogin,
  InteractiveLoginResult
} from "../server/buildInteractiveLogin"
import { WhitelistConfig } from "../server/whitelist"
import { buildNoOpLogger } from "./test-logger"
import { buildRedirect } from "../client/buildRedirect"
import { RedirectResult } from "../redirect-types"

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

const TEST_CODE = "3khsh8dhHH92jd8alcde80"
const TEST_STATE = "test_state_abc123"
const TEST_CODE_CHALLENGE = "5i8EjAJjrgQ2-3QqQpmxERhTTmKzcCfNG59mrGgPiyE"
const MALFORMED_URL = "https://example.com/oauth?client_id=test123"

// Helper to create OAuth2 URLs with dynamic ports
function createTestUrl(
  redirectPort: number,
  path: string = "",
  includeState: boolean = false
): string {
  const redirectUri = encodeURIComponent(
    `http://localhost:${redirectPort}${path}`
  )
  let url = `https://login.example.com/oauth?client_id=xxx&redirect_uri=${redirectUri}&response_type=code&scope=openid&code_challenge=${TEST_CODE_CHALLENGE}&code_challenge_method=S256`
  if (includeState) {
    url += `&state=${TEST_STATE}`
  }
  return url
}

describe("happy path", () => {
  it("roundtrips OAuth code", async () => {
    const serverPort = getNextPort()
    const redirectPort = getNextPort()
    const harness = createTestHarness({
      port: serverPort,
      callbackParams: { code: TEST_CODE }
    })

    const { close } = await harness.server()
    await harness.client(createTestUrl(redirectPort))
    close()

    expect(harness.didFail()).toBe(false)
    const url = new URL(harness.getRedirectUrl())
    expect(url.searchParams.get("code")).toEqual(TEST_CODE)
  })

  it("roundtrips OAuth code via response_mode=form_post", async () => {
    // Simulates the Azure CLI flow: Microsoft delivers the auth code as a
    // POST with application/x-www-form-urlencoded body instead of as URL
    // query parameters.
    const serverPort = getNextPort()
    const redirectPort = getNextPort()

    // The client-side redirect should hit a real container and replay the
    // form_post POST; verify the container actually sees a POST with the
    // expected body.
    let receivedMethod: string | undefined
    let receivedContentType: string | undefined
    let receivedBody: string | undefined

    const harness = createTestHarnessWithCustomContainer({
      port: serverPort,
      callbackParams: { code: TEST_CODE, state: TEST_STATE },
      containerPort: redirectPort,
      formPost: true,
      onContainerRequest: req => {
        receivedMethod = req.method
        receivedContentType = req.contentType
        receivedBody = req.body
      },
      containerStatusCode: 200,
      containerBody: "<html>Authentication successful!</html>"
    })

    const { close } = await harness.server()
    await harness.client(createTestUrl(redirectPort, "", true))
    close()

    expect(harness.didFail()).toBe(false)
    const result = harness.getRedirectResult()
    expect(result?.type).toBe("success")

    expect(receivedMethod).toBe("POST")
    expect(receivedContentType).toBe("application/x-www-form-urlencoded")
    expect(receivedBody).toContain(`code=${TEST_CODE}`)
    expect(receivedBody).toContain(`state=${TEST_STATE}`)
  })

  it("propagates 400 from form_post replay as an error result (regression)", async () => {
    // This is the exact scenario from the bug report: with response_mode=form_post,
    // an old/buggy forwarder would replay the callback as a GET with no body, and
    // the local OAuth listener would return 400. Verify the round-trip now succeeds.
    // We simulate the "buggy" listener by having the container return 400 for GET,
    // and 200 only for POST with a body. The fix should produce a "success" because
    // we POST the body through correctly.
    const serverPort = getNextPort()
    const redirectPort = getNextPort()

    const harness = createTestHarnessWithCustomContainer({
      port: serverPort,
      callbackParams: { code: TEST_CODE },
      containerPort: redirectPort,
      formPost: true,
      onContainerRequest: () => {},
      // Only succeed when a non-empty POST body is received
      respondBasedOnRequest: req =>
        req.method === "POST" && req.body.includes("code=")
          ? { statusCode: 200, body: "<html>OK</html>" }
          : { statusCode: 400, body: "missing code" }
    })

    const { close } = await harness.server()
    await harness.client(createTestUrl(redirectPort))
    close()

    expect(harness.didFail()).toBe(false)
    expect(harness.getRedirectResult()?.type).toBe("success")
  })

  it("roundtrips code and state through callback path", async () => {
    const serverPort = getNextPort()
    const redirectPort = getNextPort()
    const harness = createTestHarness({
      port: serverPort,
      callbackParams: { code: TEST_CODE, state: TEST_STATE }
    })

    const { close } = await harness.server()
    await harness.client(createTestUrl(redirectPort, "/callback", true))
    close()

    expect(harness.didFail()).toBe(false)
    const url = new URL(harness.getRedirectUrl())
    expect(url.pathname).toEqual("/callback")
    expect(url.searchParams.get("code")).toEqual(TEST_CODE)
    expect(url.searchParams.get("state")).toEqual(TEST_STATE)
  })

  it("roundtrips error parameters", async () => {
    const serverPort = getNextPort()
    const redirectPort = getNextPort()
    const harness = createTestHarness({
      port: serverPort,
      callbackParams: {
        error: "access_denied",
        error_description: "User denied",
        state: TEST_STATE
      }
    })

    const { close } = await harness.server()
    await harness.client(createTestUrl(redirectPort, "/callback", true))
    close()

    expect(harness.didFail()).toBe(false)
    const url = new URL(harness.getRedirectUrl())
    expect(url.searchParams.get("error")).toEqual("access_denied")
    expect(url.searchParams.get("error_description")).toEqual("User denied")
    expect(url.searchParams.get("state")).toEqual(TEST_STATE)
  })
})

describe("container redirect handling", () => {
  it("follows localhost 302 redirect and reports success", async () => {
    const serverPort = getNextPort()
    const containerPort = getNextPort()
    const secondContainerPort = getNextPort()

    // Set up the second container (target of redirect) manually
    const container2 = await createMockContainer(secondContainerPort, {
      type: "status",
      statusCode: 200,
      body: "Success from second container"
    })

    // The harness creates the first container that redirects to the second
    const harness = createTestHarness({
      port: serverPort,
      callbackParams: { code: TEST_CODE },
      containerPort,
      containerResponse: {
        type: "redirect",
        statusCode: 302,
        location: `http://localhost:${secondContainerPort}/success`
      }
    })

    const { close } = await harness.server()
    await harness.client(createTestUrl(containerPort))
    close()
    container2.close()

    expect(harness.didFail()).toBe(false)
    const result = harness.getRedirectResult()
    expect(result?.type).toBe("success")
  })

  it("follows localhost 301 redirect", async () => {
    const serverPort = getNextPort()
    const containerPort = getNextPort()
    const secondContainerPort = getNextPort()

    // Set up the target container manually
    const container2 = await createMockContainer(secondContainerPort, {
      type: "status",
      statusCode: 200
    })

    // The harness creates the first container that redirects
    const harness = createTestHarness({
      port: serverPort,
      callbackParams: { code: TEST_CODE },
      containerPort,
      containerResponse: {
        type: "redirect",
        statusCode: 301,
        location: `http://localhost:${secondContainerPort}/`
      }
    })

    const { close } = await harness.server()
    await harness.client(createTestUrl(containerPort))
    close()
    container2.close()

    expect(harness.didFail()).toBe(false)
    const result = harness.getRedirectResult()
    expect(result?.type).toBe("success")
  })

  it("returns non-localhost 302 redirect without following", async () => {
    const serverPort = getNextPort()
    const containerPort = getNextPort()

    const externalUrl = "https://provider.example.com/success?session=abc123"

    const harness = createTestHarness({
      port: serverPort,
      callbackParams: { code: TEST_CODE },
      containerPort,
      containerResponse: {
        type: "redirect",
        statusCode: 302,
        location: externalUrl
      }
    })

    const { close } = await harness.server()
    await harness.client(createTestUrl(containerPort))
    close()

    expect(harness.didFail()).toBe(false)
    const result = harness.getRedirectResult()
    expect(result?.type).toBe("redirect")
    if (result?.type === "redirect") {
      expect(result.location).toBe(externalUrl)
    }
  })

  it("follows chain of localhost redirects", async () => {
    const serverPort = getNextPort()
    const containerPort = getNextPort()
    const port2 = getNextPort()
    const port3 = getNextPort()

    // Set up intermediate and final containers manually
    const container2 = await createMockContainer(port2, {
      type: "redirect",
      statusCode: 302,
      location: `http://127.0.0.1:${port3}/final`
    })
    const container3 = await createMockContainer(port3, {
      type: "status",
      statusCode: 200,
      body: "Final destination"
    })

    // Harness creates the first container in the chain
    const harness = createTestHarness({
      port: serverPort,
      callbackParams: { code: TEST_CODE },
      containerPort,
      containerResponse: {
        type: "redirect",
        statusCode: 302,
        location: `http://localhost:${port2}/step2`
      }
    })

    const { close } = await harness.server()
    await harness.client(createTestUrl(containerPort))
    close()
    container2.close()
    container3.close()

    expect(harness.didFail()).toBe(false)
    const result = harness.getRedirectResult()
    expect(result?.type).toBe("success")
  })

  it("returns success with body when container returns 200", async () => {
    const serverPort = getNextPort()
    const containerPort = getNextPort()

    const harness = createTestHarness({
      port: serverPort,
      callbackParams: { code: TEST_CODE },
      containerPort,
      containerResponse: {
        type: "status",
        statusCode: 200,
        body: "<html>Authentication successful!</html>"
      }
    })

    const { close } = await harness.server()
    await harness.client(createTestUrl(containerPort))
    close()

    expect(harness.didFail()).toBe(false)
    const result = harness.getRedirectResult()
    expect(result?.type).toBe("success")
    if (result?.type === "success") {
      expect(result.body).toBe("<html>Authentication successful!</html>")
    }
  })

  it("returns error when container returns 500", async () => {
    const serverPort = getNextPort()
    const containerPort = getNextPort()

    const harness = createTestHarness({
      port: serverPort,
      callbackParams: { code: TEST_CODE },
      containerPort,
      containerResponse: {
        type: "status",
        statusCode: 500
      }
    })

    const { close } = await harness.server()
    await harness.client(createTestUrl(containerPort))
    close()

    // The client should report failure when container returns error
    expect(harness.didFail()).toBe(true)
    const result = harness.getRedirectResult()
    expect(result?.type).toBe("error")
  })
})

describe("passthrough mode", () => {
  it("opens browser when enabled", async () => {
    const port = getNextPort()
    let openedUrl: string | null = null

    const harness = createTestHarness({
      port,
      passthrough: true,
      openBrowser: async url => {
        openedUrl = url
      },
      interactiveLogin: async () => {
        throw new Error("Should not call")
      }
    })

    const { close } = await harness.server()
    await harness.client(MALFORMED_URL)
    close()

    expect(harness.didFail()).toBe(true)
    expect(openedUrl).toEqual(MALFORMED_URL)
  })

  it("does not open browser when disabled", async () => {
    const port = getNextPort()
    let opened = false

    const harness = createTestHarness({
      port,
      passthrough: false,
      openBrowser: async () => {
        opened = true
      },
      interactiveLogin: async () => {
        throw new Error("Should not call")
      }
    })

    const { close } = await harness.server()
    await harness.client(MALFORMED_URL)
    close()

    expect(harness.didFail()).toBe(true)
    expect(opened).toBe(false)
  })
})

describe("URL whitelist", () => {
  const WHITELISTED_DOMAIN = "login.example.com"
  const NON_WHITELISTED_DOMAIN = "evil.example.com"

  const ENABLED_WHITELIST: WhitelistConfig = {
    enabled: true,
    domains: new Set([WHITELISTED_DOMAIN]),
    configPath: "",
    usingLegacyPath: false,
    preferredLocation: ""
  }

  it("allows OAuth2 URLs with whitelisted domain", async () => {
    const serverPort = getNextPort()
    const redirectPort = getNextPort()

    const harness = createTestHarness({
      port: serverPort,
      callbackParams: { code: TEST_CODE },
      whitelist: ENABLED_WHITELIST
    })

    const { close } = await harness.server()
    // createTestUrl uses login.example.com which is whitelisted
    await harness.client(createTestUrl(redirectPort))
    close()

    expect(harness.didFail()).toBe(false)
    expect(harness.getRedirectUrl()).toContain(`code=${TEST_CODE}`)
  })

  it("rejects OAuth2 URLs with non-whitelisted domain", async () => {
    const serverPort = getNextPort()
    const redirectPort = getNextPort()

    const harness = createTestHarness({
      port: serverPort,
      whitelist: ENABLED_WHITELIST,
      interactiveLogin: async () => {
        throw new Error("Should not call interactiveLogin for rejected domain")
      }
    })

    const { close } = await harness.server()

    // Create URL with non-whitelisted domain
    const nonWhitelistedUrl = `https://${NON_WHITELISTED_DOMAIN}/oauth?client_id=xxx&redirect_uri=${encodeURIComponent(`http://localhost:${redirectPort}`)}&response_type=code&scope=openid&code_challenge=${TEST_CODE_CHALLENGE}&code_challenge_method=S256`

    const response = await sendRawRequest(
      serverPort,
      JSON.stringify({ url: nonWhitelistedUrl })
    )
    close()

    expect(response.statusCode).toEqual(403)
    expect(response.statusMessage).toContain(NON_WHITELISTED_DOMAIN)
    expect(response.statusMessage).toContain("not in the whitelist")
  })

  it("allows passthrough URLs with whitelisted domain", async () => {
    const port = getNextPort()
    let openedUrl: string | null = null

    const whitelistedPassthroughUrl = `https://${WHITELISTED_DOMAIN}/some-path`

    const harness = createTestHarness({
      port,
      passthrough: true,
      whitelist: ENABLED_WHITELIST,
      openBrowser: async url => {
        openedUrl = url
      },
      interactiveLogin: async () => {
        throw new Error("Should not call")
      }
    })

    const { close } = await harness.server()
    await harness.client(whitelistedPassthroughUrl)
    close()

    // Passthrough still returns failure (400) but opens the browser
    expect(harness.didFail()).toBe(true)
    expect(openedUrl).toEqual(whitelistedPassthroughUrl)
  })

  it("rejects passthrough URLs with non-whitelisted domain", async () => {
    const port = getNextPort()
    let openedUrl: string | null = null

    const nonWhitelistedPassthroughUrl = `https://${NON_WHITELISTED_DOMAIN}/some-path`

    const harness = createTestHarness({
      port,
      passthrough: true,
      whitelist: ENABLED_WHITELIST,
      openBrowser: async url => {
        openedUrl = url
      },
      interactiveLogin: async () => {
        throw new Error("Should not call")
      }
    })

    const { close } = await harness.server()

    const response = await sendRawRequest(
      port,
      JSON.stringify({ url: nonWhitelistedPassthroughUrl })
    )
    close()

    expect(response.statusCode).toEqual(403)
    expect(response.statusMessage).toContain(NON_WHITELISTED_DOMAIN)
    expect(openedUrl).toBeNull()
  })

  it("allows all URLs when whitelist is disabled", async () => {
    const serverPort = getNextPort()
    const redirectPort = getNextPort()

    const harness = createTestHarness({
      port: serverPort,
      callbackParams: { code: TEST_CODE },
      whitelist: DISABLED_WHITELIST
    })

    const { close } = await harness.server()

    // Use a random domain - should work with disabled whitelist
    const anyDomainUrl = `https://any-random-domain.com/oauth?client_id=xxx&redirect_uri=${encodeURIComponent(`http://localhost:${redirectPort}`)}&response_type=code&scope=openid&code_challenge=${TEST_CODE_CHALLENGE}&code_challenge_method=S256`

    await harness.client(anyDomainUrl)
    close()

    expect(harness.didFail()).toBe(false)
  })
})

describe("error handling", () => {
  it("returns 400 for invalid URL syntax", async () => {
    const port = getNextPort()
    const harness = createTestHarness({
      port,
      interactiveLogin: async () => {
        throw new Error("Should not call")
      }
    })

    const { close } = await harness.server()
    const response = await sendRawRequest(
      port,
      JSON.stringify({ url: "--help" })
    )
    close()

    expect(response.statusCode).toEqual(400)
    expect(response.statusMessage).toMatch(/invalid url/i)
  })

  it("returns 400 for invalid JSON", async () => {
    const port = getNextPort()
    const harness = createTestHarness({
      port,
      interactiveLogin: async () => {
        throw new Error("Should not call")
      }
    })

    const { close } = await harness.server()
    const response = await sendRawRequest(port, "not json{{{")
    close()

    expect(response.statusCode).toEqual(400)
    expect(response.statusMessage).toMatch(/json/i)
  })

  it("returns 400 for missing url property", async () => {
    const port = getNextPort()
    const harness = createTestHarness({
      port,
      interactiveLogin: async () => {
        throw new Error("Should not call")
      }
    })

    const { close } = await harness.server()
    const response = await sendRawRequest(port, JSON.stringify({ notUrl: "x" }))
    close()

    expect(response.statusCode).toEqual(400)
    expect(response.statusMessage).toMatch(/url/i)
  })

  it("returns 500 when interactiveLogin rejects", async () => {
    const port = getNextPort()
    const redirectPort = getNextPort()
    const harness = createTestHarness({
      port,
      interactiveLogin: async () => {
        throw new Error("Login failed")
      }
    })

    const { close } = await harness.server()
    const response = await sendRawRequest(
      port,
      JSON.stringify({ url: createTestUrl(redirectPort) })
    )
    close()

    expect(response.statusCode).toEqual(500)
  })

  it("rejects when server unavailable", async () => {
    const redirectPort = getNextPort()
    const redirect = buildRedirect({ logger: NO_OP_LOGGER })
    const forwarder = buildCredentialForwarder({
      host: LOCALHOST,
      port: 1,
      redirect,
      logger: NO_OP_LOGGER
    })
    await expect(forwarder(createTestUrl(redirectPort))).rejects.toThrow(
      /ECONNREFUSED|connect/i
    )
  })
})

describe("server → client wire format for form_post", () => {
  it("includes method/body/contentType in the JSON response when callback is POST", async () => {
    const port = getNextPort()
    const redirectPort = getNextPort()
    const TEST_BODY = "code=abc&state=xyz&session_state=sss"
    const TEST_CT = "application/x-www-form-urlencoded"

    const harness = createTestHarness({
      port,
      interactiveLogin: async () => ({
        callbackUrl: `http://localhost:${redirectPort}/`,
        callbackMethod: "POST",
        callbackBody: TEST_BODY,
        callbackContentType: TEST_CT,
        requestId: "test-form-post-id",
        complete: () => {}
      })
    })

    const { close } = await harness.server()
    const response = await sendRawRequest(
      port,
      JSON.stringify({
        url: `https://example.com/oauth?client_id=x&redirect_uri=http://localhost:${redirectPort}&response_type=code&scope=openid&code_challenge=${TEST_CODE_CHALLENGE}&code_challenge_method=S256&response_mode=form_post`
      })
    )
    close()

    expect(response.statusCode).toEqual(200)
    const parsed = JSON.parse(response.body)
    expect(parsed.method).toEqual("POST")
    expect(parsed.body).toEqual(TEST_BODY)
    expect(parsed.contentType).toEqual(TEST_CT)
    expect(parsed.url).toEqual(`http://localhost:${redirectPort}/`)
    expect(parsed.requestId).toEqual("test-form-post-id")
  })

  it("omits method/body/contentType when callback is GET (back-compat)", async () => {
    const port = getNextPort()
    const redirectPort = getNextPort()

    const harness = createTestHarness({
      port,
      interactiveLogin: async () => ({
        callbackUrl: `http://localhost:${redirectPort}/?code=abc`,
        callbackMethod: "GET",
        requestId: "test-get-id",
        complete: () => {}
      })
    })

    const { close } = await harness.server()
    const response = await sendRawRequest(
      port,
      JSON.stringify({
        url: `https://example.com/oauth?client_id=x&redirect_uri=http://localhost:${redirectPort}&response_type=code&scope=openid&code_challenge=${TEST_CODE_CHALLENGE}&code_challenge_method=S256`
      })
    )
    close()

    expect(response.statusCode).toEqual(200)
    const parsed = JSON.parse(response.body)
    expect(parsed.method).toBeUndefined()
    expect(parsed.body).toBeUndefined()
    expect(parsed.contentType).toBeUndefined()
    expect(parsed.url).toEqual(`http://localhost:${redirectPort}/?code=abc`)
  })
})

describe("/complete endpoint", () => {
  it("returns 400 for invalid JSON", async () => {
    const port = getNextPort()
    const harness = createTestHarness({
      port,
      interactiveLogin: async () => {
        throw new Error("Should not call")
      }
    })

    const { close } = await harness.server()
    const response = await sendRawRequest(port, "not json", "/complete")
    close()

    expect(response.statusCode).toEqual(400)
    expect(response.statusMessage).toMatch(/json/i)
  })

  it("returns 400 for missing requestId", async () => {
    const port = getNextPort()
    const harness = createTestHarness({
      port,
      interactiveLogin: async () => {
        throw new Error("Should not call")
      }
    })

    const { close } = await harness.server()
    const response = await sendRawRequest(
      port,
      JSON.stringify({ result: { type: "success" } }),
      "/complete"
    )
    close()

    expect(response.statusCode).toEqual(400)
    expect(response.statusMessage).toMatch(/requestId|result/i)
  })

  it("returns 404 for unknown requestId", async () => {
    const port = getNextPort()
    const harness = createTestHarness({
      port,
      interactiveLogin: async () => {
        throw new Error("Should not call")
      }
    })

    const { close } = await harness.server()
    const response = await sendRawRequest(
      port,
      JSON.stringify({
        requestId: "unknown-id",
        result: { type: "success" }
      }),
      "/complete"
    )
    close()

    expect(response.statusCode).toEqual(404)
    expect(response.statusMessage).toMatch(/pending|request/i)
  })
})

describe("timeout handling", () => {
  it("interactive login server times out if user does not complete OAuth flow", async () => {
    const port = getNextPort()
    const SHORT_TIMEOUT_MS = 100 // Very short timeout for testing

    const interactiveLogin = buildInteractiveLogin({
      openBrowser: async () => {
        // Simulate user not completing the OAuth flow - do nothing
      },
      logger: NO_OP_LOGGER,
      loginTimeoutMs: SHORT_TIMEOUT_MS
    })

    // This should reject with a timeout error
    await expect(
      interactiveLogin(
        "https://example.com/oauth?client_id=test&redirect_uri=http://localhost:12345&response_type=code&scope=openid&code_challenge=abc&code_challenge_method=S256",
        port
      )
    ).rejects.toThrow(/timeout/i)
  })

  it("pending request expires after TTL and returns 404 on late completion", async () => {
    const port = getNextPort()
    const SHORT_TTL_MS = 100 // Very short TTL for testing
    let capturedRequestId: string | null = null

    // Use a mock interactiveLogin that completes immediately without waiting for browser
    const mockInteractiveLogin = async (
      _url: string,
      _responsePort: number
    ): Promise<InteractiveLoginResult> => {
      const requestId = `test-${Date.now()}`
      capturedRequestId = requestId
      return {
        callbackUrl: `http://localhost:${_responsePort}?code=test`,
        callbackMethod: "GET" as const,
        requestId,
        complete: () => {}
      }
    }

    const server = buildCredentialProxy({
      host: LOCALHOST,
      port,
      interactiveLogin: mockInteractiveLogin,
      openBrowser: async () => {},
      passthrough: false,
      pendingRequestTtlMs: SHORT_TTL_MS,
      whitelist: DISABLED_WHITELIST,
      logger: NO_OP_LOGGER
    })

    const { close } = await server()

    // Send OAuth request to create a pending request
    const redirectPort = getNextPort()
    const response = await sendRawRequest(
      port,
      JSON.stringify({
        url: `https://example.com/oauth?client_id=test&redirect_uri=http://localhost:${redirectPort}&response_type=code&scope=openid&code_challenge=abc&code_challenge_method=S256`
      })
    )
    expect(response.statusCode).toEqual(200)
    expect(capturedRequestId).not.toBeNull()

    // Wait for TTL to expire
    await new Promise(resolve => setTimeout(resolve, SHORT_TTL_MS + 50))

    // Now try to complete - should return 404 because request expired
    const completeResponse = await sendRawRequest(
      port,
      JSON.stringify({
        requestId: capturedRequestId,
        result: { type: "success" }
      }),
      "/complete"
    )

    expect(completeResponse.statusCode).toEqual(404)
    close()
  })

  it("pending request completes successfully before TTL expires", async () => {
    const port = getNextPort()
    const LONG_TTL_MS = 60000 // Long TTL to ensure it doesn't expire
    let capturedRequestId: string | null = null

    // Use a mock interactiveLogin that completes immediately without waiting for browser
    const mockInteractiveLogin = async (
      _url: string,
      _responsePort: number
    ): Promise<InteractiveLoginResult> => {
      const requestId = `test-${Date.now()}`
      capturedRequestId = requestId
      return {
        callbackUrl: `http://localhost:${_responsePort}?code=test`,
        callbackMethod: "GET" as const,
        requestId,
        complete: () => {}
      }
    }

    const server = buildCredentialProxy({
      host: LOCALHOST,
      port,
      interactiveLogin: mockInteractiveLogin,
      openBrowser: async () => {},
      passthrough: false,
      pendingRequestTtlMs: LONG_TTL_MS,
      whitelist: DISABLED_WHITELIST,
      logger: NO_OP_LOGGER
    })

    const { close } = await server()

    // Send OAuth request to create a pending request
    const redirectPort = getNextPort()
    const response = await sendRawRequest(
      port,
      JSON.stringify({
        url: `https://example.com/oauth?client_id=test&redirect_uri=http://localhost:${redirectPort}&response_type=code&scope=openid&code_challenge=abc&code_challenge_method=S256`
      })
    )
    expect(response.statusCode).toEqual(200)
    expect(capturedRequestId).not.toBeNull()

    // Complete immediately - should succeed
    const completeResponse = await sendRawRequest(
      port,
      JSON.stringify({
        requestId: capturedRequestId,
        result: { type: "success" }
      }),
      "/complete"
    )

    expect(completeResponse.statusCode).toEqual(200)
    close()
  })
})

// Sends an OAuth request to the server and abandons it after `abortAfterMs`,
// like a user pressing Ctrl+C on the tool in the container.
function sendAbandonedRequest(
  port: number,
  body: string,
  abortAfterMs: number
): Promise<void> {
  return new Promise(resolve => {
    const req = http.request({
      hostname: LOCALHOST,
      port,
      path: "/",
      method: "POST"
    })
    req.on("error", () => {
      // Expected: the request is destroyed below.
    })
    req.end(body)
    setTimeout(() => {
      req.destroy()
      resolve()
    }, abortAfterMs)
  })
}

const isPortFree = (port: number): Promise<boolean> =>
  new Promise(resolve => {
    const srv = net.createServer()
    srv.once("error", () => resolve(false))
    srv.listen(port, LOCALHOST, () => srv.close(() => resolve(true)))
  })

// Polls until the condition holds or the timeout passes.
async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number = 1000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) {
      return true
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return condition()
}

describe("crash containment", () => {
  // Builds a server whose real interactive login opens the "browser" for
  // each request. Only browser opens listed in `completing` deliver the
  // OAuth callback; the others behave like a user who never finishes.
  function buildServer(
    port: number,
    completing: number[]
  ): {
    server: () => Promise<{ close: () => void }>
    browserOpens: () => number
  } {
    const callback = createMockBrowserCallback({ code: TEST_CODE })
    let opens = 0
    const interactiveLogin = buildInteractiveLogin({
      openBrowser: async url => {
        opens++
        if (completing.includes(opens)) {
          await callback(url)
        }
      },
      logger: NO_OP_LOGGER
    })
    return {
      server: buildCredentialProxy({
        host: LOCALHOST,
        port,
        interactiveLogin,
        openBrowser: async () => {},
        passthrough: false,
        whitelist: DISABLED_WHITELIST,
        logger: NO_OP_LOGGER
      }),
      browserOpens: () => opens
    }
  }

  function buildClient(port: number): (url: string) => Promise<string> {
    const forwarder = buildCredentialForwarder({
      host: LOCALHOST,
      port,
      redirect: async () => ({ type: "success" }),
      logger: NO_OP_LOGGER
    })
    return async url => {
      const result = await forwarder(url)
      return result.type
    }
  }

  it("a request cancelled mid-login, then an identical request, succeeds (regression)", async () => {
    const port = getNextPort()
    const redirectPort = getNextPort()
    const { server, browserOpens } = buildServer(port, [2])
    const { close } = await server()
    const url = createTestUrl(redirectPort)

    await sendAbandonedRequest(port, JSON.stringify({ url }), 50)
    expect(browserOpens()).toBe(1)
    // The cancelled login releases the redirect port.
    expect(await waitFor(() => isPortFree(redirectPort))).toBe(true)

    expect(await buildClient(port)(url)).toBe("success")
    close()
  })

  it("an identical request while the first is still waiting supersedes it with a clear error", async () => {
    const port = getNextPort()
    const redirectPort = getNextPort()
    const { server } = buildServer(port, [2])
    const { close } = await server()
    const url = createTestUrl(redirectPort)

    const first = sendRawRequest(port, JSON.stringify({ url }))
    await new Promise(resolve => setTimeout(resolve, 50))
    const second = buildClient(port)(url)

    const firstResponse = await first
    expect(firstResponse.statusCode).toBe(500)
    expect(firstResponse.statusMessage).toMatch(/superseded/i)
    expect(await second).toBe("success")
    close()
  })

  it("a request that can't bind its redirect port fails alone, and the next request succeeds", async () => {
    const port = getNextPort()
    const busyPort = getNextPort()
    const redirectPort = getNextPort()
    const occupier = net.createServer()
    await new Promise<void>(resolve =>
      occupier.listen(busyPort, LOCALHOST, () => resolve())
    )
    const { server } = buildServer(port, [1])
    const { close } = await server()

    const response = await sendRawRequest(
      port,
      JSON.stringify({ url: createTestUrl(busyPort) })
    )
    expect(response.statusCode).toBe(500)
    expect(response.statusMessage).toMatch(/EADDRINUSE/)

    expect(await buildClient(port)(createTestUrl(redirectPort))).toBe("success")
    occupier.close()
    close()
  })

  it("a browser that fails to open fails that request alone", async () => {
    const port = getNextPort()
    const redirectPort = getNextPort()
    const callback = createMockBrowserCallback({ code: TEST_CODE })
    let opens = 0
    const server = buildCredentialProxy({
      host: LOCALHOST,
      port,
      interactiveLogin: buildInteractiveLogin({
        openBrowser: async url => {
          opens++
          if (opens === 1) {
            throw new Error("no browser available")
          }
          await callback(url)
        },
        logger: NO_OP_LOGGER
      }),
      openBrowser: async () => {},
      passthrough: false,
      whitelist: DISABLED_WHITELIST,
      logger: NO_OP_LOGGER
    })
    const { close } = await server()
    const url = createTestUrl(redirectPort)

    const response = await sendRawRequest(port, JSON.stringify({ url }))
    expect(response.statusCode).toBe(500)
    expect(response.statusMessage).toMatch(/failed to open browser/i)

    expect(await buildClient(port)(url)).toBe("success")
    close()
  })

  it.each([
    {
      name: "a malformed URL with a non-Latin-1 character",
      path: "/",
      body: JSON.stringify({ url: "not a url \u2603" }),
      status: 400
    },
    {
      name: "a malformed URL with a newline",
      path: "/",
      body: JSON.stringify({ url: "not a url\nX-Injected: 1" }),
      status: 400
    },
    { name: "a JSON null body", path: "/", body: "null", status: 500 },
    {
      name: "a JSON null body on /complete",
      path: "/complete",
      body: "null",
      status: 500
    }
  ])(
    "$name gets an error response, and the next request succeeds",
    async ({ path, body, status }) => {
      const port = getNextPort()
      const redirectPort = getNextPort()
      const { server } = buildServer(port, [1])
      const { close } = await server()

      const response = await sendRawRequest(port, body, path)
      expect(response.statusCode).toBe(status)

      expect(await buildClient(port)(createTestUrl(redirectPort))).toBe(
        "success"
      )
      close()
    }
  )

  it("a completion the browser can't receive fails alone, and the next request succeeds", async () => {
    const port = getNextPort()
    const redirectPort = getNextPort()
    const { server } = buildServer(port, [1, 2])
    const { close } = await server()
    const url = createTestUrl(redirectPort)

    // Bypass the client so the test can send a bad completion.
    const response = await sendRawRequest(port, JSON.stringify({ url }))
    expect(response.statusCode).toBe(200)
    const { requestId } = JSON.parse(response.body) as { requestId: string }
    const completion = await sendRawRequest(
      port,
      JSON.stringify({
        requestId,
        result: { type: "redirect", location: "http://x/\u2603" }
      }),
      "/complete"
    )
    expect(completion.statusCode).toBe(500)

    expect(await buildClient(port)(url)).toBe("success")
    close()
  })

  it("answers the browser with an error if the client leaves after the callback arrives", async () => {
    const port = getNextPort()
    const redirectPort = getNextPort()
    let completedWith: RedirectResult | undefined
    // A login that ignores the abort signal and delivers its callback after
    // the client has already gone.
    const server = buildCredentialProxy({
      host: LOCALHOST,
      port,
      interactiveLogin: async (_url, responsePort) => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return {
          callbackUrl: `http://localhost:${responsePort}/?code=${TEST_CODE}`,
          callbackMethod: "GET" as const,
          requestId: "late",
          complete: result => {
            completedWith = result
          }
        }
      },
      openBrowser: async () => {},
      passthrough: false,
      whitelist: DISABLED_WHITELIST,
      logger: NO_OP_LOGGER
    })
    const { close } = await server()

    await sendAbandonedRequest(
      port,
      JSON.stringify({ url: createTestUrl(redirectPort) }),
      20
    )
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(completedWith?.type).toBe("error")

    // Nothing was left pending for the abandoned request.
    const completion = await sendRawRequest(
      port,
      JSON.stringify({ requestId: "late", result: { type: "success" } }),
      "/complete"
    )
    expect(completion.statusCode).toBe(404)
    close()
  })
})

describe("request decoding and startup errors", () => {
  it("decodes a multi-byte character split across TCP chunks (regression)", async () => {
    const port = getNextPort()
    const redirectPort = getNextPort()
    let receivedUrl: string | undefined
    const server = buildCredentialProxy({
      host: LOCALHOST,
      port,
      interactiveLogin: async url => {
        receivedUrl = url
        throw new Error("stop after capturing the URL")
      },
      openBrowser: async () => {},
      passthrough: false,
      whitelist: DISABLED_WHITELIST,
      logger: NO_OP_LOGGER
    })
    const { close } = await server()

    const url = `${createTestUrl(redirectPort)}&login_hint=josé`
    const body = Buffer.from(JSON.stringify({ url }), "utf8")
    // "é" is two bytes in UTF-8. Split the body between them.
    const splitAt = body.indexOf(Buffer.from("é", "utf8")) + 1
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        { hostname: LOCALHOST, port, path: "/", method: "POST" },
        res => {
          res.resume()
          res.on("end", () => resolve())
        }
      )
      req.on("error", reject)
      req.setNoDelay(true)
      req.write(body.subarray(0, splitAt))
      // Give the first chunk time to arrive on its own.
      setTimeout(() => req.end(body.subarray(splitAt)), 50)
    })
    close()

    expect(receivedUrl).toBe(url)
  })

  it("rejects with the reason when the server's port is in use", async () => {
    const port = getNextPort()
    const occupier = net.createServer()
    await new Promise<void>(resolve =>
      occupier.listen(port, LOCALHOST, () => resolve())
    )
    const server = buildCredentialProxy({
      host: LOCALHOST,
      port,
      interactiveLogin: async () => {
        throw new Error("Should not call")
      },
      openBrowser: async () => {},
      passthrough: false,
      whitelist: DISABLED_WHITELIST,
      logger: NO_OP_LOGGER
    })

    try {
      await expect(server()).rejects.toThrow(
        new RegExp(`Could not listen on ${LOCALHOST}:${port}: .*EADDRINUSE`)
      )
    } finally {
      occupier.close()
    }
  })

  it.each([
    { name: "invalid JSON", body: "not json", reason: /not valid JSON/ },
    { name: "JSON null", body: "null", reason: /not a JSON object/ },
    {
      name: "a non-string url",
      body: JSON.stringify({ url: 5, requestId: "r" }),
      reason: /'url'/
    }
  ])(
    "the client rejects, rather than crashing, when the server answers 200 with $name",
    async ({ body, reason }) => {
      const port = getNextPort()
      const fakeServer = http.createServer((_req, res) => {
        res.writeHead(200)
        res.end(body)
      })
      await new Promise<void>(resolve =>
        fakeServer.listen(port, LOCALHOST, () => resolve())
      )
      const forwarder = buildCredentialForwarder({
        host: LOCALHOST,
        port,
        redirect: async () => ({ type: "success" }),
        logger: NO_OP_LOGGER
      })

      try {
        await expect(forwarder(createTestUrl(getNextPort()))).rejects.toMatch(
          reason
        )
      } finally {
        fakeServer.close()
      }
    }
  )
})
