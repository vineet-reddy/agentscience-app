# AgentScience App

Main source tree: `agentscience-app/`.

- `agentscience-app/apps/desktop/`: Electron shell, preload, auto-update.
- `agentscience-app/apps/web/`: React UI.
- `agentscience-app/apps/server/`: embedded internal runtime, not a public standalone server.
- `agentscience-app/scripts/build-desktop-artifact.ts`: release builder and managed runtime bundling.
- Design source of truth: `agentscience-app/docs/design.md`.
- Release source of truth: `agentscience-app/docs/release.md`.

Treat this fork as its own product. Do not re-import T3 Code product assumptions or release policy.

## Workspaces

User-facing workspaces live under the managed container, normally `~/AgentScience`.

- Top-level: `Papers/`, `Agents/`, `Projects/`.
- Project workspaces: `Projects/<project>/papers/<thread>/` and `Projects/<project>/agents/<thread>/`.
- Unassigned threads: `Papers/<thread>/` or `Agents/<thread>/`.
- Runtime/app state lives separately under `~/.agentscience/{dev,userdata}`; do not treat it as a user workspace.
- For attachments/imports, preserve originals in app-managed state, then stage disposable working copies inside the active paper/agent workspace. Embedded Codex sessions use an `agentscience-workspace` permissions profile scoped to that active workspace. Never expose or mutate the user's original selected path.
- Attachment privacy design: `agentscience-app/docs/safe-file-attachments.md`.

## Commands

Run from `agentscience-app/`:

- `bun install --frozen-lockfile`
- `bun run lint`
- `bun run typecheck`
- `bun run test`
- `bun run build:desktop`
- `bun run release:smoke`
- `bun run dev:desktop:resources` when bundled TinyTeX/Python/runtime behavior matters.

## Design

Read `agentscience-app/docs/design.md` before UI changes.

- No decorative gradients, glows, shadows, bouncy motion, or card-heavy layouts.
- Prefer horizontal rules and full-width structure over floating cards.
- Accent blue only for logo/focus/hover/active affordances.
- EB Garamond only for page display titles and paper titles; IBM Plex Sans for UI/body text.

## Releases

- Release by pushing `vX.Y.Z`; suffix tags like `v0.0.0-test.1` are prereleases.
- After a successful release, the workflow may push a version-bump commit to `main`; pull `origin/main` before continuing.
- Required alias assets: `Agent-Science-mac-arm64.dmg`, `Agent-Science-mac-intel.dmg`, `Agent-Science-win-x64.exe`.
- Updater also needs `latest*.yml`, mac `.zip` payloads, and `*.blockmap` files.
- Windows installers must be built on Windows CI.
- Public macOS releases should be signed and notarized.
- Managed Python/science runtime packaging should prune test fixtures/cache/debug files before signing and smoke-test `scipy`, `scipy.io`, `scipy.optimize`, and `scipy.stats`.

## Security

Prioritize preload/IPC, local file access, command execution, project scripts, provider keys, updater integrity, localhost/websocket trust, path traversal, XSS, unsafe shell interpolation, and research-data leakage.

Treat workspaces, papers, datasets, markdown, model/tool output, and provider responses as attacker-controlled unless validated.
