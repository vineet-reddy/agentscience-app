# TODO: Fix Automatic Chat Renaming

Automatic sidebar chat renaming is still not working in the running desktop app.

## Goal

When a user starts or continues a conversation, a cheap nano/mini model should infer a useful short title from the thread context and update the chat title shown in the sidebar. The title should not remain the deterministic fallback based on the first user message.

## What Was Tried

- Added prompt/context plumbing for title generation so the generated title can use recent user and assistant messages, not only the first message.
- Added database/update-path support so thread metadata can accept title updates through the existing `thread.meta.update` flow.
- Added a provider-level `readConversation` method so title generation can run through the same provider session machinery as normal chat turns.
- Changed title generation to create an isolated temporary provider session instead of shelling out through the old `codex exec` text-generation path.
- Added tests around thread title prompt generation, provider title generation, and integration coverage for the title update path.
- Rebuilt `apps/server/dist/bin.mjs` and verified the built bundle contains the new isolated provider-session title-generation path.
- Found that `bun run dev:desktop` was launching a stale compiled server bundle, so source changes were not reflected in the running app.
- Updated `apps/desktop/scripts/dev-electron.mjs` so desktop dev builds the embedded server bundle before launching Electron and runs `bun tsdown --watch` for the server bundle.

## Current Status

Still broken. In the actual UI, sidebar titles continue to show the first user message, for example:

- `hi whats up`
- `create a paper about neurologin 3 in mice and humans...`

This means the deterministic fallback behavior is still what the user sees. Either the title-generation command is not firing, the generated title is not being persisted/projected, the sidebar is not reading the updated title, or the running app is still not using the intended server code path.

## Next Debugging Steps

1. Add explicit trace logs around `maybeGenerateThreadTitleForFirstTurn` to confirm whether it runs for a new thread.
2. Log the selected title-generation model/provider and whether the temporary title session starts successfully.
3. Log the raw assistant output from the title session before parsing/sanitizing.
4. Confirm that `thread.meta.update` is appended to the event log with the generated title.
5. Confirm the projection updates the thread title after `thread.meta.update`.
6. Confirm the sidebar query/store is reading the projected title and not recomputing from the first message.
7. Test from a fresh `bun run dev:desktop` process after confirming `apps/server/dist/bin.mjs` is rebuilt from current source.
