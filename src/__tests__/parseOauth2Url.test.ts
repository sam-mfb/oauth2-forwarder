import { parseOauth2Url } from "../parseOauth2Url"
import { Result } from "../result"

describe("parseOauth2Url", () => {
  it("properly parses a valid url with all required parameters", () => {
    const sampleValidUrl =
      "https://login.microsoftonline.com/f6e8a999-5111-487e-a999-555557d56ac6/oauth2/v2.0/authorize?client_id=d68b9777-83ks-4efe-h47x-a0c8b92c5f5c&scope=499b84ac-1321-427f-aa17-267ca6975798%2Fuser_impersonation%20openid%20profile%20offline_access&redirect_uri=http%3A%2F%2Flocalhost%3A38915&client-request-id=c2eabe61-f890-4463-b322-1af5d42783b3&response_mode=query&response_type=code&x-client-SKU=msal.js.node&x-client-VER=2.10.0&x-client-OS=linux&x-client-CPU=arm64&client_info=1&code_challenge=5i8EjAJjrgQ2-3QqQpmxERhTTmKzcCfNG59mrGgPiyE&code_challenge_method=S256"

    const parseResult = parseOauth2Url(sampleValidUrl)

    expect(Result.isSuccess(parseResult)).toBe(true)
    if (Result.isSuccess(parseResult)) {
      expect(parseResult.value.client_id).toEqual(
        "d68b9777-83ks-4efe-h47x-a0c8b92c5f5c"
      )
      expect(parseResult.value.redirect_uri).toEqual("http://localhost:38915")
      expect(parseResult.value.scope).toContain("user_impersonation")
      expect(parseResult.value.code_challenge).toEqual(
        "5i8EjAJjrgQ2-3QqQpmxERhTTmKzcCfNG59mrGgPiyE"
      )
      expect(parseResult.value.code_challenge_method).toEqual("S256")
      expect(parseResult.value.response_type).toEqual("code")
      expect(parseResult.value.response_mode).toEqual("query")
    }
  })

  it("parses optional parameters when present", () => {
    const urlWithOptionalParams =
      "https://login.example.com/oauth?client_id=test&scope=openid&redirect_uri=http://localhost:3000&response_type=code&code_challenge=abc&code_challenge_method=S256&state=mystate&prompt=login&login_hint=user@example.com"

    const parseResult = parseOauth2Url(urlWithOptionalParams)

    expect(Result.isSuccess(parseResult)).toBe(true)
    if (Result.isSuccess(parseResult)) {
      expect(parseResult.value.state).toEqual("mystate")
      expect(parseResult.value.prompt).toEqual("login")
      expect(parseResult.value.login_hint).toEqual("user@example.com")
    }
  })

  it("returns undefined for optional parameters when not present", () => {
    const minimalUrl =
      "https://login.example.com/oauth?client_id=test&scope=openid&redirect_uri=http://localhost:3000&response_type=code&code_challenge=abc&code_challenge_method=S256"

    const parseResult = parseOauth2Url(minimalUrl)

    expect(Result.isSuccess(parseResult)).toBe(true)
    if (Result.isSuccess(parseResult)) {
      expect(parseResult.value.state).toBeUndefined()
      expect(parseResult.value.prompt).toBeUndefined()
      expect(parseResult.value.login_hint).toBeUndefined()
      expect(parseResult.value.response_mode).toBeUndefined()
    }
  })

  it("fails on undefined URL input", () => {
    const parseResult = parseOauth2Url(undefined)

    expect(Result.isFailure(parseResult)).toBe(true)
    if (Result.isFailure(parseResult)) {
      expect(parseResult.error.message).toContain("undefined")
    }
  })

  it("fails on a url missing client_id", () => {
    const sampleUrlMissingClientId =
      "https://login.microsoftonline.com/f6e8a999-5111-487e-a999-555557d56ac6/oauth2/v2.0/authorize?scope=openid&redirect_uri=http%3A%2F%2Flocalhost%3A38915&response_type=code&code_challenge=abc&code_challenge_method=S256"

    const parseResult = parseOauth2Url(sampleUrlMissingClientId)

    expect(Result.isFailure(parseResult)).toBe(true)
    if (Result.isFailure(parseResult)) {
      expect(parseResult.error.message).toContain("client_id")
    }
  })

  it("fails on a url missing redirect_uri", () => {
    const url =
      "https://login.example.com/oauth?client_id=test&scope=openid&response_type=code&code_challenge=abc&code_challenge_method=S256"

    const parseResult = parseOauth2Url(url)

    expect(Result.isFailure(parseResult)).toBe(true)
    if (Result.isFailure(parseResult)) {
      expect(parseResult.error.message).toContain("redirect_uri")
    }
  })

  it("fails on a url missing code_challenge", () => {
    const url =
      "https://login.example.com/oauth?client_id=test&scope=openid&redirect_uri=http://localhost:3000&response_type=code&code_challenge_method=S256"

    const parseResult = parseOauth2Url(url)

    expect(Result.isFailure(parseResult)).toBe(true)
    if (Result.isFailure(parseResult)) {
      expect(parseResult.error.message).toContain("code_challenge")
    }
  })

  it("fails on invalid response_mode value", () => {
    const sampleInvalidUrl =
      "https://login.microsoftonline.com/f6e8a999-5111-487e-a999-555557d56ac6/oauth2/v2.0/authorize?client_id=d68b9777-83ks-4efe-h47x-a0c8b92c5f5c&scope=openid&redirect_uri=http%3A%2F%2Flocalhost%3A38915&response_mode=BAD&response_type=code&code_challenge=abc&code_challenge_method=S256"

    const parseResult = parseOauth2Url(sampleInvalidUrl)

    expect(Result.isFailure(parseResult)).toBe(true)
    if (Result.isFailure(parseResult)) {
      expect(parseResult.error.message).toContain("response_mode")
      expect(parseResult.error.message).toContain("BAD")
    }
  })

  it("fails on invalid code_challenge_method value", () => {
    const url =
      "https://login.example.com/oauth?client_id=test&scope=openid&redirect_uri=http://localhost:3000&response_type=code&code_challenge=abc&code_challenge_method=INVALID"

    const parseResult = parseOauth2Url(url)

    expect(Result.isFailure(parseResult)).toBe(true)
    if (Result.isFailure(parseResult)) {
      expect(parseResult.error.message).toContain("code_challenge_method")
      expect(parseResult.error.message).toContain("INVALID")
    }
  })

  it("fails on invalid prompt value", () => {
    const url =
      "https://login.example.com/oauth?client_id=test&scope=openid&redirect_uri=http://localhost:3000&response_type=code&code_challenge=abc&code_challenge_method=S256&prompt=invalid_prompt"

    const parseResult = parseOauth2Url(url)

    expect(Result.isFailure(parseResult)).toBe(true)
    if (Result.isFailure(parseResult)) {
      expect(parseResult.error.message).toContain("prompt")
      expect(parseResult.error.message).toContain("invalid_prompt")
    }
  })

  it("accepts valid code_challenge_method values", () => {
    const baseUrl =
      "https://login.example.com/oauth?client_id=test&scope=openid&redirect_uri=http://localhost:3000&response_type=code&code_challenge=abc"

    const s256Result = parseOauth2Url(baseUrl + "&code_challenge_method=S256")
    const plainResult = parseOauth2Url(baseUrl + "&code_challenge_method=plain")

    expect(Result.isSuccess(s256Result)).toBe(true)
    expect(Result.isSuccess(plainResult)).toBe(true)
  })

  it("accepts all valid prompt values", () => {
    const baseUrl =
      "https://login.example.com/oauth?client_id=test&scope=openid&redirect_uri=http://localhost:3000&response_type=code&code_challenge=abc&code_challenge_method=S256&prompt="

    const validPrompts = ["login", "none", "consent", "select_account"]

    for (const prompt of validPrompts) {
      const result = parseOauth2Url(baseUrl + prompt)
      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) {
        expect(result.value.prompt).toEqual(prompt)
      }
    }
  })
})
