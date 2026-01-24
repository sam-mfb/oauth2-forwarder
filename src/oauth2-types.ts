/**
 * Base parameters for an Oauth2 auth code url request (excluding PKCE)
 * as described here:
 * https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow#request-an-authorization-code
 */
type Oauth2AuthCodeRequestBaseParams = {
  client_id: string
  response_type: string
  redirect_uri: string
  scope: string
  response_mode?: "query" | "fragment" | "form_post"
  state?: string
  prompt?: "login" | "none" | "consent" | "select_account"
  login_hint?: string
  domain_hint?: string
}

/**
 * PKCE parameters - when using PKCE, both code_challenge and code_challenge_method
 * must be present together
 */
type Oauth2PKCEParams = {
  code_challenge: string
  code_challenge_method: "S256" | "plain"
}

/**
 * No PKCE parameters - when not using PKCE, neither param should be present
 */
type Oauth2NoPKCEParams = {
  code_challenge?: never
  code_challenge_method?: never
}

/**
 * Standard params using discriminated union for PKCE - ensures either both
 * PKCE params are present or neither is (making impossible states impossible)
 */
export type Oauth2AuthCodeRequestStandardParams =
  Oauth2AuthCodeRequestBaseParams & (Oauth2PKCEParams | Oauth2NoPKCEParams)

/**
 * Optional params that are seen in msal-node generated requests, even though not
 * formally documented by Microsoft
 */
export type Oauth2AuthCodeRequestNonStandardParams = {
  "x-client-SKU"?: string // Client software development kit information
  "x-client-VER"?: string // Version of the client software
  "x-client-OS"?: string // Operating system of the client
  "x-client-CPU"?: string // CPU architecture of the client
  "client_info"?: string // Optional flag to request additional client information
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
