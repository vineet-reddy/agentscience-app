import {
  ChatAttachment,
  // DEFAULT_PROVIDER_INTERACTION_MODE,
  // DEFAULT_RUNTIME_MODE,
  ModelSelection,
  type ModelSelection as ModelSelectionType,
  OrchestrationReadModel,
  type OrchestrationThread,
  type RuntimeMode,
  type ProviderInteractionMode,
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
  type ProjectionSnapshotCounts,
  type ProjectionThreadCheckpointContext,
  type ProjectionSnapshotQueryShape,
} from "../Services/ProjectionSnapshotQuery.ts";

const PROJECT_METADATA_PREFIX = "local.project.";
const THREAD_METADATA_PREFIX = "local.thread.";

const decodeReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);

const ProjectMetadataSchema = Schema.Struct({
  defaultModelSelection: Schema.NullOr(Schema.Unknown),
  scripts: Schema.Array(ProjectScript),
  deletedAt: Schema.NullOr(Schema.String),
});
type ProjectMetadata = {
  readonly defaultModelSelection: ModelSelectionType | null;
  readonly scripts: ReadonlyArray<typeof ProjectScript.Type>;
  readonly deletedAt: string | null;
  readonly workspaceRoot: string | null;
};

const ThreadMetadataSchema = Schema.Struct({
  modelSelection: Schema.Unknown,
  runtimeMode: Schema.String,
  interactionMode: Schema.String,
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  deletedAt: Schema.NullOr(Schema.String),
});
type ThreadMetadata = {
  readonly modelSelection: ModelSelectionType;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly deletedAt: string | null;
  readonly workspaceRoot: string | null;
};

const MessageMetadataSchema = Schema.Struct({
  turnId: Schema.NullOr(Schema.String),
  attachments: Schema.optional(Schema.Array(Schema.Unknown)),
  updatedAt: Schema.String,
  streaming: Schema.Boolean,
});
type MessageMetadata = {
  readonly turnId: TurnId | null;
  readonly attachments?: ReadonlyArray<ChatAttachment>;
  readonly updatedAt: string;
  readonly streaming: boolean;
};

const ProjectRowSchema = Schema.Struct({
  projectId: ProjectId,
  folderSlug: Schema.String,
  title: Schema.String,
  defaultChatId: Schema.NullOr(ThreadId),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  archivedAt: Schema.NullOr(Schema.String),
});

const ThreadRowSchema = Schema.Struct({
  threadId: ThreadId,
  projectId: Schema.NullOr(ProjectId),
  folderSlug: Schema.String,
  title: Schema.String,
  lastMessageAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  archivedAt: Schema.NullOr(Schema.String),
});

const MessageRowSchema = Schema.Struct({
  messageId: Schema.String,
  chatId: ThreadId,
  projectId: Schema.NullOr(ProjectId),
  role: Schema.String,
  contentMarkdown: Schema.String,
  clientCreatedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  sequenceNo: Schema.Number,
  metadataJson: Schema.String,
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

const decodeProjectMetadataSchema = Schema.decodeUnknownSync(ProjectMetadataSchema);
const decodeThreadMetadataSchema = Schema.decodeUnknownSync(ThreadMetadataSchema);
const decodeMessageMetadataSchema = Schema.decodeUnknownSync(MessageMetadataSchema);
const decodeModelSelection = Schema.decodeUnknownSync(ModelSelection);
const decodeRuntimeMode = Schema.decodeUnknownSync(
  Schema.Literals(["full-access", "approval-required"]),
);
const decodeInteractionMode = Schema.decodeUnknownSync(Schema.Literals(["default", "plan"]));
const decodeAttachments = Schema.decodeUnknownSync(Schema.Array(ChatAttachment));
const decodeTurnId = Schema.decodeUnknownSync(TurnId);

function parseProjectMetadata(valueJson: string): ProjectMetadata | null {
  const parsedJson = parseJson(valueJson);
  if (parsedJson === null) {
    return null;
  }
  let parsed: typeof ProjectMetadataSchema.Type;
  try {
    parsed = decodeProjectMetadataSchema(parsedJson);
  } catch {
    return null;
  }
  const modelSelectionRaw = parsed.defaultModelSelection;
  let decodedModelSelection: ModelSelection | null = null;
  if (modelSelectionRaw !== null) {
    try {
      decodedModelSelection = decodeModelSelection(modelSelectionRaw);
    } catch {
      decodedModelSelection = null;
    }
  }
  return {
    defaultModelSelection: decodedModelSelection,
    scripts: parsed.scripts,
    deletedAt: parsed.deletedAt,
    workspaceRoot:
      typeof (parsedJson as { workspaceRoot?: unknown }).workspaceRoot === "string"
        ? (parsedJson as { workspaceRoot: string }).workspaceRoot
        : null,
  };
}

function parseThreadMetadata(valueJson: string): ThreadMetadata | null {
  const parsedJson = parseJson(valueJson);
  if (parsedJson === null) {
    return null;
  }
  let parsed: typeof ThreadMetadataSchema.Type;
  try {
    parsed = decodeThreadMetadataSchema(parsedJson);
  } catch {
    return null;
  }
  try {
    return {
      modelSelection: decodeModelSelection(parsed.modelSelection),
      runtimeMode: decodeRuntimeMode(parsed.runtimeMode) as RuntimeMode,
      interactionMode: decodeInteractionMode(parsed.interactionMode) as ProviderInteractionMode,
      branch: parsed.branch,
      worktreePath: parsed.worktreePath,
      deletedAt: parsed.deletedAt,
      workspaceRoot:
        typeof (parsedJson as { workspaceRoot?: unknown }).workspaceRoot === "string"
          ? (parsedJson as { workspaceRoot: string }).workspaceRoot
          : null,
    };
  } catch {
    return null;
  }
}

function parseMessageMetadata(valueJson: string): MessageMetadata | null {
  const parsedJson = parseJson(valueJson);
  if (parsedJson === null) {
    return null;
  }
  let parsed: typeof MessageMetadataSchema.Type;
  try {
    parsed = decodeMessageMetadataSchema(parsedJson);
  } catch {
    return null;
  }
  let attachments: ReadonlyArray<ChatAttachment> | undefined;
  if (parsed.attachments !== undefined) {
    try {
      attachments = decodeAttachments(parsed.attachments);
    } catch {
      attachments = undefined;
    }
  }
  let turnId: TurnId | null = null;
  if (parsed.turnId !== null) {
    try {
      turnId = decodeTurnId(parsed.turnId);
    } catch {
      turnId = null;
    }
  }
  return {
    turnId,
    ...(attachments !== undefined ? { attachments } : {}),
    updatedAt: parsed.updatedAt,
    streaming: parsed.streaming,
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
  readonly projectMetadataById: ReadonlyMap<string, ProjectMetadata>;
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
  readonly projectMetadataById: ReadonlyMap<string, ProjectMetadata>;
  readonly threadMetadataById: ReadonlyMap<string, ThreadMetadata>;
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

const makeProjectionSnapshotQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const deviceStateRepository = yield* DeviceStateRepository;
  const serverSettingsService = yield* ServerSettingsService;

  const listProjectRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectRowSchema,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          folder_slug AS "folderSlug",
          title,
          default_chat_id AS "defaultChatId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt"
        FROM research_projects
        ORDER BY created_at ASC, project_id ASC
      `,
  });

  const listThreadRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ThreadRowSchema,
    execute: () =>
      sql`
        SELECT
          chat_id AS "threadId",
          project_id AS "projectId",
          folder_slug AS "folderSlug",
          title,
          last_message_at AS "lastMessageAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt"
        FROM research_chats
        ORDER BY created_at ASC, chat_id ASC
      `,
  });

  const listMessageRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: MessageRowSchema,
    execute: () =>
      sql`
        SELECT
          message_id AS "messageId",
          chat_id AS "chatId",
          project_id AS "projectId",
          role,
          content_markdown AS "contentMarkdown",
          client_created_at AS "clientCreatedAt",
          created_at AS "createdAt",
          sequence_no AS "sequenceNo",
          metadata_json AS "metadataJson"
        FROM chat_messages
        ORDER BY chat_id ASC, sequence_no ASC, created_at ASC, message_id ASC
      `,
  });

  const readProjectionCounts = SqlSchema.findOne({
    Request: Schema.Void,
    Result: ProjectionCountsRowSchema,
    execute: () =>
      sql`
        SELECT
          (SELECT COUNT(*) FROM research_projects) AS "projectCount",
          (SELECT COUNT(*) FROM research_chats) AS "threadCount"
      `,
  });

  const getFirstThreadByProject = SqlSchema.findOneOption({
    Request: ProjectIdLookupInput,
    Result: Schema.Struct({ threadId: ThreadId }),
    execute: ({ projectId }) =>
      sql`
        SELECT
          chat_id AS "threadId"
        FROM research_chats
        WHERE project_id = ${projectId}
        ORDER BY created_at ASC, chat_id ASC
        LIMIT 1
      `,
  });

  const getThreadRow = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ThreadRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          chat_id AS "threadId",
          project_id AS "projectId",
          folder_slug AS "folderSlug",
          title,
          last_message_at AS "lastMessageAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt"
        FROM research_chats
        WHERE chat_id = ${threadId}
        LIMIT 1
      `,
  });

  const getSnapshot: ProjectionSnapshotQueryShape["getSnapshot"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [projectRows, threadRows, messageRows, projectStateRows, threadStateRows] =
            yield* Effect.all([
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
              deviceStateRepository.listByPrefix({ prefix: PROJECT_METADATA_PREFIX }),
              deviceStateRepository.listByPrefix({ prefix: THREAD_METADATA_PREFIX }),
            ]);
          const settings = yield* serverSettingsService.getSettings;

          const projectMetadataById = new Map<string, ProjectMetadata>();
          for (const row of projectStateRows) {
            const metadata = parseProjectMetadata(row.valueJson);
            if (metadata !== null) {
              projectMetadataById.set(row.key.slice(PROJECT_METADATA_PREFIX.length), metadata);
            }
          }

          const threadMetadataById = new Map<string, ThreadMetadata>();
          for (const row of threadStateRows) {
            const metadata = parseThreadMetadata(row.valueJson);
            if (metadata !== null) {
              threadMetadataById.set(row.key.slice(THREAD_METADATA_PREFIX.length), metadata);
            }
          }

          const messagesByThread = new Map<string, Array<OrchestrationThread["messages"][number]>>();
          let updatedAt: string | null = null;

          for (const row of projectRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of threadRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
            updatedAt = maxIso(updatedAt, row.lastMessageAt);
          }

          for (const row of messageRows) {
            const metadata = parseMessageMetadata(row.metadataJson);
            const threadMessages = messagesByThread.get(row.chatId) ?? [];
            threadMessages.push({
              id: row.messageId as never,
              role: row.role as never,
              text: row.contentMarkdown,
              ...(metadata?.attachments !== undefined ? { attachments: metadata.attachments } : {}),
              turnId: metadata?.turnId ?? null,
              streaming: metadata?.streaming ?? false,
              createdAt: row.createdAt,
              updatedAt: metadata?.updatedAt ?? row.createdAt,
            });
            messagesByThread.set(row.chatId, threadMessages);
            updatedAt = maxIso(updatedAt, metadata?.updatedAt ?? row.createdAt);
          }

          const projects: ReadonlyArray<OrchestrationReadModel["projects"][number]> =
            projectRows.flatMap((row) => {
              const metadata = projectMetadataById.get(row.projectId);
              return [
                {
                  id: row.projectId,
                  title: row.title,
                  folderSlug: row.folderSlug,
                  defaultModelSelection: metadata?.defaultModelSelection ?? null,
                  scripts: [...(metadata?.scripts ?? [])],
                  createdAt: row.createdAt,
                  updatedAt: row.updatedAt,
                  deletedAt: metadata?.deletedAt ?? null,
                },
              ];
            });

          const threads: ReadonlyArray<OrchestrationThread> = threadRows.flatMap((row) => {
            const metadata = threadMetadataById.get(row.threadId);
            if (!metadata) {
              return [];
            }
            return [
              {
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
                modelSelection: metadata.modelSelection,
                runtimeMode: metadata.runtimeMode,
                interactionMode: metadata.interactionMode,
                branch: metadata.branch,
                worktreePath: metadata.worktreePath,
                latestTurn: null,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                archivedAt: row.archivedAt,
                deletedAt: metadata.deletedAt,
                messages: messagesByThread.get(row.threadId) ?? [],
                proposedPlans: [],
                activities: [],
                checkpoints: [],
                session: null,
              },
            ];
          });

          return yield* decodeReadModel({
            snapshotSequence: 0,
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
      Effect.map(
        (row): ProjectionSnapshotCounts => ({
          projectCount: row.projectCount,
          threadCount: row.threadCount,
        }),
      ),
    );

  const getFirstActiveThreadIdByProjectId: ProjectionSnapshotQueryShape["getFirstActiveThreadIdByProjectId"] =
    (projectId) =>
      Effect.gen(function* () {
        const [threadRow, metadataRows] = yield* Effect.all([
          getFirstThreadByProject({ projectId }).pipe(
            Effect.mapError(
              toPersistenceSqlError(
                "ProjectionSnapshotQuery.getFirstActiveThreadIdByProjectId:getFirstThread:query",
              ),
            ),
          ),
          deviceStateRepository.listByPrefix({ prefix: THREAD_METADATA_PREFIX }),
        ]);
        if (Option.isNone(threadRow)) {
          return Option.none<ThreadId>();
        }
        const deletedById = new Map<string, string | null>();
        for (const row of metadataRows) {
          const metadata = parseThreadMetadata(row.valueJson);
          if (metadata !== null) {
            deletedById.set(row.key.slice(THREAD_METADATA_PREFIX.length), metadata.deletedAt);
          }
        }
        return deletedById.get(threadRow.value.threadId) === null
          ? Option.some(threadRow.value.threadId)
          : Option.none<ThreadId>();
      });

  const getThreadCheckpointContext: ProjectionSnapshotQueryShape["getThreadCheckpointContext"] = (
    threadId,
  ) =>
    Effect.gen(function* () {
      const [threadRow, threadMetadataRow] = yield* Effect.all([
        getThreadRow({ threadId }).pipe(
          Effect.mapError(
            toPersistenceSqlError("ProjectionSnapshotQuery.getThreadCheckpointContext:getThread:query"),
          ),
        ),
        deviceStateRepository.getByKey({ key: `${THREAD_METADATA_PREFIX}${threadId}` }),
      ]);
      if (Option.isNone(threadRow) || Option.isNone(threadMetadataRow)) {
        return Option.none<ProjectionThreadCheckpointContext>();
      }
      const threadMetadata = parseThreadMetadata(threadMetadataRow.value.valueJson);
      if (threadMetadata === null) {
        return Option.none<ProjectionThreadCheckpointContext>();
      }
      const settings = yield* serverSettingsService.getSettings.pipe(
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionSnapshotQuery.getThreadCheckpointContext:getSettings:query",
          ),
        ),
      );
      const projectStateRows = yield* deviceStateRepository.listByPrefix({
        prefix: PROJECT_METADATA_PREFIX,
      });
      const projectMetadataById = new Map<string, ProjectMetadata>();
      for (const row of projectStateRows) {
        const metadata = parseProjectMetadata(row.valueJson);
        if (metadata !== null) {
          projectMetadataById.set(row.key.slice(PROJECT_METADATA_PREFIX.length), metadata);
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
        worktreePath: threadMetadata.worktreePath,
        checkpoints: [],
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
