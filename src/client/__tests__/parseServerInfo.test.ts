import { Result } from "../../result"
import { parseServerInfo } from "../parseServerInfo"

describe(parseServerInfo.name, () => {
  it("returns correct tcp server information for host and port", () => {
    const info = "example.com:3000"
    const result = parseServerInfo(info)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value.host).toEqual("example.com")
      expect(result.value.port).toEqual(3000)
    }
  })

  it("returns failure when port is not numeric", () => {
    const info = "example.com:abc"
    const result = parseServerInfo(info)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toContain("Invalid server info format")
    }
  })

  it("returns failure when port is out of range (above 65535)", () => {
    const info = "example.com:70000"
    const result = parseServerInfo(info)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toMatch(/not a valid port/i)
    }
  })

  it("returns failure when port is missing (no digits after colon)", () => {
    const info = "example.com:"
    const result = parseServerInfo(info)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toContain("Invalid server info format")
    }
  })

  it("returns failure when host is missing", () => {
    const info = ":3000"
    const result = parseServerInfo(info)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toContain("Invalid server info format")
    }
  })

  it("returns failure for input without colon", () => {
    const info = "example.com"
    const result = parseServerInfo(info)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toContain("Invalid server info format")
    }
  })

  it("handles port 0 (ephemeral port)", () => {
    const info = "localhost:0"
    const result = parseServerInfo(info)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value.port).toEqual(0)
    }
  })

  it("handles port 65535 (max valid port)", () => {
    const info = "localhost:65535"
    const result = parseServerInfo(info)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value.port).toEqual(65535)
    }
  })

  it("returns failure for port 65536 (just above max)", () => {
    const info = "localhost:65536"
    const result = parseServerInfo(info)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toMatch(/not a valid port/i)
    }
  })

  it("handles localhost as host", () => {
    const info = "localhost:8080"
    const result = parseServerInfo(info)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value.host).toEqual("localhost")
      expect(result.value.port).toEqual(8080)
    }
  })

  it("handles IP addresses as host", () => {
    const info = "127.0.0.1:3000"
    const result = parseServerInfo(info)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value.host).toEqual("127.0.0.1")
      expect(result.value.port).toEqual(3000)
    }
  })
})
