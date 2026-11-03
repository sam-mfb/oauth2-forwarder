// Fails the build if a bundled file contains an absolute path from the build
// machine. Such paths leak the builder's local directory layout into the
// published package and zip.
const fs = require("fs")
const path = require("path")

const distPath = path.join(__dirname, "dist")
const files = ["o2f-server.js", "o2f-client.js"]

// Patterns that indicate a build-machine path made it into the bundle
const forbidden = [
  { name: "repository path", text: __dirname },
  { name: "file:// URL", text: "file://" }
]

let failed = false

for (const file of files) {
  const filePath = path.join(distPath, file)
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`)
    failed = true
    continue
  }
  const content = fs.readFileSync(filePath, "utf8")
  for (const { name, text } of forbidden) {
    const index = content.indexOf(text)
    if (index !== -1) {
      const excerpt = content.slice(Math.max(0, index - 40), index + 80)
      console.error(`${file} contains a ${name}: ...${excerpt}...`)
      failed = true
    }
  }
}

if (failed) {
  console.error("Bundle check failed: build-machine paths found in dist.")
  process.exit(1)
}
console.log("Bundle check passed: no build-machine paths in dist.")
