# Desktop Distribution

This doc explains how AgentScience App gets from source code to a real download on the public AgentScience website.

## Current shape

The public download flow now works like this:

1. A user clicks `Download for macOS` on the AgentScience website.
2. The website sends them to a stable download route:
   - `/download/mac`
   - `/download/mac/intel`
3. That route redirects to the latest GitHub Release asset in this repo:
   - `releases/latest/download/Agent-Science-mac-arm64.dmg`
   - `releases/latest/download/Agent-Science-mac-intel.dmg`
4. GitHub hosts the actual installer file.

This means:

- the website does not need to know the current version number
- we do not need to host binaries on Vercel
- one release pipeline powers both website downloads and in-app auto-updates

## Repo ownership

This repo owns the release and distribution machinery:

- GitHub Actions release workflow: [../.github/workflows/release.yml](../.github/workflows/release.yml)
- release process notes: [./release.md](./release.md)
- desktop updater wiring: [../apps/desktop/src/main.ts](../apps/desktop/src/main.ts)

The `agentscience` repo only owns the public download button and redirect routes.

## Release flow

The release pipeline builds:

- macOS arm64 DMG
- macOS x64 DMG

It publishes a GitHub Release that includes:

- versioned artifacts like `Agent-Science-0.0.19-arm64.dmg`
- stable public alias assets like `Agent-Science-mac-arm64.dmg`
- updater metadata files like `latest-mac.yml`

Those stable alias assets are the important part for the website download button.

## Current live release

The current public release is whatever is marked latest on the GitHub Releases page for this repo.

Each release is expected to include the stable public download assets:

- `Agent-Science-mac-arm64.dmg`
- `Agent-Science-mac-intel.dmg`

## Mac trust status

Mac signing and notarization are configured for production releases.

The release workflow signs and notarizes macOS builds when the Apple signing secrets are present. The current production setup has those secrets configured; the `v0.0.43` release logs confirmed both `arm64` and Intel builds used the Developer ID Application certificate and completed notarization successfully.

The workflow still contains an unsigned fallback so engineers can diagnose build or certificate issues, but that fallback is not the expected public release path.

## Apple signing configuration

The production release workflow expects these repo secrets in GitHub Actions:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

What they are:

- `CSC_LINK`: base64-encoded `.p12` containing the Developer ID Application cert and private key
- `CSC_KEY_PASSWORD`: password for that `.p12`
- `APPLE_API_KEY`: raw contents of the App Store Connect `.p8` key
- `APPLE_API_KEY_ID`: App Store Connect key id
- `APPLE_API_ISSUER`: App Store Connect issuer id

When all five secrets are present and non-empty, the existing workflow signs and notarizes macOS builds automatically.

## Recommended operating flow

For each release:

1. Merge release-ready changes to `main`.
2. Create or update the release tag, for example `v0.0.19`.
3. Push the release tag.
4. Verify the GitHub Release contains:
   - both Mac DMGs
   - the stable alias DMGs
   - `latest-mac.yml`
5. Verify the website download routes still resolve.
6. Smoke test install on a real Mac.

## Release verification checklist

For public Mac releases, verify:

1. The GitHub Actions build logs say `macOS signing enabled.`
2. The desktop artifact build logs show a `Developer ID Application` signing identity.
3. The desktop artifact build logs say `notarization successful`.
4. The GitHub Release contains both stable alias DMGs.
5. The website download routes resolve to the latest signed release.
6. The downloaded app opens cleanly on a real Mac.
