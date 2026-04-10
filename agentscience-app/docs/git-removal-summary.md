# Git Removal Summary

This repo has a concentrated git feature area plus several cross-cutting UI and RPC entrypoints.

## Safe Primary Delete Candidates

These files are almost entirely git-feature implementations and are the best first-pass delete targets if we decide to remove git support instead of stubbing it:

- `apps/server/src/git/Layers/GitCore.ts`
- `apps/server/src/git/Layers/GitHubCli.ts`
- `apps/server/src/git/Layers/GitManager.ts`
- `apps/server/src/git/Layers/GitStatusBroadcaster.ts`
- `apps/server/src/git/Layers/CodexTextGeneration.ts`
- `apps/server/src/git/Layers/RoutingTextGeneration.ts`
- `apps/server/src/git/Services/GitCore.ts`
- `apps/server/src/git/Services/GitHubCli.ts`
- `apps/server/src/git/Services/GitManager.ts`
- `apps/server/src/git/Services/GitStatusBroadcaster.ts`
- `apps/server/src/git/Services/TextGeneration.ts`
- `apps/server/src/git/Prompts.ts`
- `apps/server/src/git/Utils.ts`
- `apps/server/src/git/remoteRefs.ts`
- `apps/web/src/components/GitActionsControl.tsx`
- `apps/web/src/components/GitActionsControl.logic.ts`
- `apps/web/src/lib/gitReactQuery.ts`
- `apps/web/src/lib/gitStatusState.ts`
- `packages/contracts/src/git.ts`
- `packages/shared/src/git.ts`

## Tests That Can Go With Them

- `apps/server/src/git/Layers/CodexTextGeneration.test.ts`
- `apps/server/src/git/Layers/GitCore.test.ts`
- `apps/server/src/git/Layers/GitHubCli.test.ts`
- `apps/server/src/git/Layers/GitManager.test.ts`
- `apps/server/src/git/Layers/GitStatusBroadcaster.test.ts`
- `apps/server/src/git/Prompts.test.ts`
- `apps/web/src/components/GitActionsControl.browser.tsx`
- `apps/web/src/components/GitActionsControl.logic.test.ts`
- `apps/web/src/lib/gitReactQuery.test.ts`
- `apps/web/src/lib/gitStatusState.test.ts`
- `packages/contracts/src/git.test.ts`
- `packages/shared/src/git.test.ts`

## Cross-Cutting References To Untangle First

These are not git-only files, but they currently wire git into app startup, RPC, or core UI:

- `apps/server/src/server.ts`
  Removes the git layers from server startup.
- `apps/server/src/ws.ts`
  Removes git websocket methods and subscriptions.
- `packages/contracts/src/index.ts`
  Stops re-exporting git contracts.
- `packages/contracts/src/ipc.ts`
  Imports git contracts.
- `packages/contracts/src/rpc.ts`
  Defines all git RPC methods and schemas.
- `apps/web/src/wsRpcClient.ts`
  Exposes the git RPC client.
- `apps/web/src/wsNativeApi.ts`
  Forwards git APIs into the web app.
- `apps/web/src/components/chat/ChatHeader.tsx`
  Renders `GitActionsControl`.
- `apps/web/src/components/PullRequestThreadDialog.tsx`
  Uses git PR resolution and worktree preparation flows.
- `apps/web/src/hooks/useThreadActions.ts`
  Removes worktrees during thread deletion.
- `apps/web/src/components/BranchToolbar.logic.ts`
  Depends on shared git helpers.
- `apps/web/src/components/ChatView.browser.tsx`
  Has test/runtime expectations for git RPC activity.
- `apps/web/src/components/KeybindingsToast.browser.tsx`
  Handles git RPC request labels.

## Practical Removal Order

1. Remove git UI entrypoints from the web app.
2. Remove git RPC methods from contracts, client, and server websocket wiring.
3. Remove git layers from server startup.
4. Delete the isolated git implementation files.
5. Delete now-orphaned tests.

## Recommendation

Do not comment out all git implementations in-place as a first step. There are too many cross-file references, so broad commenting will likely leave the app in a half-wired state. A structured removal pass is safer than a partial stub pass.
