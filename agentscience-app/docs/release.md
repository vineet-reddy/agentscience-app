# Release

This doc is for engineers cutting desktop releases, or touching the release pipeline itself. If you are changing anything in here, also read the workflow file directly:

- [release.yml](../../.github/workflows/release.yml)

The big picture: one git tag drives one release. Pushing a tag like `v1.2.3` kicks off a GitHub Actions workflow that runs quality gates, builds desktop installers for macOS, Linux, and Windows in parallel, and publishes one GitHub Release with all the files. Signing is optional and auto-detected per platform from secrets, so the unsigned path always works even if signing is broken.

Versions with a suffix after the numeric part (for example `1.2.3-alpha.1`) are published as GitHub prereleases and do not become the "latest" release. Only plain `X.Y.Z` tags are marked latest.

## What the workflow actually does

When a tag matching `v*.*.*` is pushed, the workflow:

- runs preflight quality gates (lint, typecheck, test) and fails fast if they fail
- builds four desktop artifacts in parallel:
  - macOS `arm64` DMG
  - macOS `x64` DMG
  - Linux `x64` AppImage
  - Windows `x64` NSIS installer
- signs macOS builds if Apple secrets are present, otherwise ships unsigned
- signs the Windows installer via Azure Trusted Signing if Azure secrets are present, otherwise ships unsigned
- publishes one GitHub Release with all the installers plus electron-updater metadata files (`latest*.yml`, `*.blockmap`, mac `.zip` payloads)
- publishes stable alias assets for the public website download buttons:
  - `Agent-Science-mac-arm64.dmg`
  - `Agent-Science-mac-intel.dmg`
  - `Agent-Science-linux-x64.AppImage`
  - `Agent-Science-windows-x64.exe`
- aligns internal workspace package versions to the release tag before committing the release bump back to `main`

All four desktop builds run in parallel in a matrix job. The GitHub Release happens in a final job after the matrix completes.

## The normal release flow

Day to day this is the only path you need. There is no separate manual production release flow.

1. Make sure CI is green on the branch you are releasing from.
2. Create and push the tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

3. Wait for the workflow to finish. It takes a while because of the signing and notarization steps on macOS.
4. Verify the GitHub Release contains every platform artifact and the updater metadata files.
5. Download at least one build per platform and smoke test it.

That is it. If you find yourself doing anything else, read the sections below.

Public website download links should point at the stable alias asset paths under the latest GitHub release, not at a specific versioned file. Example:

```text
https://github.com/<owner>/<repo>/releases/latest/download/Agent-Science-mac-arm64.dmg
```

## Doing a dry run without cutting a real release

Push a prerelease tag. Because anything with a suffix becomes a prerelease and is not marked latest, it is safe to throw away.

```bash
git tag v0.0.0-test.1
git push origin v0.0.0-test.1
```

Then check the resulting GitHub Release, download the artifacts, and install them on each platform. Delete the release afterwards if you care about keeping the list clean.

This is also the right thing to do when you are changing the release workflow itself. Do not test release pipeline changes by cutting a real release.

## Signing

Signing is strictly optional. Every platform has an unsigned fallback, which is useful because it means a broken cert or expired key never blocks a release, it just downgrades quality. Each platform has its own set of secrets, and the workflow decides at runtime whether signing is enabled based on whether those secrets exist and are non-empty.

### macOS signing and notarization

When these secrets are present the workflow signs and notarizes macOS builds automatically:

- `CSC_LINK`: base64-encoded `.p12` containing the Developer ID Application certificate and its private key
- `CSC_KEY_PASSWORD`: the `.p12` export password
- `APPLE_API_KEY`: raw text contents of the App Store Connect API key `.p8` file
- `APPLE_API_KEY_ID`: the key ID for that API key
- `APPLE_API_ISSUER`: the issuer ID for that API key

First-time setup checklist:

1. Confirm the Apple Developer team has rights to create Developer ID certificates.
2. Create a `Developer ID Application` certificate in Apple Developer.
3. Export the certificate plus private key from Keychain as `.p12`.
4. Base64-encode the `.p12` and store it as `CSC_LINK` in GitHub Actions secrets.
5. Store the `.p12` export password as `CSC_KEY_PASSWORD`.
6. In App Store Connect, create a Team API key.
7. Save the three Apple API secrets: `APPLE_API_KEY` holds the raw `.p8` text, `APPLE_API_KEY_ID` is the key ID, `APPLE_API_ISSUER` is the issuer ID.
8. Push a prerelease tag and confirm the mac DMGs come out signed and notarized.

One implementation detail worth knowing: `APPLE_API_KEY` is stored as raw key text because that is what the workflow expects. The workflow writes it to a temporary `AuthKey_<id>.p8` file at runtime before invoking notarization.

### Windows signing (Azure Trusted Signing)

When these secrets are present the workflow signs the Windows installer via Azure Trusted Signing:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
- `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`

First-time setup checklist:

1. Create an Azure Trusted Signing account and certificate profile.
2. Record the ATS endpoint, account name, certificate profile name, and publisher name.
3. Create or pick an Entra app registration (service principal) that has the right Trusted Signing permissions.
4. Create a client secret for that service principal.
5. Add all seven Azure secrets to GitHub Actions secrets.
6. Push a prerelease tag and confirm the Windows installer comes out signed.

### What to do if signing is breaking a release

Do not skip signing by force. Instead:

1. Cut a prerelease with no signing secrets present and confirm the unsigned path still works, so you know the build itself is healthy.
2. Re-add the signing secrets one platform at a time.
3. Check that every required secret is present and non-empty. Empty secrets are the single most common failure.
4. Double-check cert profile names, tenant and client ids, and that the Apple team rights and cert are still valid.

## Internal Server Runtime

`apps/server` is an internal backend package. It ships inside the desktop app and
is versioned with the app release, but it is not published as a standalone npm
package.

That means the release pipeline only needs to:

1. build the desktop artifacts
2. publish the GitHub Release
3. commit any internal version alignment back to `main`

If the `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` secrets are not configured, the workflow still builds and publishes the GitHub Release, but it skips the final version-bump commit.

If you are debugging the backend locally, run it from the monorepo with the repo
scripts instead of trying to install it from npm.

## Desktop auto-update

Updates are served from GitHub Releases through `electron-updater`, wired up in [apps/desktop/src/main.ts](../apps/desktop/src/main.ts). A few things are worth knowing because they affect what goes into a release and how users experience it.

Update UX:

- background checks run after a startup delay and then at an interval
- nothing downloads or installs automatically
- when an update is available the desktop UI shows a rocket button, first click downloads, second click after download restarts and installs

Provider and repo resolution:

- provider is GitHub Releases (`provider: github`), configured at build time
- production builds are pinned to `vineet-reddy/agentscience-app`
- local mock-update testing still uses the generic mock-update server path

Private-repo auth workaround:

- setting `AGENTSCIENCE_DESKTOP_UPDATE_GITHUB_TOKEN` (or `GH_TOKEN`) in the desktop runtime environment makes the updater send `Authorization: Bearer <token>` on its API calls, so private repos are reachable
- this is a stopgap, not a long-term answer

Required release assets for the updater to work at all:

- platform installers: `.exe`, `.dmg`, `.AppImage`, plus macOS `.zip` for Squirrel.Mac update payloads
- `latest*.yml` updater metadata files
- `*.blockmap` files, used for differential downloads

One macOS quirk: `electron-updater` reads `latest-mac.yml` for both Intel and Apple Silicon, but the build produces one per-arch manifest. The workflow merges the two per-arch mac manifests into a single `latest-mac.yml` before publishing the GitHub Release. If updates are broken on one mac arch only, this merge step is the first place to look.

If update behavior is acting weird in a specific build, check the desktop main process code in `main.ts` and check the release assets on GitHub. Almost every update bug is either missing assets, a stale packaged build, or missing updater metadata.

## Troubleshooting a broken release

Start with the workflow logs. The failure almost always falls in one of four buckets:

- quality gate failure: lint, typecheck, or tests fail in preflight. Fix and re-push the tag.
- signing secrets missing or wrong: the build succeeds on the unsigned path but signing fails, or secrets are empty and you expected signed output. Verify secrets are present and non-empty, check cert and profile names.
- internal release automation drift: usually the workflow, package-version alignment, or lockfile refresh step no longer matches the repo layout.
- missing release assets: a matrix job silently dropped an artifact, or updater metadata files did not get uploaded. Re-run the matrix job if it was flaky, investigate the upload step if it was a real bug.

If you need to re-cut the same version, delete the tag and the GitHub Release, then push the tag again. Do not publish `vX.Y.Z.1` or similar ad hoc variants to "get around" a broken run.
