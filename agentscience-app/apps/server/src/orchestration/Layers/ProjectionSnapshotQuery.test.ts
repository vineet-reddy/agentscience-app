import { MessageId, ProjectId, ThreadId } from "@agentscience/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";

import { DeviceStateRepositoryLive } from "../../persistence/Layers/DeviceState.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const testLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
  Layer.provideMerge(DeviceStateRepositoryLive),
  Layer.provideMerge(ServerSettingsService.layerTest({ workspaceRoot: "/tmp/AgentScience" })),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

describe("ProjectionSnapshotQuery", () => {
  it("hydrates the read model from Agent Science tables and local metadata", async () => {
    const snapshot = await Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        INSERT INTO research_projects (
          project_id, user_id, folder_slug, title, sharing_strategy, sync_state, created_at, updated_at
        ) VALUES (
          'project-1', 'local-user', 'project-1', 'Project 1', 'local_only', 'local_only',
          '2026-02-24T00:00:00.000Z', '2026-02-24T00:00:01.000Z'
        )
      `;
      yield* sql`
        INSERT INTO research_chats (
          chat_id, project_id, folder_slug, user_id, title, sharing_strategy, sync_state, created_at, updated_at
        ) VALUES (
          'thread-1', 'project-1', 'thread-1', 'local-user', 'Thread 1', 'local_only', 'local_only',
          '2026-02-24T00:00:02.000Z', '2026-02-24T00:00:03.000Z'
        )
      `;
      yield* sql`
        INSERT INTO chat_messages (
          message_id, chat_id, project_id, user_id, role, message_type, content_markdown,
          client_created_at, created_at, sequence_no, sharing_strategy, sync_state, metadata_json
        ) VALUES
        (
          'message-1', 'thread-1', 'project-1', 'local-user', 'user', 'text', 'hello',
          '2026-02-24T00:00:04.000Z', '2026-02-24T00:00:04.000Z', 1, 'local_only', 'local_only',
          '{"turnId":null,"updatedAt":"2026-02-24T00:00:04.000Z","streaming":false}'
        ),
        (
          'message-2', 'thread-1', 'project-1', 'local-user', 'assistant', 'text', 'world',
          '2026-02-24T00:00:05.000Z', '2026-02-24T00:00:05.000Z', 2, 'local_only', 'local_only',
          '{"turnId":null,"updatedAt":"2026-02-24T00:00:06.000Z","streaming":false}'
        )
      `;
      yield* sql`
        INSERT INTO device_state (key, value_json, updated_at) VALUES
        (
          'local.project.project-1',
          '{"defaultModelSelection":{"provider":"codex","model":"gpt-5-codex"},"scripts":[],"deletedAt":null}',
          '2026-02-24T00:00:01.000Z'
        ),
        (
          'local.thread.thread-1',
          '{"modelSelection":{"provider":"codex","model":"gpt-5-codex"},"runtimeMode":"full-access","interactionMode":"default","branch":null,"worktreePath":null,"deletedAt":null}',
          '2026-02-24T00:00:03.000Z'
        )
      `;

      return yield* snapshotQuery.getSnapshot();
    }).pipe(Effect.provide(testLayer), Effect.runPromise);

    expect(snapshot.snapshotSequence).toBe(0);
    expect(snapshot.updatedAt).toBe("2026-02-24T00:00:06.000Z");
    expect(snapshot.projects).toEqual([
      {
        id: ProjectId.makeUnsafe("project-1"),
        title: "Project 1",
        folderSlug: "project-1",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        scripts: [],
        createdAt: "2026-02-24T00:00:00.000Z",
        updatedAt: "2026-02-24T00:00:01.000Z",
        deletedAt: null,
      },
    ]);
    expect(snapshot.threads).toEqual([
      {
        id: ThreadId.makeUnsafe("thread-1"),
        projectId: ProjectId.makeUnsafe("project-1"),
        folderSlug: "thread-1",
        resolvedWorkspacePath: "/tmp/AgentScience/Projects/project-1/papers/thread-1",
        title: "Thread 1",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: "2026-02-24T00:00:02.000Z",
        updatedAt: "2026-02-24T00:00:03.000Z",
        archivedAt: null,
        deletedAt: null,
        messages: [
          {
            id: MessageId.makeUnsafe("message-1"),
            role: "user",
            text: "hello",
            turnId: null,
            streaming: false,
            createdAt: "2026-02-24T00:00:04.000Z",
            updatedAt: "2026-02-24T00:00:04.000Z",
          },
          {
            id: MessageId.makeUnsafe("message-2"),
            role: "assistant",
            text: "world",
            turnId: null,
            streaming: false,
            createdAt: "2026-02-24T00:00:05.000Z",
            updatedAt: "2026-02-24T00:00:06.000Z",
          },
        ],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ]);
  });

  it("resolves workspace and thread context from local metadata", async () => {
    const result = await Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        INSERT INTO research_projects (
          project_id, user_id, folder_slug, title, sharing_strategy, sync_state, created_at, updated_at
        ) VALUES (
          'project-ctx', 'local-user', 'context-project', 'Context Project', 'local_only', 'local_only',
          '2026-02-25T00:00:00.000Z', '2026-02-25T00:00:01.000Z'
        )
      `;
      yield* sql`
        INSERT INTO research_chats (
          chat_id, project_id, folder_slug, user_id, title, sharing_strategy, sync_state, created_at, updated_at
        ) VALUES (
          'thread-ctx', 'project-ctx', 'context-thread', 'local-user', 'Context Thread', 'local_only', 'local_only',
          '2026-02-25T00:00:02.000Z', '2026-02-25T00:00:03.000Z'
        )
      `;
      yield* sql`
        INSERT INTO device_state (key, value_json, updated_at) VALUES
        (
          'local.project.project-ctx',
          '{"defaultModelSelection":null,"scripts":[],"deletedAt":null}',
          '2026-02-25T00:00:01.000Z'
        ),
        (
          'local.thread.thread-ctx',
          '{"modelSelection":{"provider":"codex","model":"gpt-5-codex"},"runtimeMode":"full-access","interactionMode":"default","branch":null,"worktreePath":"/tmp/context-worktree","deletedAt":null}',
          '2026-02-25T00:00:03.000Z'
        )
      `;

      return {
        snapshot: yield* snapshotQuery.getSnapshot(),
        firstThreadId: yield* snapshotQuery.getFirstActiveThreadIdByProjectId(
          ProjectId.makeUnsafe("project-ctx"),
        ),
        context: yield* snapshotQuery.getThreadCheckpointContext(
          ThreadId.makeUnsafe("thread-ctx"),
        ),
      };
    }).pipe(Effect.provide(testLayer), Effect.runPromise);

    expect(Option.isSome(result.firstThreadId)).toBe(true);
    expect(Option.isSome(result.context)).toBe(true);
    expect(result.snapshot.projects).toEqual([
      {
        id: ProjectId.makeUnsafe("project-ctx"),
        title: "Context Project",
        folderSlug: "context-project",
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-02-25T00:00:00.000Z",
        updatedAt: "2026-02-25T00:00:01.000Z",
        deletedAt: null,
      },
    ]);
    if (Option.isSome(result.firstThreadId)) {
      expect(result.firstThreadId.value).toEqual(ThreadId.makeUnsafe("thread-ctx"));
    }
    if (Option.isSome(result.context)) {
      expect(result.context.value).toEqual({
        threadId: ThreadId.makeUnsafe("thread-ctx"),
        projectId: ProjectId.makeUnsafe("project-ctx"),
        resolvedWorkspacePath: "/tmp/AgentScience/Projects/context-project/papers/context-thread",
        worktreePath: "/tmp/context-worktree",
        checkpoints: [],
      });
    }
  });

  it("falls back to research project rows when project metadata is missing", async () => {
    const snapshot = await Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        INSERT INTO research_projects (
          project_id, user_id, folder_slug, title, sharing_strategy, sync_state, created_at, updated_at
        ) VALUES (
          'project-fallback', 'local-user', 'fallback-project', 'Fallback Project', 'local_only', 'local_only',
          '2026-02-26T00:00:00.000Z', '2026-02-26T00:00:01.000Z'
        )
      `;
      yield* sql`
        INSERT INTO research_chats (
          chat_id, project_id, folder_slug, user_id, title, sharing_strategy, sync_state, created_at, updated_at
        ) VALUES (
          'thread-fallback', 'project-fallback', 'fallback-thread', 'local-user', 'Fallback Thread', 'local_only', 'local_only',
          '2026-02-26T00:00:02.000Z', '2026-02-26T00:00:03.000Z'
        )
      `;
      yield* sql`
        INSERT INTO device_state (key, value_json, updated_at) VALUES
        (
          'local.thread.thread-fallback',
          '{"modelSelection":{"provider":"codex","model":"gpt-5-codex"},"runtimeMode":"full-access","interactionMode":"default","branch":null,"worktreePath":null,"deletedAt":null}',
          '2026-02-26T00:00:03.000Z'
        )
      `;

      return {
        snapshot: yield* snapshotQuery.getSnapshot(),
      };
    }).pipe(Effect.provide(testLayer), Effect.runPromise);

    expect(snapshot.snapshot.projects).toEqual([
      {
        id: ProjectId.makeUnsafe("project-fallback"),
        title: "Fallback Project",
        folderSlug: "fallback-project",
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-02-26T00:00:00.000Z",
        updatedAt: "2026-02-26T00:00:01.000Z",
        deletedAt: null,
      },
    ]);
  });
});
