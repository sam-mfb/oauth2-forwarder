const path = require("path")
const webpack = require("webpack")

module.exports = {
  entry: {
    "o2f-server": "./src/server/index.ts",
    "o2f-client": "./src/client/index.ts"
  },
  mode: "production",
  target: "node",
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: "ts-loader",
          options: {
            configFile: "tsconfig.prod.json"
          }
        }
      }
    ]
  },
  plugins: [
    // Webpack would otherwise replace `import.meta.url` with the absolute
    // file URL of the module on the build machine, which leaks the builder's
    // local path into the published bundle. Leaving it undefined lets
    // dependencies (e.g. `open`) detect that they are bundled and fall back
    // to their documented bundled behaviour.
    new webpack.DefinePlugin({
      "import.meta.url": "undefined"
    })
  ],
  resolve: {
    extensions: [".tsx", ".ts", ".js"]
  },
  output: {
    filename: "[name].js",
    path: path.resolve(__dirname, "dist"),
    library: {
      name: "oauth-forwarder",
      type: "umd"
    },
    globalObject: "this"
  }
}
