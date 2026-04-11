import { Encoding } from "effect";
import { CheckpointRef, type ThreadId } from "@agentscience/contracts";

export const CHECKPOINT_REFS_PREFIX = "refs/t3/checkpoints";

export function checkpointRefForThreadTurn(threadId: ThreadId, turnCount: number): CheckpointRef {
  return CheckpointRef.makeUnsafe(
    `${CHECKPOINT_REFS_PREFIX}/${Encoding.encodeBase64Url(threadId)}/turn/${turnCount}`,
  );
}

export function resolveThreadWorkspaceCwd(input: {
  readonly thread: {
    readonly resolvedWorkspacePath: string | null;
    readonly worktreePath: string | null;
  };
}): string | undefined {
  return input.thread.worktreePath ?? input.thread.resolvedWorkspacePath ?? undefined;
}
