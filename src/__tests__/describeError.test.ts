import { describeError } from "../describeError"

describe("describeError", () => {
  it("uses an Error's message (JSON.stringify would give '{}')", () => {
    const error = new Error("listen EADDRINUSE: address already in use")
    expect(JSON.stringify(error)).toBe("{}")
    expect(describeError(error)).toBe(
      "listen EADDRINUSE: address already in use"
    )
  })

  it("returns a string unchanged", () => {
    expect(describeError("plain failure")).toBe("plain failure")
  })

  it("serializes other values as JSON", () => {
    expect(describeError({ code: 7 })).toBe('{"code":7}')
  })

  it("falls back to String() for values JSON can't serialize", () => {
    expect(describeError(undefined)).toBe("undefined")
  })
})
