import { Oauth2AuthCodeRequestParams } from "./oauth2-types"
import { Result } from "./result"

export function parseOauth2Url(
  url: string | undefined
): Result<Oauth2AuthCodeRequestParams> {
  if (!url) {
    return Result.failure(new Error("Url parameter was undefined"))
  }
  const requiredParams = [
    "client_id",
    "response_type",
    "redirect_uri",
    "scope",
    "code_challenge",
    "code_challenge_method"
  ]

  const urlObj = new URL(url)
  const params = Object.fromEntries(urlObj.searchParams.entries())

  // Validate required parameters
  for (const param of requiredParams) {
    if (!params[param]) {
      return Result.failure(new Error(`Missing required parameter: ${param}`))
    }
  }

  // Validate enums
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  if (!["S256", "plain"].includes(params["code_challenge_method"]!)) {
    return Result.failure(
      new Error(
        `${params["code_challenge_method"]} is not valid for "code_challenge_method" property`
      )
    )
  }

  if (
    params["response_mode"] &&
    !["query", "fragment", "form_post"].includes(params["response_mode"])
  ) {
    return Result.failure(
      new Error(
        `${params["response_mode"]} is not valid for "response_mode" property`
      )
    )
  }

  if (
    params["prompt"] &&
    !["login", "none", "consent", "select_account"].includes(params["prompt"])
  ) {
    return Result.failure(
      new Error(`${params["prompt"]} is not valid for "prompt" property`)
    )
  }

  const parsedParams = {
    "client_id": params["client_id"],
    "response_type": params["response_type"],
    "redirect_uri": params["redirect_uri"],
    "scope": params["scope"],
    "code_challenge": params["code_challenge"],
    "code_challenge_method": params["code_challenge_method"],
    "response_mode": params["response_mode"],
    "state": params["state"],
    "prompt": params["prompt"],
    "login_hint": params["login_hint"],
    "domain_hint": params["domain_hint"],
    "x-client-SKU": params["x-client-SKU"],
    "x-client-VER": params["x-client-VER"],
    "x-client-OS": params["x-client-OS"],
    "x-client-CPU": params["x-client-CPU"],
    "client_info": params["client_info"]
  } as Oauth2AuthCodeRequestParams

  return Result.success(parsedParams)
}
