import { parseOauth2Url } from "../parseOauth2Url"
import { Result } from "../result"

it("properly parses a valid url", () => {
  const sampleValidUrl =
    "https://login.microsoftonline.com/f6e8a999-5111-487e-a999-555557d56ac6/oauth2/v2.0/authorize?client_id=d68b9777-83ks-4efe-h47x-a0c8b92c5f5c&scope=499b84ac-1321-427f-aa17-267ca6975798%2Fuser_impersonation%20openid%20profile%20offline_access&redirect_uri=http%3A%2F%2Flocalhost%3A38915&client-request-id=c2eabe61-f890-4463-b322-1af5d42783b3&response_mode=query&response_type=code&x-client-SKU=msal.js.node&x-client-VER=2.10.0&x-client-OS=linux&x-client-CPU=arm64&client_info=1&code_challenge=5i8EjAJjrgQ2-3QqQpmxERhTTmKzcCfNG59mrGgPiyE&code_challenge_method=S256"

  const parseResult = parseOauth2Url(sampleValidUrl)

  expect(Result.isSuccess(parseResult)).toBeTruthy()
})

it("fails on a url missing required properties", () => {
  const sampleUrlMissingClientId =
    "https://login.microsoftonline.com/f6e8a999-5111-487e-a999-555557d56ac6/oauth2/v2.0/authorize?scope=499b84ac-1321-427f-aa17-267ca6975798%2Fuser_impersonation%20openid%20profile%20offline_access&redirect_uri=http%3A%2F%2Flocalhost%3A38915&client-request-id=c2eabe61-f890-4463-b322-1af5d42783b3&response_mode=query&response_type=code&x-client-SKU=msal.js.node&x-client-VER=2.10.0&x-client-OS=linux&x-client-CPU=arm64&client_info=1&code_challenge=5i8EjAJjrgQ2-3QqQpmxERhTTmKzcCfNG59mrGgPiyE&code_challenge_method=S256"

  const parseResult = parseOauth2Url(sampleUrlMissingClientId)

  expect(Result.isFailure(parseResult)).toBeTruthy()
})

it("fails on a url with invalid values", () => {
  const sampleInvalidUrl =
    "https://login.microsoftonline.com/f6e8a999-5111-487e-a999-555557d56ac6/oauth2/v2.0/authorize?client_id=d68b9777-83ks-4efe-h47x-a0c8b92c5f5c&scope=499b84ac-1321-427f-aa17-267ca6975798%2Fuser_impersonation%20openid%20profile%20offline_access&redirect_uri=http%3A%2F%2Flocalhost%3A38915&client-request-id=c2eabe61-f890-4463-b322-1af5d42783b3&response_mode=BAD&response_type=code&x-client-SKU=msal.js.node&x-client-VER=2.10.0&x-client-OS=linux&x-client-CPU=arm64&client_info=1&code_challenge=5i8EjAJjrgQ2-3QqQpmxERhTTmKzcCfNG59mrGgPiyE&code_challenge_method=S256"

  const parseResult = parseOauth2Url(sampleInvalidUrl)

  expect(Result.isFailure(parseResult)).toBeTruthy()
})
