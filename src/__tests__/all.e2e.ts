import {
  createTestHarness,
  getNextPort,
  sendRawRequest,
  LOCALHOST
} from "./e2e-helpers"
import { buildCredentialForwarder } from "../client/buildCredentialForwarder"

const TEST_CODE = "3khsh8dhHH92jd8alcde80"
const TEST_STATE = "test_state_abc123"
const TEST_CODE_CHALLENGE = "5i8EjAJjrgQ2-3QqQpmxERhTTmKzcCfNG59mrGgPiyE"

const TEST_URL =
  "https://login.example.com/oauth?client_id=xxx&redirect_uri=http%3A%2F%2Flocalhost%3A38915&response_type=code&scope=openid&code_challenge=" +
  TEST_CODE_CHALLENGE +
  "&code_challenge_method=S256"
const TEST_URL_WITH_PATH =
  "https://example.com/oauth?client_id=xxx&redirect_uri=http%3A%2F%2Flocalhost%3A38916%2Fcallback&response_type=code&scope=openid&code_challenge=" +
  TEST_CODE_CHALLENGE +
  "&code_challenge_method=S256&state=" +
  TEST_STATE
const MALFORMED_URL = "https://example.com/oauth?client_id=test123"

describe("happy path", () => {
  it("roundtrips OAuth code", async () => {
    const port = getNextPort()
    const harness = createTestHarness({
      port,
      callbackParams: { code: TEST_CODE }
    })

    const { close } = await harness.server()
    await harness.client(TEST_URL)
    close()

    const url = new URL(harness.getRedirectUrl())
    expect(url.searchParams.get("code")).toEqual(TEST_CODE)
  })

  it("roundtrips code and state through callback path", async () => {
    const port = getNextPort()
    const harness = createTestHarness({
      port,
      callbackParams: { code: TEST_CODE, state: TEST_STATE }
    })

    const { close } = await harness.server()
    await harness.client(TEST_URL_WITH_PATH)
    close()

    const url = new URL(harness.getRedirectUrl())
    expect(url.pathname).toEqual("/callback")
    expect(url.searchParams.get("code")).toEqual(TEST_CODE)
    expect(url.searchParams.get("state")).toEqual(TEST_STATE)
  })

  it("roundtrips error parameters", async () => {
    const port = getNextPort()
    const harness = createTestHarness({
      port,
      callbackParams: {
        error: "access_denied",
        error_description: "User denied",
        state: TEST_STATE
      }
    })

    const { close } = await harness.server()
    await harness.client(TEST_URL_WITH_PATH)
    close()

    const url = new URL(harness.getRedirectUrl())
    expect(url.searchParams.get("error")).toEqual("access_denied")
    expect(url.searchParams.get("error_description")).toEqual("User denied")
    expect(url.searchParams.get("state")).toEqual(TEST_STATE)
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
    expect(response.statusMessage).toContain("Invalid JSON")
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
  })

  it("returns 500 when interactiveLogin rejects", async () => {
    const port = getNextPort()
    const harness = createTestHarness({
      port,
      interactiveLogin: async () => {
        throw new Error("Login failed")
      }
    })

    const { close } = await harness.server()
    await harness.client(TEST_URL)
    close()

    expect(harness.didFail()).toBe(true)
  })

  it("rejects when server unavailable", async () => {
    const forwarder = buildCredentialForwarder({ host: LOCALHOST, port: 1 })
    await expect(forwarder(TEST_URL)).rejects.toThrow()
  })
})
