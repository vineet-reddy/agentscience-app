import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
} from "@agentscience/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";

import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";

const testLayer = OrchestrationProjectionPipelineLive.pipe(
  Layer.provideMerge(OrchestrationEventStoreLive),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "agentscience-agent-science-pipeline-",
    }),
  ),
  Layer.provideMerge(
    ServerSettingsService.layerTest({ workspaceRoot: "/tmp/AgentScience" }),
  ),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

describe("OrchestrationProjectionPipeline Agent Science", () => {
  it("writes projects, chats, messages, and local metadata", async () => {
    const result = await Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-02-24T00:00:00.000Z";

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-project"),
        aggregateKind: "project",
        aggregateId: ProjectId.makeUnsafe("project-1"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project"),
        metadata: {},
        payload: {
          projectId: ProjectId.makeUnsafe("project-1"),
          title: "Project 1",
          folderSlug: "project-1",
          defaultModelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-thread"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-1"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          projectId: ProjectId.makeUnsafe("project-1"),
          folderSlug: "thread-1",
          title: "Thread 1",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-message"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-1"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-message"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-message"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          messageId: MessageId.makeUnsafe("message-1"),
          role: "assistant",
          text: "hello",
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* projectionPipeline.bootstrap;

      return {
        projectRows: yield* sql<{
          readonly projectId: string;
          readonly folderSlug: string | null;
          readonly defaultChatId: string | null;
        }>`
          SELECT
            project_id AS "projectId",
            folder_slug AS "folderSlug",
            default_chat_id AS "defaultChatId"
          FROM research_projects
        `,
        messageRows: yield* sql<{
          readonly messageId: string;
          readonly contentMarkdown: string;
          readonly sequenceNo: number;
        }>`
          SELECT
            message_id AS "messageId",
            content_markdown AS "contentMarkdown",
            sequence_no AS "sequenceNo"
          FROM chat_messages
        `,
        deviceRows: yield* sql<{
          readonly key: string;
        }>`
          SELECT key
          FROM device_state
          WHERE key IN ('local.project.project-1', 'local.thread.thread-1', 'local.message.message-1')
          ORDER BY key ASC
        `,
      };
    }).pipe(Effect.provide(testLayer), Effect.runPromise);

    expect(result.projectRows).toEqual([
      {
        projectId: "project-1",
        folderSlug: "project-1",
        defaultChatId: "thread-1",
      },
    ]);
    expect(result.messageRows).toEqual([
      { messageId: "message-1", contentMarkdown: "hello", sequenceNo: 1 },
    ]);
    expect(result.deviceRows).toEqual([
      { key: "local.message.message-1" },
      { key: "local.project.project-1" },
      { key: "local.thread.thread-1" },
    ]);
  });

  it("updates a single message row across streaming chunks", async () => {
    const rows = await Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-02-24T00:00:00.000Z";

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-project-2"),
        aggregateKind: "project",
        aggregateId: ProjectId.makeUnsafe("project-2"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-2"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-2"),
        metadata: {},
        payload: {
          projectId: ProjectId.makeUnsafe("project-2"),
          title: "Project 2",
          folderSlug: "project-2",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-thread-2"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-2"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-2"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-2"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-2"),
          projectId: ProjectId.makeUnsafe("project-2"),
          folderSlug: "thread-2",
          title: "Thread 2",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      for (const [eventId, text, streaming, updatedAt] of [
        ["evt-message-2a", "hel", true, now],
        ["evt-message-2b", "lo", true, "2026-02-24T00:00:01.000Z"],
        ["evt-message-2c", "hello", false, "2026-02-24T00:00:02.000Z"],
      ] as const) {
        yield* eventStore.append({
          type: "thread.message-sent",
          eventId: EventId.makeUnsafe(eventId),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("thread-2"),
          occurredAt: updatedAt,
          commandId: CommandId.makeUnsafe(`cmd-${eventId}`),
          causationEventId: null,
          correlationId: CommandId.makeUnsafe(`cmd-${eventId}`),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe("thread-2"),
            messageId: MessageId.makeUnsafe("message-2"),
            role: "assistant",
            text,
            turnId: null,
            streaming,
            createdAt: now,
            updatedAt,
          },
        });
      }

      yield* projectionPipeline.bootstrap;

      return yield* sql<{
        readonly count: number;
        readonly contentMarkdown: string;
        readonly sequenceNo: number;
      }>`
        SELECT
          COUNT(*) AS "count",
          MAX(content_markdown) AS "contentMarkdown",
          MAX(sequence_no) AS "sequenceNo"
        FROM chat_messages
        WHERE message_id = 'message-2'
      `;
    }).pipe(Effect.provide(testLayer), Effect.runPromise);

    expect(rows).toEqual([
      { count: 1, contentMarkdown: "hello", sequenceNo: 1 },
    ]);
  });

  it("allows projects with duplicate titles when workspace roots differ", async () => {
    const rows = await Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-02-24T00:00:00.000Z";

      for (const [projectId, folderSlug] of [
        ["project-a", "project-a"],
        ["project-b", "project-b"],
      ] as const) {
        yield* eventStore.append({
          type: "project.created",
          eventId: EventId.makeUnsafe(`evt-${projectId}`),
          aggregateKind: "project",
          aggregateId: ProjectId.makeUnsafe(projectId),
          occurredAt: now,
          commandId: CommandId.makeUnsafe(`cmd-${projectId}`),
          causationEventId: null,
          correlationId: CommandId.makeUnsafe(`cmd-${projectId}`),
          metadata: {},
          payload: {
            projectId: ProjectId.makeUnsafe(projectId),
            title: "Shared Title",
            folderSlug,
            defaultModelSelection: null,
            scripts: [],
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      yield* projectionPipeline.bootstrap;

      return yield* sql<{
        readonly projectId: string;
        readonly folderSlug: string | null;
      }>`
        SELECT
          project_id AS "projectId",
          folder_slug AS "folderSlug"
        FROM research_projects
        ORDER BY project_id ASC
      `;
    }).pipe(Effect.provide(testLayer), Effect.runPromise);

    expect(rows).toEqual([
      { projectId: "project-a", folderSlug: "project-a" },
      { projectId: "project-b", folderSlug: "project-b" },
    ]);
  });
});
