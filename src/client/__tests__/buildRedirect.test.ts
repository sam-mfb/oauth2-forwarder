import http from "http"
import { buildRedirect } from "../buildRedirect"

describe("buildRedirect", () => {
  let server: http.Server | null = null
  let serverPort: number

  const createServer = (
    host: string,
    responseCode: number
  ): Promise<number> => {
    return new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        res.statusCode = responseCode
        res.end()
      })
      server.on("error", reject)
      server.listen(0, host, () => {
        const address = server!.address()
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
    it("should succeed with 200 response", async () => {
      serverPort = await createServer("127.0.0.1", 200)
      const redirect = buildRedirect({})
      await expect(
        redirect(`http://127.0.0.1:${serverPort}/callback`)
      ).resolves.toBeUndefined()
    })

    it("should succeed with 302 response", async () => {
      serverPort = await createServer("127.0.0.1", 302)
      const redirect = buildRedirect({})
      await expect(
        redirect(`http://127.0.0.1:${serverPort}/callback`)
      ).resolves.toBeUndefined()
    })

    it("should fail with other status codes", async () => {
      serverPort = await createServer("127.0.0.1", 404)
      const redirect = buildRedirect({})
      await expect(
        redirect(`http://127.0.0.1:${serverPort}/callback`)
      ).rejects.toThrow(/unexpected status.*404/i)
    })
  })

  describe("IPv4/IPv6 fallback behavior", () => {
    it("should succeed when server listens on IPv4 (127.0.0.1)", async () => {
      serverPort = await createServer("127.0.0.1", 200)
      const redirect = buildRedirect({})

      // Should work with localhost (will try IPv4 first)
      await expect(
        redirect(`http://localhost:${serverPort}/callback`)
      ).resolves.toBeUndefined()
    })

    it("should try IPv6 when IPv4 connection is refused", async () => {
      // Create server only on IPv6
      serverPort = await createServer("::1", 200)
      const debugMessages: string[] = []
      const redirect = buildRedirect({
        debugger: msg => debugMessages.push(msg),
      })

      // Should fail on IPv4, then succeed on IPv6
      await expect(
        redirect(`http://localhost:${serverPort}/callback`)
      ).resolves.toBeUndefined()

      // Verify it tried IPv4 first, then IPv6
      expect(debugMessages.some(m => m.includes("Trying IPv4"))).toBe(true)
      expect(debugMessages.some(m => m.includes("trying IPv6"))).toBe(true)
    })

    it("should provide descriptive error when both IPv4 and IPv6 fail", async () => {
      // No server running - both should fail
      const redirect = buildRedirect({})

      await expect(
        redirect("http://localhost:59999/callback")
      ).rejects.toThrow(/Connection refused on both IPv4 and IPv6/)
    })

    it("should handle explicit 127.0.0.1 URLs", async () => {
      serverPort = await createServer("127.0.0.1", 200)
      const redirect = buildRedirect({})

      await expect(
        redirect(`http://127.0.0.1:${serverPort}/callback`)
      ).resolves.toBeUndefined()
    })

    it("should handle explicit [::1] URLs", async () => {
      serverPort = await createServer("::1", 200)
      const redirect = buildRedirect({})

      await expect(
        redirect(`http://[::1]:${serverPort}/callback`)
      ).resolves.toBeUndefined()
    })
  })

  describe("debug output", () => {
    it("should call debugger with request details", async () => {
      serverPort = await createServer("127.0.0.1", 200)
      const debugMessages: string[] = []
      const redirect = buildRedirect({
        debugger: msg => debugMessages.push(msg),
      })

      await redirect(`http://127.0.0.1:${serverPort}/callback`)

      expect(debugMessages.length).toBeGreaterThan(0)
      expect(debugMessages.some(m => m.includes("GET request"))).toBe(true)
    })
  })
})
