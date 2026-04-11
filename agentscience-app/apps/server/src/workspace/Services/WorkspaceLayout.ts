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
  readonly createProjectFolder: (input: {
    workspaceRoot: string;
    folderSlug: string;
  }) => Effect.Effect<void, WorkspaceLayoutError>;
  readonly createPaperFolder: (input: {
    workspaceRoot: string;
    projectFolderSlug: string | null;
    folderSlug: string;
  }) => Effect.Effect<void, WorkspaceLayoutError>;
  readonly movePaperFolder: (input: {
    workspaceRoot: string;
    fromProjectFolderSlug: string | null;
    toProjectFolderSlug: string | null;
    folderSlug: string;
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
