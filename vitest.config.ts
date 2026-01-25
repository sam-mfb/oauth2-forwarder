import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["{src,example}/**/*.{spec,test}.ts?(x)"],
    environment: "node",
    globals: true
  }
})
