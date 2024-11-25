import { Result } from "./result"

export function parseOauth2Url(url: string | undefined): Result<any> {
  if (!url) {
    return Result.failure(new Error("Url parameter was undefined"))
  }

  return Result.success({})
}
