import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["{src,example}/**/*.e2e.ts?(x)"],
    environment: "node",
    globals: true,
    // Force exit after tests complete - e2e tests have HTTP servers
    // that may have keep-alive connections that take time to close
    teardownTimeout: 1000
  }
})
