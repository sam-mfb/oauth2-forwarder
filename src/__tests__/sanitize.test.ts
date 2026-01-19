import { sanitize } from "../sanitize"

describe(sanitize.name, () => {
  it("replaces code value with asterisks", () => {
    const input = "code=secret"
    const result = sanitize(input)
    expect(result).toMatch(/^code=\*+$/)
    expect(result).not.toContain("secret")
  })

  it("replaces code_challenge value with asterisks", () => {
    const input = "code_challenge=secret"
    const result = sanitize(input)
    expect(result).toMatch(/^code_challenge=\*+$/)
    expect(result).not.toContain("secret")
  })

  it("handles case-insensitive matching", () => {
    const upperCode = sanitize("CODE=secret")
    const mixedCode = sanitize("Code=secret")
    const upperChallenge = sanitize("CODE_CHALLENGE=secret")

    expect(upperCode).not.toContain("secret")
    expect(mixedCode).not.toContain("secret")
    expect(upperChallenge).not.toContain("secret")
  })

  it("returns empty string for empty input", () => {
    expect(sanitize("")).toEqual("")
  })

  it("handles multiple occurrences of code=", () => {
    const input = "code=first&other=value&code=second"
    const result = sanitize(input)
    expect(result).not.toContain("first")
    expect(result).not.toContain("second")
    expect(result).toContain("other=value")
    expect((result.match(/\*+/g) || []).length).toBe(2)
  })

  it("handles code= with empty value", () => {
    const input = "code=&other=value"
    const result = sanitize(input)
    expect(result).toMatch(/code=\*+&other=value/)
  })

  it("preserves non-sensitive parameters", () => {
    const input = "client_id=abc123&scope=openid&state=xyz"
    const result = sanitize(input)
    expect(result).toEqual(input)
  })

  it("sanitizes parameters that contain 'code' anywhere in their name", () => {
    // Note: The implementation matches 'code=' anywhere, not just at word boundaries
    // This means 'mycode=' and 'encode=' will also be sanitized
    const input = "mycode=secret&encode=value&decoded=data"
    const result = sanitize(input)
    expect(result).not.toContain("secret")
    expect(result).not.toContain("value")
    expect(result).toContain("decoded=data") // 'decoded' doesn't contain 'code='
  })

  it("does not sanitize code_challenger (partial match)", () => {
    const input = "code_challenger=value"
    const result = sanitize(input)
    expect(result).toEqual(input)
  })

  it("handles value at end of string without delimiter", () => {
    const input = "param=x&code=endshere"
    const result = sanitize(input)
    expect(result).not.toContain("endshere")
    expect(result).toContain("param=x")
  })

  it("handles special characters in values", () => {
    const input = "code=abc+def%20ghi"
    const result = sanitize(input)
    expect(result).not.toContain("abc")
    expect(result).not.toContain("def")
    expect(result).not.toContain("ghi")
  })

  it("sanitizes code in JSON-like structures", () => {
    const input = '{"url":"/?code=secretvalue&other=x"}'
    const result = sanitize(input)
    expect(result).not.toContain("secretvalue")
    expect(result).toContain("other=x")
  })

  it("sanitizes code_challenge in URL query strings", () => {
    const input =
      "https://example.com/oauth?code_challenge=mysecret&code_challenge_method=S256"
    const result = sanitize(input)
    expect(result).not.toContain("mysecret")
    expect(result).toContain("code_challenge_method=S256")
  })

  it("works on a full text with code", () => {
    const fullText =
      'Ending response with output: "{"url":"/?code=1.ATYAgKHo9pZYfkipmfpfl9VqxnKXi9aLkv5OtXugyLksX1w2AI02AA.AgABBAIAAADW6jl31mB3T7ugrWTT8pFeAwDs_wUA9P9I0Mb83EngkdLiKmflecTxfam_zRfQbuh5_-jt-BH5neMZUdFrLFaALOBzcLRlO15VUBpQYDabGdwat00qNhnBQ4Z6ILMeS45iGAppaq_U6V--xmuUqIsGBpdHgl8YEEv6sF8wcPpgdFQXgAYylTrhvmzfO_-CBZQVMabNZ5BbsP9U44e4S2IExrddhDLrthnLqqQ8t8eWhFZb6zP4LwKa4TohPXcptEwHoQD2dfxn-rvyvMfbW2eaEEMnqA-iWxrzT6rt8tsnurVjZ6nIN7lQUvgb0_X_QjRE9MzX6BAj7z3A3r7mKDX7M8tyJX1D5N7JqFhRFe8pKqPGOnIYOCVoJ50b-K6gjIo1AOABwQZXnLVNr-mgmE8gCMG4pD4g1kuqO0WmKADxd2BkxUA8Fo4Pb-pGnwh3ToRFgdxCtqP3GYuBHkuJn7z-sfYW6s0SSSUt2MfLZ-Y-T4FzmNN5y_GinhgVrbyKC11f0JDG2hpF9jn7Zl-WnT9bH6M0qBk8k_nvkDAVNFHzk4gfsNdkjyLalrHGY50yRAp2IW7iiOmeFc5aLwAYP43dqg_CAFwXM2ug34SLf2zeX717LDW8NmzxlDyglPiuHSkaL9lqvBrLQ0Mq2-Ebh1TPgcoZbHJHo4dE0-Hy6IHZvXy5kZpzAWsYgDhECnaQLwdOpwf9UGvchtoU51wsHP4VknjOKDE77Eq-_rxSQVlDeH7dAqs-mLYiu09cKdMzxxk_PoVGKuOUG10eSUDjlq0Wi9S4Dufi0VHaUewhT8B88_lO5HeNP9aS9X_Khri1IpKBOoqsEkTkQSBtHuhWq9VklZ4fSL51g7x4QaCmSQNvuS_g--buuR9FBU5w09rwNJLcL-goUkKb_KrcvvSTZ3t2hqvrGpQ1H8hRL2_BuXydWoqiLCzUFSVTvz2WidCQMHYk_QwO5-ySR4aqojVqb-48V4Lwq3NAJ6VIQUGldFYl7NOdZzfP8lA6A5rkODrWDhPCJgH5KFB5mQSs3wBx-fE4dAjtHdQj4nv3xP6m6yyO7z0_ikmGQx9Cm4tiRJvWI_Cr1vmF69-V9wVCjzrNnT57yh4jb0mLWLdRur0y5DAcwADBmRpnGVQ-26OCgZLoUIFYsU7GDauk8wCc59q6Ddu8abj4Q7SNrBXWOq0j_4ItuIMlP2qHXEO8wuLqdFn1LqY7f2kD-XD_oz7KFSQrhM_aqPSTNIxz-YIzUh3A1_qY_zVKZdZf&client_info=eyJ1aWQiOiI3YTlmZTFhYi1jNzk0LTQ0ZGMtYjkwMS00ODIyY2UwOTMzZDkiLCJ1dGlkIjoiZjZlOGExODAtNTg5Ni00ODdlLWE5OTktZmE1Zjk3ZDU2YWM2In0&session_state=aeaea7da-68c7-47ff-9c47-cba2e82487d0"}"'

    const result = sanitize(fullText)

    // Should sanitize the code value
    expect(result).not.toContain("1.ATYAgKHo9pZYfkipmfpfl9VqxnKXi9aLkv5OtXugyLks")
    // Should preserve other parameters
    expect(result).toContain("client_info=")
    expect(result).toContain("session_state=")
  })

  it("works on a full text with code_challenge", () => {
    const fullText =
      'Received body: "{"url":"https://login.microsoftonline.com/f6e8a180-5896-487e-a999-fa5f97d56ac6/oauth2/v2.0/authorize?client_id=d68b9772-928b-4efe-b57b-a0c8b92c5f5c&scope=499b84ac-1321-427f-aa17-267ca6975798%2Fuser_impersonation%20openid%20profile%20offline_access&redirect_uri=http%3A%2F%2Flocalhost%3A38199&client-request-id=47737269-e37a-45df-bfec-54e5894df04f&response_mode=query&response_type=code&x-client-SKU=msal.js.node&x-client-VER=2.10.0&x-client-OS=linux&x-client-CPU=arm64&client_info=1&code_challenge=5DZ1rp-TMBEvHlSqa0HixU3dLNVbv8nLMHu732XjQxU&code_challenge_method=S256"}"'

    const result = sanitize(fullText)

    // Should sanitize the code_challenge value
    expect(result).not.toContain("5DZ1rp-TMBEvHlSqa0HixU3dLNVbv8nLMHu732XjQxU")
    // Should preserve code_challenge_method
    expect(result).toContain("code_challenge_method=S256")
    // Should preserve other parameters
    expect(result).toContain("client_id=d68b9772-928b-4efe-b57b-a0c8b92c5f5c")
    expect(result).toContain("response_mode=query")
  })
})
