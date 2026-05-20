# Dead-Code Cleanup Proof

Branch: `codex/dead-code-cleanup`

This note records the evidence for the May 2026 web/runtime cleanup. The goal is not just
that tests pass; the goal is to show that deleted code was outside the product behavior
surface, or that the retained behavior is equivalent after the cleanup.

## What Changed

The cleanup removed these unused web/runtime areas:

- The abandoned stage UI/store island under `apps/web/src/components/stages/` and
  `apps/web/src/stages/stageStore.ts`.
- The unused history bootstrap helper `apps/web/src/historyBootstrap.ts`.
- The orphan project-script UI path:
  `apps/web/src/components/ProjectScriptsControl.tsx`,
  `apps/web/src/projectScripts.ts`, and stale project-script props/callbacks on
  `ChatView` and `ChatHeader`.
- Unreferenced UI primitives: alert dialog, card, field, fieldset, form, input group,
  keyboard key, label, and radio group.
- Unreferenced components: `SettingsSidebarNav` and `SidebarUpdatePill`.
- Package dependencies that only supported deleted code:
  `@dnd-kit/*` and `@formkit/auto-animate`.
- An unused `@agentscience/contracts` dependency from the release scripts package.
- One lint-only server cleanup in `apps/server/src/ws.ts`, changing a no-yield
  `Effect.gen` wrapper into `Effect.succeed` for the same stream provider.

## Reachability Experiment

I used a temporary static reachability script to walk runtime imports from the production
web entrypoints:

- `apps/web/src/main.tsx`
- `apps/web/src/router.ts`
- `apps/web/src/routeTree.gen.ts`
- every route file under `apps/web/src/routes/`

The script resolves relative imports and `~/` aliases and ignores TypeScript-only imports.
It also asserts that known-live controls are still reachable:

- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/chat/ChatHeader.tsx`
- `apps/web/src/components/PaperReviewPanel.tsx`
- `apps/web/src/components/ThreadTerminalDrawer.tsx`
- `apps/web/src/components/Sidebar.tsx`

Baseline command:

```bash
node /tmp/agentscience-reachability-proof.mjs \
  /Users/vineetreddy/Documents/GitHub/agent-science-workspace/agentscience-app/agentscience-app
```

Baseline result:

```json
{
  "reachableFileCount": 196,
  "deletedCandidateCount": 23,
  "deletedCandidatesExistingInThisTree": 23,
  "reachableDeletedCandidates": ["apps/web/src/projectScripts.ts"],
  "missingLiveControls": [],
  "verdict": "FAIL"
}
```

Cleanup command:

```bash
node /tmp/agentscience-reachability-proof.mjs \
  /Users/vineetreddy/Documents/GitHub/agent-science-workspace/agentscience-app-cleanup/agentscience-app
```

Cleanup result:

```json
{
  "reachableFileCount": 195,
  "deletedCandidateCount": 23,
  "deletedCandidatesExistingInThisTree": 0,
  "reachableDeletedCandidates": [],
  "missingLiveControls": [],
  "verdict": "PASS"
}
```

Interpretation:

- All deleted candidates except `projectScripts.ts` were outside the runtime web import
  graph before deletion.
- After deletion, none of the deleted candidates remain reachable.
- The known live chat, sidebar, paper review, and terminal controls remain reachable.

## Project-Script Exception

`projectScripts.ts` was the only deleted file that the baseline reachability experiment
could still reach. That was not a product feature edge; it was the root of the stale code.

On the baseline tree:

```bash
rg -n "activeProjectScripts|preferredScriptId|onRunProjectScript|onAddProjectScript|onUpdateProjectScript|onDeleteProjectScript|ProjectScriptsControl|primaryProjectScript" \
  agentscience-app/apps/web/src/components/ChatView.tsx \
  agentscience-app/apps/web/src/components/chat/ChatHeader.tsx \
  agentscience-app/apps/web/src/components/ProjectScriptsControl.tsx \
  agentscience-app/apps/web/src/projectScripts.ts
```

Key results:

- `ChatView.tsx:4520-4539` passed project-script props and callbacks into
  `ChatHeader`.
- `ChatHeader.tsx:18-33` declared those props in its TypeScript interface.
- `ChatHeader.tsx:39-52` destructured only thread title, project name, editor picker,
  terminal toggle, paper-review toggle, and work status. It never destructured or rendered
  the project-script props or callbacks.
- `ProjectScriptsControl.tsx` imported `primaryProjectScript`, but nothing in the runtime
  graph imported or rendered `ProjectScriptsControl`.

So the stale import was:

`ChatView -> ChatHeader prop types/callbacks -> project-script helpers`

There was no rendered control and no user action that could call those callbacks. Removing
the stale props/callbacks removes a dormant path without removing a visible workflow.

## Dependency Experiment

Before cleanup, the only non-lockfile references to the removed UI dependencies were package
manifest entries and tests for deleted code:

```bash
rg -n "@dnd-kit|auto-animate|ProjectScriptsControl|components/stages|historyBootstrap|stageStore" \
  agentscience-app/apps/web/src \
  agentscience-app/apps/web/package.json \
  agentscience-app/scripts/package.json
```

Relevant baseline results:

- `@dnd-kit/*` and `@formkit/auto-animate` appeared only in
  `apps/web/package.json`.
- `historyBootstrap` appeared only in `historyBootstrap.test.ts`.
- `stageStore` appeared only in stage components and `stageStore.test.ts`.
- `ProjectScriptsControl` appeared only in its own file and stale type imports/props.

After cleanup, the same search in the branch returns no source or manifest hits. A frozen
install succeeds, proving the package graph is internally consistent without those
dependencies:

```bash
bun install --frozen-lockfile
```

## Bundle Comparison

I built the web app in both trees:

```bash
bun run build --filter=@agentscience/web
```

Both builds completed with the same known warnings:

- unresolved `images/altText_add.svg`
- unresolved `images/altText_done.svg`
- pdf.js direct `eval`
- large chunk warning

The cleanup build transforms one fewer module and emits smaller main assets:

| Metric | Baseline | Cleanup |
| --- | ---: | ---: |
| transformed modules | 3613 | 3612 |
| main CSS raw | 245.84 kB | 221.83 kB |
| main CSS gzip | 33.66 kB | 31.05 kB |
| main JS raw | 1412.83 kB | 1409.24 kB |
| main JS gzip | 402.49 kB | 401.38 kB |

This is the toy experiment for product quality: the production app still builds through the
same entrypoints and route tree, keeps the same live controls reachable, keeps the same
known build warnings, and ships less unused code and CSS.

## Validation

Commands run from `agentscience-app/` on the cleanup branch:

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run build:desktop
git diff --check
```

Observed results:

- `lint`: passed with zero warnings. Baseline had one warning in `apps/server/src/ws.ts`;
  the cleanup removes that warning without changing the stream provider value.
- `typecheck`: passed.
- `test`: passed.
- `build:desktop`: passed.
- `git diff --check`: passed.

## Product-Quality Conclusion

The cleanup is behavior-preserving for the product surface because the deleted candidates
were either unreachable from production entrypoints or, in the project-script case, reachable
only through stale props that no rendered component consumed. The branch keeps the known live
UI controls in the import graph, removes manifest dependencies that no remaining source uses,
and produces a smaller production bundle with the same build warnings and passing full
validation suite.
