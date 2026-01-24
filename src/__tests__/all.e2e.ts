import {
  createTestHarness,
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

// Disabled whitelist for e2e tests
const DISABLED_WHITELIST: WhitelistConfig = {
  enabled: false,
  domains: new Set(),
  configPath: ""
}

// No-op logger for e2e tests
const NO_OP_LOGGER = (_str: string): void => {}
import { buildRedirect } from "../client/buildRedirect"

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
    const redirect = buildRedirect({})
    const forwarder = buildCredentialForwarder({
      host: LOCALHOST,
      port: 1,
      redirect
    })
    await expect(forwarder(createTestUrl(redirectPort))).rejects.toThrow(
      /ECONNREFUSED|connect/i
    )
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
