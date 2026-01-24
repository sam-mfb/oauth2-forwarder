import http from "http"
import { buildRedirect } from "../buildRedirect"

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

  afterEach(done => {
    if (server && server.listening) {
      server.close(() => {
        server = null
        done()
      })
    } else {
      server = null
      done()
    }
  })

  describe("basic functionality", () => {
    it("should return success with 200 response", async () => {
      serverPort = await createServer("127.0.0.1", 200)
      const redirect = buildRedirect({})
      const result = await redirect(`http://127.0.0.1:${serverPort}/callback`)
      expect(result.type).toBe("success")
    })

    it("should return success with body when 200 response has body", async () => {
      const body = "<html>Success!</html>"
      serverPort = await createServer("127.0.0.1", 200, { body })
      const redirect = buildRedirect({})
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
      const redirect = buildRedirect({})
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
      const redirect = buildRedirect({})
      const result = await redirect(`http://127.0.0.1:${serverPort}/callback`)
      expect(result.type).toBe("redirect")
      if (result.type === "redirect") {
        expect(result.location).toBe(externalUrl)
      }
    })

    it("should return error with other status codes", async () => {
      serverPort = await createServer("127.0.0.1", 404)
      const redirect = buildRedirect({})
      const result = await redirect(`http://127.0.0.1:${serverPort}/callback`)
      expect(result.type).toBe("error")
      if (result.type === "error") {
        expect(result.message).toMatch(/unexpected status.*404/i)
      }
    })

    it("should return error for 302 without Location header", async () => {
      serverPort = await createServer("127.0.0.1", 302)
      const redirect = buildRedirect({})
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
      const redirect = buildRedirect({})

      // Should work with localhost (will try IPv4 first)
      const result = await redirect(`http://localhost:${serverPort}/callback`)
      expect(result.type).toBe("success")
    })

    it("should try IPv6 when IPv4 connection is refused", async () => {
      // Create server only on IPv6
      serverPort = await createServer("::1", 200)
      const debugMessages: string[] = []
      const redirect = buildRedirect({
        debugger: msg => debugMessages.push(msg)
      })

      // Should fail on IPv4, then succeed on IPv6
      const result = await redirect(`http://localhost:${serverPort}/callback`)
      expect(result.type).toBe("success")

      // Verify it tried IPv4 first, then IPv6
      expect(debugMessages.some(m => m.includes("Trying IPv4"))).toBe(true)
      expect(debugMessages.some(m => m.includes("trying IPv6"))).toBe(true)
    })

    it("should return error when both IPv4 and IPv6 fail", async () => {
      // No server running - both should fail
      const redirect = buildRedirect({})

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
      const redirect = buildRedirect({})

      const result = await redirect(`http://127.0.0.1:${serverPort}/callback`)
      expect(result.type).toBe("success")
    })

    it("should handle explicit [::1] URLs", async () => {
      serverPort = await createServer("::1", 200)
      const redirect = buildRedirect({})

      const result = await redirect(`http://[::1]:${serverPort}/callback`)
      expect(result.type).toBe("success")
    })
  })

  describe("debug output", () => {
    it("should call debugger with request details", async () => {
      serverPort = await createServer("127.0.0.1", 200)
      const debugMessages: string[] = []
      const redirect = buildRedirect({
        debugger: msg => debugMessages.push(msg)
      })

      await redirect(`http://127.0.0.1:${serverPort}/callback`)

      expect(debugMessages.length).toBeGreaterThan(0)
      expect(debugMessages.some(m => m.includes("GET request"))).toBe(true)
    })
  })
})
