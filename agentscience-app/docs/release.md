# Release

This repo releases the desktop app from GitHub Actions. The source of truth is
[`release.yml`](../../.github/workflows/release.yml).

## Normal Flow

Run from the repo root after CI is green:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

A tag matching `v*.*.*` triggers `Release Desktop`.

- Plain tags like `v1.2.3` publish a latest release.
- Suffix tags like `v1.2.3-test.1` publish prereleases and do not become latest.
- The release can take a while because macOS signing/notarization and large runtime artifacts are slow.

After a successful release, the workflow may commit package version alignment
back to `main`. Pull before continuing local work:

```bash
git pull --ff-only origin main
```

## What The Workflow Builds

The workflow:

1. Runs preflight: `bun install --frozen-lockfile --ignore-scripts`, `bun run lint`, `bun run typecheck`, `bun run test`.
2. Builds three release legs in parallel:
   - macOS arm64 DMG on `macos-14`
   - macOS x64 DMG on `macos-15-intel`
   - Windows x64 NSIS installer on `windows-latest`
3. Publishes one GitHub Release.
4. Finalizes workspace package versions back to `main` when needed.

Windows installers must be built on Windows CI. Do not treat local macOS
Windows packaging as authoritative.

## Required Assets

Every public release should include these stable download aliases:

- `Agent-Science-mac-arm64.dmg`
- `Agent-Science-mac-intel.dmg`
- `Agent-Science-win-x64.exe`

Updater metadata/assets should also be present:

- `latest-mac.yml`
- `latest.yml`
- mac `.zip` payloads
- `*.blockmap` files

Website download links should use stable latest aliases, for example:

```text
https://github.com/vineet-reddy/agentscience-app/releases/latest/download/Agent-Science-mac-arm64.dmg
https://github.com/vineet-reddy/agentscience-app/releases/latest/download/Agent-Science-win-x64.exe
```

## Signing

Public macOS releases should be signed and notarized. The workflow enables
macOS signing only when all Apple signing secrets are present:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

`APPLE_API_KEY` is raw `.p8` text; the workflow writes it to a temporary
`AuthKey_<id>.p8` file before notarization.

Windows Authenticode signing is not wired up yet, so Windows installers are
currently unsigned.

## Managed Runtimes

Release artifacts bundle managed Codex, TinyTeX, and Python/science runtimes.

For local behavior that depends on bundled TinyTeX/Python/science packages:

```bash
bun run dev:desktop:resources
bun run dev:desktop
```

The managed Python/science runtime should prune test fixtures, caches, and debug
files before packaging/signing. Keep smoke checks for core packages including
`scipy`, `scipy.io`, `scipy.optimize`, and `scipy.stats`; `v0.0.50` failed
because macOS x64 signing hit a SciPy test fixture, and `v0.0.51` fixed this by
pruning those fixtures.

## Auto-Update

Desktop updates use GitHub Releases through `electron-updater`, wired in
[`apps/desktop/src/main.ts`](../apps/desktop/src/main.ts).

- Production builds are pinned to `vineet-reddy/agentscience-app`.
- The app checks in the background.
- Updates are not installed silently: users download, then restart/install.
- macOS has one merged `latest-mac.yml` for both arm64 and x64.
- Windows uses `latest.yml` for the NSIS installer.

Most update failures are missing release assets, stale packaged builds, or
missing updater metadata.

## Troubleshooting

Start with the GitHub Actions logs and the release asset list.

Common failures:

- Preflight failed: fix lint/typecheck/tests and push a new tag.
- Matrix build failed: inspect that platform job.
- macOS signing/notarization failed: verify Apple secrets and check nested files in the app bundle.
- Missing assets: inspect `Collect release assets`, manifest merge, and `Publish release`.
- Version drift after release: pull `origin/main`; the finalize job may have pushed package version bumps.

If re-cutting the same version, delete the GitHub Release and tag first, then
push the tag again. Do not invent ad hoc versions like `vX.Y.Z.1`.
