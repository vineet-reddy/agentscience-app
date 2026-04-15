import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

export class WorkspaceLayoutError extends Schema.TaggedErrorClass<WorkspaceLayoutError>()(
  "WorkspaceLayoutError",
  {
    workspaceRoot: Schema.String,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface WorkspaceLayoutShape {
  readonly ensureRoot: (
    workspaceRoot: string,
  ) => Effect.Effect<void, WorkspaceLayoutError>;
  readonly ensureProjectWorkspace: (input: {
    containerRoot: string;
    projectWorkspaceRoot: string;
  }) => Effect.Effect<void, WorkspaceLayoutError>;
  readonly ensurePaperWorkspace: (input: {
    containerRoot: string;
    paperWorkspaceRoot: string;
    projectWorkspaceRoot?: string | null;
  }) => Effect.Effect<void, WorkspaceLayoutError>;
  readonly movePaperWorkspace: (input: {
    containerRoot: string;
    fromPaperWorkspaceRoot: string;
    fromProjectWorkspaceRoot?: string | null;
    toPaperWorkspaceRoot: string;
    toProjectWorkspaceRoot?: string | null;
  }) => Effect.Effect<void, WorkspaceLayoutError>;
  readonly moveWorkspaceRoot: (input: {
    fromWorkspaceRoot: string;
    toWorkspaceRoot: string;
  }) => Effect.Effect<void, WorkspaceLayoutError>;
}

export class WorkspaceLayout extends ServiceMap.Service<
  WorkspaceLayout,
  WorkspaceLayoutShape
>()("agentscience/workspace/Services/WorkspaceLayout") {}
