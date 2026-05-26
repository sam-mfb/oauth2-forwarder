import http from "http"
import { buildRedirect } from "../buildRedirect"
import { buildTestLogger, buildNoOpLogger } from "../../__tests__/test-logger"

describe("buildRedirect", () => {
  let server: http.Server | null = null
  let serverPort: number

  const createServer = (
    host: string,
    responseCode: number,
    options?: { location?: string; body?: string }
  ): Promise<number> => {
    return new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        if (options?.location) {
          res.setHeader("Location", options.location)
        }
        res.statusCode = responseCode
        res.end(options?.body ?? "")
      })
      server.on("error", reject)
      server.listen(0, host, () => {
        if (!server) {
          reject(new Error("Server not initialized"))
          return
        }
        const address = server.address()
        if (address && typeof address === "object") {
          resolve(address.port)
        } else {
          reject(new Error("Failed to get server port"))
        }
      })
    })
  }

  afterEach(() => {
    return new Promise<void>(resolve => {
      if (server && server.listening) {
        server.close(() => {
          server = null
          resolve()
        })
      } else {
        server = null
        resolve()
      }
    })
  })

  describe("basic functionality", () => {
    it("should return success with 200 response", async () => {
      serverPort = await createServer("127.0.0.1", 200)
      const redirect = buildRedirect({ logger: buildNoOpLogger() })
      const result = await redirect(`http://127.0.0.1:${serverPort}/callback`)
      expect(result.type).toBe("success")
    })

    it("should return success with body when 200 response has body", async () => {
      const body = "<html>Success!</html>"
      serverPort = await createServer("127.0.0.1", 200, { body })
      const redirect = buildRedirect({ logger: buildNoOpLogger() })
      const result = await redirect(`http://127.0.0.1:${serverPort}/callback`)
      expect(result.type).toBe("success")
      if (result.type === "success") {
        expect(result.body).toBe(body)
      }
    })

    it("should return redirect for 302 to non-localhost", async () => {
      const externalUrl = "https://example.com/success"
      serverPort = await createServer("127.0.0.1", 302, {
        location: externalUrl
      })
      const redirect = buildRedirect({ logger: buildNoOpLogger() })
      const result = await redirect(`http://127.0.0.1:${serverPort}/callback`)
      expect(result.type).toBe("redirect")
      if (result.type === "redirect") {
        expect(result.location).toBe(externalUrl)
      }
    })

    it("should return redirect for 301 to non-localhost", async () => {
      const externalUrl = "https://example.com/permanent"
      serverPort = await createServer("127.0.0.1", 301, {
        location: externalUrl
      })
      const redirect = buildRedirect({ logger: buildNoOpLogger() })
      const result = await redirect(`http://127.0.0.1:${serverPort}/callback`)
      expect(result.type).toBe("redirect")
      if (result.type === "redirect") {
        expect(result.location).toBe(externalUrl)
      }
    })

    it("should return error with other status codes", async () => {
      serverPort = await createServer("127.0.0.1", 404)
      const redirect = buildRedirect({ logger: buildNoOpLogger() })
      const result = await redirect(`http://127.0.0.1:${serverPort}/callback`)
      expect(result.type).toBe("error")
      if (result.type === "error") {
        expect(result.message).toMatch(/unexpected status.*404/i)
      }
    })

    it("should return error for 302 without Location header", async () => {
      serverPort = await createServer("127.0.0.1", 302)
      const redirect = buildRedirect({ logger: buildNoOpLogger() })
      const result = await redirect(`http://127.0.0.1:${serverPort}/callback`)
      expect(result.type).toBe("error")
      if (result.type === "error") {
        expect(result.message).toMatch(/without Location/i)
      }
    })
  })

  describe("IPv4/IPv6 fallback behavior", () => {
    it("should succeed when server listens on IPv4 (127.0.0.1)", async () => {
      serverPort = await createServer("127.0.0.1", 200)
      const redirect = buildRedirect({ logger: buildNoOpLogger() })

      // Should work with localhost (will try IPv4 first)
      const result = await redirect(`http://localhost:${serverPort}/callback`)
      expect(result.type).toBe("success")
    })

    it("should try IPv6 when IPv4 connection is refused", async () => {
      // Create server only on IPv6
      serverPort = await createServer("::1", 200)
      const { logger, messages } = buildTestLogger()
      const redirect = buildRedirect({ logger })

      // Should fail on IPv4, then succeed on IPv6
      const result = await redirect(`http://localhost:${serverPort}/callback`)
      expect(result.type).toBe("success")

      // Verify it tried IPv4 first, then IPv6
      expect(messages.some(m => m.includes("Trying IPv4"))).toBe(true)
      expect(messages.some(m => m.includes("trying IPv6"))).toBe(true)
    })

    it("should return error when both IPv4 and IPv6 fail", async () => {
      // No server running - both should fail
      const redirect = buildRedirect({ logger: buildNoOpLogger() })

      const result = await redirect("http://localhost:59999/callback")
      expect(result.type).toBe("error")
      if (result.type === "error") {
        expect(result.message).toMatch(
          /Connection refused on both IPv4 and IPv6/
        )
      }
    })

    it("should handle explicit 127.0.0.1 URLs", async () => {
      serverPort = await createServer("127.0.0.1", 200)
      const redirect = buildRedirect({ logger: buildNoOpLogger() })

      const result = await redirect(`http://127.0.0.1:${serverPort}/callback`)
      expect(result.type).toBe("success")
    })

    it("should handle explicit [::1] URLs", async () => {
      serverPort = await createServer("::1", 200)
      const redirect = buildRedirect({ logger: buildNoOpLogger() })

      const result = await redirect(`http://[::1]:${serverPort}/callback`)
      expect(result.type).toBe("success")
    })

    it("should preserve original localhost Host header when connecting via IPv4", async () => {
      let receivedHostHeader: string | undefined
      await new Promise<void>((resolve, reject) => {
        server = http.createServer((req, res) => {
          receivedHostHeader = req.headers.host
          res.statusCode = 200
          res.end()
        })
        server.on("error", reject)
        server.listen(0, "127.0.0.1", () => {
          if (!server) {
            reject(new Error("Server not initialized"))
            return
          }
          const address = server.address()
          if (address && typeof address === "object") {
            serverPort = address.port
            resolve()
          } else {
            reject(new Error("Failed to get server port"))
          }
        })
      })

      const redirect = buildRedirect({ logger: buildNoOpLogger() })
      const result = await redirect(`http://localhost:${serverPort}/callback`)

      expect(result.type).toBe("success")
      expect(receivedHostHeader).toBe(`localhost:${serverPort}`)
    })

    it("should preserve original localhost Host header when falling back to IPv6", async () => {
      let receivedHostHeader: string | undefined
      await new Promise<void>((resolve, reject) => {
        server = http.createServer((req, res) => {
          receivedHostHeader = req.headers.host
          res.statusCode = 200
          res.end()
        })
        server.on("error", reject)
        server.listen(0, "::1", () => {
          if (!server) {
            reject(new Error("Server not initialized"))
            return
          }
          const address = server.address()
          if (address && typeof address === "object") {
            serverPort = address.port
            resolve()
          } else {
            reject(new Error("Failed to get server port"))
          }
        })
      })

      const redirect = buildRedirect({ logger: buildNoOpLogger() })
      const result = await redirect(`http://localhost:${serverPort}/callback`)

      expect(result.type).toBe("success")
      expect(receivedHostHeader).toBe(`localhost:${serverPort}`)
    })
  })

  describe("debug output", () => {
    it("should call logger with request details", async () => {
      serverPort = await createServer("127.0.0.1", 200)
      const { logger, messages } = buildTestLogger()
      const redirect = buildRedirect({ logger })

      await redirect(`http://127.0.0.1:${serverPort}/callback`)

      expect(messages.length).toBeGreaterThan(0)
      expect(messages.some(m => m.includes("GET request"))).toBe(true)
    })
  })

  describe("form_post (POST) replay", () => {
    type CapturedRequest = {
      method?: string
      contentType?: string | string[]
      body: string
    }

    const createCapturingServer = (
      host: string,
      responseCode: number,
      onRequest: (received: CapturedRequest) => void,
      options?: { location?: string; body?: string }
    ): Promise<number> => {
      return new Promise((resolve, reject) => {
        server = http.createServer((req, res) => {
          const chunks: Buffer[] = []
          req.on("data", (chunk: Buffer) => chunks.push(chunk))
          req.on("end", () => {
            onRequest({
              method: req.method,
              contentType: req.headers["content-type"],
              body: Buffer.concat(chunks).toString("utf8")
            })
            if (options?.location) {
              res.setHeader("Location", options.location)
            }
            res.statusCode = responseCode
            res.end(options?.body ?? "")
          })
        })
        server.on("error", reject)
        server.listen(0, host, () => {
          if (!server) {
            reject(new Error("Server not initialized"))
            return
          }
          const address = server.address()
          if (address && typeof address === "object") {
            resolve(address.port)
          } else {
            reject(new Error("Failed to get server port"))
          }
        })
      })
    }

    it("sends POST with form body when method=POST", async () => {
      let captured: CapturedRequest | undefined
      serverPort = await createCapturingServer("127.0.0.1", 200, r => {
        captured = r
      })
      const redirect = buildRedirect({ logger: buildNoOpLogger() })

      const body = "code=abc123&state=xyz&session_state=def"
      const result = await redirect(`http://127.0.0.1:${serverPort}/`, {
        method: "POST",
        body,
        contentType: "application/x-www-form-urlencoded"
      })

      expect(result.type).toBe("success")
      expect(captured?.method).toBe("POST")
      expect(captured?.contentType).toBe("application/x-www-form-urlencoded")
      expect(captured?.body).toBe(body)
    })

    it("defaults Content-Type to application/x-www-form-urlencoded if omitted", async () => {
      let captured: CapturedRequest | undefined
      serverPort = await createCapturingServer("127.0.0.1", 200, r => {
        captured = r
      })
      const redirect = buildRedirect({ logger: buildNoOpLogger() })

      await redirect(`http://127.0.0.1:${serverPort}/`, {
        method: "POST",
        body: "code=abc"
      })

      expect(captured?.contentType).toBe("application/x-www-form-urlencoded")
    })

    it("uses GET when no options are provided (back-compat)", async () => {
      let captured: CapturedRequest | undefined
      serverPort = await createCapturingServer("127.0.0.1", 200, r => {
        captured = r
      })
      const redirect = buildRedirect({ logger: buildNoOpLogger() })

      await redirect(`http://127.0.0.1:${serverPort}/?code=abc`)

      expect(captured?.method).toBe("GET")
      expect(captured?.body).toBe("")
    })

    it("does not send a body when method=GET", async () => {
      let captured: CapturedRequest | undefined
      serverPort = await createCapturingServer("127.0.0.1", 200, r => {
        captured = r
      })
      const redirect = buildRedirect({ logger: buildNoOpLogger() })

      await redirect(`http://127.0.0.1:${serverPort}/?code=abc`, {
        method: "GET",
        body: "should-be-ignored"
      })

      expect(captured?.method).toBe("GET")
      expect(captured?.body).toBe("")
    })

    it("switches to GET on loopback redirect (does not replay POST body)", async () => {
      // First server: receives initial POST and 302-redirects to a second server.
      // Second server: must receive a GET with no body.
      let secondRequest: CapturedRequest | undefined
      const secondServer = await new Promise<{
        port: number
        close: () => void
      }>((resolve, reject) => {
        const s = http.createServer((req, res) => {
          const chunks: Buffer[] = []
          req.on("data", (c: Buffer) => chunks.push(c))
          req.on("end", () => {
            secondRequest = {
              method: req.method,
              contentType: req.headers["content-type"],
              body: Buffer.concat(chunks).toString("utf8")
            }
            res.statusCode = 200
            res.end("done")
          })
        })
        s.on("error", reject)
        s.listen(0, "127.0.0.1", () => {
          const address = s.address()
          if (address && typeof address === "object") {
            resolve({ port: address.port, close: () => s.close() })
          } else {
            reject(new Error("Failed to get port"))
          }
        })
      })

      let firstRequest: CapturedRequest | undefined
      try {
        serverPort = await createCapturingServer(
          "127.0.0.1",
          302,
          r => {
            firstRequest = r
          },
          { location: `http://127.0.0.1:${secondServer.port}/next` }
        )
        const redirect = buildRedirect({ logger: buildNoOpLogger() })

        const result = await redirect(`http://127.0.0.1:${serverPort}/`, {
          method: "POST",
          body: "code=abc",
          contentType: "application/x-www-form-urlencoded"
        })

        expect(result.type).toBe("success")
        expect(firstRequest?.method).toBe("POST")
        expect(firstRequest?.body).toBe("code=abc")
        // After loopback 302 we should be using GET with no body.
        expect(secondRequest?.method).toBe("GET")
        expect(secondRequest?.body).toBe("")
      } finally {
        secondServer.close()
      }
    })

    it("returns 'redirect' for non-loopback 302 (POST body not replayed externally)", async () => {
      const externalUrl = "https://example.com/success"
      let captured: CapturedRequest | undefined
      serverPort = await createCapturingServer(
        "127.0.0.1",
        302,
        r => {
          captured = r
        },
        { location: externalUrl }
      )
      const redirect = buildRedirect({ logger: buildNoOpLogger() })

      const result = await redirect(`http://127.0.0.1:${serverPort}/`, {
        method: "POST",
        body: "code=abc",
        contentType: "application/x-www-form-urlencoded"
      })

      expect(result.type).toBe("redirect")
      if (result.type === "redirect") {
        expect(result.location).toBe(externalUrl)
      }
      expect(captured?.method).toBe("POST")
      expect(captured?.body).toBe("code=abc")
    })

    it("propagates the POST 400 status as an error (regression: form_post mishandling)", async () => {
      serverPort = await createCapturingServer("127.0.0.1", 400, () => {})
      const redirect = buildRedirect({ logger: buildNoOpLogger() })

      const result = await redirect(`http://127.0.0.1:${serverPort}/`, {
        method: "POST",
        body: "code=abc",
        contentType: "application/x-www-form-urlencoded"
      })

      expect(result.type).toBe("error")
      if (result.type === "error") {
        expect(result.message).toMatch(/unexpected status.*400/i)
      }
    })

    it("sets Content-Length matching the body byte length", async () => {
      let receivedContentLength: string | undefined
      await new Promise<void>((resolve, reject) => {
        server = http.createServer((req, res) => {
          receivedContentLength = req.headers["content-length"]
          // Drain the body so the request finishes
          req.on("data", () => {})
          req.on("end", () => {
            res.statusCode = 200
            res.end()
          })
        })
        server.on("error", reject)
        server.listen(0, "127.0.0.1", () => {
          if (!server) {
            reject(new Error("Server not initialized"))
            return
          }
          const address = server.address()
          if (address && typeof address === "object") {
            serverPort = address.port
            resolve()
          } else {
            reject(new Error("Failed to get server port"))
          }
        })
      })

      const body = "code=héllo"
      const redirect = buildRedirect({ logger: buildNoOpLogger() })
      const result = await redirect(`http://127.0.0.1:${serverPort}/`, {
        method: "POST",
        body
      })

      expect(result.type).toBe("success")
      expect(receivedContentLength).toBe(
        String(Buffer.byteLength(body, "utf8"))
      )
    })
  })
})
