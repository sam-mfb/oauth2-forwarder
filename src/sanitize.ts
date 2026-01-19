export function sanitize(input: string): string {
  const regex = /((code|code_challenge)=)([^"&\n]*)/gi
  return input.replace(regex, (match, p1) => {
    return `${p1}********`
  })
}
