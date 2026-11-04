/**
 * A readable message for a thrown value. JSON.stringify on an Error gives
 * "{}" because its message is not an enumerable property, so use the
 * message for Errors and a string form for anything else.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === "string") {
    return error
  }
  const serialized = JSON.stringify(error)
  return serialized === undefined ? String(error) : serialized
}
