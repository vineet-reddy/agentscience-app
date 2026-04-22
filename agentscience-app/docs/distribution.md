# Desktop Distribution

This doc explains how AgentScience App gets from source code to a real download on the public AgentScience website, and what still needs to be finished for a normal Mac install experience.

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
- Linux x64 AppImage
- Windows x64 installer

It publishes a GitHub Release that includes:

- versioned artifacts like `Agent-Science-0.0.19-arm64.dmg`
- stable public alias assets like `Agent-Science-mac-arm64.dmg`
- updater metadata files like `latest-mac.yml`

Those stable alias assets are the important part for the website download button.

## Current live release

As of April 12, 2026, the first public release flow is live at:

- `v0.0.19`

That release already includes the stable public download assets:

- `Agent-Science-mac-arm64.dmg`
- `Agent-Science-mac-intel.dmg`
- `Agent-Science-linux-x64.AppImage`
- `Agent-Science-windows-x64.exe`

## What still is not done

The biggest remaining gap is Mac trust/signing.

Right now the app can be downloaded, but the macOS build is unsigned and not notarized. That means non-technical users will still hit Gatekeeper warnings when they try to open it.

For a normal public Mac install flow, we still need:

1. An Apple Developer account.
2. A Developer ID Application certificate.
3. App Store Connect API credentials for notarization.
4. GitHub Actions secrets configured in this repo.
5. A new release cut after those secrets are configured.

## Apple setup needed next

Once the Apple Developer account exists, configure these repo secrets in GitHub Actions:

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

Once those exist, the existing workflow will sign and notarize macOS builds automatically.

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

## Short-term recommendation

Until Apple signing is configured:

- keep the download flow live
- treat Mac distribution as early access/beta
- do not assume non-technical scientists will get through Gatekeeper cleanly

Once Apple signing is configured:

- cut a new release immediately
- re-test the website download flow
- then promote the Mac app publicly
