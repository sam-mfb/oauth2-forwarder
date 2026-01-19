import { extractPort, isLoopbackUrl, convertLoopbackUrl } from "../extractPort"
import { Result } from "../result"

describe("extractPort", () => {
  it("should extract the port number from a localhost URL with port", () => {
    const uri = "http://localhost:3000"
    const result = extractPort(uri)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value).toBe(3000)
    }
  })

  it("should return undefined for a localhost URL without port", () => {
    const uri = "http://localhost"
    const result = extractPort(uri)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value).toBeUndefined()
    }
  })

  it("should fail for a non-localhost URL", () => {
    const uri = "http://example.com:3000"
    const result = extractPort(uri)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toMatch(/invalid.*url/i)
    }
  })

  it("should fail for a localhost URL with an invalid port number", () => {
    const uri = "http://localhost:99999"
    const result = extractPort(uri)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toMatch(/not a valid port/i)
      expect(result.error.message).toContain("99999")
    }
  })

  it("should fail for a localhost URL with a negative port number", () => {
    const uri = "http://localhost:-1"
    const result = extractPort(uri)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toMatch(/invalid.*url/i)
    }
  })

  it("should fail for a localhost URL with a non-numeric port", () => {
    const uri = "http://localhost:abc"
    const result = extractPort(uri)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toMatch(/invalid.*url/i)
    }
  })

  it("should fail for URLs with incorrect protocol", () => {
    const uri = "https://localhost:3000"
    const result = extractPort(uri)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toMatch(/invalid.*url/i)
    }
  })

  it("should fail for non-URL strings", () => {
    const uri = "not a url"
    const result = extractPort(uri)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toMatch(/invalid.*url/i)
    }
  })

  it("should handle boundary value 0 for port", () => {
    const uri = "http://localhost:0"
    const result = extractPort(uri)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value).toBe(0)
    }
  })

  it("should handle boundary value 65535 for port", () => {
    const uri = "http://localhost:65535"
    const result = extractPort(uri)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value).toBe(65535)
    }
  })

  // Path support tests
  it("should extract port from URL with simple path", () => {
    const uri = "http://localhost:35171/callback"
    const result = extractPort(uri)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value).toBe(35171)
    }
  })

  it("should extract port from URL with nested path", () => {
    const uri = "http://localhost:8080/oauth/callback"
    const result = extractPort(uri)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value).toBe(8080)
    }
  })

  it("should return undefined for localhost URL with path but no port", () => {
    const uri = "http://localhost/callback"
    const result = extractPort(uri)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value).toBeUndefined()
    }
  })

  it("should extract port from URL with trailing slash only", () => {
    const uri = "http://localhost:3000/"
    const result = extractPort(uri)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value).toBe(3000)
    }
  })

  // OAuth callback parameter tests
  it("should extract port from URL with code parameter", () => {
    const uri = "http://localhost:35171/callback?code=abc123xyz"
    const result = extractPort(uri)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value).toBe(35171)
    }
  })

  it("should extract port from URL with code and state parameters", () => {
    const uri =
      "http://localhost:35171/callback?code=auth_code&state=state_value"
    const result = extractPort(uri)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value).toBe(35171)
    }
  })

  it("should extract port from URL with error parameters", () => {
    const uri =
      "http://localhost:35171/callback?error=access_denied&error_description=User%20denied%20access"
    const result = extractPort(uri)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value).toBe(35171)
    }
  })

  it("should extract port from URL with fragment", () => {
    const uri = "http://localhost:3000/callback#access_token=xyz"
    const result = extractPort(uri)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value).toBe(3000)
    }
  })

  // Security tests - ensure invalid URLs still fail
  it("should still fail for non-localhost URLs with paths", () => {
    const uri = "http://example.com:3000/callback"
    const result = extractPort(uri)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toMatch(/invalid.*url/i)
    }
  })

  it("should still fail for https localhost URLs with paths", () => {
    const uri = "https://localhost:3000/callback"
    const result = extractPort(uri)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toMatch(/invalid.*url/i)
    }
  })

  // IPv4 loopback (127.0.0.1) tests
  describe("IPv4 loopback (127.0.0.1)", () => {
    it("should extract port from 127.0.0.1 URL", () => {
      const uri = "http://127.0.0.1:3000"
      const result = extractPort(uri)

      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) {
        expect(result.value).toBe(3000)
      }
    })

    it("should return undefined for 127.0.0.1 URL without port", () => {
      const uri = "http://127.0.0.1"
      const result = extractPort(uri)

      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) {
        expect(result.value).toBeUndefined()
      }
    })

    it("should extract port from 127.0.0.1 URL with path", () => {
      const uri = "http://127.0.0.1:8080/callback"
      const result = extractPort(uri)

      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) {
        expect(result.value).toBe(8080)
      }
    })

    it("should extract port from 127.0.0.1 URL with query params", () => {
      const uri = "http://127.0.0.1:35171/callback?code=abc123&state=xyz"
      const result = extractPort(uri)

      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) {
        expect(result.value).toBe(35171)
      }
    })
  })

  // IPv6 loopback ([::1]) tests
  describe("IPv6 loopback ([::1])", () => {
    it("should extract port from [::1] URL", () => {
      const uri = "http://[::1]:3000"
      const result = extractPort(uri)

      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) {
        expect(result.value).toBe(3000)
      }
    })

    it("should return undefined for [::1] URL without port", () => {
      const uri = "http://[::1]"
      const result = extractPort(uri)

      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) {
        expect(result.value).toBeUndefined()
      }
    })

    it("should extract port from [::1] URL with path", () => {
      const uri = "http://[::1]:8080/callback"
      const result = extractPort(uri)

      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) {
        expect(result.value).toBe(8080)
      }
    })

    it("should extract port from [::1] URL with query params", () => {
      const uri = "http://[::1]:35171/callback?code=abc123&state=xyz"
      const result = extractPort(uri)

      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) {
        expect(result.value).toBe(35171)
      }
    })

    it("should fail for IPv6 without brackets", () => {
      const uri = "http://::1:3000"
      const result = extractPort(uri)

      expect(Result.isFailure(result)).toBe(true)
    })
  })
})

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
