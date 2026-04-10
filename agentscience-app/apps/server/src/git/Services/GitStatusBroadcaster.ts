import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";
import type {
  GitManagerServiceError,
  GitStatusInput,
  GitStatusResult,
  GitStatusStreamEvent,
} from "@agentscience/contracts";

export interface GitStatusBroadcasterShape {
  readonly getStatus: (
    input: GitStatusInput,
  ) => Effect.Effect<GitStatusResult, GitManagerServiceError>;
  readonly refreshStatus: (cwd: string) => Effect.Effect<GitStatusResult, GitManagerServiceError>;
  readonly streamStatus: (
    input: GitStatusInput,
  ) => Stream.Stream<GitStatusStreamEvent, GitManagerServiceError>;
}

export class GitStatusBroadcaster extends ServiceMap.Service<
  GitStatusBroadcaster,
  GitStatusBroadcasterShape
>()("agentscience/git/Services/GitStatusBroadcaster") {}
