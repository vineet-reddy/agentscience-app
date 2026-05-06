import { inspect } from "node:util";
import {
  ApprovalRequestId,
  type ChatAttachment,
  type OrchestrationEvent,
  type WorkspaceKind,
} from "@agentscience/contracts";
import { Effect, FileSystem, Layer, Option, Path, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  isPersistenceError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../../persistence/Errors.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { ProjectionPendingApprovalRepository } from "../../persistence/Services/ProjectionPendingApprovals.ts";
import { ProjectionProjectRepository } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionStateRepository } from "../../persistence/Services/ProjectionState.ts";
import { ProjectionThreadActivityRepository } from "../../persistence/Services/ProjectionThreadActivities.ts";
import { type ProjectionThreadActivity } from "../../persistence/Services/ProjectionThreadActivities.ts";
import { DeviceStateRepository } from "../../persistence/Services/DeviceState.ts";
import {
  type ProjectionThreadMessage,
  ProjectionThreadMessageRepository,
} from "../../persistence/Services/ProjectionThreadMessages.ts";
import {
  type ProjectionThreadProposedPlan,
  ProjectionThreadProposedPlanRepository,
} from "../../persistence/Services/ProjectionThreadProposedPlans.ts";
import { ProjectionThreadSessionRepository } from "../../persistence/Services/ProjectionThreadSessions.ts";
import {
  type ProjectionTurn,
  ProjectionTurnRepository,
} from "../../persistence/Services/ProjectionTurns.ts";
import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import { ProjectionPendingApprovalRepositoryLive } from "../../persistence/Layers/ProjectionPendingApprovals.ts";
import { ProjectionProjectRepositoryLive } from "../../persistence/Layers/ProjectionProjects.ts";
import { ProjectionStateRepositoryLive } from "../../persistence/Layers/ProjectionState.ts";
import { ProjectionThreadActivityRepositoryLive } from "../../persistence/Layers/ProjectionThreadActivities.ts";
import { ProjectionThreadMessageRepositoryLive } from "../../persistence/Layers/ProjectionThreadMessages.ts";
import { ProjectionThreadProposedPlanRepositoryLive } from "../../persistence/Layers/ProjectionThreadProposedPlans.ts";
import { ProjectionThreadSessionRepositoryLive } from "../../persistence/Layers/ProjectionThreadSessions.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import { ProjectionThreadRepositoryLive } from "../../persistence/Layers/ProjectionThreads.ts";
import { DeviceStateRepositoryLive } from "../../persistence/Layers/DeviceState.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  OrchestrationProjectionPipeline,
  type OrchestrationProjectionPipelineShape,
} from "../Services/ProjectionPipeline.ts";
import {
  attachmentRelativePath,
  parseAttachmentIdFromRelativePath,
  parseThreadSegmentFromAttachmentId,
  toSafeThreadAttachmentSegment,
} from "../../attachmentStore.ts";
import { WorkspaceLayout } from "../../workspace/Services/WorkspaceLayout.ts";
import { WorkspaceLayoutLive } from "../../workspace/Layers/WorkspaceLayout.ts";
import { WorkspacePathsLive } from "../../workspace/Layers/WorkspacePaths.ts";
import {
  getValidatedAgentWorkspaceRoot,
  getValidatedPaperWorkspaceRoot,
  getValidatedProjectWorkspaceRoot,
  rebaseWorkspaceRoot,
  resolveManagedAgentWorkspaceRoot,
  resolveManagedPaperWorkspaceRoot,
  resolveManagedProjectWorkspaceRoot,
} from "../../workspace/roots.ts";

const LOCAL_USER_ID = "local-user";
const LOCAL_SHARING_STRATEGY = "local_only";
const LOCAL_SYNC_STATE = "local_only";
const PROJECT_METADATA_PREFIX = "local.project.";
const THREAD_METADATA_PREFIX = "local.thread.";
const MESSAGE_METADATA_PREFIX = "local.message.";

function projectMetadataKey(projectId: string): string {
  return `${PROJECT_METADATA_PREFIX}${projectId}`;
}

function threadMetadataKey(threadId: string): string {
  return `${THREAD_METADATA_PREFIX}${threadId}`;
}

function messageMetadataKey(messageId: string): string {
  return `${MESSAGE_METADATA_PREFIX}${messageId}`;
}

export const ORCHESTRATION_PROJECTOR_NAMES = {
  projects: "projection.projects",
  threads: "projection.threads",
  threadMessages: "projection.thread-messages",
  threadProposedPlans: "projection.thread-proposed-plans",
  threadActivities: "projection.thread-activities",
  threadSessions: "projection.thread-sessions",
  threadTurns: "projection.thread-turns",
  checkpoints: "projection.checkpoints",
  pendingApprovals: "projection.pending-approvals",
} as const;

type ProjectorName =
  (typeof ORCHESTRATION_PROJECTOR_NAMES)[keyof typeof ORCHESTRATION_PROJECTOR_NAMES];

interface ProjectorDefinition {
  readonly name: ProjectorName;
  readonly apply: (
    event: OrchestrationEvent,
    attachmentSideEffects: AttachmentSideEffects,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

interface AttachmentSideEffects {
  readonly deletedThreadIds: Set<string>;
  readonly prunedThreadRelativePaths: Map<string, Set<string>>;
  readonly workspaceOperations: WorkspaceSideEffect[];
}

type WorkspaceSideEffect =
  | {
      readonly type: "project.create";
      readonly containerRoot: string;
      readonly projectWorkspaceRoot: string;
    }
  | {
      readonly type: "paper.create";
      readonly containerRoot: string;
      readonly paperWorkspaceRoot: string;
      readonly projectWorkspaceRoot?: string | null;
    }
  | {
      readonly type: "agent.create";
      readonly containerRoot: string;
      readonly agentWorkspaceRoot: string;
      readonly projectWorkspaceRoot?: string | null;
    }
  | {
      readonly type: "paper.move";
      readonly containerRoot: string;
      readonly fromPaperWorkspaceRoot: string;
      readonly fromProjectWorkspaceRoot?: string | null;
      readonly toPaperWorkspaceRoot: string;
      readonly toProjectWorkspaceRoot?: string | null;
    }
  | {
      readonly type: "agent.move";
      readonly containerRoot: string;
      readonly fromAgentWorkspaceRoot: string;
      readonly fromProjectWorkspaceRoot?: string | null;
      readonly toAgentWorkspaceRoot: string;
      readonly toProjectWorkspaceRoot?: string | null;
    }
  | {
      readonly type: "workspace.rootChange";
      readonly newRoot: string;
    };

interface StoredProjectMetadata {
  readonly defaultModelSelection: unknown;
  readonly scripts: ReadonlyArray<unknown>;
  readonly deletedAt: string | null;
  readonly workspaceRoot: string | null;
}

interface StoredThreadMetadata {
  readonly modelSelection: unknown;
  readonly runtimeMode: string;
  readonly interactionMode: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly deletedAt: string | null;
  readonly workspaceRoot: string | null;
  readonly workspaceKind: WorkspaceKind;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseStoredProjectMetadata(valueJson: string): StoredProjectMetadata | null {
  try {
    const parsed = JSON.parse(valueJson);
    if (!isRecord(parsed)) {
      return null;
    }
    return {
      defaultModelSelection: parsed.defaultModelSelection ?? null,
      scripts: Array.isArray(parsed.scripts) ? parsed.scripts : [],
      deletedAt: typeof parsed.deletedAt === "string" ? parsed.deletedAt : null,
      workspaceRoot: typeof parsed.workspaceRoot === "string" ? parsed.workspaceRoot : null,
    };
  } catch {
    return null;
  }
}

function parseStoredThreadMetadata(valueJson: string): StoredThreadMetadata | null {
  try {
    const parsed = JSON.parse(valueJson);
    if (!isRecord(parsed)) {
      return null;
    }
    return {
      modelSelection: parsed.modelSelection ?? null,
      runtimeMode:
        typeof parsed.runtimeMode === "string" ? parsed.runtimeMode : "approval-required",
      interactionMode:
        typeof parsed.interactionMode === "string" ? parsed.interactionMode : "default",
      branch: typeof parsed.branch === "string" ? parsed.branch : null,
      worktreePath: typeof parsed.worktreePath === "string" ? parsed.worktreePath : null,
      deletedAt: typeof parsed.deletedAt === "string" ? parsed.deletedAt : null,
      workspaceRoot: typeof parsed.workspaceRoot === "string" ? parsed.workspaceRoot : null,
      workspaceKind: parsed.workspaceKind === "agent" ? "agent" : "paper",
    };
  } catch {
    return null;
  }
}

function inferWorkspaceKindFromWorkflowMode(
  workflowMode: string | null | undefined,
): WorkspaceKind {
  return workflowMode && workflowMode !== "open" ? "agent" : "paper";
}

function resolveManagedThreadWorkspaceRoot(input: {
  readonly workspaceKind: WorkspaceKind;
  readonly containerRoot: string;
  readonly projectWorkspaceRoot: string | null;
  readonly folderSlug: string;
}): string {
  return input.workspaceKind === "agent"
    ? resolveManagedAgentWorkspaceRoot(input)
    : resolveManagedPaperWorkspaceRoot(input);
}

function workspaceCreateOperation(input: {
  readonly workspaceKind: WorkspaceKind;
  readonly containerRoot: string;
  readonly workspaceRoot: string;
  readonly projectWorkspaceRoot: string | null;
}): AttachmentSideEffects["workspaceOperations"][number] {
  return input.workspaceKind === "agent"
    ? {
        type: "agent.create",
        containerRoot: input.containerRoot,
        agentWorkspaceRoot: input.workspaceRoot,
        projectWorkspaceRoot: input.projectWorkspaceRoot,
      }
    : {
        type: "paper.create",
        containerRoot: input.containerRoot,
        paperWorkspaceRoot: input.workspaceRoot,
        projectWorkspaceRoot: input.projectWorkspaceRoot,
      };
}

function workspaceMoveOperation(input: {
  readonly workspaceKind: WorkspaceKind;
  readonly containerRoot: string;
  readonly fromWorkspaceRoot: string;
  readonly fromProjectWorkspaceRoot: string | null;
  readonly toWorkspaceRoot: string;
  readonly toProjectWorkspaceRoot: string | null;
}): AttachmentSideEffects["workspaceOperations"][number] {
  return input.workspaceKind === "agent"
    ? {
        type: "agent.move",
        containerRoot: input.containerRoot,
        fromAgentWorkspaceRoot: input.fromWorkspaceRoot,
        fromProjectWorkspaceRoot: input.fromProjectWorkspaceRoot,
        toAgentWorkspaceRoot: input.toWorkspaceRoot,
        toProjectWorkspaceRoot: input.toProjectWorkspaceRoot,
      }
    : {
        type: "paper.move",
        containerRoot: input.containerRoot,
        fromPaperWorkspaceRoot: input.fromWorkspaceRoot,
        fromProjectWorkspaceRoot: input.fromProjectWorkspaceRoot,
        toPaperWorkspaceRoot: input.toWorkspaceRoot,
        toProjectWorkspaceRoot: input.toProjectWorkspaceRoot,
      };
}

const materializeAttachmentsForProjection = Effect.fn("materializeAttachmentsForProjection")(
  (input: { readonly attachments: ReadonlyArray<ChatAttachment> }) =>
    Effect.succeed(input.attachments.length === 0 ? [] : input.attachments),
);

function toProjectionSqlOrPersistenceError(operation: string) {
  return (cause: unknown): ProjectionRepositoryError =>
    isPersistenceError(cause) ? cause : toPersistenceSqlError(operation)(cause);
}

function describeErrorForLog(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: describeErrorForLog(error.cause),
    };
  }

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    return {
      ...record,
      ...(record.cause !== undefined ? { cause: describeErrorForLog(record.cause) } : {}),
    };
  }

  return error;
}

function extractActivityRequestId(payload: unknown): ApprovalRequestId | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const requestId = (payload as Record<string, unknown>).requestId;
  return typeof requestId === "string" ? ApprovalRequestId.makeUnsafe(requestId) : null;
}

function retainProjectionMessagesAfterRevert(
  messages: ReadonlyArray<ProjectionThreadMessage>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionThreadMessage> {
  const retainedMessageIds = new Set<string>();
  const retainedTurnIds = new Set<string>();
  const keptTurns = turns.filter(
    (turn) =>
      turn.turnId !== null &&
      turn.checkpointTurnCount !== null &&
      turn.checkpointTurnCount <= turnCount,
  );
  for (const turn of keptTurns) {
    if (turn.turnId !== null) {
      retainedTurnIds.add(turn.turnId);
    }
    if (turn.pendingMessageId !== null) {
      retainedMessageIds.add(turn.pendingMessageId);
    }
    if (turn.assistantMessageId !== null) {
      retainedMessageIds.add(turn.assistantMessageId);
    }
  }

  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.messageId);
      continue;
    }
    if (message.turnId !== null && retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(message.messageId);
    }
  }

  const retainedUserCount = messages.filter(
    (message) => message.role === "user" && retainedMessageIds.has(message.messageId),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(message.messageId) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.messageId.localeCompare(right.messageId),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.messageId);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) => message.role === "assistant" && retainedMessageIds.has(message.messageId),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(message.messageId) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.messageId.localeCompare(right.messageId),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.messageId);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.messageId));
}

function retainProjectionActivitiesAfterRevert(
  activities: ReadonlyArray<ProjectionThreadActivity>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionThreadActivity> {
  const retainedTurnIds = new Set<string>(
    turns
      .filter(
        (turn) =>
          turn.turnId !== null &&
          turn.checkpointTurnCount !== null &&
          turn.checkpointTurnCount <= turnCount,
      )
      .flatMap((turn) => (turn.turnId === null ? [] : [turn.turnId])),
  );
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

function retainProjectionProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<ProjectionThreadProposedPlan>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionThreadProposedPlan> {
  const retainedTurnIds = new Set<string>(
    turns
      .filter(
        (turn) =>
          turn.turnId !== null &&
          turn.checkpointTurnCount !== null &&
          turn.checkpointTurnCount <= turnCount,
      )
      .flatMap((turn) => (turn.turnId === null ? [] : [turn.turnId])),
  );
  return proposedPlans.filter(
    (proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId),
  );
}

function collectThreadAttachmentRelativePaths(
  threadId: string,
  messages: ReadonlyArray<ProjectionThreadMessage>,
): Set<string> {
  const threadSegment = toSafeThreadAttachmentSegment(threadId);
  if (!threadSegment) {
    return new Set();
  }
  const relativePaths = new Set<string>();
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachment.id);
      if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) {
        continue;
      }
      relativePaths.add(attachmentRelativePath(attachment));
    }
  }
  return relativePaths;
}

interface AgentScienceMessageMetadata {
  readonly turnId: string | null;
  readonly attachments?: ReadonlyArray<ChatAttachment>;
  readonly updatedAt: string;
  readonly streaming: boolean;
}

function parseAgentScienceMessageMetadata(valueJson: string): AgentScienceMessageMetadata | null {
  try {
    const value = JSON.parse(valueJson) as Record<string, unknown>;
    const turnId = typeof value.turnId === "string" ? value.turnId : null;
    const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : null;
    const streaming = value.streaming === true;
    const attachments = Array.isArray(value.attachments)
      ? (value.attachments as ReadonlyArray<ChatAttachment>)
      : undefined;
    if (updatedAt === null) {
      return null;
    }
    return {
      turnId,
      ...(attachments !== undefined ? { attachments } : {}),
      updatedAt,
      streaming,
    };
  } catch {
    return null;
  }
}

const runAttachmentSideEffects = Effect.fn("runAttachmentSideEffects")(function* (
  sideEffects: AttachmentSideEffects,
) {
  const serverConfig = yield* Effect.service(ServerConfig);
  const fileSystem = yield* Effect.service(FileSystem.FileSystem);
  const path = yield* Effect.service(Path.Path);

  const attachmentsRootDir = serverConfig.attachmentsDir;
  const readAttachmentRootEntries = fileSystem
    .readDirectory(attachmentsRootDir, { recursive: false })
    .pipe(Effect.catch(() => Effect.succeed([] as Array<string>)));

  const removeDeletedThreadAttachmentEntry = Effect.fn("removeDeletedThreadAttachmentEntry")(
    function* (threadSegment: string, entry: string) {
      const normalizedEntry = entry.replace(/^[/\\]+/, "").replace(/\\/g, "/");
      if (normalizedEntry.length === 0 || normalizedEntry.includes("/")) {
        return;
      }
      const attachmentId =
        parseAttachmentIdFromRelativePath(normalizedEntry) ??
        (normalizedEntry.includes(".") ? null : normalizedEntry);
      if (!attachmentId) {
        return;
      }
      const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachmentId);
      if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) {
        return;
      }
      yield* fileSystem.remove(path.join(attachmentsRootDir, normalizedEntry), {
        force: true,
        recursive: true,
      });
    },
  );

  const deleteThreadAttachments = Effect.fn("deleteThreadAttachments")(function* (
    threadId: string,
  ) {
    const threadSegment = toSafeThreadAttachmentSegment(threadId);
    if (!threadSegment) {
      yield* Effect.logWarning("skipping attachment cleanup for unsafe thread id", {
        threadId,
      });
      return;
    }

    const entries = yield* readAttachmentRootEntries;
    yield* Effect.forEach(
      entries,
      (entry) => removeDeletedThreadAttachmentEntry(threadSegment, entry),
      {
        concurrency: 1,
      },
    );
  });

  const pruneThreadAttachmentEntry = Effect.fn("pruneThreadAttachmentEntry")(function* (
    threadSegment: string,
    keptThreadRelativePaths: Set<string>,
    entry: string,
  ) {
    const relativePath = entry.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    if (relativePath.length === 0 || relativePath.includes("/")) {
      return;
    }
    const attachmentId =
      parseAttachmentIdFromRelativePath(relativePath) ??
      (relativePath.includes(".") ? null : relativePath);
    if (!attachmentId) {
      return;
    }
    const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachmentId);
    if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) {
      return;
    }

    const absolutePath = path.join(attachmentsRootDir, relativePath);
    const fileInfo = yield* fileSystem
      .stat(absolutePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || (fileInfo.type !== "File" && fileInfo.type !== "Directory")) {
      return;
    }

    const keepEntry =
      keptThreadRelativePaths.has(relativePath) ||
      Array.from(keptThreadRelativePaths).some((keptPath) =>
        keptPath.startsWith(`${relativePath}/`),
      );
    if (!keepEntry) {
      yield* fileSystem.remove(absolutePath, { force: true, recursive: true });
    }
  });

  const pruneThreadAttachments = Effect.fn("pruneThreadAttachments")(function* (
    threadId: string,
    keptThreadRelativePaths: Set<string>,
  ) {
    if (sideEffects.deletedThreadIds.has(threadId)) {
      return;
    }

    const threadSegment = toSafeThreadAttachmentSegment(threadId);
    if (!threadSegment) {
      yield* Effect.logWarning("skipping attachment prune for unsafe thread id", { threadId });
      return;
    }

    const entries = yield* readAttachmentRootEntries;
    yield* Effect.forEach(
      entries,
      (entry) => pruneThreadAttachmentEntry(threadSegment, keptThreadRelativePaths, entry),
      { concurrency: 1 },
    );
  });

  yield* Effect.forEach(sideEffects.deletedThreadIds, deleteThreadAttachments, {
    concurrency: 1,
  });

  yield* Effect.forEach(
    sideEffects.prunedThreadRelativePaths.entries(),
    ([threadId, keptThreadRelativePaths]) =>
      pruneThreadAttachments(threadId, keptThreadRelativePaths),
    { concurrency: 1 },
  );
});

const makeOrchestrationProjectionPipeline = Effect.fn("makeOrchestrationProjectionPipeline")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    const eventStore = yield* OrchestrationEventStore;
    const projectionStateRepository = yield* ProjectionStateRepository;
    const projectionProjectRepository = yield* ProjectionProjectRepository;
    const projectionThreadRepository = yield* ProjectionThreadRepository;
    const projectionThreadMessageRepository = yield* ProjectionThreadMessageRepository;
    const projectionThreadProposedPlanRepository = yield* ProjectionThreadProposedPlanRepository;
    const projectionThreadActivityRepository = yield* ProjectionThreadActivityRepository;
    const projectionThreadSessionRepository = yield* ProjectionThreadSessionRepository;
    const projectionTurnRepository = yield* ProjectionTurnRepository;
    const projectionPendingApprovalRepository = yield* ProjectionPendingApprovalRepository;
    const deviceStateRepository = yield* DeviceStateRepository;

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverConfig = yield* ServerConfig;
    const workspaceLayout = yield* WorkspaceLayout;
    const serverSettingsService = yield* ServerSettingsService;

    const runWorkspaceSideEffects = Effect.fn("runWorkspaceSideEffects")(function* (
      sideEffects: AttachmentSideEffects,
      options: {
        readonly allowWorkspaceRootChange: boolean;
      },
    ) {
      if (sideEffects.workspaceOperations.length === 0) {
        return;
      }

      const settings = yield* serverSettingsService.getSettings;

      yield* Effect.forEach(sideEffects.workspaceOperations, (operation) => {
        switch (operation.type) {
          case "project.create":
            return workspaceLayout.ensureProjectWorkspace({
              containerRoot: operation.containerRoot,
              projectWorkspaceRoot: operation.projectWorkspaceRoot,
            });

          case "paper.create":
            return workspaceLayout.ensurePaperWorkspace({
              containerRoot: operation.containerRoot,
              paperWorkspaceRoot: operation.paperWorkspaceRoot,
              ...(operation.projectWorkspaceRoot !== undefined
                ? { projectWorkspaceRoot: operation.projectWorkspaceRoot }
                : {}),
            });

          case "agent.create":
            return workspaceLayout.ensureAgentWorkspace({
              containerRoot: operation.containerRoot,
              agentWorkspaceRoot: operation.agentWorkspaceRoot,
              ...(operation.projectWorkspaceRoot !== undefined
                ? { projectWorkspaceRoot: operation.projectWorkspaceRoot }
                : {}),
            });

          case "paper.move":
            return workspaceLayout.movePaperWorkspace({
              containerRoot: operation.containerRoot,
              fromPaperWorkspaceRoot: operation.fromPaperWorkspaceRoot,
              ...(operation.fromProjectWorkspaceRoot !== undefined
                ? { fromProjectWorkspaceRoot: operation.fromProjectWorkspaceRoot }
                : {}),
              toPaperWorkspaceRoot: operation.toPaperWorkspaceRoot,
              ...(operation.toProjectWorkspaceRoot !== undefined
                ? { toProjectWorkspaceRoot: operation.toProjectWorkspaceRoot }
                : {}),
            });

          case "agent.move":
            return workspaceLayout.moveAgentWorkspace({
              containerRoot: operation.containerRoot,
              fromAgentWorkspaceRoot: operation.fromAgentWorkspaceRoot,
              ...(operation.fromProjectWorkspaceRoot !== undefined
                ? { fromProjectWorkspaceRoot: operation.fromProjectWorkspaceRoot }
                : {}),
              toAgentWorkspaceRoot: operation.toAgentWorkspaceRoot,
              ...(operation.toProjectWorkspaceRoot !== undefined
                ? { toProjectWorkspaceRoot: operation.toProjectWorkspaceRoot }
                : {}),
            });

          case "workspace.rootChange":
            if (!options.allowWorkspaceRootChange) {
              return Effect.void;
            }
            if (settings.workspaceRoot === operation.newRoot) {
              return Effect.void;
            }
            return workspaceLayout
              .moveWorkspaceRoot({
                fromWorkspaceRoot: settings.workspaceRoot,
                toWorkspaceRoot: operation.newRoot,
              })
              .pipe(
                Effect.flatMap(() =>
                  serverSettingsService.updateSettings({
                    workspaceRoot: operation.newRoot,
                  }),
                ),
                Effect.asVoid,
              );
        }
      });
    });

    const upsertProjectMetadata = Effect.fn("upsertProjectMetadata")(function* (input: {
      readonly projectId: string;
      readonly defaultModelSelection: OrchestrationEvent["type"] extends never ? never : unknown;
      readonly scripts: ReadonlyArray<unknown>;
      readonly deletedAt: string | null;
      readonly workspaceRoot?: string | null;
      readonly updatedAt: string;
    }) {
      const existingProjectMetadataRow = yield* deviceStateRepository.getByKey({
        key: projectMetadataKey(input.projectId),
      });
      const existingProjectMetadata = Option.isSome(existingProjectMetadataRow)
        ? parseStoredProjectMetadata(existingProjectMetadataRow.value.valueJson)
        : null;
      yield* deviceStateRepository.upsert({
        key: projectMetadataKey(input.projectId),
        valueJson: JSON.stringify({
          defaultModelSelection: input.defaultModelSelection,
          scripts: input.scripts,
          deletedAt: input.deletedAt,
          workspaceRoot:
            input.workspaceRoot !== undefined
              ? input.workspaceRoot
              : (existingProjectMetadata?.workspaceRoot ?? null),
        }),
        updatedAt: input.updatedAt,
      });
    });

    const upsertThreadMetadata = Effect.fn("upsertThreadMetadata")(function* (input: {
      readonly threadId: string;
      readonly modelSelection: unknown;
      readonly runtimeMode: string;
      readonly interactionMode: string;
      readonly branch: string | null;
      readonly worktreePath: string | null;
      readonly deletedAt: string | null;
      readonly workspaceRoot?: string | null;
      readonly workspaceKind?: WorkspaceKind;
      readonly updatedAt: string;
    }) {
      const existingThreadMetadataRow = yield* deviceStateRepository.getByKey({
        key: threadMetadataKey(input.threadId),
      });
      const existingThreadMetadata = Option.isSome(existingThreadMetadataRow)
        ? parseStoredThreadMetadata(existingThreadMetadataRow.value.valueJson)
        : null;
      yield* deviceStateRepository.upsert({
        key: threadMetadataKey(input.threadId),
        valueJson: JSON.stringify({
          modelSelection: input.modelSelection,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          branch: input.branch,
          worktreePath: input.worktreePath,
          deletedAt: input.deletedAt,
          workspaceRoot:
            input.workspaceRoot !== undefined
              ? input.workspaceRoot
              : (existingThreadMetadata?.workspaceRoot ?? null),
          workspaceKind:
            input.workspaceKind !== undefined
              ? input.workspaceKind
              : (existingThreadMetadata?.workspaceKind ?? "paper"),
        }),
        updatedAt: input.updatedAt,
      });
    });

    const getProjectMetadata = Effect.fn("getProjectMetadata")(function* (projectId: string) {
      const row = yield* deviceStateRepository.getByKey({
        key: projectMetadataKey(projectId),
      });
      return Option.isSome(row) ? parseStoredProjectMetadata(row.value.valueJson) : null;
    });

    const getThreadMetadata = Effect.fn("getThreadMetadata")(function* (threadId: string) {
      const row = yield* deviceStateRepository.getByKey({
        key: threadMetadataKey(threadId),
      });
      return Option.isSome(row) ? parseStoredThreadMetadata(row.value.valueJson) : null;
    });

    const upsertMessageMetadata = Effect.fn("upsertMessageMetadata")(function* (input: {
      readonly messageId: string;
      readonly turnId: string | null;
      readonly attachments?: ReadonlyArray<ChatAttachment>;
      readonly updatedAt: string;
      readonly streaming: boolean;
    }) {
      yield* deviceStateRepository.upsert({
        key: messageMetadataKey(input.messageId),
        valueJson: JSON.stringify({
          turnId: input.turnId,
          ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
          updatedAt: input.updatedAt,
          streaming: input.streaming,
        }),
        updatedAt: input.updatedAt,
      });
    });

    const getResearchProjectRow = Effect.fn("getResearchProjectRow")(function* (projectId: string) {
      const rows = yield* sql<{
        readonly projectId: string;
        readonly folderSlug: string;
        readonly title: string;
        readonly createdAt: string;
        readonly updatedAt: string;
      }>`
        SELECT
          project_id AS "projectId",
          folder_slug AS "folderSlug",
          title,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM research_projects
        WHERE project_id = ${projectId}
        LIMIT 1
      `;
      return rows[0] ?? null;
    });

    const resolveProjectWorkspaceRoot = Effect.fn("resolveProjectWorkspaceRoot")(function* (
      projectId: string | null,
    ) {
      if (projectId === null) {
        return null;
      }
      const settings = yield* serverSettingsService.getSettings;
      const projectMetadata = yield* getProjectMetadata(projectId);
      if (!projectMetadata?.workspaceRoot) {
        return null;
      }
      return getValidatedProjectWorkspaceRoot({
        containerRoot: settings.workspaceRoot,
        projectWorkspaceRoot: projectMetadata.workspaceRoot,
      });
    });

    const resolveThreadWorkspaceRoot = Effect.fn("resolveThreadWorkspaceRoot")(function* (input: {
      readonly threadId: string;
      readonly projectId: string | null;
    }) {
      const settings = yield* serverSettingsService.getSettings;
      const threadMetadata = yield* getThreadMetadata(input.threadId);
      if (!threadMetadata?.workspaceRoot) {
        return null;
      }
      const projectWorkspaceRoot = yield* resolveProjectWorkspaceRoot(input.projectId);
      if (input.projectId !== null && projectWorkspaceRoot === null) {
        return null;
      }
      return threadMetadata.workspaceKind === "agent"
        ? getValidatedAgentWorkspaceRoot({
            containerRoot: settings.workspaceRoot,
            agentWorkspaceRoot: threadMetadata.workspaceRoot,
            projectWorkspaceRoot,
          })
        : getValidatedPaperWorkspaceRoot({
            containerRoot: settings.workspaceRoot,
            paperWorkspaceRoot: threadMetadata.workspaceRoot,
            projectWorkspaceRoot,
          });
    });

    const rebaseBoundWorkspaceRoots = Effect.fn("rebaseBoundWorkspaceRoots")(function* (input: {
      readonly fromContainerRoot: string;
      readonly toContainerRoot: string;
      readonly updatedAt: string;
    }) {
      const projectRows = yield* deviceStateRepository.listByPrefix({
        prefix: PROJECT_METADATA_PREFIX,
      });
      for (const row of projectRows) {
        const metadata = parseStoredProjectMetadata(row.valueJson);
        if (!metadata?.workspaceRoot) {
          continue;
        }
        const nextWorkspaceRoot = rebaseWorkspaceRoot({
          workspaceRoot: metadata.workspaceRoot,
          fromContainerRoot: input.fromContainerRoot,
          toContainerRoot: input.toContainerRoot,
        });
        if (nextWorkspaceRoot === null || nextWorkspaceRoot === metadata.workspaceRoot) {
          continue;
        }
        yield* deviceStateRepository.upsert({
          key: row.key,
          valueJson: JSON.stringify({
            defaultModelSelection: metadata.defaultModelSelection,
            scripts: metadata.scripts,
            deletedAt: metadata.deletedAt,
            workspaceRoot: nextWorkspaceRoot,
          }),
          updatedAt: input.updatedAt,
        });
      }

      const threadRows = yield* deviceStateRepository.listByPrefix({
        prefix: THREAD_METADATA_PREFIX,
      });
      for (const row of threadRows) {
        const metadata = parseStoredThreadMetadata(row.valueJson);
        if (!metadata?.workspaceRoot) {
          continue;
        }
        const nextWorkspaceRoot = rebaseWorkspaceRoot({
          workspaceRoot: metadata.workspaceRoot,
          fromContainerRoot: input.fromContainerRoot,
          toContainerRoot: input.toContainerRoot,
        });
        if (nextWorkspaceRoot === null || nextWorkspaceRoot === metadata.workspaceRoot) {
          continue;
        }
        yield* deviceStateRepository.upsert({
          key: row.key,
          valueJson: JSON.stringify({
            modelSelection: metadata.modelSelection,
            runtimeMode: metadata.runtimeMode,
            interactionMode: metadata.interactionMode,
            branch: metadata.branch,
            worktreePath: metadata.worktreePath,
            deletedAt: metadata.deletedAt,
            workspaceRoot: nextWorkspaceRoot,
            workspaceKind: metadata.workspaceKind,
          }),
          updatedAt: input.updatedAt,
        });
      }
    });

    const getResearchChatRow = Effect.fn("getResearchChatRow")(function* (threadId: string) {
      const rows = yield* sql<{
        readonly threadId: string;
        readonly projectId: string | null;
        readonly folderSlug: string;
        readonly title: string;
        readonly createdAt: string;
        readonly updatedAt: string;
        readonly archivedAt: string | null;
      }>`
        SELECT
          chat_id AS "threadId",
          project_id AS "projectId",
          folder_slug AS "folderSlug",
          title,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt"
        FROM research_chats
        WHERE chat_id = ${threadId}
        LIMIT 1
      `;
      return rows[0] ?? null;
    });

    const upsertResearchProject = Effect.fn("upsertResearchProject")(function* (input: {
      readonly projectId: string;
      readonly folderSlug: string;
      readonly title: string;
      readonly createdAt: string;
      readonly updatedAt: string;
    }) {
      yield* sql`
        INSERT INTO research_projects (
          project_id,
          user_id,
          workspace_id,
          folder_slug,
          title,
          description,
          status,
          sharing_strategy,
          sync_state,
          remote_project_id,
          default_chat_id,
          created_at,
          updated_at,
          archived_at
        )
        VALUES (
          ${input.projectId},
          ${LOCAL_USER_ID},
          NULL,
          ${input.folderSlug},
          ${input.title},
          NULL,
          'active',
          ${LOCAL_SHARING_STRATEGY},
          ${LOCAL_SYNC_STATE},
          NULL,
          NULL,
          ${input.createdAt},
          ${input.updatedAt},
          NULL
        )
        ON CONFLICT (project_id)
        DO UPDATE SET
          folder_slug = excluded.folder_slug,
          title = excluded.title,
          updated_at = excluded.updated_at
      `;
    });

    const upsertResearchChat = Effect.fn("upsertResearchChat")(function* (input: {
      readonly threadId: string;
      readonly projectId: string | null;
      readonly folderSlug: string;
      readonly title: string;
      readonly createdAt: string;
      readonly updatedAt: string;
      readonly archivedAt: string | null;
    }) {
      yield* sql`
        INSERT INTO research_chats (
          chat_id,
          project_id,
          folder_slug,
          user_id,
          workspace_id,
          title,
          agent_profile,
          status,
          sharing_strategy,
          sync_state,
          remote_chat_id,
          last_message_at,
          created_at,
          updated_at,
          archived_at
        )
        VALUES (
          ${input.threadId},
          ${input.projectId},
          ${input.folderSlug},
          ${LOCAL_USER_ID},
          NULL,
          ${input.title},
          'agentscience',
          'active',
          ${LOCAL_SHARING_STRATEGY},
          ${LOCAL_SYNC_STATE},
          NULL,
          NULL,
          ${input.createdAt},
          ${input.updatedAt},
          ${input.archivedAt}
        )
        ON CONFLICT (chat_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          folder_slug = excluded.folder_slug,
          title = excluded.title,
          updated_at = excluded.updated_at,
          archived_at = excluded.archived_at
      `;
    });

    const ensureDefaultChatId = Effect.fn("ensureDefaultChatId")(function* (
      projectId: string | null,
      threadId: string,
    ) {
      if (projectId === null) {
        return;
      }
      yield* sql`
        UPDATE research_projects
        SET default_chat_id = CASE
          WHEN default_chat_id IS NULL THEN ${threadId}
          ELSE default_chat_id
        END
        WHERE project_id = ${projectId}
      `;
    });

    const upsertResearchMessage = Effect.fn("upsertResearchMessage")(function* (input: {
      readonly messageId: string;
      readonly threadId: string;
      readonly role: string;
      readonly text: string;
      readonly turnId: string | null;
      readonly attachments?: ReadonlyArray<ChatAttachment>;
      readonly streaming: boolean;
      readonly createdAt: string;
      readonly updatedAt: string;
    }) {
      const existingRows = yield* sql<{
        readonly contentMarkdown: string;
        readonly createdAt: string;
        readonly sequenceNo: number;
        readonly metadataJson: string;
      }>`
        SELECT
          content_markdown AS "contentMarkdown",
          created_at AS "createdAt",
          sequence_no AS "sequenceNo",
          metadata_json AS "metadataJson"
        FROM chat_messages
        WHERE message_id = ${input.messageId}
        LIMIT 1
      `;
      const threadRows = yield* sql<{
        readonly projectId: string | null;
      }>`
        SELECT
          project_id AS "projectId"
        FROM research_chats
        WHERE chat_id = ${input.threadId}
        LIMIT 1
      `;
      const projectId = threadRows[0]?.projectId;
      if (projectId === undefined) {
        return;
      }
      const existingMessage = existingRows[0];
      const previousMetadata =
        existingMessage === undefined
          ? null
          : parseAgentScienceMessageMetadata(existingMessage.metadataJson);
      const nextText =
        existingMessage === undefined
          ? input.text
          : input.streaming
            ? `${existingMessage.contentMarkdown}${input.text}`
            : input.text.length === 0
              ? existingMessage.contentMarkdown
              : input.text;
      const nextAttachments = input.attachments ?? previousMetadata?.attachments;
      const nextSequenceNo =
        existingMessage?.sequenceNo ??
        (yield* sql<{
          readonly nextSequenceNo: number;
        }>`
              SELECT
                COALESCE(MAX(sequence_no), 0) + 1 AS "nextSequenceNo"
              FROM chat_messages
              WHERE chat_id = ${input.threadId}
            `)[0]?.nextSequenceNo ??
        1;

      yield* sql`
        INSERT INTO chat_messages (
          message_id,
          chat_id,
          project_id,
          user_id,
          role,
          message_type,
          content_markdown,
          client_created_at,
          created_at,
          sequence_no,
          run_id,
          sharing_strategy,
          sync_state,
          remote_message_id,
          metadata_json
        )
        VALUES (
          ${input.messageId},
          ${input.threadId},
          ${projectId},
          ${LOCAL_USER_ID},
          ${input.role},
          'text',
          ${nextText},
          ${input.createdAt},
          ${existingMessage?.createdAt ?? input.createdAt},
          ${nextSequenceNo},
          NULL,
          ${LOCAL_SHARING_STRATEGY},
          ${LOCAL_SYNC_STATE},
          NULL,
          ${JSON.stringify({
            turnId: input.turnId,
            ...(nextAttachments !== undefined ? { attachments: nextAttachments } : {}),
            updatedAt: input.updatedAt,
            streaming: input.streaming,
          })}
        )
        ON CONFLICT (message_id)
        DO UPDATE SET
          role = excluded.role,
          content_markdown = excluded.content_markdown,
          client_created_at = excluded.client_created_at,
          metadata_json = excluded.metadata_json
      `;

      yield* upsertMessageMetadata({
        messageId: input.messageId,
        turnId: input.turnId,
        ...(nextAttachments !== undefined ? { attachments: nextAttachments } : {}),
        updatedAt: input.updatedAt,
        streaming: input.streaming,
      });

      yield* sql`
        UPDATE research_chats
        SET
          last_message_at = ${input.updatedAt},
          updated_at = ${input.updatedAt}
        WHERE chat_id = ${input.threadId}
      `;
    });

    const applyProjectsProjection: ProjectorDefinition["apply"] = (event, sideEffects) =>
      Effect.gen(function* () {
        switch (event.type) {
          case "project.created": {
            const settings = yield* serverSettingsService.getSettings;
            const projectWorkspaceRoot = resolveManagedProjectWorkspaceRoot(
              settings.workspaceRoot,
              event.payload.folderSlug,
            );
            yield* upsertResearchProject({
              projectId: event.payload.projectId,
              folderSlug: event.payload.folderSlug,
              title: event.payload.title,
              createdAt: event.payload.createdAt,
              updatedAt: event.payload.updatedAt,
            });
            yield* upsertProjectMetadata({
              projectId: event.payload.projectId,
              defaultModelSelection: event.payload.defaultModelSelection,
              scripts: event.payload.scripts,
              deletedAt: null,
              workspaceRoot: projectWorkspaceRoot,
              updatedAt: event.payload.updatedAt,
            });
            yield* projectionProjectRepository.upsert({
              projectId: event.payload.projectId,
              title: event.payload.title,
              folderSlug: event.payload.folderSlug,
              defaultModelSelection: event.payload.defaultModelSelection,
              scripts: event.payload.scripts,
              createdAt: event.payload.createdAt,
              updatedAt: event.payload.updatedAt,
              deletedAt: null,
            });
            sideEffects.workspaceOperations.push({
              type: "project.create",
              containerRoot: settings.workspaceRoot,
              projectWorkspaceRoot,
            });
            return;
          }

          case "workspace.root-changed": {
            const settings = yield* serverSettingsService.getSettings;
            yield* rebaseBoundWorkspaceRoots({
              fromContainerRoot: settings.workspaceRoot,
              toContainerRoot: event.payload.newRoot,
              updatedAt: event.payload.updatedAt,
            });
            sideEffects.workspaceOperations.push({
              type: "workspace.rootChange",
              newRoot: event.payload.newRoot,
            });
            return;
          }

          case "project.meta-updated": {
            const existingRow = yield* projectionProjectRepository.getById({
              projectId: event.payload.projectId,
            });
            const existingResearchProject = yield* getResearchProjectRow(event.payload.projectId);
            const existingProjectMetadataRow = yield* deviceStateRepository.getByKey({
              key: projectMetadataKey(event.payload.projectId),
            });
            const existingProjectMetadata = Option.isSome(existingProjectMetadataRow)
              ? parseStoredProjectMetadata(existingProjectMetadataRow.value.valueJson)
              : null;
            const existingProjectWorkspaceRoot = yield* resolveProjectWorkspaceRoot(
              event.payload.projectId,
            );
            if (existingResearchProject !== null) {
              yield* upsertResearchProject({
                projectId: event.payload.projectId,
                folderSlug: existingResearchProject.folderSlug,
                title: event.payload.title ?? existingResearchProject.title,
                createdAt: existingResearchProject.createdAt,
                updatedAt: event.payload.updatedAt,
              });
            }
            if (
              existingResearchProject !== null ||
              Option.isSome(existingRow) ||
              existingProjectMetadata !== null
            ) {
              const fallbackDefaultModelSelection =
                event.payload.defaultModelSelection ??
                existingProjectMetadata?.defaultModelSelection ??
                (Option.isSome(existingRow) ? existingRow.value.defaultModelSelection : null);
              const fallbackScripts =
                event.payload.scripts ??
                existingProjectMetadata?.scripts ??
                (Option.isSome(existingRow) ? existingRow.value.scripts : []);
              const fallbackDeletedAt =
                existingProjectMetadata?.deletedAt ??
                (Option.isSome(existingRow) ? existingRow.value.deletedAt : null);
              yield* upsertProjectMetadata({
                projectId: event.payload.projectId,
                defaultModelSelection: fallbackDefaultModelSelection,
                scripts: fallbackScripts,
                deletedAt: fallbackDeletedAt,
                workspaceRoot: existingProjectWorkspaceRoot,
                updatedAt: event.payload.updatedAt,
              });
            }
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionProjectRepository.upsert({
              ...existingRow.value,
              ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
              ...(event.payload.defaultModelSelection !== undefined
                ? { defaultModelSelection: event.payload.defaultModelSelection }
                : {}),
              ...(event.payload.scripts !== undefined ? { scripts: event.payload.scripts } : {}),
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "project.deleted": {
            const existingRow = yield* projectionProjectRepository.getById({
              projectId: event.payload.projectId,
            });
            const existingProjectWorkspaceRoot = yield* resolveProjectWorkspaceRoot(
              event.payload.projectId,
            );
            const existingProjectMetadata = yield* getProjectMetadata(event.payload.projectId);
            if (existingProjectMetadata !== null || Option.isSome(existingRow)) {
              yield* upsertProjectMetadata({
                projectId: event.payload.projectId,
                defaultModelSelection:
                  existingProjectMetadata?.defaultModelSelection ??
                  (Option.isSome(existingRow) ? existingRow.value.defaultModelSelection : null),
                scripts:
                  existingProjectMetadata?.scripts ??
                  (Option.isSome(existingRow) ? existingRow.value.scripts : []),
                deletedAt: event.payload.deletedAt,
                workspaceRoot: existingProjectWorkspaceRoot,
                updatedAt: event.payload.deletedAt,
              });
            }
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionProjectRepository.upsert({
              ...existingRow.value,
              deletedAt: event.payload.deletedAt,
              updatedAt: event.payload.deletedAt,
            });
            return;
          }

          default:
            return;
        }
      }).pipe(
        Effect.mapError(
          toProjectionSqlOrPersistenceError("ProjectionPipeline.applyProjectsProjection:query"),
        ),
      );

    const applyThreadsProjection: ProjectorDefinition["apply"] = (event, attachmentSideEffects) =>
      Effect.gen(function* () {
        switch (event.type) {
          case "thread.created": {
            const settings = yield* serverSettingsService.getSettings;
            const projectWorkspaceRoot = yield* resolveProjectWorkspaceRoot(
              event.payload.projectId,
            );
            if (event.payload.projectId !== null && projectWorkspaceRoot === null) {
              throw new Error(
                `Missing bound project workspace root for project '${event.payload.projectId}' during thread creation.`,
              );
            }
            const workspaceKind =
              event.payload.workspaceKind ??
              inferWorkspaceKindFromWorkflowMode(event.payload.workflowMode);
            const threadWorkspaceRoot = resolveManagedThreadWorkspaceRoot({
              workspaceKind,
              containerRoot: settings.workspaceRoot,
              projectWorkspaceRoot,
              folderSlug: event.payload.folderSlug,
            });
            attachmentSideEffects.workspaceOperations.push(
              workspaceCreateOperation({
                workspaceKind,
                containerRoot: settings.workspaceRoot,
                workspaceRoot: threadWorkspaceRoot,
                projectWorkspaceRoot,
              }),
            );
            yield* upsertResearchChat({
              threadId: event.payload.threadId,
              projectId: event.payload.projectId,
              folderSlug: event.payload.folderSlug,
              title: event.payload.title,
              createdAt: event.payload.createdAt,
              updatedAt: event.payload.updatedAt,
              archivedAt: null,
            });
            yield* ensureDefaultChatId(event.payload.projectId, event.payload.threadId);
            yield* upsertThreadMetadata({
              threadId: event.payload.threadId,
              modelSelection: event.payload.modelSelection,
              runtimeMode: event.payload.runtimeMode,
              interactionMode: event.payload.interactionMode,
              branch: event.payload.branch,
              worktreePath: event.payload.worktreePath,
              deletedAt: null,
              workspaceRoot: threadWorkspaceRoot,
              workspaceKind,
              updatedAt: event.payload.updatedAt,
            });
            yield* projectionThreadRepository.upsert({
              threadId: event.payload.threadId,
              projectId: event.payload.projectId,
              folderSlug: event.payload.folderSlug,
              title: event.payload.title,
              modelSelection: event.payload.modelSelection,
              runtimeMode: event.payload.runtimeMode,
              interactionMode: event.payload.interactionMode,
              branch: event.payload.branch,
              worktreePath: event.payload.worktreePath,
              latestTurnId: null,
              stageState: event.payload.stageState ?? null,
              createdAt: event.payload.createdAt,
              updatedAt: event.payload.updatedAt,
              archivedAt: null,
              deletedAt: null,
            });
            return;
          }

          case "thread.project-set": {
            const existingRow = yield* projectionThreadRepository.getById({
              threadId: event.payload.threadId,
            });
            const existingResearchChat = yield* getResearchChatRow(event.payload.threadId);
            const settings = yield* serverSettingsService.getSettings;
            const existingThreadWorkspaceRoot =
              existingResearchChat === null
                ? null
                : yield* resolveThreadWorkspaceRoot({
                    projectId: existingResearchChat.projectId,
                    threadId: existingResearchChat.threadId,
                  });
            const fromProjectWorkspaceRoot =
              existingResearchChat === null
                ? null
                : yield* resolveProjectWorkspaceRoot(existingResearchChat.projectId);
            const toProjectWorkspaceRoot = yield* resolveProjectWorkspaceRoot(
              event.payload.projectId,
            );
            const existingThreadMetadata =
              existingResearchChat === null
                ? null
                : yield* getThreadMetadata(event.payload.threadId);
            if (event.payload.projectId !== null && toProjectWorkspaceRoot === null) {
              throw new Error(
                `Missing bound project workspace root for target project '${event.payload.projectId}' during paper move.`,
              );
            }
            const nextThreadWorkspaceRoot =
              existingResearchChat === null
                ? null
                : resolveManagedThreadWorkspaceRoot({
                    workspaceKind: existingThreadMetadata?.workspaceKind ?? "paper",
                    containerRoot: settings.workspaceRoot,
                    projectWorkspaceRoot: toProjectWorkspaceRoot,
                    folderSlug: existingResearchChat.folderSlug,
                  });
            if (existingResearchChat !== null) {
              if (
                existingThreadWorkspaceRoot === null ||
                nextThreadWorkspaceRoot === null ||
                existingThreadMetadata === null
              ) {
                throw new Error(
                  `Missing bound thread workspace root for thread '${event.payload.threadId}' during paper move.`,
                );
              }
              const boundExistingThreadWorkspaceRoot = existingThreadWorkspaceRoot;
              const boundNextThreadWorkspaceRoot = nextThreadWorkspaceRoot;
              attachmentSideEffects.workspaceOperations.push(
                workspaceMoveOperation({
                  workspaceKind: existingThreadMetadata.workspaceKind,
                  containerRoot: settings.workspaceRoot,
                  fromWorkspaceRoot: boundExistingThreadWorkspaceRoot,
                  fromProjectWorkspaceRoot,
                  toWorkspaceRoot: boundNextThreadWorkspaceRoot,
                  toProjectWorkspaceRoot,
                }),
              );
              yield* upsertResearchChat({
                threadId: existingResearchChat.threadId,
                projectId: event.payload.projectId,
                folderSlug: existingResearchChat.folderSlug,
                title: existingResearchChat.title,
                createdAt: existingResearchChat.createdAt,
                updatedAt: event.payload.updatedAt,
                archivedAt: existingResearchChat.archivedAt,
              });
              yield* ensureDefaultChatId(event.payload.projectId, event.payload.threadId);
              yield* upsertThreadMetadata({
                threadId: event.payload.threadId,
                modelSelection: existingThreadMetadata.modelSelection,
                runtimeMode: existingThreadMetadata.runtimeMode,
                interactionMode: existingThreadMetadata.interactionMode,
                branch: existingThreadMetadata.branch,
                worktreePath: existingThreadMetadata.worktreePath,
                deletedAt: existingThreadMetadata.deletedAt,
                workspaceRoot: boundNextThreadWorkspaceRoot,
                workspaceKind: existingThreadMetadata.workspaceKind,
                updatedAt: event.payload.updatedAt,
              });
            }
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionThreadRepository.upsert({
              ...existingRow.value,
              projectId: event.payload.projectId,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "paper.moved": {
            const existingRow = yield* projectionThreadRepository.getById({
              threadId: event.payload.threadId,
            });
            const existingResearchChat = yield* getResearchChatRow(event.payload.threadId);
            const settings = yield* serverSettingsService.getSettings;
            const existingThreadWorkspaceRoot =
              existingResearchChat === null
                ? null
                : yield* resolveThreadWorkspaceRoot({
                    projectId: event.payload.fromProjectId,
                    threadId: existingResearchChat.threadId,
                  });
            const fromProjectWorkspaceRoot = yield* resolveProjectWorkspaceRoot(
              event.payload.fromProjectId,
            );
            const toProjectWorkspaceRoot = yield* resolveProjectWorkspaceRoot(
              event.payload.toProjectId,
            );
            const existingThreadMetadata =
              existingResearchChat === null
                ? null
                : yield* getThreadMetadata(event.payload.threadId);
            if (event.payload.toProjectId !== null && toProjectWorkspaceRoot === null) {
              throw new Error(
                `Missing bound project workspace root for target project '${event.payload.toProjectId}' during paper move.`,
              );
            }
            const nextThreadWorkspaceRoot =
              existingResearchChat === null
                ? null
                : resolveManagedThreadWorkspaceRoot({
                    workspaceKind: existingThreadMetadata?.workspaceKind ?? "paper",
                    containerRoot: settings.workspaceRoot,
                    projectWorkspaceRoot: toProjectWorkspaceRoot,
                    folderSlug: existingResearchChat.folderSlug,
                  });
            if (existingResearchChat !== null) {
              if (
                existingThreadWorkspaceRoot === null ||
                nextThreadWorkspaceRoot === null ||
                existingThreadMetadata === null
              ) {
                throw new Error(
                  `Missing bound thread workspace root for thread '${event.payload.threadId}' during paper move.`,
                );
              }
              const boundExistingThreadWorkspaceRoot = existingThreadWorkspaceRoot;
              const boundNextThreadWorkspaceRoot = nextThreadWorkspaceRoot;
              attachmentSideEffects.workspaceOperations.push(
                workspaceMoveOperation({
                  workspaceKind: existingThreadMetadata.workspaceKind,
                  containerRoot: settings.workspaceRoot,
                  fromWorkspaceRoot: boundExistingThreadWorkspaceRoot,
                  fromProjectWorkspaceRoot,
                  toWorkspaceRoot: boundNextThreadWorkspaceRoot,
                  toProjectWorkspaceRoot,
                }),
              );
              yield* upsertResearchChat({
                threadId: existingResearchChat.threadId,
                projectId: event.payload.toProjectId,
                folderSlug: existingResearchChat.folderSlug,
                title: existingResearchChat.title,
                createdAt: existingResearchChat.createdAt,
                updatedAt: event.payload.updatedAt,
                archivedAt: existingResearchChat.archivedAt,
              });
              yield* ensureDefaultChatId(event.payload.toProjectId, event.payload.threadId);
              yield* upsertThreadMetadata({
                threadId: event.payload.threadId,
                modelSelection: existingThreadMetadata.modelSelection,
                runtimeMode: existingThreadMetadata.runtimeMode,
                interactionMode: existingThreadMetadata.interactionMode,
                branch: existingThreadMetadata.branch,
                worktreePath: existingThreadMetadata.worktreePath,
                deletedAt: existingThreadMetadata.deletedAt,
                workspaceRoot: boundNextThreadWorkspaceRoot,
                workspaceKind: existingThreadMetadata.workspaceKind,
                updatedAt: event.payload.updatedAt,
              });
            }
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionThreadRepository.upsert({
              ...existingRow.value,
              projectId: event.payload.toProjectId,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "thread.archived": {
            const existingRow = yield* projectionThreadRepository.getById({
              threadId: event.payload.threadId,
            });
            const existingResearchChat = yield* getResearchChatRow(event.payload.threadId);
            if (existingResearchChat !== null) {
              yield* upsertResearchChat({
                threadId: existingResearchChat.threadId,
                projectId: existingResearchChat.projectId,
                folderSlug: existingResearchChat.folderSlug,
                title: existingResearchChat.title,
                createdAt: existingResearchChat.createdAt,
                updatedAt: event.payload.updatedAt,
                archivedAt: event.payload.archivedAt,
              });
            }
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionThreadRepository.upsert({
              ...existingRow.value,
              archivedAt: event.payload.archivedAt,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "thread.unarchived": {
            const existingRow = yield* projectionThreadRepository.getById({
              threadId: event.payload.threadId,
            });
            const existingResearchChat = yield* getResearchChatRow(event.payload.threadId);
            if (existingResearchChat !== null) {
              yield* upsertResearchChat({
                threadId: existingResearchChat.threadId,
                projectId: existingResearchChat.projectId,
                folderSlug: existingResearchChat.folderSlug,
                title: existingResearchChat.title,
                createdAt: existingResearchChat.createdAt,
                updatedAt: event.payload.updatedAt,
                archivedAt: null,
              });
            }
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionThreadRepository.upsert({
              ...existingRow.value,
              archivedAt: null,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "thread.meta-updated": {
            const existingRow = yield* projectionThreadRepository.getById({
              threadId: event.payload.threadId,
            });
            const existingResearchChat = yield* getResearchChatRow(event.payload.threadId);
            const existingThreadMetadata = yield* getThreadMetadata(event.payload.threadId);
            if (existingResearchChat !== null && existingThreadMetadata !== null) {
              const existingThreadWorkspaceRoot = yield* resolveThreadWorkspaceRoot({
                threadId: event.payload.threadId,
                projectId: existingResearchChat.projectId,
              });
              yield* upsertResearchChat({
                threadId: existingResearchChat.threadId,
                projectId: existingResearchChat.projectId,
                folderSlug: existingResearchChat.folderSlug,
                title: event.payload.title ?? existingResearchChat.title,
                createdAt: existingResearchChat.createdAt,
                updatedAt: event.payload.updatedAt,
                archivedAt: existingResearchChat.archivedAt,
              });
              yield* upsertThreadMetadata({
                threadId: event.payload.threadId,
                modelSelection:
                  event.payload.modelSelection ?? existingThreadMetadata.modelSelection,
                runtimeMode: existingThreadMetadata.runtimeMode,
                interactionMode: existingThreadMetadata.interactionMode,
                branch:
                  event.payload.branch !== undefined
                    ? event.payload.branch
                    : existingThreadMetadata.branch,
                worktreePath:
                  event.payload.worktreePath !== undefined
                    ? event.payload.worktreePath
                    : existingThreadMetadata.worktreePath,
                deletedAt: existingThreadMetadata.deletedAt,
                workspaceRoot: existingThreadWorkspaceRoot,
                workspaceKind: existingThreadMetadata.workspaceKind,
                updatedAt: event.payload.updatedAt,
              });
            }
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionThreadRepository.upsert({
              ...existingRow.value,
              ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
              ...(event.payload.modelSelection !== undefined
                ? { modelSelection: event.payload.modelSelection }
                : {}),
              ...(event.payload.branch !== undefined ? { branch: event.payload.branch } : {}),
              ...(event.payload.worktreePath !== undefined
                ? { worktreePath: event.payload.worktreePath }
                : {}),
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "thread.runtime-mode-set": {
            const existingRow = yield* projectionThreadRepository.getById({
              threadId: event.payload.threadId,
            });
            const existingThreadMetadata = yield* getThreadMetadata(event.payload.threadId);
            if (existingThreadMetadata !== null) {
              yield* upsertThreadMetadata({
                threadId: event.payload.threadId,
                modelSelection: existingThreadMetadata.modelSelection,
                runtimeMode: event.payload.runtimeMode,
                interactionMode: existingThreadMetadata.interactionMode,
                branch: existingThreadMetadata.branch,
                worktreePath: existingThreadMetadata.worktreePath,
                deletedAt: existingThreadMetadata.deletedAt,
                workspaceRoot: existingThreadMetadata.workspaceRoot,
                workspaceKind: existingThreadMetadata.workspaceKind,
                updatedAt: event.payload.updatedAt,
              });
            }
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionThreadRepository.upsert({
              ...existingRow.value,
              runtimeMode: event.payload.runtimeMode,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "thread.interaction-mode-set": {
            const existingRow = yield* projectionThreadRepository.getById({
              threadId: event.payload.threadId,
            });
            const existingThreadMetadata = yield* getThreadMetadata(event.payload.threadId);
            if (existingThreadMetadata !== null) {
              yield* upsertThreadMetadata({
                threadId: event.payload.threadId,
                modelSelection: existingThreadMetadata.modelSelection,
                runtimeMode: existingThreadMetadata.runtimeMode,
                interactionMode: event.payload.interactionMode,
                branch: existingThreadMetadata.branch,
                worktreePath: existingThreadMetadata.worktreePath,
                deletedAt: existingThreadMetadata.deletedAt,
                workspaceRoot: existingThreadMetadata.workspaceRoot,
                workspaceKind: existingThreadMetadata.workspaceKind,
                updatedAt: event.payload.updatedAt,
              });
            }
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionThreadRepository.upsert({
              ...existingRow.value,
              interactionMode: event.payload.interactionMode,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "thread.deleted": {
            attachmentSideEffects.deletedThreadIds.add(event.payload.threadId);
            const existingThreadMetadata = yield* getThreadMetadata(event.payload.threadId);
            if (existingThreadMetadata !== null) {
              yield* upsertThreadMetadata({
                threadId: event.payload.threadId,
                modelSelection: existingThreadMetadata.modelSelection,
                runtimeMode: existingThreadMetadata.runtimeMode,
                interactionMode: existingThreadMetadata.interactionMode,
                branch: existingThreadMetadata.branch,
                worktreePath: existingThreadMetadata.worktreePath,
                deletedAt: event.payload.deletedAt,
                workspaceRoot: existingThreadMetadata.workspaceRoot,
                workspaceKind: existingThreadMetadata.workspaceKind,
                updatedAt: event.payload.deletedAt,
              });
            }
            const existingRow = yield* projectionThreadRepository.getById({
              threadId: event.payload.threadId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionThreadRepository.upsert({
              ...existingRow.value,
              deletedAt: event.payload.deletedAt,
              updatedAt: event.payload.deletedAt,
            });
            return;
          }

          case "thread.message-sent":
          case "thread.proposed-plan-upserted":
          case "thread.activity-appended": {
            const existingResearchChat = yield* getResearchChatRow(event.payload.threadId);
            if (existingResearchChat !== null) {
              yield* upsertResearchChat({
                threadId: existingResearchChat.threadId,
                projectId: existingResearchChat.projectId,
                folderSlug: existingResearchChat.folderSlug,
                title: existingResearchChat.title,
                createdAt: existingResearchChat.createdAt,
                updatedAt: event.occurredAt,
                archivedAt: existingResearchChat.archivedAt,
              });
            }
            const existingRow = yield* projectionThreadRepository.getById({
              threadId: event.payload.threadId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionThreadRepository.upsert({
              ...existingRow.value,
              updatedAt: event.occurredAt,
            });
            return;
          }

          case "thread.stage-state-updated": {
            const existingRow = yield* projectionThreadRepository.getById({
              threadId: event.payload.threadId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionThreadRepository.upsert({
              ...existingRow.value,
              stageState: event.payload.stageState,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "thread.session-set": {
            const existingRow = yield* projectionThreadRepository.getById({
              threadId: event.payload.threadId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionThreadRepository.upsert({
              ...existingRow.value,
              latestTurnId:
                event.payload.session.status === "running" &&
                event.payload.session.activeTurnId !== null
                  ? event.payload.session.activeTurnId
                  : existingRow.value.latestTurnId,
              updatedAt: event.occurredAt,
            });
            return;
          }

          case "thread.turn-diff-completed": {
            const existingRow = yield* projectionThreadRepository.getById({
              threadId: event.payload.threadId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionThreadRepository.upsert({
              ...existingRow.value,
              latestTurnId: event.payload.turnId,
              updatedAt: event.occurredAt,
            });
            return;
          }

          case "thread.reverted": {
            const existingRow = yield* projectionThreadRepository.getById({
              threadId: event.payload.threadId,
            });
            if (Option.isNone(existingRow)) {
              return;
            }
            yield* projectionThreadRepository.upsert({
              ...existingRow.value,
              latestTurnId: null,
              updatedAt: event.occurredAt,
            });
            return;
          }

          default:
            return;
        }
      }).pipe(
        Effect.tapError((error) =>
          Effect.logError("ProjectionPipeline.applyThreadsProjection failed", {
            eventType: event.type,
            aggregateId: event.aggregateId,
            error: describeErrorForLog(error),
            errorInspect: inspect(error, { depth: 10, breakLength: 120 }),
          }),
        ),
        Effect.mapError(
          toProjectionSqlOrPersistenceError("ProjectionPipeline.applyThreadsProjection:query"),
        ),
      );

    const applyThreadMessagesProjection: ProjectorDefinition["apply"] = (
      event,
      attachmentSideEffects,
    ) =>
      Effect.gen(function* () {
        switch (event.type) {
          case "thread.message-sent": {
            yield* upsertResearchMessage({
              messageId: event.payload.messageId,
              threadId: event.payload.threadId,
              role: event.payload.role,
              text: event.payload.text,
              turnId: event.payload.turnId,
              ...(event.payload.attachments !== undefined
                ? { attachments: event.payload.attachments }
                : {}),
              streaming: event.payload.streaming,
              createdAt: event.payload.createdAt,
              updatedAt: event.payload.updatedAt,
            });
            const existingMessage = yield* projectionThreadMessageRepository.getByMessageId({
              messageId: event.payload.messageId,
            });
            const previousMessage = Option.getOrUndefined(existingMessage);
            const nextText = Option.match(existingMessage, {
              onNone: () => event.payload.text,
              onSome: (message) => {
                if (event.payload.streaming) {
                  return `${message.text}${event.payload.text}`;
                }
                if (event.payload.text.length === 0) {
                  return message.text;
                }
                return event.payload.text;
              },
            });
            const nextAttachments =
              event.payload.attachments !== undefined
                ? yield* materializeAttachmentsForProjection({
                    attachments: event.payload.attachments,
                  })
                : previousMessage?.attachments;
            yield* projectionThreadMessageRepository.upsert({
              messageId: event.payload.messageId,
              threadId: event.payload.threadId,
              turnId: event.payload.turnId,
              role: event.payload.role,
              text: nextText,
              ...(nextAttachments !== undefined ? { attachments: [...nextAttachments] } : {}),
              isStreaming: event.payload.streaming,
              createdAt: previousMessage?.createdAt ?? event.payload.createdAt,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          case "thread.reverted": {
            const existingRows = yield* projectionThreadMessageRepository.listByThreadId({
              threadId: event.payload.threadId,
            });
            if (existingRows.length === 0) {
              return;
            }

            const existingTurns = yield* projectionTurnRepository.listByThreadId({
              threadId: event.payload.threadId,
            });
            const keptRows = retainProjectionMessagesAfterRevert(
              existingRows,
              existingTurns,
              event.payload.turnCount,
            );
            if (keptRows.length === existingRows.length) {
              return;
            }

            yield* projectionThreadMessageRepository.deleteByThreadId({
              threadId: event.payload.threadId,
            });
            yield* Effect.forEach(keptRows, projectionThreadMessageRepository.upsert, {
              concurrency: 1,
            }).pipe(Effect.asVoid);
            attachmentSideEffects.prunedThreadRelativePaths.set(
              event.payload.threadId,
              collectThreadAttachmentRelativePaths(event.payload.threadId, keptRows),
            );
            return;
          }

          default:
            return;
        }
      }).pipe(
        Effect.mapError(
          toProjectionSqlOrPersistenceError(
            "ProjectionPipeline.applyThreadMessagesProjection:query",
          ),
        ),
      );

    const applyThreadProposedPlansProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadProposedPlansProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "thread.proposed-plan-upserted":
          yield* projectionThreadProposedPlanRepository.upsert({
            planId: event.payload.proposedPlan.id,
            threadId: event.payload.threadId,
            turnId: event.payload.proposedPlan.turnId,
            planMarkdown: event.payload.proposedPlan.planMarkdown,
            implementedAt: event.payload.proposedPlan.implementedAt,
            implementationThreadId: event.payload.proposedPlan.implementationThreadId,
            createdAt: event.payload.proposedPlan.createdAt,
            updatedAt: event.payload.proposedPlan.updatedAt,
          });
          return;

        case "thread.reverted": {
          const existingRows = yield* projectionThreadProposedPlanRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          if (existingRows.length === 0) {
            return;
          }

          const existingTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptRows = retainProjectionProposedPlansAfterRevert(
            existingRows,
            existingTurns,
            event.payload.turnCount,
          );
          if (keptRows.length === existingRows.length) {
            return;
          }

          yield* projectionThreadProposedPlanRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(keptRows, projectionThreadProposedPlanRepository.upsert, {
            concurrency: 1,
          }).pipe(Effect.asVoid);
          return;
        }

        default:
          return;
      }
    });

    const applyThreadActivitiesProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadActivitiesProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "thread.activity-appended":
          yield* projectionThreadActivityRepository.upsert({
            activityId: event.payload.activity.id,
            threadId: event.payload.threadId,
            turnId: event.payload.activity.turnId,
            tone: event.payload.activity.tone,
            kind: event.payload.activity.kind,
            summary: event.payload.activity.summary,
            payload: event.payload.activity.payload,
            ...(event.payload.activity.sequence !== undefined
              ? { sequence: event.payload.activity.sequence }
              : {}),
            createdAt: event.payload.activity.createdAt,
          });
          return;

        case "thread.reverted": {
          const existingRows = yield* projectionThreadActivityRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          if (existingRows.length === 0) {
            return;
          }
          const existingTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptRows = retainProjectionActivitiesAfterRevert(
            existingRows,
            existingTurns,
            event.payload.turnCount,
          );
          if (keptRows.length === existingRows.length) {
            return;
          }
          yield* projectionThreadActivityRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(keptRows, projectionThreadActivityRepository.upsert, {
            concurrency: 1,
          }).pipe(Effect.asVoid);
          return;
        }

        default:
          return;
      }
    });

    const applyThreadSessionsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadSessionsProjection",
    )(function* (event, _attachmentSideEffects) {
      if (event.type !== "thread.session-set") {
        return;
      }
      yield* projectionThreadSessionRepository.upsert({
        threadId: event.payload.threadId,
        status: event.payload.session.status,
        providerName: event.payload.session.providerName,
        runtimeMode: event.payload.session.runtimeMode,
        activeTurnId: event.payload.session.activeTurnId,
        lastError: event.payload.session.lastError,
        updatedAt: event.payload.session.updatedAt,
      });
    });

    const applyThreadTurnsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadTurnsProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "thread.turn-start-requested": {
          yield* projectionTurnRepository.replacePendingTurnStart({
            threadId: event.payload.threadId,
            messageId: event.payload.messageId,
            sourceProposedPlanThreadId: event.payload.sourceProposedPlan?.threadId ?? null,
            sourceProposedPlanId: event.payload.sourceProposedPlan?.planId ?? null,
            requestedAt: event.payload.createdAt,
          });
          return;
        }

        case "thread.session-set": {
          const turnId = event.payload.session.activeTurnId;
          if (turnId === null || event.payload.session.status !== "running") {
            return;
          }

          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            threadId: event.payload.threadId,
            turnId,
          });
          const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({
            threadId: event.payload.threadId,
          });
          if (Option.isSome(existingTurn)) {
            const nextState =
              existingTurn.value.state === "completed" || existingTurn.value.state === "error"
                ? existingTurn.value.state
                : "running";
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              state: nextState,
              pendingMessageId:
                existingTurn.value.pendingMessageId ??
                (Option.isSome(pendingTurnStart) ? pendingTurnStart.value.messageId : null),
              sourceProposedPlanThreadId:
                existingTurn.value.sourceProposedPlanThreadId ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.sourceProposedPlanThreadId
                  : null),
              sourceProposedPlanId:
                existingTurn.value.sourceProposedPlanId ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.sourceProposedPlanId
                  : null),
              startedAt:
                existingTurn.value.startedAt ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.requestedAt
                  : event.occurredAt),
              requestedAt:
                existingTurn.value.requestedAt ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.requestedAt
                  : event.occurredAt),
            });
          } else {
            yield* projectionTurnRepository.upsertByTurnId({
              turnId,
              threadId: event.payload.threadId,
              pendingMessageId: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.messageId
                : null,
              sourceProposedPlanThreadId: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.sourceProposedPlanThreadId
                : null,
              sourceProposedPlanId: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.sourceProposedPlanId
                : null,
              assistantMessageId: null,
              state: "running",
              requestedAt: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.requestedAt
                : event.occurredAt,
              startedAt: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.requestedAt
                : event.occurredAt,
              completedAt: null,
              checkpointTurnCount: null,
              checkpointRef: null,
              checkpointStatus: null,
              checkpointFiles: [],
            });
          }

          yield* projectionTurnRepository.deletePendingTurnStartByThreadId({
            threadId: event.payload.threadId,
          });
          return;
        }

        case "thread.message-sent": {
          if (event.payload.turnId === null || event.payload.role !== "assistant") {
            return;
          }
          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
          });
          if (Option.isSome(existingTurn)) {
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              assistantMessageId: event.payload.messageId,
              state: event.payload.streaming
                ? existingTurn.value.state
                : existingTurn.value.state === "interrupted"
                  ? "interrupted"
                  : existingTurn.value.state === "error"
                    ? "error"
                    : "completed",
              completedAt: event.payload.streaming
                ? existingTurn.value.completedAt
                : (existingTurn.value.completedAt ?? event.payload.updatedAt),
              startedAt: existingTurn.value.startedAt ?? event.payload.createdAt,
              requestedAt: existingTurn.value.requestedAt ?? event.payload.createdAt,
            });
            return;
          }
          yield* projectionTurnRepository.upsertByTurnId({
            turnId: event.payload.turnId,
            threadId: event.payload.threadId,
            pendingMessageId: null,
            sourceProposedPlanThreadId: null,
            sourceProposedPlanId: null,
            assistantMessageId: event.payload.messageId,
            state: event.payload.streaming ? "running" : "completed",
            requestedAt: event.payload.createdAt,
            startedAt: event.payload.createdAt,
            completedAt: event.payload.streaming ? null : event.payload.updatedAt,
            checkpointTurnCount: null,
            checkpointRef: null,
            checkpointStatus: null,
            checkpointFiles: [],
          });
          return;
        }

        case "thread.turn-interrupt-requested": {
          if (event.payload.turnId === undefined) {
            return;
          }
          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
          });
          if (Option.isSome(existingTurn)) {
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              state: "interrupted",
              completedAt: existingTurn.value.completedAt ?? event.payload.createdAt,
              startedAt: existingTurn.value.startedAt ?? event.payload.createdAt,
              requestedAt: existingTurn.value.requestedAt ?? event.payload.createdAt,
            });
            return;
          }
          yield* projectionTurnRepository.upsertByTurnId({
            turnId: event.payload.turnId,
            threadId: event.payload.threadId,
            pendingMessageId: null,
            sourceProposedPlanThreadId: null,
            sourceProposedPlanId: null,
            assistantMessageId: null,
            state: "interrupted",
            requestedAt: event.payload.createdAt,
            startedAt: event.payload.createdAt,
            completedAt: event.payload.createdAt,
            checkpointTurnCount: null,
            checkpointRef: null,
            checkpointStatus: null,
            checkpointFiles: [],
          });
          return;
        }

        case "thread.turn-diff-completed": {
          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
          });
          const nextState = event.payload.status === "error" ? "error" : "completed";
          yield* projectionTurnRepository.clearCheckpointTurnConflict({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
            checkpointTurnCount: event.payload.checkpointTurnCount,
          });

          if (Option.isSome(existingTurn)) {
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              assistantMessageId: event.payload.assistantMessageId,
              state: nextState,
              checkpointTurnCount: event.payload.checkpointTurnCount,
              checkpointRef: event.payload.checkpointRef,
              checkpointStatus: event.payload.status,
              checkpointFiles: event.payload.files,
              startedAt: existingTurn.value.startedAt ?? event.payload.completedAt,
              requestedAt: existingTurn.value.requestedAt ?? event.payload.completedAt,
              completedAt: event.payload.completedAt,
            });
            return;
          }
          yield* projectionTurnRepository.upsertByTurnId({
            turnId: event.payload.turnId,
            threadId: event.payload.threadId,
            pendingMessageId: null,
            sourceProposedPlanThreadId: null,
            sourceProposedPlanId: null,
            assistantMessageId: event.payload.assistantMessageId,
            state: nextState,
            requestedAt: event.payload.completedAt,
            startedAt: event.payload.completedAt,
            completedAt: event.payload.completedAt,
            checkpointTurnCount: event.payload.checkpointTurnCount,
            checkpointRef: event.payload.checkpointRef,
            checkpointStatus: event.payload.status,
            checkpointFiles: event.payload.files,
          });
          return;
        }

        case "thread.reverted": {
          const existingTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptTurns = existingTurns.filter(
            (turn) =>
              turn.turnId !== null &&
              turn.checkpointTurnCount !== null &&
              turn.checkpointTurnCount <= event.payload.turnCount,
          );
          yield* projectionTurnRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(
            keptTurns,
            (turn) =>
              turn.turnId === null
                ? Effect.void
                : projectionTurnRepository.upsertByTurnId({
                    ...turn,
                    turnId: turn.turnId,
                  }),
            { concurrency: 1 },
          ).pipe(Effect.asVoid);
          return;
        }

        default:
          return;
      }
    });

    const applyCheckpointsProjection: ProjectorDefinition["apply"] = () => Effect.void;

    const applyPendingApprovalsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyPendingApprovalsProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "thread.activity-appended": {
          const requestId =
            extractActivityRequestId(event.payload.activity.payload) ??
            event.metadata.requestId ??
            null;
          if (requestId === null) {
            return;
          }
          const existingRow = yield* projectionPendingApprovalRepository.getByRequestId({
            requestId,
          });
          if (event.payload.activity.kind === "approval.resolved") {
            const resolvedDecisionRaw =
              typeof event.payload.activity.payload === "object" &&
              event.payload.activity.payload !== null &&
              "decision" in event.payload.activity.payload
                ? (event.payload.activity.payload as { decision?: unknown }).decision
                : null;
            const resolvedDecision =
              resolvedDecisionRaw === "accept" ||
              resolvedDecisionRaw === "acceptForSession" ||
              resolvedDecisionRaw === "decline" ||
              resolvedDecisionRaw === "cancel"
                ? resolvedDecisionRaw
                : null;
            yield* projectionPendingApprovalRepository.upsert({
              requestId,
              threadId: Option.isSome(existingRow)
                ? existingRow.value.threadId
                : event.payload.threadId,
              turnId: Option.isSome(existingRow)
                ? existingRow.value.turnId
                : event.payload.activity.turnId,
              status: "resolved",
              decision: resolvedDecision,
              createdAt: Option.isSome(existingRow)
                ? existingRow.value.createdAt
                : event.payload.activity.createdAt,
              resolvedAt: event.payload.activity.createdAt,
            });
            return;
          }
          if (Option.isSome(existingRow) && existingRow.value.status === "resolved") {
            return;
          }
          yield* projectionPendingApprovalRepository.upsert({
            requestId,
            threadId: event.payload.threadId,
            turnId: event.payload.activity.turnId,
            status: "pending",
            decision: null,
            createdAt: Option.isSome(existingRow)
              ? existingRow.value.createdAt
              : event.payload.activity.createdAt,
            resolvedAt: null,
          });
          return;
        }

        case "thread.approval-response-requested": {
          const existingRow = yield* projectionPendingApprovalRepository.getByRequestId({
            requestId: event.payload.requestId,
          });
          yield* projectionPendingApprovalRepository.upsert({
            requestId: event.payload.requestId,
            threadId: Option.isSome(existingRow)
              ? existingRow.value.threadId
              : event.payload.threadId,
            turnId: Option.isSome(existingRow) ? existingRow.value.turnId : null,
            status: "resolved",
            decision: event.payload.decision,
            createdAt: Option.isSome(existingRow)
              ? existingRow.value.createdAt
              : event.payload.createdAt,
            resolvedAt: event.payload.createdAt,
          });
          return;
        }

        default:
          return;
      }
    });

    const projectors: ReadonlyArray<ProjectorDefinition> = [
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.projects,
        apply: applyProjectsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.threads,
        apply: applyThreadsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
        apply: applyThreadMessagesProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
        apply: applyThreadProposedPlansProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
        apply: applyThreadActivitiesProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
        apply: applyThreadSessionsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.threadTurns,
        apply: applyThreadTurnsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
        apply: applyCheckpointsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.pendingApprovals,
        apply: applyPendingApprovalsProjection,
      },
    ];

    const runProjectorForEvent = Effect.fn("runProjectorForEvent")(function* (
      projector: ProjectorDefinition,
      event: OrchestrationEvent,
      options: {
        readonly allowWorkspaceRootChange: boolean;
      },
    ) {
      const attachmentSideEffects: AttachmentSideEffects = {
        deletedThreadIds: new Set<string>(),
        prunedThreadRelativePaths: new Map<string, Set<string>>(),
        workspaceOperations: [],
      };

      yield* sql.withTransaction(
        projector.apply(event, attachmentSideEffects).pipe(
          Effect.flatMap(() =>
            projectionStateRepository.upsert({
              projector: projector.name,
              lastAppliedSequence: event.sequence,
              updatedAt: event.occurredAt,
            }),
          ),
        ),
      );

      yield* runAttachmentSideEffects(attachmentSideEffects).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("failed to apply projected attachment side-effects", {
            projector: projector.name,
            sequence: event.sequence,
            eventType: event.type,
            cause,
          }),
        ),
      );
      yield* runWorkspaceSideEffects(attachmentSideEffects, options).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("failed to apply projected workspace side-effects", {
            projector: projector.name,
            sequence: event.sequence,
            eventType: event.type,
            cause,
          }),
        ),
      );
    });

    const bootstrapProjector = (projector: ProjectorDefinition) =>
      projectionStateRepository
        .getByProjector({
          projector: projector.name,
        })
        .pipe(
          Effect.flatMap((stateRow) =>
            Stream.runForEach(
              eventStore.readFromSequence(
                Option.isSome(stateRow) ? stateRow.value.lastAppliedSequence : 0,
              ),
              (event) =>
                runProjectorForEvent(projector, event, {
                  allowWorkspaceRootChange: false,
                }),
            ),
          ),
        );

    const projectEvent: OrchestrationProjectionPipelineShape["projectEvent"] = (event) =>
      Effect.forEach(
        projectors,
        (projector) =>
          runProjectorForEvent(projector, event, {
            allowWorkspaceRootChange: true,
          }),
        {
          concurrency: 1,
        },
      ).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.provideService(ServerConfig, serverConfig),
        Effect.asVoid,
        Effect.catchTag("SqlError", (sqlError) =>
          Effect.fail(toPersistenceSqlError("ProjectionPipeline.projectEvent:query")(sqlError)),
        ),
      );

    const bootstrap: OrchestrationProjectionPipelineShape["bootstrap"] = Effect.forEach(
      projectors,
      bootstrapProjector,
      { concurrency: 1 },
    ).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ServerConfig, serverConfig),
      Effect.asVoid,
      Effect.tap(() =>
        Effect.logDebug("orchestration projection pipeline bootstrapped").pipe(
          Effect.annotateLogs({ projectors: projectors.length }),
        ),
      ),
      Effect.catchTag("SqlError", (sqlError) =>
        Effect.fail(toPersistenceSqlError("ProjectionPipeline.bootstrap:query")(sqlError)),
      ),
    );

    return {
      bootstrap,
      projectEvent,
    } satisfies OrchestrationProjectionPipelineShape;
  },
);

export const OrchestrationProjectionPipelineLive = Layer.effect(
  OrchestrationProjectionPipeline,
  makeOrchestrationProjectionPipeline(),
).pipe(
  Layer.provideMerge(ProjectionProjectRepositoryLive),
  Layer.provideMerge(ProjectionThreadRepositoryLive),
  Layer.provideMerge(ProjectionThreadMessageRepositoryLive),
  Layer.provideMerge(ProjectionThreadProposedPlanRepositoryLive),
  Layer.provideMerge(ProjectionThreadActivityRepositoryLive),
  Layer.provideMerge(ProjectionThreadSessionRepositoryLive),
  Layer.provideMerge(ProjectionTurnRepositoryLive),
  Layer.provideMerge(ProjectionPendingApprovalRepositoryLive),
  Layer.provideMerge(ProjectionStateRepositoryLive),
  Layer.provideMerge(DeviceStateRepositoryLive),
  Layer.provideMerge(WorkspacePathsLive),
  Layer.provideMerge(WorkspaceLayoutLive.pipe(Layer.provide(WorkspacePathsLive))),
);
