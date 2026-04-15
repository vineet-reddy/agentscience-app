import {
  ChatAttachment,
  CheckpointRef,
  EventId,
  MessageId,
  ModelSelection,
  NonNegativeInt,
  OrchestrationCheckpointFile,
  OrchestrationCheckpointStatus,
  OrchestrationMessageRole,
  OrchestrationProposedPlanId,
  OrchestrationReadModel,
  OrchestrationSessionStatus,
  OrchestrationThreadActivityTone,
  type OrchestrationThread,
  ProjectScript,
  ProjectId,
  ThreadId,
  TurnId,
} from "@agentscience/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  isPersistenceError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
} from "../../persistence/Errors.ts";
import { DeviceStateRepositoryLive } from "../../persistence/Layers/DeviceState.ts";
import { DeviceStateRepository } from "../../persistence/Services/DeviceState.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  getValidatedPaperWorkspaceRoot,
  getValidatedProjectWorkspaceRoot,
} from "../../workspace/roots.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
  type ProjectionThreadCheckpointContext,
} from "../Services/ProjectionSnapshotQuery.ts";

const PROJECT_METADATA_PREFIX = "local.project.";
const THREAD_METADATA_PREFIX = "local.thread.";

const decodeReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);

type WorkspaceMetadata = {
  readonly workspaceRoot: string | null;
};

const ProjectionTurnState = Schema.Literals([
  "pending",
  "running",
  "interrupted",
  "completed",
  "error",
]);

const ProjectionProjectRowSchema = Schema.Struct({
  projectId: ProjectId,
  folderSlug: Schema.String,
  title: Schema.String,
  defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
  scripts: Schema.fromJsonString(Schema.Array(ProjectScript)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  deletedAt: Schema.NullOr(Schema.String),
});

const ProjectionThreadRowSchema = Schema.Struct({
  threadId: ThreadId,
  projectId: Schema.NullOr(ProjectId),
  folderSlug: Schema.String,
  title: Schema.String,
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  runtimeMode: Schema.Literals(["full-access", "approval-required"]),
  interactionMode: Schema.Literals(["default", "plan"]),
  modelSelection: Schema.fromJsonString(ModelSelection),
  latestTurnId: Schema.NullOr(TurnId),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  archivedAt: Schema.NullOr(Schema.String),
  deletedAt: Schema.NullOr(Schema.String),
});

const ProjectionMessageRowSchema = Schema.Struct({
  messageId: MessageId,
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
  isStreaming: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

const ProjectionSessionRowSchema = Schema.Struct({
  threadId: ThreadId,
  status: OrchestrationSessionStatus,
  providerName: Schema.NullOr(Schema.String),
  runtimeMode: Schema.Literals(["full-access", "approval-required"]),
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
});

const ProjectionProposedPlanRowSchema = Schema.Struct({
  planId: OrchestrationProposedPlanId,
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: Schema.String,
  implementedAt: Schema.NullOr(Schema.String),
  implementationThreadId: Schema.NullOr(ThreadId),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

const ProjectionActivityRowSchema = Schema.Struct({
  activityId: EventId,
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  tone: OrchestrationThreadActivityTone,
  kind: Schema.String,
  summary: Schema.String,
  payload: Schema.fromJsonString(Schema.Unknown),
  createdAt: Schema.String,
  sequence: Schema.NullOr(NonNegativeInt),
});

const ProjectionTurnRowSchema = Schema.Struct({
  rowId: NonNegativeInt,
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  pendingMessageId: Schema.NullOr(MessageId),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
  assistantMessageId: Schema.NullOr(MessageId),
  state: ProjectionTurnState,
  requestedAt: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
  checkpointTurnCount: Schema.NullOr(NonNegativeInt),
  checkpointRef: Schema.NullOr(CheckpointRef),
  checkpointStatus: Schema.NullOr(OrchestrationCheckpointStatus),
  checkpointFiles: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
});
type ProjectionTurnRow = typeof ProjectionTurnRowSchema.Type;

const ProjectionStateSummaryRowSchema = Schema.Struct({
  snapshotSequence: Schema.NullOr(NonNegativeInt),
  updatedAt: Schema.NullOr(Schema.String),
});

const ProjectionCountsRowSchema = Schema.Struct({
  projectCount: Schema.Number,
  threadCount: Schema.Number,
});

const ProjectIdLookupInput = Schema.Struct({
  projectId: ProjectId,
});

const ThreadIdLookupInput = Schema.Struct({
  threadId: ThreadId,
});

function parseWorkspaceMetadata(valueJson: string): WorkspaceMetadata | null {
  const parsedJson = parseJson(valueJson);
  if (parsedJson === null || typeof parsedJson !== "object") {
    return null;
  }
  const workspaceRoot = (parsedJson as { workspaceRoot?: unknown }).workspaceRoot;
  return {
    workspaceRoot: typeof workspaceRoot === "string" ? workspaceRoot : null,
  };
}

function parseJson(valueJson: string): unknown | null {
  try {
    return JSON.parse(valueJson);
  } catch {
    return null;
  }
}

function maxIso(left: string | null, right: string | null): string | null {
  if (right === null) {
    return left;
  }
  if (left === null) {
    return right;
  }
  return left > right ? left : right;
}

function resolveProjectWorkspacePath(input: {
  readonly settingsWorkspaceRoot: string;
  readonly projectId: ProjectId;
  readonly projectMetadataById: ReadonlyMap<string, WorkspaceMetadata>;
}): string | null {
  const metadata = input.projectMetadataById.get(input.projectId);
  if (!metadata?.workspaceRoot) {
    return null;
  }
  return getValidatedProjectWorkspaceRoot({
    containerRoot: input.settingsWorkspaceRoot,
    projectWorkspaceRoot: metadata.workspaceRoot,
  });
}

function resolveThreadWorkspacePath(input: {
  readonly settingsWorkspaceRoot: string;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId | null;
  readonly projectMetadataById: ReadonlyMap<string, WorkspaceMetadata>;
  readonly threadMetadataById: ReadonlyMap<string, WorkspaceMetadata>;
}): string | null {
  const threadMetadata = input.threadMetadataById.get(input.threadId);
  if (!threadMetadata?.workspaceRoot) {
    return null;
  }

  const projectWorkspaceRoot =
    input.projectId === null
      ? null
      : resolveProjectWorkspacePath({
          settingsWorkspaceRoot: input.settingsWorkspaceRoot,
          projectId: input.projectId,
          projectMetadataById: input.projectMetadataById,
        });
  if (input.projectId !== null && projectWorkspaceRoot === null) {
    return null;
  }
  return getValidatedPaperWorkspaceRoot({
    containerRoot: input.settingsWorkspaceRoot,
    paperWorkspaceRoot: threadMetadata.workspaceRoot,
    projectWorkspaceRoot,
  });
}

function toLatestTurnState(
  state: ProjectionTurnRow["state"],
): "running" | "interrupted" | "completed" | "error" {
  return state === "pending" ? "running" : state;
}

function compareActivities(
  left: OrchestrationThread["activities"][number],
  right: OrchestrationThread["activities"][number],
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function buildCheckpointsFromTurns(
  turns: ReadonlyArray<ProjectionTurnRow>,
): OrchestrationThread["checkpoints"] {
  return turns
    .flatMap((turn) => {
      if (
        turn.turnId === null ||
        turn.checkpointTurnCount === null ||
        turn.checkpointRef === null ||
        turn.checkpointStatus === null ||
        turn.completedAt === null
      ) {
        return [];
      }
      return [
        {
          turnId: turn.turnId,
          checkpointTurnCount: turn.checkpointTurnCount,
          checkpointRef: turn.checkpointRef,
          status: turn.checkpointStatus,
          files: turn.checkpointFiles,
          assistantMessageId: turn.assistantMessageId,
          completedAt: turn.completedAt,
        },
      ];
    })
    .toSorted(
      (left, right) =>
        left.checkpointTurnCount - right.checkpointTurnCount ||
        left.completedAt.localeCompare(right.completedAt) ||
        left.turnId.localeCompare(right.turnId),
    );
}

function buildLatestTurn(input: {
  readonly sessionActiveTurnId: TurnId | null;
  readonly threadLatestTurnId: TurnId | null;
  readonly turns: ReadonlyArray<ProjectionTurnRow>;
}): OrchestrationThread["latestTurn"] {
  const concreteTurns = input.turns.filter(
    (turn): turn is ProjectionTurnRow & { readonly turnId: TurnId } => turn.turnId !== null,
  );
  if (concreteTurns.length === 0) {
    return null;
  }

  const targetTurnId =
    input.sessionActiveTurnId ?? input.threadLatestTurnId ?? concreteTurns.at(-1)?.turnId ?? null;
  const turn =
    (targetTurnId
      ? concreteTurns.find((entry) => entry.turnId === targetTurnId)
      : null) ?? concreteTurns.at(-1);
  if (!turn) {
    return null;
  }

  return {
    turnId: turn.turnId,
    state: toLatestTurnState(turn.state),
    requestedAt: turn.requestedAt,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    assistantMessageId: turn.assistantMessageId,
    ...(turn.sourceProposedPlanThreadId !== null && turn.sourceProposedPlanId !== null
      ? {
          sourceProposedPlan: {
            threadId: turn.sourceProposedPlanThreadId,
            planId: turn.sourceProposedPlanId,
          },
        }
      : {}),
  };
}

const makeProjectionSnapshotQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const deviceStateRepository = yield* DeviceStateRepository;
  const serverSettingsService = yield* ServerSettingsService;

  const listProjectRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProjectRowSchema,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          folder_slug AS "folderSlug",
          title,
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        WHERE deleted_at IS NULL
        ORDER BY created_at ASC, project_id ASC
      `,
  });

  const listThreadRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          folder_slug AS "folderSlug",
          title,
          branch,
          worktree_path AS "worktreePath",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          model_selection_json AS "modelSelection",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt"
        FROM projection_threads
        WHERE deleted_at IS NULL
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const listMessageRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionMessageRowSchema,
    execute: () =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          is_streaming AS "isStreaming",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_messages
        ORDER BY thread_id ASC, created_at ASC, message_id ASC
      `,
  });

  const listSessionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionSessionRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          status,
          provider_name AS "providerName",
          runtime_mode AS "runtimeMode",
          active_turn_id AS "activeTurnId",
          last_error AS "lastError",
          updated_at AS "updatedAt"
        FROM projection_thread_sessions
      `,
  });

  const listProposedPlanRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProposedPlanRowSchema,
    execute: () =>
      sql`
        SELECT
          plan_id AS "planId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          plan_markdown AS "planMarkdown",
          implemented_at AS "implementedAt",
          implementation_thread_id AS "implementationThreadId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_proposed_plans
        ORDER BY thread_id ASC, created_at ASC, plan_id ASC
      `,
  });

  const listActivityRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionActivityRowSchema,
    execute: () =>
      sql`
        SELECT
          activity_id AS "activityId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          tone,
          kind,
          summary,
          payload_json AS "payload",
          created_at AS "createdAt",
          sequence AS "sequence"
        FROM projection_thread_activities
        ORDER BY
          thread_id ASC,
          CASE WHEN sequence IS NULL THEN 1 ELSE 0 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `,
  });

  const listTurnRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionTurnRowSchema,
    execute: () =>
      sql`
        SELECT
          row_id AS "rowId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          pending_message_id AS "pendingMessageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          assistant_message_id AS "assistantMessageId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "checkpointStatus",
          checkpoint_files_json AS "checkpointFiles"
        FROM projection_turns
        ORDER BY thread_id ASC, requested_at ASC, row_id ASC
      `,
  });

  const readProjectionStateSummary = SqlSchema.findOne({
    Request: Schema.Void,
    Result: ProjectionStateSummaryRowSchema,
    execute: () =>
      sql`
        SELECT
          MIN(last_applied_sequence) AS "snapshotSequence",
          MAX(updated_at) AS "updatedAt"
        FROM projection_state
      `,
  });

  const readProjectionCounts = SqlSchema.findOne({
    Request: Schema.Void,
    Result: ProjectionCountsRowSchema,
    execute: () =>
      sql`
        SELECT
          (SELECT COUNT(*) FROM projection_projects WHERE deleted_at IS NULL) AS "projectCount",
          (SELECT COUNT(*) FROM projection_threads WHERE deleted_at IS NULL) AS "threadCount"
      `,
  });

  const getFirstThreadByProject = SqlSchema.findOneOption({
    Request: ProjectIdLookupInput,
    Result: Schema.Struct({ threadId: ThreadId }),
    execute: ({ projectId }) =>
      sql`
        SELECT
          thread_id AS "threadId"
        FROM projection_threads
        WHERE project_id = ${projectId}
          AND deleted_at IS NULL
        ORDER BY created_at ASC, thread_id ASC
        LIMIT 1
      `,
  });

  const getThreadRow = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          folder_slug AS "folderSlug",
          title,
          branch,
          worktree_path AS "worktreePath",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          model_selection_json AS "modelSelection",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt"
        FROM projection_threads
        WHERE thread_id = ${threadId}
          AND deleted_at IS NULL
        LIMIT 1
      `,
  });

  const listTurnRowsByThreadId = SqlSchema.findAll({
    Request: ThreadIdLookupInput,
    Result: ProjectionTurnRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          row_id AS "rowId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          pending_message_id AS "pendingMessageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          assistant_message_id AS "assistantMessageId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "checkpointStatus",
          checkpoint_files_json AS "checkpointFiles"
        FROM projection_turns
        WHERE thread_id = ${threadId}
        ORDER BY requested_at ASC, row_id ASC
      `,
  });

  const getSnapshot: ProjectionSnapshotQueryShape["getSnapshot"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [
            projectRows,
            threadRows,
            messageRows,
            sessionRows,
            proposedPlanRows,
            activityRows,
            turnRows,
            projectionStateSummary,
            projectStateRows,
            threadStateRows,
            settings,
          ] = yield* Effect.all([
            listProjectRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlError("ProjectionSnapshotQuery.getSnapshot:listProjects:query"),
              ),
            ),
            listThreadRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlError("ProjectionSnapshotQuery.getSnapshot:listThreads:query"),
              ),
            ),
            listMessageRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlError("ProjectionSnapshotQuery.getSnapshot:listMessages:query"),
              ),
            ),
            listSessionRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlError("ProjectionSnapshotQuery.getSnapshot:listSessions:query"),
              ),
            ),
            listProposedPlanRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlError(
                  "ProjectionSnapshotQuery.getSnapshot:listProposedPlans:query",
                ),
              ),
            ),
            listActivityRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlError("ProjectionSnapshotQuery.getSnapshot:listActivities:query"),
              ),
            ),
            listTurnRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlError("ProjectionSnapshotQuery.getSnapshot:listTurns:query"),
              ),
            ),
            readProjectionStateSummary(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlError("ProjectionSnapshotQuery.getSnapshot:readProjectionState:query"),
              ),
            ),
            deviceStateRepository.listByPrefix({ prefix: PROJECT_METADATA_PREFIX }),
            deviceStateRepository.listByPrefix({ prefix: THREAD_METADATA_PREFIX }),
            serverSettingsService.getSettings.pipe(
              Effect.mapError(
                toPersistenceSqlError("ProjectionSnapshotQuery.getSnapshot:getSettings:query"),
              ),
            ),
          ]);

          const projectMetadataById = new Map<string, WorkspaceMetadata>();
          for (const row of projectStateRows) {
            const metadata = parseWorkspaceMetadata(row.valueJson);
            if (metadata !== null) {
              projectMetadataById.set(row.key.slice(PROJECT_METADATA_PREFIX.length), metadata);
            }
          }

          const threadMetadataById = new Map<string, WorkspaceMetadata>();
          for (const row of threadStateRows) {
            const metadata = parseWorkspaceMetadata(row.valueJson);
            if (metadata !== null) {
              threadMetadataById.set(row.key.slice(THREAD_METADATA_PREFIX.length), metadata);
            }
          }

          const messagesByThread = new Map<string, Array<OrchestrationThread["messages"][number]>>();
          for (const row of messageRows) {
            const threadMessages = messagesByThread.get(row.threadId) ?? [];
            threadMessages.push({
              id: row.messageId,
              role: row.role,
              text: row.text,
              ...(row.attachments !== null && row.attachments.length > 0
                ? { attachments: row.attachments }
                : {}),
              turnId: row.turnId,
              streaming: row.isStreaming !== 0,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            });
            messagesByThread.set(row.threadId, threadMessages);
          }

          const sessionsByThread = new Map<string, OrchestrationThread["session"]>();
          for (const row of sessionRows) {
            sessionsByThread.set(row.threadId, {
              threadId: row.threadId,
              status: row.status,
              providerName: row.providerName,
              runtimeMode: row.runtimeMode,
              activeTurnId: row.activeTurnId,
              lastError: row.lastError,
              updatedAt: row.updatedAt,
            });
          }

          const proposedPlansByThread = new Map<
            string,
            Array<OrchestrationThread["proposedPlans"][number]>
          >();
          for (const row of proposedPlanRows) {
            const threadPlans = proposedPlansByThread.get(row.threadId) ?? [];
            threadPlans.push({
              id: row.planId,
              turnId: row.turnId,
              planMarkdown: row.planMarkdown,
              implementedAt: row.implementedAt,
              implementationThreadId: row.implementationThreadId,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            });
            proposedPlansByThread.set(row.threadId, threadPlans);
          }

          const activitiesByThread = new Map<
            string,
            Array<OrchestrationThread["activities"][number]>
          >();
          for (const row of activityRows) {
            const threadActivities = activitiesByThread.get(row.threadId) ?? [];
            threadActivities.push({
              id: row.activityId,
              turnId: row.turnId,
              tone: row.tone,
              kind: row.kind,
              summary: row.summary,
              payload: row.payload,
              ...(row.sequence !== null ? { sequence: row.sequence } : {}),
              createdAt: row.createdAt,
            });
            activitiesByThread.set(row.threadId, threadActivities);
          }
          for (const [threadId, threadActivities] of activitiesByThread) {
            activitiesByThread.set(
              threadId,
              threadActivities.toSorted(compareActivities),
            );
          }

          const turnsByThread = new Map<string, Array<ProjectionTurnRow>>();
          for (const row of turnRows) {
            const threadTurns = turnsByThread.get(row.threadId) ?? [];
            threadTurns.push(row);
            turnsByThread.set(row.threadId, threadTurns);
          }

          let updatedAt = projectionStateSummary.updatedAt;
          for (const row of projectRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of threadRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of messageRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of sessionRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of proposedPlanRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of activityRows) {
            updatedAt = maxIso(updatedAt, row.createdAt);
          }
          for (const row of projectStateRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of threadStateRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }

          const projects = projectRows.map((row) => ({
            id: row.projectId,
            title: row.title,
            folderSlug: row.folderSlug,
            defaultModelSelection: row.defaultModelSelection,
            scripts: row.scripts,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          }));

          const threads: ReadonlyArray<OrchestrationThread> = threadRows.map((row) => {
            const threadTurns = turnsByThread.get(row.threadId) ?? [];
            const session = sessionsByThread.get(row.threadId) ?? null;
            return {
              id: row.threadId,
              projectId: row.projectId,
              folderSlug: row.folderSlug,
              resolvedWorkspacePath: resolveThreadWorkspacePath({
                settingsWorkspaceRoot: settings.workspaceRoot,
                threadId: row.threadId,
                projectId: row.projectId,
                projectMetadataById,
                threadMetadataById,
              }),
              title: row.title,
              modelSelection: row.modelSelection,
              runtimeMode: row.runtimeMode,
              interactionMode: row.interactionMode,
              branch: row.branch,
              worktreePath: row.worktreePath,
              latestTurn: buildLatestTurn({
                sessionActiveTurnId: session?.activeTurnId ?? null,
                threadLatestTurnId: row.latestTurnId,
                turns: threadTurns,
              }),
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              archivedAt: row.archivedAt,
              deletedAt: row.deletedAt,
              messages: messagesByThread.get(row.threadId) ?? [],
              proposedPlans: proposedPlansByThread.get(row.threadId) ?? [],
              activities: activitiesByThread.get(row.threadId) ?? [],
              checkpoints: buildCheckpointsFromTurns(threadTurns),
              session,
            };
          });

          return yield* decodeReadModel({
            snapshotSequence: projectionStateSummary.snapshotSequence ?? 0,
            projects,
            threads,
            updatedAt: updatedAt ?? new Date(0).toISOString(),
          }).pipe(
            Effect.mapError(
              toPersistenceDecodeError("ProjectionSnapshotQuery.getSnapshot:decodeReadModel"),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getSnapshot:query")(error);
        }),
      );

  const getCounts: ProjectionSnapshotQueryShape["getCounts"] = () =>
    readProjectionCounts(undefined).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionSnapshotQuery.getCounts:query")),
      Effect.map((row) => ({
        projectCount: row.projectCount,
        threadCount: row.threadCount,
      })),
    );

  const getFirstActiveThreadIdByProjectId: ProjectionSnapshotQueryShape["getFirstActiveThreadIdByProjectId"] =
    (projectId) =>
      getFirstThreadByProject({ projectId }).pipe(
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionSnapshotQuery.getFirstActiveThreadIdByProjectId:getFirstThread:query",
          ),
        ),
        Effect.flatMap((threadRow) =>
          Option.match(threadRow, {
            onNone: () => Effect.succeed(Option.none<ThreadId>()),
            onSome: (row) => Effect.succeed(Option.some(row.threadId)),
          }),
        ),
      );

  const getThreadCheckpointContext: ProjectionSnapshotQueryShape["getThreadCheckpointContext"] = (
    threadId,
  ) =>
    Effect.gen(function* () {
      const threadRow = yield* getThreadRow({ threadId }).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionSnapshotQuery.getThreadCheckpointContext:getThread:query"),
        ),
      );
      if (Option.isNone(threadRow)) {
        return Option.none<ProjectionThreadCheckpointContext>();
      }

      const [turnRows, threadStateRow, settings, projectStateRow] = yield* Effect.all([
        listTurnRowsByThreadId({ threadId }).pipe(
          Effect.mapError(
            toPersistenceSqlError("ProjectionSnapshotQuery.getThreadCheckpointContext:listTurns:query"),
          ),
        ),
        deviceStateRepository.getByKey({ key: `${THREAD_METADATA_PREFIX}${threadId}` }),
        serverSettingsService.getSettings.pipe(
          Effect.mapError(
            toPersistenceSqlError(
              "ProjectionSnapshotQuery.getThreadCheckpointContext:getSettings:query",
            ),
          ),
        ),
        threadRow.value.projectId === null
          ? Effect.succeed(Option.none())
          : deviceStateRepository.getByKey({
              key: `${PROJECT_METADATA_PREFIX}${threadRow.value.projectId}`,
            }),
      ]);

      if (Option.isNone(threadStateRow)) {
        return Option.none<ProjectionThreadCheckpointContext>();
      }

      const threadMetadata = parseWorkspaceMetadata(threadStateRow.value.valueJson);
      if (threadMetadata === null) {
        return Option.none<ProjectionThreadCheckpointContext>();
      }

      const projectMetadataById = new Map<string, WorkspaceMetadata>();
      if (threadRow.value.projectId !== null && Option.isSome(projectStateRow)) {
        const projectMetadata = parseWorkspaceMetadata(projectStateRow.value.valueJson);
        if (projectMetadata !== null) {
          projectMetadataById.set(threadRow.value.projectId, projectMetadata);
        }
      }

      return Option.some({
        threadId: threadRow.value.threadId,
        projectId: threadRow.value.projectId,
        resolvedWorkspacePath: resolveThreadWorkspacePath({
          settingsWorkspaceRoot: settings.workspaceRoot,
          threadId: threadRow.value.threadId,
          projectId: threadRow.value.projectId,
          projectMetadataById,
          threadMetadataById: new Map([[threadRow.value.threadId, threadMetadata]]),
        }),
        worktreePath: threadRow.value.worktreePath,
        checkpoints: buildCheckpointsFromTurns(turnRows),
      });
    });

  return {
    getSnapshot,
    getCounts,
    getFirstActiveThreadIdByProjectId,
    getThreadCheckpointContext,
  } satisfies ProjectionSnapshotQueryShape;
});

export const OrchestrationProjectionSnapshotQueryLive = Layer.effect(
  ProjectionSnapshotQuery,
  makeProjectionSnapshotQuery,
).pipe(Layer.provideMerge(DeviceStateRepositoryLive));
