import http from "http"
import { buildBrowserHelper } from "../client/buildBrowserHelper"
import { buildCredentialForwarder } from "../client/buildCredentialForwarder"
import { buildOutputWriter } from "../output"
import { buildCredentialProxy } from "../server/buildCredentialProxy"
import { buildInteractiveLogin } from "../server/buildInteractiveLogin"
import { parseOauth2Url } from "../parseOauth2Url"
import { Result } from "../result"

// This is an end to end test that builds the client and server and
// runs them to make sure the request url is passed through and
// the received redirect url (with code) is returned.
//
// The client is built using a mocked `redirect` function that
// puts the output in a global variable.
// The server is built using a mocked interactive login
// function that simply makes a call to the redirect url with a
// `code`.

const LOCALHOST = "127.0.0.1"
const TEST_PORT = 45999
// set to true to see debug output
const DEBUG = false
const TEST_CODE = "3khsh8dhHH92jd8alcde80"

const TEST_REQUEST_URL =
  "https://login.microsoftonline.com/f6e8a999-5111-487e-a999-555557d56ac6/oauth2/v2.0/authorize?client_id=d68b9777-83ks-4efe-h47x-a0c8b92c5f5c&scope=499b84ac-1321-427f-aa17-267ca6975798%2Fuser_impersonation%20openid%20profile%20offline_access&redirect_uri=http%3A%2F%2Flocalhost%3A38915&client-request-id=c2eabe61-f890-4463-b322-1af5d42783b3&response_mode=query&response_type=code&code_challenge=5i8EjAJjrgQ2-3QqQpmxERhTTmKzcCfNG59mrGgPiyE&code_challenge_method=S256"

let capturedRedirectUrl: string = ""

// Build client

/**
 * mock redirect function that captures the url in a global variable
 * for later inspection
 */
const mockRedirect = async (redirectUrl: string) => {
  capturedRedirectUrl = redirectUrl
}

const credentialForwarder = buildCredentialForwarder({
  host: LOCALHOST,
  port: TEST_PORT,
  debugger: DEBUG
    ? buildOutputWriter({ color: "cyan", stream: process.stderr })
    : undefined
})

const browserHelper = buildBrowserHelper({
  onExit: {
    success: function (): void {},
    failure: function (): void {
      throw new Error("Client failure")
    }
  },
  credentialForwarder: credentialForwarder,
  redirect: mockRedirect,
  debugger: DEBUG
    ? buildOutputWriter({ color: "green", stream: process.stderr })
    : undefined
})

const client = browserHelper

// Build server

/**
 * Mock interactive login method that makes a GET request for the redirect uri
 * with the test coe
 */
const mockInteractiveLogin = async (requestUrl: string): Promise<void> => {
  const paramsResult = parseOauth2Url(requestUrl)
  if (Result.isFailure(paramsResult)) {
    throw new Error("Invalid request url")
  }
  const redirectUrl = `${paramsResult.value.redirect_uri}/?code=${TEST_CODE}`
  return new Promise((resolve, reject) => {
    http
      .get(redirectUrl, res => {
        if (res.statusCode !== 200) {
          reject(`Request returned unexpected status: ${res.statusCode}`)
        } else {
          resolve()
        }
      })
      .on("error", error => {
        reject(error.message)
      })
  })
}

const interactiveLogin = buildInteractiveLogin({
  openBrowser: async url => {
    await mockInteractiveLogin(url)
    return
  },
  debugger: DEBUG
    ? buildOutputWriter({ color: "magenta", stream: process.stdout })
    : undefined
})

const credentialProxy = buildCredentialProxy({
  host: LOCALHOST,
  port: TEST_PORT,
  interactiveLogin: interactiveLogin,
  debugger: DEBUG
    ? buildOutputWriter({ color: "green", stream: process.stdout })
    : undefined
})

const startServer = credentialProxy

it("passes the request url and returns the redirect url with expected code", async () => {
  const { close } = await startServer()

  await client(TEST_REQUEST_URL)

  close()

  const receivedUrl = new URL(capturedRedirectUrl)
  expect(receivedUrl.searchParams.get("code")).toEqual(TEST_CODE)
})
