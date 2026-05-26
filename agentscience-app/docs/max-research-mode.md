# Max Research Mode

Max mode is the high-rigor AgentScience research path for users who care more about scientific novelty and honest judgment than token or latency efficiency.

## User Behavior

- The composer exposes a binary `Standard` / `Max` control in the top-right of the prompt box.
- Standard remains the default.
- The visible product copy avoids implementation language such as search trees, reasoning, frontier expansion, or depth protocols.
- The first time a user chooses Max, the app warns that Max may take longer, use substantially more tokens, and increase cost.
- Max visually marks the composer with a subdued warning accent and sends `researchDepth: "max"` with the turn.
- For Codex-backed turns, Max automatically disables fast mode and selects `xhigh` reasoning when the selected model supports it.

## Runtime Behavior

Max is not just a longer timeout. The app sends a first-class `researchDepth` field through the contract, orchestration decider, provider reactor, prompt builder, and Codex adapter. Server-side defaults preserve compatibility for older clients.

When Max reaches Codex, AgentScience adds developer instructions that set a posture rather than a fixed search recipe:

- optimize for a genuinely new scientific contribution, not a broader summary;
- scan the field to learn what has already been claimed and what does not yet exist;
- search adversarially by trying to kill candidate ideas instead of collecting them;
- avoid memory-only or shallow web-scan answers when correctness or novelty depends on current literature;
- use the internet aggressively when needed, including bounded read-only Codex subagents for independent slices of broad, fast-moving, or novelty-sensitive literatures;
- increase search depth until additional searches stop changing the frontier picture, rather than following a fixed source quota;
- avoid merely filtering the existing idea set and keeping the survivors;
- propose a defensible mechanism, reframing, cross-field transfer, falsifiable prediction, or other scientific move outside the current vocabulary when one survives scrutiny;
- say plainly when no strong novel angle survives, and name the best incremental route instead of dressing it up as novelty;
- let the model choose its own search and reasoning budget because the bar is the result, not the procedure.

## Runtime Updates

The sidebar now surfaces AgentScience managed-runtime health separately from desktop app updates. When the runtime reports an update or refresh recommendation, users can run the existing managed updater from the app through `server.applyAgentScienceRuntimeUpdates()`.

The bundled Codex dependency is updated to `@openai/codex@0.128.0`, which was the latest published package version at implementation time.

## Verification

Release checks run for this implementation:

- `bun install`
- `bun run typecheck`
- `bun --filter @agentscience/server test -- src/agentScienceRuntimeStatus.test.ts src/provider/Layers/CodexAdapter.test.ts src/orchestration/decider.projectScripts.test.ts src/orchestration/Layers/OrchestrationEngine.test.ts`
- `bun --filter @agentscience/web test -- src/lib/agentScienceRuntimeStatus.test.ts src/rpc/serverState.test.ts src/components/settings/SettingsPanels.browser.tsx src/composerDraftStore.test.ts`
- `bun --filter @agentscience/shared test -- src/stagePromptBuilder.test.ts`
- `bun run build`
