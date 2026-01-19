import { isLoopbackUrl, convertLoopbackUrl } from "../loopback"

describe("isLoopbackUrl", () => {
  it("should return true for localhost URLs", () => {
    expect(isLoopbackUrl("http://localhost:3000")).toBe(true)
    expect(isLoopbackUrl("http://localhost")).toBe(true)
    expect(isLoopbackUrl("http://localhost/callback")).toBe(true)
  })

  it("should return true for 127.0.0.1 URLs", () => {
    expect(isLoopbackUrl("http://127.0.0.1:3000")).toBe(true)
    expect(isLoopbackUrl("http://127.0.0.1")).toBe(true)
    expect(isLoopbackUrl("http://127.0.0.1/callback")).toBe(true)
  })

  it("should return true for [::1] URLs", () => {
    expect(isLoopbackUrl("http://[::1]:3000")).toBe(true)
    expect(isLoopbackUrl("http://[::1]")).toBe(true)
    expect(isLoopbackUrl("http://[::1]/callback")).toBe(true)
  })

  it("should return false for non-loopback URLs", () => {
    expect(isLoopbackUrl("http://example.com:3000")).toBe(false)
    expect(isLoopbackUrl("https://localhost:3000")).toBe(false)
    expect(isLoopbackUrl("http://192.168.1.1:3000")).toBe(false)
  })
})

describe("convertLoopbackUrl", () => {
  describe("converting to IPv4 (127.0.0.1)", () => {
    it("should convert localhost to 127.0.0.1", () => {
      expect(
        convertLoopbackUrl("http://localhost:3000/callback", "127.0.0.1")
      ).toBe("http://127.0.0.1:3000/callback")
    })

    it("should keep 127.0.0.1 as is", () => {
      expect(
        convertLoopbackUrl("http://127.0.0.1:3000/callback", "127.0.0.1")
      ).toBe("http://127.0.0.1:3000/callback")
    })

    it("should convert [::1] to 127.0.0.1", () => {
      expect(
        convertLoopbackUrl("http://[::1]:3000/callback", "127.0.0.1")
      ).toBe("http://127.0.0.1:3000/callback")
    })

    it("should handle URLs without port", () => {
      expect(convertLoopbackUrl("http://localhost/callback", "127.0.0.1")).toBe(
        "http://127.0.0.1/callback"
      )
    })
  })

  describe("converting to IPv6 ([::1])", () => {
    it("should convert localhost to [::1]", () => {
      expect(
        convertLoopbackUrl("http://localhost:3000/callback", "[::1]")
      ).toBe("http://[::1]:3000/callback")
    })

    it("should convert 127.0.0.1 to [::1]", () => {
      expect(
        convertLoopbackUrl("http://127.0.0.1:3000/callback", "[::1]")
      ).toBe("http://[::1]:3000/callback")
    })

    it("should keep [::1] as is", () => {
      expect(convertLoopbackUrl("http://[::1]:3000/callback", "[::1]")).toBe(
        "http://[::1]:3000/callback"
      )
    })

    it("should handle URLs without port", () => {
      expect(convertLoopbackUrl("http://localhost/callback", "[::1]")).toBe(
        "http://[::1]/callback"
      )
    })
  })
})
