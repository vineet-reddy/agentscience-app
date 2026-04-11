import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const testLayer = Layer.mergeAll(NodeSqliteClient.layerMemory());

describe("024_NullableThreadProjectIds", () => {
  it("makes research chat project ids nullable while preserving folder slugs", async () => {
    await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 23 });
      yield* sql`
        INSERT INTO research_chats (
          chat_id,
          project_id,
          user_id,
          workspace_id,
          folder_slug,
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
        ) VALUES (
          'thread-1',
          NULL,
          'local-user',
          NULL,
          'new-paper',
          'New Paper',
          'agentscience',
          'active',
          'local_only',
          'local_only',
          NULL,
          NULL,
          '2026-03-03T00:00:00.000Z',
          '2026-03-03T00:00:00.000Z',
          NULL
        )
      `.pipe(Effect.ignore);

      yield* runMigrations({ toMigrationInclusive: 24 });

      yield* sql`
        INSERT INTO research_chats (
          chat_id,
          project_id,
          user_id,
          workspace_id,
          folder_slug,
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
        ) VALUES (
          'thread-root',
          NULL,
          'local-user',
          NULL,
          'root-paper',
          'Root Paper',
          'agentscience',
          'active',
          'local_only',
          'local_only',
          NULL,
          NULL,
          '2026-03-04T00:00:00.000Z',
          '2026-03-04T00:00:00.000Z',
          NULL
        )
      `;

      const [chatColumns, latestMigration, insertedRows] = yield* Effect.all([
        sql<{
          readonly name: string;
          readonly notnull: number;
        }>`
          PRAGMA table_info(research_chats)
        `,
        sql<{
          readonly migrationId: number;
        }>`
          SELECT MAX(migration_id) AS "migrationId"
          FROM effect_sql_migrations
        `,
        sql<{
          readonly threadId: string;
          readonly projectId: string | null;
          readonly folderSlug: string;
        }>`
          SELECT
            chat_id AS "threadId",
            project_id AS "projectId",
            folder_slug AS "folderSlug"
          FROM research_chats
          WHERE chat_id = 'thread-root'
        `,
      ]);

      expect(chatColumns.find((column) => column.name === "project_id")?.notnull).toBe(0);
      expect(chatColumns.find((column) => column.name === "folder_slug")?.notnull).toBe(1);
      expect(latestMigration[0]?.migrationId).toBe(24);
      expect(insertedRows).toEqual([
        {
          threadId: "thread-root",
          projectId: null,
          folderSlug: "root-paper",
        },
      ]);
    }).pipe(Effect.provide(testLayer), Effect.runPromise);
  });
});
