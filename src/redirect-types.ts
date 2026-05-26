export type RedirectResult =
  | { type: "redirect"; location: string }
  | { type: "success"; body?: string }
  | { type: "error"; message: string }

export type CompletionReport = {
  requestId: string
  result: RedirectResult
}

/**
 * Options for replaying an OAuth2 callback against the in-container loopback
 * server. When the OAuth provider used response_mode=form_post, the callback
 * arrives as an HTTP POST with form-urlencoded body, and we need to replay it
 * the same way (per RFC 6749 §4.1.2 / OAuth 2.0 Form Post Response Mode).
 */
export type RedirectRequestOptions = {
  method?: "GET" | "POST"
  body?: string
  contentType?: string
}
