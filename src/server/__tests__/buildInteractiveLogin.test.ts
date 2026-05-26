import http from "http"
import net from "net"
import { buildInteractiveLogin } from "../buildInteractiveLogin"
import { buildNoOpLogger } from "../../__tests__/test-logger"

const LOCALHOST = "127.0.0.1"

const getRandomPort = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on("error", reject)
    srv.listen(0, LOCALHOST, () => {
      const address = srv.address()
      if (address && typeof address === "object") {
        const port = address.port
        srv.close(() => resolve(port))
      } else {
        srv.close()
        reject(new Error("Could not get random port"))
      }
    })
  })
}

const OAUTH_URL =
  "https://example.com/oauth?client_id=test&redirect_uri=http://localhost:1&response_type=code&scope=openid"

describe("buildInteractiveLogin — callback capture", () => {
  it("returns callbackMethod='GET' for a query-mode callback", async () => {
    const port = await getRandomPort()
    const interactiveLogin = buildInteractiveLogin({
      openBrowser: async () => {
        // Simulate browser hitting the redirect URI as a GET with query params
        await new Promise<void>((resolve, reject) => {
          const req = http.request(
            {
              hostname: LOCALHOST,
              port,
              path: "/?code=abc&state=xyz",
              method: "GET"
            },
            () => resolve()
          )
          req.on("error", reject)
          req.end()
        })
      },
      logger: buildNoOpLogger()
    })

    const result = await interactiveLogin(OAUTH_URL, port)

    expect(result.callbackMethod).toBe("GET")
    expect(result.callbackBody).toBeUndefined()
    expect(result.callbackContentType).toBeUndefined()
    expect(result.callbackUrl).toContain("/?code=abc&state=xyz")
    result.complete({ type: "success" })
  })

  it("captures method, body, and Content-Type for a form_post callback", async () => {
    const port = await getRandomPort()
    const body =
      "code=AUTHCODE&state=STATE123&client_info=CINFO&session_state=SESS"

    const interactiveLogin = buildInteractiveLogin({
      openBrowser: async () => {
        // Simulate browser POSTing the auth response (response_mode=form_post)
        await new Promise<void>((resolve, reject) => {
          const req = http.request(
            {
              hostname: LOCALHOST,
              port,
              path: "/",
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(body)
              }
            },
            () => resolve()
          )
          req.on("error", reject)
          req.write(body)
          req.end()
        })
      },
      logger: buildNoOpLogger()
    })

    const result = await interactiveLogin(OAUTH_URL, port)

    expect(result.callbackMethod).toBe("POST")
    expect(result.callbackBody).toBe(body)
    expect(result.callbackContentType).toBe("application/x-www-form-urlencoded")
    // The callback URL itself has no query params in form_post mode
    expect(result.callbackUrl).toMatch(/\/$/)
    result.complete({ type: "success" })
  })

  it("preserves the exact form_post body bytes (Buffer.concat, not chunk join)", async () => {
    const port = await getRandomPort()
    // Use a body containing utf-8 to verify we don't mangle bytes when chunks
    // are split.
    const body = "code=héllo&state=wörld"

    const interactiveLogin = buildInteractiveLogin({
      openBrowser: async () => {
        await new Promise<void>((resolve, reject) => {
          const req = http.request(
            {
              hostname: LOCALHOST,
              port,
              path: "/",
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(body, "utf8")
              }
            },
            () => resolve()
          )
          req.on("error", reject)
          // Split into two writes to force multi-chunk parsing
          const bytes = Buffer.from(body, "utf8")
          req.write(bytes.subarray(0, 5))
          req.write(bytes.subarray(5))
          req.end()
        })
      },
      logger: buildNoOpLogger()
    })

    const result = await interactiveLogin(OAUTH_URL, port)
    expect(result.callbackBody).toBe(body)
    result.complete({ type: "success" })
  })

  it("rejects on login timeout when no callback arrives", async () => {
    const port = await getRandomPort()
    const interactiveLogin = buildInteractiveLogin({
      openBrowser: async () => {
        // Never trigger a callback
      },
      logger: buildNoOpLogger(),
      loginTimeoutMs: 50
    })

    await expect(interactiveLogin(OAUTH_URL, port)).rejects.toThrow(/timeout/i)
  })

  it("complete() responds 200 with default body when result is success", async () => {
    const port = await getRandomPort()
    let browserResponseBody = ""
    let browserStatusCode = 0

    const browserDone = new Promise<void>((resolve, reject) => {
      // Pre-arm the browser callback so we can capture the held response
      setImmediate(() => {
        const req = http.request(
          {
            hostname: LOCALHOST,
            port,
            path: "/?code=abc",
            method: "GET"
          },
          res => {
            browserStatusCode = res.statusCode ?? 0
            const chunks: Buffer[] = []
            res.on("data", (c: Buffer) => chunks.push(c))
            res.on("end", () => {
              browserResponseBody = Buffer.concat(chunks).toString("utf8")
              resolve()
            })
          }
        )
        req.on("error", reject)
        req.end()
      })
    })

    const interactiveLogin = buildInteractiveLogin({
      openBrowser: async () => {
        // browser is already arming on its own
      },
      logger: buildNoOpLogger()
    })

    const result = await interactiveLogin(OAUTH_URL, port)
    result.complete({ type: "success" })
    await browserDone

    expect(browserStatusCode).toBe(200)
    expect(browserResponseBody).toMatch(/Authentication completed/i)
  })

  it("ignores follow-up requests on the same keep-alive connection without re-resolving", async () => {
    // This is the favicon/prefetch scenario observed in the real failure log.
    // After the first callback, the listening socket is closed but the
    // browser may pipeline additional requests on the keep-alive connection.
    const port = await getRandomPort()

    const interactiveLogin = buildInteractiveLogin({
      openBrowser: async () => {
        // Send the real callback first.
        const agent = new http.Agent({ keepAlive: true })
        await new Promise<void>((resolve, reject) => {
          const req = http.request(
            {
              hostname: LOCALHOST,
              port,
              path: "/?code=abc",
              method: "GET",
              agent
            },
            res => {
              res.on("data", () => {})
              res.on("end", () => resolve())
            }
          )
          req.on("error", reject)
          req.end()
        })
        agent.destroy()
      },
      logger: buildNoOpLogger()
    })

    // Should resolve exactly once and not throw.
    const result = await interactiveLogin(OAUTH_URL, port)
    expect(result.callbackMethod).toBe("GET")
    result.complete({ type: "success" })
  })
})
