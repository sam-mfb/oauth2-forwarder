import { Oauth2AuthCodeRequestParams } from "./oauth2-types"
import { Result } from "./result"

export function parseOauth2Url(
  url: string | undefined
): Result<Oauth2AuthCodeRequestParams> {
  if (!url) {
    return Result.failure(new Error("Url parameter was undefined"))
  }
  const requiredParams = ["client_id", "response_type", "redirect_uri", "scope"]

  let urlObj: URL
  try {
    urlObj = new URL(url)
  } catch (error) {
    return Result.failure(new Error(`Invalid URL: ${url} (${error})`))
  }
  const params = Object.fromEntries(urlObj.searchParams.entries())

  // Validate required parameters
  for (const param of requiredParams) {
    if (!params[param]) {
      return Result.failure(new Error(`Missing required parameter: ${param}`))
    }
  }

  // Validate PKCE params: both must be present together or neither
  const hasCodeChallenge = Boolean(params.code_challenge)
  const hasCodeChallengeMethod = Boolean(params.code_challenge_method)
  if (hasCodeChallenge !== hasCodeChallengeMethod) {
    return Result.failure(
      new Error(
        "PKCE parameters must be used together: both code_challenge and code_challenge_method are required, or neither"
      )
    )
  }

  // Validate enums
  if (
    params.code_challenge_method &&
    !["S256", "plain"].includes(params.code_challenge_method)
  ) {
    return Result.failure(
      new Error(
        `${params.code_challenge_method} is not valid for "code_challenge_method" property`
      )
    )
  }

  if (
    params.response_mode &&
    !["query", "fragment", "form_post"].includes(params.response_mode)
  ) {
    return Result.failure(
      new Error(
        `${params.response_mode} is not valid for "response_mode" property`
      )
    )
  }

  if (
    params.prompt &&
    !["login", "none", "consent", "select_account"].includes(params.prompt)
  ) {
    return Result.failure(
      new Error(`${params.prompt} is not valid for "prompt" property`)
    )
  }

  // Build the final params with proper PKCE typing
  // Required params are validated above, so we can safely assert their types
  const parsedParams: Oauth2AuthCodeRequestParams = hasCodeChallenge
    ? {
        "client_id": params.client_id as string,
        "response_type": params.response_type as string,
        "redirect_uri": params.redirect_uri as string,
        "scope": params.scope as string,
        "response_mode": params.response_mode as
          | "query"
          | "fragment"
          | "form_post"
          | undefined,
        "state": params.state,
        "prompt": params.prompt as
          | "login"
          | "none"
          | "consent"
          | "select_account"
          | undefined,
        "login_hint": params.login_hint,
        "domain_hint": params.domain_hint,
        "x-client-SKU": params["x-client-SKU"],
        "x-client-VER": params["x-client-VER"],
        "x-client-OS": params["x-client-OS"],
        "x-client-CPU": params["x-client-CPU"],
        "client_info": params.client_info,
        "code_challenge": params.code_challenge as string,
        "code_challenge_method": params.code_challenge_method as
          | "S256"
          | "plain"
      }
    : {
        "client_id": params.client_id as string,
        "response_type": params.response_type as string,
        "redirect_uri": params.redirect_uri as string,
        "scope": params.scope as string,
        "response_mode": params.response_mode as
          | "query"
          | "fragment"
          | "form_post"
          | undefined,
        "state": params.state,
        "prompt": params.prompt as
          | "login"
          | "none"
          | "consent"
          | "select_account"
          | undefined,
        "login_hint": params.login_hint,
        "domain_hint": params.domain_hint,
        "x-client-SKU": params["x-client-SKU"],
        "x-client-VER": params["x-client-VER"],
        "x-client-OS": params["x-client-OS"],
        "x-client-CPU": params["x-client-CPU"],
        "client_info": params.client_info
      }

  return Result.success(parsedParams)
}
