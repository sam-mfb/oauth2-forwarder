module.exports = {
  testMatch: ["<rootDir>/(src|example)/**/*.(e2e).ts?(x)"],
  preset: "ts-jest",
  testEnvironment: "node",
  // Force exit after tests complete - e2e tests have HTTP servers
  // that may have keep-alive connections that take time to close
  forceExit: true
}
