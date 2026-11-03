# Releasing

Releases go to two places:

- **npm**, published by the `Publish to NPM` workflow (`.github/workflows/npm-publish.yml`) when a GitHub release is published.
- **GitHub releases**, which carry `oauth2-forwarder.zip`. The README's install instructions and Dockerfile example download this file, so every release must include it.

## Steps

1. **Bump the version.** On a branch, run `npm version <x.y.z> --no-git-tag-version`. Commit `package.json` and `package-lock.json`, open a PR, and merge it once CI is green.

2. **Create the GitHub release.** Tag `v<x.y.z>` on the merge commit from step 1, titled `<x.y.z>`, with a short changelog. Publish it as a full release, not a pre-release: the npm workflow only runs on published releases.

3. **Build the zip from the release tag.**

   ```sh
   git checkout v<x.y.z>
   npm ci
   npm run build
   npm run zip-release
   ```

   This creates `dist/oauth2-forwarder.zip`, which contains `o2f/o2f-server.js`, `o2f/o2f-client.js` and `o2f/browser.sh`.

4. **Attach the zip to the release.**

   ```sh
   gh release upload v<x.y.z> dist/oauth2-forwarder.zip
   ```

5. **Verify.**
   - The `Publish to NPM` workflow run succeeded.
   - `npm view oauth2-forwarder version` shows the new version.
   - `https://github.com/sam-mfb/oauth2-forwarder/releases/download/v<x.y.z>/oauth2-forwarder.zip` downloads.
