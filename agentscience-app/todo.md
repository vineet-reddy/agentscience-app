# Fixed: Automatic Chat Renaming

Automatic sidebar chat renaming now runs through the provider-session title path and has regression coverage for the runtime failure shape seen in the desktop app.

## Root Cause

Codex thread snapshots use `type: "message"` for both user and assistant items. The old title polling code accepted any item whose type contained `message`, then recursively collected `text`, `content`, and `message` fields. That allowed the title generator to parse the user prompt or generic provider text as if it were the assistant's generated title, stop the temporary `thread-title-*` session early, and leave the sidebar on the deterministic first-message fallback.

## Fix

- Title polling now only accepts real assistant or agent message items, using `role: "assistant"` / `role: "agent"` or explicit assistant/agent message item types.
- User, generic message, reasoning, tool, and status-like items are ignored even if they contain JSON-looking title text.
- Title generation uses the cheap `gpt-5.4-mini` model with low reasoning effort and fast mode unless the user already selected a mini/nano title model.
- The generated title is still persisted through `thread.meta.update`, then projected into the same thread/sidebar state path the UI already reads.

## Proof

- `bunx vitest run apps/server/src/orchestration/threadTitleGeneration.test.ts apps/server/integration/threadTitleGeneration.integration.test.ts`
- `bunx vitest run apps/web/src/store.test.ts apps/server/src/orchestration/threadTitleGeneration.test.ts apps/server/integration/threadTitleGeneration.integration.test.ts`
- `bun run typecheck` in `apps/server`
- `bun run typecheck` in `apps/web`
- `bun run build` in `apps/server`
