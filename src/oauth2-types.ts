/**
 * Type reflecting the parameters of an Oauth2 auth code url request as
 * described here:
 * https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow#request-an-authorization-code
 */
export type Oauth2AuthCodeRequestStandardParams = {
  client_id: string
  response_type: string
  redirect_uri: string
  scope: string
  response_mode?: "query" | "fragment" | "form_post"
  state?: string
  prompt?: "login" | "none" | "consent" | "select_account"
  login_hint?: string
  domain_hint?: string
  code_challenge: string
  code_challenge_method: "S256" | "plain"
}

/**
 * Optional params that are seen in msal-node generated requests, even though not
 * formally documented by Microsoft
 */
export type Oauth2AuthCodeRequestNonStandardParams = {
  x_client_SKU?: string // Client software development kit information
  x_client_VER?: string // Version of the client software
  x_client_OS?: string // Operating system of the client
  x_client_CPU?: string // CPU architecture of the client
  client_info?: string // Optional flag to request additional client information
}

export type Oauth2AuthCodeRequestParams = Oauth2AuthCodeRequestStandardParams &
  Oauth2AuthCodeRequestNonStandardParams

export type Oauth2AuthCodeRedirectParams =
  | Oauth2AuthCodeRedirectSuccessParams
  | Oauth2AuthCodeRedirectErrorParams

/**
 * Type reflecting the parameters of an Oauth2 auth code successful redirect
 * described here:
 * https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow#successful-response
 */
export type Oauth2AuthCodeRedirectSuccessParams = {
  code: string
  state?: string
}

/**
 * Type reflecting the parameters of an Oauth2 auth code error redirect
 * described here:
 * https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow#error-response
 */
export type Oauth2AuthCodeRedirectErrorParams = {
  error: string
  error_description: string
}
