import { EventId, MessageId, ProjectId, ThreadId, TurnId } from "@agentscience/contracts";
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
  it("hydrates the read model from projection tables and local metadata", async () => {
    const snapshot = await Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, folder_slug, default_model_selection_json, scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'project-1', 'Project 1', 'project-1',
          '{"provider":"codex","model":"gpt-5.4"}',
          '[{"id":"script-1","name":"Run analysis","command":"bun run analyze","icon":"play","runOnWorktreeCreate":false}]',
          '2026-02-24T00:00:00.000Z',
          '2026-02-24T00:00:01.000Z',
          NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, folder_slug, title, branch, worktree_path, runtime_mode, interaction_mode,
          model_selection_json, latest_turn_id, created_at, updated_at, archived_at, deleted_at
        ) VALUES (
          'thread-1', 'project-1', 'thread-1', 'Thread 1', 'main', NULL, 'full-access', 'default',
          '{"provider":"codex","model":"gpt-5.4"}',
          NULL,
          '2026-02-24T00:00:02.000Z',
          '2026-02-24T00:00:08.000Z',
          NULL,
          NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id, thread_id, turn_id, role, text, attachments_json, is_streaming, created_at, updated_at
        ) VALUES
        (
          'message-1', 'thread-1', NULL, 'user', 'hello', NULL, 0,
          '2026-02-24T00:00:04.000Z', '2026-02-24T00:00:04.000Z'
        ),
        (
          'message-2', 'thread-1', 'turn-1', 'assistant', 'world',
          '[{"type":"image","id":"attachment-1","name":"plot.png","mimeType":"image/png","sizeBytes":42}]',
          0,
          '2026-02-24T00:00:05.000Z',
          '2026-02-24T00:00:06.000Z'
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_sessions (
          thread_id, status, provider_name, runtime_mode, active_turn_id, last_error, updated_at
        ) VALUES (
          'thread-1', 'ready', 'codex', 'full-access', NULL, NULL, '2026-02-24T00:00:06.500Z'
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_proposed_plans (
          plan_id, thread_id, turn_id, plan_markdown, implemented_at, implementation_thread_id, created_at, updated_at
        ) VALUES (
          'plan-1', 'thread-1', 'turn-1', '1. Run the analysis', NULL, NULL,
          '2026-02-24T00:00:06.750Z', '2026-02-24T00:00:06.750Z'
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, created_at, sequence
        ) VALUES (
          'evt-activity-1', 'thread-1', 'turn-1', 'info', 'context-window.updated', 'Context window updated',
          '{"usedTokens":42}',
          '2026-02-24T00:00:07.000Z',
          7
        )
      `;
      yield* sql`
        INSERT INTO projection_turns (
          thread_id, turn_id, pending_message_id, source_proposed_plan_thread_id, source_proposed_plan_id,
          assistant_message_id, state, requested_at, started_at, completed_at,
          checkpoint_turn_count, checkpoint_ref, checkpoint_status, checkpoint_files_json
        ) VALUES (
          'thread-1', 'turn-1', 'message-1', 'source-thread', 'source-plan',
          'message-2', 'completed',
          '2026-02-24T00:00:04.000Z',
          '2026-02-24T00:00:04.500Z',
          '2026-02-24T00:00:06.000Z',
          1,
          'checkpoint-1',
          'ready',
          '[{"path":"README.md","kind":"modified","additions":1,"deletions":0}]'
        )
      `;
      yield* sql`
        INSERT INTO projection_state (projector, last_applied_sequence, updated_at) VALUES
        ('projection.projects', 7, '2026-02-24T00:00:08.000Z'),
        ('projection.threads', 7, '2026-02-24T00:00:08.000Z'),
        ('projection.thread-messages', 7, '2026-02-24T00:00:08.000Z')
      `;
      yield* sql`
        INSERT INTO device_state (key, value_json, updated_at) VALUES
        (
          'local.project.project-1',
          '{"workspaceRoot":"/tmp/AgentScience/Projects/project-1"}',
          '2026-02-24T00:00:01.000Z'
        ),
        (
          'local.thread.thread-1',
          '{"workspaceRoot":"/tmp/AgentScience/Projects/project-1/papers/thread-1"}',
          '2026-02-24T00:00:03.000Z'
        )
      `;

      return yield* snapshotQuery.getSnapshot();
    }).pipe(Effect.provide(testLayer), Effect.runPromise);

    expect(snapshot.snapshotSequence).toBe(7);
    expect(snapshot.updatedAt).toBe("2026-02-24T00:00:08.000Z");
    expect(snapshot.projects).toEqual([
      {
        id: ProjectId.makeUnsafe("project-1"),
        title: "Project 1",
        folderSlug: "project-1",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5.4",
        },
        scripts: [
          {
            id: "script-1",
            name: "Run analysis",
            command: "bun run analyze",
            icon: "play",
            runOnWorktreeCreate: false,
          },
        ],
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
          model: "gpt-5.4",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "main",
        worktreePath: null,
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "completed",
          requestedAt: "2026-02-24T00:00:04.000Z",
          startedAt: "2026-02-24T00:00:04.500Z",
          completedAt: "2026-02-24T00:00:06.000Z",
          assistantMessageId: MessageId.makeUnsafe("message-2"),
          sourceProposedPlan: {
            threadId: ThreadId.makeUnsafe("source-thread"),
            planId: "source-plan",
          },
        },
        createdAt: "2026-02-24T00:00:02.000Z",
        updatedAt: "2026-02-24T00:00:08.000Z",
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
            attachments: [
              {
                type: "image",
                id: "attachment-1",
                name: "plot.png",
                mimeType: "image/png",
                sizeBytes: 42,
              },
            ],
            turnId: TurnId.makeUnsafe("turn-1"),
            streaming: false,
            createdAt: "2026-02-24T00:00:05.000Z",
            updatedAt: "2026-02-24T00:00:06.000Z",
          },
        ],
        proposedPlans: [
          {
            id: "plan-1",
            turnId: TurnId.makeUnsafe("turn-1"),
            planMarkdown: "1. Run the analysis",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-02-24T00:00:06.750Z",
            updatedAt: "2026-02-24T00:00:06.750Z",
          },
        ],
        activities: [
          {
            id: EventId.makeUnsafe("evt-activity-1"),
            tone: "info",
            kind: "context-window.updated",
            summary: "Context window updated",
            payload: { usedTokens: 42 },
            turnId: TurnId.makeUnsafe("turn-1"),
            sequence: 7,
            createdAt: "2026-02-24T00:00:07.000Z",
          },
        ],
        checkpoints: [
          {
            turnId: TurnId.makeUnsafe("turn-1"),
            checkpointTurnCount: 1,
            checkpointRef: "checkpoint-1",
            status: "ready",
            files: [{ path: "README.md", kind: "modified", additions: 1, deletions: 0 }],
            assistantMessageId: MessageId.makeUnsafe("message-2"),
            completedAt: "2026-02-24T00:00:06.000Z",
          },
        ],
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: "2026-02-24T00:00:06.500Z",
        },
      },
    ]);
  });

  it("resolves workspace and checkpoint context from projection tables", async () => {
    const result = await Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, folder_slug, default_model_selection_json, scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'project-ctx', 'Context Project', 'context-project', NULL, '[]',
          '2026-02-25T00:00:00.000Z', '2026-02-25T00:00:01.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, folder_slug, title, branch, worktree_path, runtime_mode, interaction_mode,
          model_selection_json, latest_turn_id, created_at, updated_at, archived_at, deleted_at
        ) VALUES (
          'thread-ctx', 'project-ctx', 'context-thread', 'Context Thread', NULL, '/tmp/context-worktree',
          'full-access', 'default', '{"provider":"codex","model":"gpt-5-codex"}', 'turn-ctx',
          '2026-02-25T00:00:02.000Z', '2026-02-25T00:00:03.000Z', NULL, NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_turns (
          thread_id, turn_id, pending_message_id, source_proposed_plan_thread_id, source_proposed_plan_id,
          assistant_message_id, state, requested_at, started_at, completed_at,
          checkpoint_turn_count, checkpoint_ref, checkpoint_status, checkpoint_files_json
        ) VALUES (
          'thread-ctx', 'turn-ctx', NULL, NULL, NULL, 'message-ctx-assistant', 'completed',
          '2026-02-25T00:00:04.000Z', '2026-02-25T00:00:04.000Z', '2026-02-25T00:00:05.000Z',
          1, 'checkpoint-ctx', 'ready',
          '[{"path":"figures/output.png","kind":"added","additions":10,"deletions":0}]'
        )
      `;
      yield* sql`
        INSERT INTO device_state (key, value_json, updated_at) VALUES
        (
          'local.project.project-ctx',
          '{"workspaceRoot":"/tmp/AgentScience/Projects/canonical-project-root"}',
          '2026-02-25T00:00:01.000Z'
        ),
        (
          'local.thread.thread-ctx',
          '{"workspaceRoot":"/tmp/AgentScience/Projects/canonical-project-root/papers/canonical-thread-root"}',
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
        resolvedWorkspacePath:
          "/tmp/AgentScience/Projects/canonical-project-root/papers/canonical-thread-root",
        worktreePath: "/tmp/context-worktree",
        checkpoints: [
          {
            turnId: TurnId.makeUnsafe("turn-ctx"),
            checkpointTurnCount: 1,
            checkpointRef: "checkpoint-ctx",
            status: "ready",
            files: [{ path: "figures/output.png", kind: "added", additions: 10, deletions: 0 }],
            assistantMessageId: MessageId.makeUnsafe("message-ctx-assistant"),
            completedAt: "2026-02-25T00:00:05.000Z",
          },
        ],
      });
    }
  });

  it("prefers an explicit thread workspace root over folder slugs and titles", async () => {
    const snapshot = await Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, folder_slug, default_model_selection_json, scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'project-rename', 'Renamed Project', 'old-project-slug', NULL, '[]',
          '2026-02-27T00:00:00.000Z', '2026-02-27T00:00:01.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, folder_slug, title, branch, worktree_path, runtime_mode, interaction_mode,
          model_selection_json, latest_turn_id, created_at, updated_at, archived_at, deleted_at
        ) VALUES (
          'thread-rename', 'project-rename', 'old-thread-slug', 'Final Paper Title', NULL, NULL,
          'full-access', 'default', '{"provider":"codex","model":"gpt-5-codex"}', NULL,
          '2026-02-27T00:00:02.000Z', '2026-02-27T00:00:03.000Z', NULL, NULL
        )
      `;
      yield* sql`
        INSERT INTO device_state (key, value_json, updated_at) VALUES
        (
          'local.project.project-rename',
          '{"workspaceRoot":"/tmp/AgentScience/Projects/canonical-project-root"}',
          '2026-02-27T00:00:01.000Z'
        ),
        (
          'local.thread.thread-rename',
          '{"workspaceRoot":"/tmp/AgentScience/Projects/canonical-project-root/papers/canonical-paper-root"}',
          '2026-02-27T00:00:03.000Z'
        )
      `;

      return yield* snapshotQuery.getSnapshot();
    }).pipe(Effect.provide(testLayer), Effect.runPromise);

    expect(snapshot.threads).toEqual([
      expect.objectContaining({
        id: ThreadId.makeUnsafe("thread-rename"),
        projectId: ProjectId.makeUnsafe("project-rename"),
        folderSlug: "old-thread-slug",
        title: "Final Paper Title",
        resolvedWorkspacePath:
          "/tmp/AgentScience/Projects/canonical-project-root/papers/canonical-paper-root",
      }),
    ]);
  });

  it("fails closed when workspace metadata is missing", async () => {
    const result = await Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, folder_slug, default_model_selection_json, scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'project-fallback', 'Fallback Project', 'fallback-project', NULL, '[]',
          '2026-02-26T00:00:00.000Z', '2026-02-26T00:00:01.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, folder_slug, title, branch, worktree_path, runtime_mode, interaction_mode,
          model_selection_json, latest_turn_id, created_at, updated_at, archived_at, deleted_at
        ) VALUES (
          'thread-fallback', 'project-fallback', 'fallback-thread', 'Fallback Thread', NULL, NULL,
          'full-access', 'default', '{"provider":"codex","model":"gpt-5-codex"}', NULL,
          '2026-02-26T00:00:02.000Z', '2026-02-26T00:00:03.000Z', NULL, NULL
        )
      `;
      yield* sql`
        INSERT INTO device_state (key, value_json, updated_at) VALUES
        (
          'local.thread.thread-fallback',
          '{}',
          '2026-02-26T00:00:03.000Z'
        )
      `;

      return {
        snapshot: yield* snapshotQuery.getSnapshot(),
        context: yield* snapshotQuery.getThreadCheckpointContext(
          ThreadId.makeUnsafe("thread-fallback"),
        ),
      };
    }).pipe(Effect.provide(testLayer), Effect.runPromise);

    expect(result.snapshot.projects).toEqual([
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
    expect(result.snapshot.threads).toEqual([
      expect.objectContaining({
        id: ThreadId.makeUnsafe("thread-fallback"),
        resolvedWorkspacePath: null,
      }),
    ]);
    expect(Option.isSome(result.context)).toBe(true);
    if (Option.isSome(result.context)) {
      expect(result.context.value.resolvedWorkspacePath).toBeNull();
    }
  });

  it("rejects workspace metadata outside the managed container layout", async () => {
    const result = await Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, folder_slug, default_model_selection_json, scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'project-invalid', 'Invalid Project', 'invalid-project', NULL, '[]',
          '2026-02-28T00:00:00.000Z', '2026-02-28T00:00:01.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, folder_slug, title, branch, worktree_path, runtime_mode, interaction_mode,
          model_selection_json, latest_turn_id, created_at, updated_at, archived_at, deleted_at
        ) VALUES (
          'thread-invalid', 'project-invalid', 'invalid-thread', 'Invalid Thread', NULL, NULL,
          'full-access', 'default', '{"provider":"codex","model":"gpt-5-codex"}', NULL,
          '2026-02-28T00:00:02.000Z', '2026-02-28T00:00:03.000Z', NULL, NULL
        )
      `;
      yield* sql`
        INSERT INTO device_state (key, value_json, updated_at) VALUES
        (
          'local.project.project-invalid',
          '{"workspaceRoot":"/tmp/rogue-project-root"}',
          '2026-02-28T00:00:01.000Z'
        ),
        (
          'local.thread.thread-invalid',
          '{"workspaceRoot":"/tmp/rogue-project-root/papers/invalid-thread"}',
          '2026-02-28T00:00:03.000Z'
        )
      `;

      return {
        snapshot: yield* snapshotQuery.getSnapshot(),
        context: yield* snapshotQuery.getThreadCheckpointContext(
          ThreadId.makeUnsafe("thread-invalid"),
        ),
      };
    }).pipe(Effect.provide(testLayer), Effect.runPromise);

    expect(result.snapshot.threads).toEqual([
      expect.objectContaining({
        id: ThreadId.makeUnsafe("thread-invalid"),
        resolvedWorkspacePath: null,
      }),
    ]);
    expect(Option.isSome(result.context)).toBe(true);
    if (Option.isSome(result.context)) {
      expect(result.context.value.resolvedWorkspacePath).toBeNull();
    }
  });
});
