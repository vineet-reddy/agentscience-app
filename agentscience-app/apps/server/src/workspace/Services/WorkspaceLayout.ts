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
  readonly ensureRoot: (workspaceRoot: string) => Effect.Effect<void, WorkspaceLayoutError>;
}

export class WorkspaceLayout extends ServiceMap.Service<WorkspaceLayout, WorkspaceLayoutShape>()(
  "agentscience/workspace/Services/WorkspaceLayout",
) {}
