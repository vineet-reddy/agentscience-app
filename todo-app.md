# Agent Science Desktop App — Build Plan

## Why This Exists

Agent Science is a platform where AI agents do real scientific research — they find datasets, run statistical analyses, generate figures, write LaTeX papers, and publish them. The platform already works. It has a CLI, a web frontend, a paper feed with peer rankings, and integrations with coding agents like Codex and Claude Code.

The problem is who it's for versus who can actually use it.

The people who would benefit most from Agent Science — clinical researchers, bench scientists, doctors, epidemiologists, public health workers — are not people who live in a terminal. They don't know what `npm install -g` means. They've never heard of Codex. They're not going to clone a GitHub repo, configure API keys in a `.env` file, and run slash commands in a CLI. That's not their world, and asking them to learn it is asking them not to use the product.

But these are smart people. They know their domains deeply. They have research questions worth investigating. If you put a clean, simple app in front of them — something they can download, open, type a research idea into, and watch a paper get built — they would use it. They'd understand it immediately. The barrier isn't intelligence, it's interface.

That's what this app is. It's the bridge between Agent Science's powerful research pipeline and the people who actually need it. A native Mac app (distributed as a DMG they download from the Agent Science website) that wraps the entire research workflow in a UI so simple that a doctor who's never touched a terminal can open it, type "Does statin use correlate with reduced severity in hospitalized COVID-19 patients?", and get back a real paper with real data analysis.

Under the hood, the app uses Codex (OpenAI's coding agent) to drive the research. Codex runs the Agent Science methodology — the same multi-stage pipeline that finds datasets, runs experiments, validates results, writes LaTeX, compiles PDFs, and publishes to the Agent Science platform. The user doesn't need to know any of this. They just see a conversation where their research partner (the AI) talks them through the process, asks for input when needed, and delivers a finished paper.

## What the App Does (Two Things)

1. **Research Chat** — The user types a research idea. The AI evaluates it, searches for data, runs experiments, writes the paper, and publishes it. The user watches the conversation unfold in real time and can see terminal output (downloads, compilation, etc.) in a collapsible drawer. This is the core experience — a conversation that produces science.

2. **My Papers** — A simple library showing every paper the user has published through Agent Science. Title, date, abstract. Click to view the PDF. That's it.

No feed browser. No rankings page. No dataset registry search. No settings jungle. Two views. The app should feel like opening Notes or a very simple chat app — not like opening an IDE.

## Design Principles

- **If a doctor can't figure it out in 30 seconds, it's too complicated.** Every screen, every button, every piece of text should be self-explanatory. No jargon. No developer concepts leaking through.
- **The terminal is hidden by default but available.** Power users and curious researchers can expand the terminal drawer to see what's happening under the hood. But it should never be the primary interface.
- **The sidebar is a simple list, not a file tree.** Past research sessions listed chronologically. A "New Research" button. A "My Papers" link. A "Settings" link. That's the entire navigation.
- **Settings are minimal.** Codex connection status, Agent Science login, maybe theme. Not a wall of toggles.
- **The app should feel warm and trustworthy.** These are researchers putting their ideas into a tool. The experience should feel like working with a knowledgeable collaborator, not operating a machine.

## How We're Building It

We're forking T3 Code, an open-source Electron app (MIT license) that already wraps Codex in a desktop UI. It has all the hard infrastructure solved — Electron packaging, terminal/PTY management, Codex integration via JSON-RPC, WebSocket-based real-time streaming, SQLite persistence, auto-updates, DMG distribution. We don't need to build any of that from scratch.

What we do need to do is gut everything that makes it a generic coding tool (Claude provider, git UI, diff panels, branch toolbars, project scripts, file @-mentions) and replace it with a focused, minimal research interface. The surgery is significant but the architecture fits naturally — T3 Code is "UI shell that manages an AI agent running terminal commands," which is exactly what Agent Science needs.

The app uses Codex only (not Claude) because Anthropic has shut down third-party tools that leverage Claude subscriptions via unofficial API access. Codex is the stable, supported path.

**Prerequisites:** The `/agentscience` Codex slash command must be working first (see todo.md).
**Target repo:** `agent-science-app/` (separate repo, not inside agentscience)
**Source reference:** T3 Code (open-source Electron app wrapping Codex). The source was previously at `t3code-main/` in this repo for reference but has been deleted. Use the upstream repo.

---

## Phase 1: Fork and Strip

### 1.1 Create new repo
- Copy T3 Code contents to `agent-science-app/`
- `git init`, initial commit

### 1.2 Delete marketing app
- **Delete:** `apps/marketing/` (entire directory)
- **Modify `package.json` (root):** Remove `dev:marketing`, `start:marketing`, `build:marketing` scripts

### 1.3 Delete Claude provider

**Delete files:**
```
apps/server/src/provider/Layers/ClaudeProvider.ts
apps/server/src/provider/Layers/ClaudeAdapter.ts
apps/server/src/provider/Layers/ClaudeAdapter.test.ts
apps/server/src/provider/Services/ClaudeProvider.ts
apps/server/src/provider/Services/ClaudeAdapter.ts
apps/server/src/git/Layers/ClaudeTextGeneration.ts
apps/server/src/git/Layers/ClaudeTextGeneration.test.ts
```

**Remove `@anthropic-ai/claude-agent-sdk` from `apps/server/package.json`.**

**Remove Claude references from:**

| File | Change |
|------|--------|
| `apps/server/src/provider/Layers/ProviderRegistry.ts` | Remove `ClaudeProviderLive` import, `claudeProvider` from `loadProviders`, `case "claudeAgent"` from refresh, `.pipe(Layer.provideMerge(ClaudeProviderLive))` |
| `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts` | Remove `ClaudeAdapter` import and from default adapters array |
| `apps/server/src/server.ts` | Remove `makeClaudeAdapterLive` import and Layer usage |
| `apps/server/src/git/Layers/RoutingTextGeneration.ts` | Remove Claude routing, always use Codex |
| `packages/contracts/src/orchestration.ts` | `ProviderKind`: `Literals(["codex", "claudeAgent"])` → `Literals(["codex"])` |
| `packages/contracts/src/model.ts` | Remove `CLAUDE_CODE_EFFORT_OPTIONS`, `ClaudeModelOptions`, all `claudeAgent` entries from provider maps |
| `packages/contracts/src/settings.ts` | Remove `ClaudeSettings` schema |
| `packages/shared/src/model.ts` | Remove `isClaudeUltrathinkPrompt`, `normalizeClaudeModelOptionsWithCapabilities` |
| `apps/web/src/components/chat/composerProviderRegistry.tsx` | Remove `claudeAgent` entry |
| `apps/web/src/components/settings/SettingsPanels.tsx` | Remove `claudeAgent` from `PROVIDER_SETTINGS` |
| `apps/web/src/components/chat/ProviderModelPicker.tsx` | Remove Claude picker logic |
| `apps/web/src/components/chat/ProviderModelPicker.browser.tsx` | Remove Claude picker logic |

### 1.4 Delete git/code-specific UI

**Delete files:**
```
apps/web/src/components/DiffPanel.tsx
apps/web/src/components/DiffPanelShell.tsx
apps/web/src/components/DiffWorkerPoolProvider.tsx
apps/web/src/components/GitActionsControl.tsx
apps/web/src/components/GitActionsControl.browser.tsx
apps/web/src/components/BranchToolbar.tsx
apps/web/src/components/BranchToolbarBranchSelector.tsx
apps/web/src/components/PullRequestThreadDialog.tsx
apps/web/src/components/ProjectScriptsControl.tsx
apps/web/src/components/PlanSidebar.tsx
apps/web/src/routes/settings.archived.tsx
```

**Also delete if they exist:**
```
apps/web/src/components/GitActionsControl.logic.ts
apps/web/src/components/GitActionsControl.logic.test.ts
apps/web/src/components/BranchToolbar.logic.ts
apps/web/src/components/BranchToolbar.logic.test.ts
apps/web/src/diffRouteSearch.ts
apps/web/src/diffRouteSearch.test.ts
apps/web/src/pullRequestReference.ts
apps/web/src/pullRequestReference.test.ts
apps/web/src/projectScripts.ts
apps/web/src/projectScripts.test.ts
apps/web/src/worktreeCleanup.ts
apps/web/src/worktreeCleanup.test.ts
apps/web/src/lib/gitReactQuery.ts
apps/web/src/lib/gitReactQuery.test.ts
apps/web/src/lib/projectScriptKeybindings.ts
apps/web/src/lib/projectScriptKeybindings.test.ts
```

**Fix dead imports:**

| File | Change |
|------|--------|
| `apps/web/src/routes/_chat.$threadId.tsx` | Remove DiffPanel/DiffPanelShell/DiffWorkerPoolProvider imports and rendering. Just render ChatView inside SidebarInset. |
| `apps/web/src/components/ChatView.tsx` | Remove imports/rendering of GitActionsControl, BranchToolbar, DiffPanel, PlanSidebar, ProjectScriptsControl |
| `apps/web/src/components/chat/ChatHeader.tsx` | Remove git branch display, PR button, git controls |
| `apps/web/src/components/settings/SettingsSidebarNav.tsx` | Remove "Archived" nav link |

### 1.5 Verify
```bash
cd agent-science-app && bun install && bun typecheck && bun lint && bun fmt
```
Iterate fixing type errors until clean.

---

## Phase 2: Rebrand

### 2.1 Core branding

**`apps/web/src/branding.ts`:**
```ts
export const APP_BASE_NAME = "Agent Science";
export const APP_STAGE_LABEL = import.meta.env.DEV ? "Dev" : "Alpha";
export const APP_DISPLAY_NAME = `${APP_BASE_NAME} (${APP_STAGE_LABEL})`;
export const APP_VERSION = import.meta.env.APP_VERSION || "0.0.0";
```

**`apps/desktop/src/main.ts`** constants:
- `T3CODE_HOME` → `AGENTSCIENCE_HOME`
- `BASE_DIR`: `".t3"` → `".agentscience"`
- `DESKTOP_SCHEME`: `"t3"` → `"agentscience"`
- `APP_DISPLAY_NAME`: `"T3 Code"` → `"Agent Science"`
- `APP_USER_MODEL_ID`: `"com.t3tools.t3code"` → `"com.agentscience.app"`
- `LINUX_DESKTOP_ENTRY_NAME`, `LINUX_WM_CLASS`, `USER_DATA_DIR_NAME`: `"t3code"` → `"agentscience"`

**`apps/desktop/package.json`**: name → `@agentscience/desktop`, productName → `Agent Science (Alpha)`

### 2.2 Package renames

| Old | New |
|-----|-----|
| `@t3tools/monorepo` | `@agentscience/monorepo` |
| `@t3tools/desktop` | `@agentscience/desktop` |
| `t3` (server) | `agentscience-server` |
| `@t3tools/web` | `@agentscience/web` |
| `@t3tools/contracts` | `@agentscience/contracts` |
| `@t3tools/shared` | `@agentscience/shared` |

### 2.3 Mass find-and-replace (ALL .ts, .tsx, .json, .mjs files)

| Find | Replace |
|------|---------|
| `@t3tools/contracts` | `@agentscience/contracts` |
| `@t3tools/shared` | `@agentscience/shared` |
| `@t3tools/desktop` | `@agentscience/desktop` |
| `@t3tools/web` | `@agentscience/web` |
| `@t3tools/marketing` | (delete references) |
| `T3CODE_` (all env vars) | `AGENTSCIENCE_` |
| `t3code` | `agentscience` |
| `T3 Code` | `Agent Science` |
| `t3-server` | `agentscience-server` |
| `com.t3tools.t3code` | `com.agentscience.app` |

Key files: `turbo.json`, `apps/server/src/config.ts`, `apps/server/src/cli.ts`, `scripts/build-desktop-artifact.ts`, `scripts/lib/brand-assets.ts`

### 2.4 Build script branding

**`scripts/build-desktop-artifact.ts`:**
- `appId` → `"com.agentscience.app"`
- `artifactName` → `"Agent-Science-${version}-${arch}.${ext}"`
- `executableName` → `"agentscience"`
- `author` → `"Agent Science"`

### 2.5 Verify
```bash
bun install && bun typecheck && bun lint && bun fmt
grep -r "t3code\|t3tools\|T3 Code\|T3CODE" --include="*.ts" --include="*.tsx" --include="*.json" . | grep -v node_modules | grep -v .git
```

---

## Phase 3: Simplify the UI

### 3.1 Rewrite Sidebar

**`apps/web/src/components/Sidebar.tsx`** — complete rewrite (~1000 lines → ~200 lines):

1. **Header:** "Agent Science" + version badge
2. **"New Research" button** (uses `useHandleNewThread` hook from `../hooks/useHandleNewThread`)
3. **Thread list:** Flat, sorted by `updatedAt` desc. Each: title + timestamp. Click → `/$threadId`.
4. **Footer:** "My Papers" (→ `/papers`), "Settings" (→ `/settings`)

**Keep:** `useStore`, `useHandleNewThread`, `Link`/`useNavigate`/`useParams`, `formatRelativeTimeLabel`, UI primitives, branding imports.

**Remove all:** `@dnd-kit/*`, project/folder tree, git status, multi-select, branch selectors, desktop update pill, complex grouping.

### 3.2 Simplify Settings

**`apps/web/src/components/settings/SettingsPanels.tsx`:**
- Keep: Codex provider status, theme picker, app version
- Remove: diff word wrap, worktree, project scripts, sidebar sort
- Add: "Agent Science Account" section (login status from CLI config)

**`apps/web/src/components/settings/SettingsSidebarNav.tsx`:** Remove "Archived" link.

### 3.3 Simplify ChatView

**`apps/web/src/components/ChatView.tsx`:**
- Keep: message timeline, composer, terminal drawer, pending approval panel
- Remove: file @-mention picker, "Open in" editor picker
- Header: "Research Session" + thread title (no git info)

### 3.4 Update empty state

**`apps/web/src/routes/_chat.index.tsx`:**
- Text: "Start a new research session to begin. Type your research idea and Agent Science will find data, run experiments, and write your paper."
- Centered "New Research" button

### 3.5 Verify
```bash
bun typecheck && bun dev
```

---

## Phase 4: Add "My Papers" View

### 4.1 Create route

**Create `apps/web/src/routes/papers.tsx`:**
- File-based route at `/papers`
- Renders `PapersView` inside `SidebarInset` with "My Papers" header
- Include `SidebarTrigger` for mobile, drag region for Electron

### 4.2 Create PapersView component

**Create `apps/web/src/components/PapersView.tsx`:**
- Calls papers list via server RPC (which spawns `agentscience papers list --json`)
- Loading: skeleton cards
- Empty: "No papers yet. Start a research session to publish your first paper."
- Cards: title, date, abstract snippet (150 chars)
- Click → open PDF via `shell.openExternal`

**Create `apps/server/src/agentscience/papersList.ts`:**
- Spawns `agentscience papers list --json` child process
- Parses JSON, returns `{ slug, title, abstract, publishedAt, pdfUrl, status }[]`
- Handles errors (CLI missing, not authenticated)

**Register in `apps/server/src/wsServer.ts`:**
- New method `agentscience.listPapers`

**Add contract in `packages/contracts/src/`:**
- RPC method schema + response type

### 4.3 Verify
```bash
bun typecheck
```

---

## Phase 5: Wire Up Research Flow

### 5.1 Auto-invoke /agentscience

**`apps/server/src/provider/Layers/CodexAdapter.ts`:**
- In `sendTurn`, detect first turn in session
- If first turn, prepend `/agentscience\n\n` to input text

### 5.2 Auto-open terminal drawer

**`apps/web/src/components/ThreadTerminalDrawer.tsx` or `terminalStateStore.ts`:**
- Auto-expand terminal drawer when terminal output begins

### 5.3 Research workspace

- On server boot, ensure `~/.agentscience/research/` exists
- New Codex sessions use it as cwd

### 5.4 Verify
```bash
bun typecheck && bun dev
```

---

## Phase 6: Build and Distribution

### 6.1 Icons
- Keep existing icon files, rename references (or create placeholders)

### 6.2 GitHub Actions

**`.github/workflows/ci.yml`:** Install, typecheck, lint, test. No marketing.

**`.github/workflows/release.yml`:** On tag `v*` → macOS runner builds DMG → uploads to GitHub Release.

### 6.3 README
- What Agent Science is
- Prerequisites: Codex CLI, `npm i -g agentscience`, OpenAI API key
- Download: link to GitHub Releases
- Dev: `bun install && bun dev`
- Build: `bun dist:desktop:dmg`

### 6.4 Final verify
```bash
bun install && bun build && bun dist:desktop:dmg
```

---

## Execution Order

Run `bun typecheck && bun lint && bun fmt` after each phase. Fix all errors before proceeding.

1. Phase 1.1 — Copy repo, git init
2. Phase 1.2 — Delete marketing
3. Phase 1.3 — Delete Claude (files + references)
4. Phase 1.4 — Delete git UI (files + references)
5. Phase 1.5 — `bun install && bun typecheck` — fix all errors
6. Phase 2.1–2.4 — All branding
7. Phase 2.5 — `bun install && bun typecheck` — fix all errors
8. Phase 3.1 — Rewrite Sidebar
9. Phase 3.2–3.4 — Simplify settings, ChatView, empty state
10. Phase 3.5 — `bun typecheck` — fix all errors
11. Phase 4.1–4.2 — Papers route + component + server RPC
12. Phase 4.3 — `bun typecheck`
13. Phase 5.1–5.3 — Wire research flow
14. Phase 5.4 — `bun typecheck`
15. Phase 6.1–6.4 — Icons, CI, README, final build

**Phase 1 is the hardest.** After deleting files, expect cascading type errors. Trace each to a removed import and delete or stub the importing code.
