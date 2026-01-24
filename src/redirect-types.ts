export type RedirectResult =
  | { type: "redirect"; location: string }
  | { type: "success"; body?: string }
  | { type: "error"; message: string }

export type CompletionReport = {
  requestId: string
  result: RedirectResult
}
