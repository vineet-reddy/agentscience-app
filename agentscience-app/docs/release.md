# Release

This is the short version of how releases work.

If you are changing release infrastructure, read the workflow too:

- [release.yml](/Users/vineetreddy/Documents/GitHub/agentscience-app/.github/workflows/release.yml)

## What a release does

Pushing a tag like `v1.2.3` triggers the release workflow.

That workflow:

- runs quality gates first
- builds desktop artifacts for macOS, Linux, and Windows
- publishes a GitHub Release
- publishes the CLI package from `apps/server`

Versions with a suffix like `v1.2.3-alpha.1` become prereleases.

## The normal release flow

1. Make sure CI is green on the branch you want to release.
2. Create a tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

3. Wait for the workflow to finish.
4. Verify the GitHub Release assets.
5. Smoke test the downloaded builds.

That is the main path. Most people do not need more than that.

## Dry run

If you want to test the release pipeline without cutting a real release, use a prerelease tag.

For example:

```bash
git tag v0.0.0-test.1
git push origin v0.0.0-test.1
```

Then inspect the release artifacts and install them on the target platforms.

## Signing

Signing is optional and controlled by secrets.

### macOS

If Apple signing and notarization secrets are present, the workflow signs and notarizes macOS builds.

Important secrets:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

### Windows

If Azure Trusted Signing secrets are present, the workflow signs the Windows installer.

Important secrets:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
- `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`

If those secrets are missing, the release can still run unsigned.

## CLI publishing

The CLI package is `agentscience-server` from `apps/server`.

Publishing uses npm trusted publishing through GitHub Actions.

Before relying on that path, confirm npm trusted publishing is configured for:

- this repo
- `.github/workflows/release.yml`
- the `agentscience-server` package

## Desktop auto-update

Desktop updates come from GitHub Releases.

Important points:

- the app checks for updates in the background
- it does not auto-install immediately
- release assets must include the updater metadata files

If you are debugging update behavior, check the desktop main process and the release assets on GitHub first.

## If a release goes wrong

Start with the workflow logs.

Common buckets:

- quality gate failure
- signing secrets missing or wrong
- publish permissions wrong
- missing release assets

If signing is failing and you need to isolate the problem, first confirm the unsigned path still works.
