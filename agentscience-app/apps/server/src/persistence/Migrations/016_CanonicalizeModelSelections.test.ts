import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("016_CanonicalizeModelSelections", (it) => {
  it.effect(
    "migrates legacy projection rows and event payloads to the canonical model-selection shape",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        // Setup base state
        {
          yield* runMigrations({ toMigrationInclusive: 15 });

          yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES
          ('project-codex', 'Codex project', '/tmp/project-codex', 'gpt-5.4', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
          ('project-legacy', 'Legacy project', '/tmp/project-legacy', 'gpt-5.3-codex', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
          ('project-null', 'Null project', '/tmp/project-null', NULL, '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)
      `;
          yield* sql`
        UPDATE projection_projects
        SET default_model = 'gpt-5.4'
        WHERE project_id = 'project-legacy'
      `;
          yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          deleted_at,
          runtime_mode,
          interaction_mode
        )
        VALUES
          ('thread-session', 'project-codex', 'Session thread', 'gpt-5.4', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, 'full-access', 'default'),
          ('thread-legacy', 'project-legacy', 'Legacy thread', 'gpt-5.4', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, 'full-access', 'default'),
          ('thread-codex', 'project-codex', 'Codex thread', 'gpt-5.4', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, 'full-access', 'default'),
          ('thread-legacy-options', 'project-legacy', 'Legacy options thread', 'gpt-5.4', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, 'full-access', 'default')
      `;
          yield* sql`
        INSERT INTO projection_thread_sessions (
          thread_id,
          status,
          provider_name,
          provider_session_id,
          provider_thread_id,
          active_turn_id,
          last_error,
          updated_at,
          runtime_mode
        )
        VALUES (
          'thread-session',
          'running',
          'legacy-provider',
          'provider-session-1',
          'provider-thread-1',
          NULL,
          NULL,
          '2026-01-01T00:00:00.000Z',
          'full-access'
        )
      `;
          yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES
        (
          'event-project-created',
          'project',
          'project-1',
          1,
          'project.created',
          '2026-01-01T00:00:00.000Z',
          'command-project-created',
          NULL,
          'correlation-project-created',
          'user',
          '{"projectId":"project-1","title":"Project","workspaceRoot":"/tmp/project","defaultModel":"gpt-5.4","defaultModelOptions":{"codex":{"reasoningEffort":"high"},"legacy":{"effort":"max"}},"scripts":[],"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
          '{}'
        ),
        (
          'event-project-created-fallback',
          'project',
          'project-2',
          1,
          'project.created',
          '2026-01-01T00:00:00.000Z',
          'command-project-created-fallback',
          NULL,
          'correlation-project-created-fallback',
          'user',
          '{"projectId":"project-2","title":"Fallback Project","workspaceRoot":"/tmp/project-2","defaultModel":"gpt-5.3-codex","defaultModelOptions":{"codex":{"reasoningEffort":"low"}},"scripts":[],"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
          '{}'
        ),
        (
          'event-project-created-null-model',
          'project',
          'project-3',
          1,
          'project.created',
          '2026-01-01T00:00:00.000Z',
          'command-project-created-null-model',
          NULL,
          'correlation-project-created-null-model',
          'user',
          '{"projectId":"project-3","title":"Null Model Project","workspaceRoot":"/tmp/project-3","defaultModel":null,"scripts":[],"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
          '{}'
        ),
        (
          'event-thread-created',
          'thread',
          'thread-1',
          1,
          'thread.created',
          '2026-01-01T00:00:00.000Z',
          'command-thread-created',
          NULL,
          'correlation-thread-created',
          'user',
          '{"threadId":"thread-1","projectId":"project-1","title":"Thread","model":"gpt-5.4","modelOptions":{"codex":{"reasoningEffort":"high"},"legacy":{"effort":"max","thinking":false}},"runtimeMode":"full-access","interactionMode":"default","branch":null,"worktreePath":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
          '{}'
        ),
        (
          'event-thread-created-fallback',
          'thread',
          'thread-2',
          1,
          'thread.created',
          '2026-01-01T00:00:00.000Z',
          'command-thread-created-fallback',
          NULL,
          'correlation-thread-created-fallback',
          'user',
          '{"threadId":"thread-2","projectId":"project-1","title":"Fallback Thread","model":"gpt-5.4","modelOptions":{"legacy":{"effort":"max"}},"runtimeMode":"full-access","interactionMode":"default","branch":null,"worktreePath":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
          '{}'
        ),
        (
          'event-turn-start-requested',
          'thread',
          'thread-1',
          2,
          'thread.turn-start-requested',
          '2026-01-01T00:00:00.000Z',
          'command-turn-start-requested',
          NULL,
          'correlation-turn-start-requested',
          'user',
          '{"threadId":"thread-1","turnId":"turn-1","input":"hi","model":"gpt-5.4","modelOptions":{"codex":{"fastMode":true},"legacy":{"effort":"max"}},"deliveryMode":"buffered"}',
          '{}'
        ),
        (
          'event-thread-created-no-model',
          'thread',
          'thread-3',
          1,
          'thread.created',
          '2026-01-01T00:00:00.000Z',
          'command-thread-created-no-model',
          NULL,
          'correlation-thread-created-no-model',
          'user',
          '{"threadId":"thread-3","projectId":"project-1","title":"Ancient Thread","runtimeMode":"full-access","interactionMode":"default","branch":null,"worktreePath":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
          '{}'
        )
      `;
        }

        // Execute migration under test
        yield* runMigrations({ toMigrationInclusive: 16 });

        // Assert expected state
        {
          const projectRows = yield* sql<{
            readonly projectId: string;
            readonly defaultModelSelection: string | null;
          }>`
        SELECT
          project_id AS "projectId",
          default_model_selection_json AS "defaultModelSelection"
        FROM projection_projects
        ORDER BY project_id
      `;
          assert.deepStrictEqual(projectRows, [
            {
              projectId: "project-codex",
              defaultModelSelection: '{"provider":"codex","model":"gpt-5.4"}',
            },
            {
              projectId: "project-legacy",
              defaultModelSelection: '{"provider":"codex","model":"gpt-5.4"}',
            },
            { projectId: "project-null", defaultModelSelection: null },
          ]);

          const threadRows = yield* sql<{
            readonly threadId: string;
            readonly modelSelection: string | null;
          }>`
        SELECT
          thread_id AS "threadId",
          model_selection_json AS "modelSelection"
        FROM projection_threads
        ORDER BY thread_id
      `;
          assert.deepStrictEqual(threadRows, [
            {
              threadId: "thread-codex",
              modelSelection: '{"provider":"codex","model":"gpt-5.4"}',
            },
            {
              threadId: "thread-legacy",
              modelSelection: '{"provider":"codex","model":"gpt-5.4"}',
            },
            {
              threadId: "thread-legacy-options",
              modelSelection: '{"provider":"codex","model":"gpt-5.4"}',
            },
            {
              threadId: "thread-session",
              modelSelection: '{"provider":"codex","model":"gpt-5.4"}',
            },
          ]);

          const eventRows = yield* sql<{
            readonly payloadJson: string;
          }>`
        SELECT payload_json AS "payloadJson"
        FROM orchestration_events
        ORDER BY rowid ASC
      `;

          assert.deepStrictEqual(JSON.parse(eventRows[0]!.payloadJson), {
            projectId: "project-1",
            title: "Project",
            workspaceRoot: "/tmp/project",
            defaultModelSelection: {
              provider: "codex",
              model: "gpt-5.4",
              options: {
                reasoningEffort: "high",
              },
            },
            scripts: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });

          assert.deepStrictEqual(JSON.parse(eventRows[1]!.payloadJson), {
            projectId: "project-2",
            title: "Fallback Project",
            workspaceRoot: "/tmp/project-2",
            defaultModelSelection: {
              provider: "codex",
              model: "gpt-5.3-codex",
              options: {
                reasoningEffort: "low",
              },
            },
            scripts: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });

          assert.deepStrictEqual(JSON.parse(eventRows[2]!.payloadJson), {
            projectId: "project-3",
            title: "Null Model Project",
            workspaceRoot: "/tmp/project-3",
            defaultModelSelection: null,
            scripts: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });

          assert.deepStrictEqual(JSON.parse(eventRows[3]!.payloadJson), {
            threadId: "thread-1",
            projectId: "project-1",
            title: "Thread",
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4",
              options: {
                reasoningEffort: "high",
              },
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });

          assert.deepStrictEqual(JSON.parse(eventRows[4]!.payloadJson), {
            threadId: "thread-2",
            projectId: "project-1",
            title: "Fallback Thread",
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4",
              options: {
                effort: "max",
              },
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });

          assert.deepStrictEqual(JSON.parse(eventRows[5]!.payloadJson), {
            threadId: "thread-1",
            turnId: "turn-1",
            input: "hi",
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4",
              options: {
                fastMode: true,
              },
            },
            deliveryMode: "buffered",
          });

          assert.deepStrictEqual(JSON.parse(eventRows[6]!.payloadJson), {
            threadId: "thread-3",
            projectId: "project-1",
            title: "Ancient Thread",
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4",
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });
        }
      }),
  );
});
