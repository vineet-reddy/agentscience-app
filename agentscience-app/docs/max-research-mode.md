# Max Research Mode

Max mode is the high-rigor AgentScience research path for users who care more about frontier-quality answers than token or latency efficiency.

## User Behavior

- The composer exposes a `Standard` / `Max` depth control.
- Standard remains the default and uses normal adaptive research depth.
- Max visually marks the composer and sends `researchDepth: "max"` with the turn.
- For Codex-backed turns, Max automatically disables fast mode and selects `xhigh` reasoning when the selected model supports it.
- Compact composer controls expose the same depth choice in the menu.

## Runtime Behavior

Max is not just a longer timeout. The app sends a first-class `researchDepth` field through the contract, orchestration decider, provider reactor, prompt builder, and Codex adapter. Server-side defaults preserve compatibility for older clients.

When Max reaches Codex, AgentScience adds developer instructions requiring a branching frontier-search protocol:

- decompose assumptions, baselines, and non-obvious contribution criteria;
- build a frontier map of sources, authors, methods, objections, benchmarks, and open problems;
- expand high-value branches through backward citations, forward citations, recent author work, competing methods, critique papers, and adjacent-field transfers;
- use parallel scouts/subagents when available and separable;
- run an adversarial critic pass before answering;
- write durable workspace notes for large searches.

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
- `bun run fmt:check -- <touched files>`
- `bun run build`
