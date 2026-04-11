import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const testLayer = Layer.mergeAll(NodeSqliteClient.layerMemory());

describe("023_WorkspaceRefactor", () => {
  it("backfills project and paper folder slugs and drops workspace roots", async () => {
    await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 22 });

      yield* sql`
        INSERT INTO research_projects (
          project_id,
          user_id,
          workspace_id,
          workspace_root,
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
        ) VALUES
          (
            'project-1',
            'local-user',
            NULL,
            '/tmp/project-one',
            'Shared Title',
            NULL,
            'active',
            'local_only',
            'local_only',
            NULL,
            NULL,
            '2026-03-01T00:00:00.000Z',
            '2026-03-01T00:00:00.000Z',
            NULL
          ),
          (
            'project-2',
            'local-user',
            NULL,
            '/tmp/project-two',
            'Shared Title',
            NULL,
            'active',
            'local_only',
            'local_only',
            NULL,
            NULL,
            '2026-03-02T00:00:00.000Z',
            '2026-03-02T00:00:00.000Z',
            NULL
          )
      `;

      yield* sql`
        INSERT INTO research_chats (
          chat_id,
          project_id,
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
        ) VALUES
          (
            'thread-1',
            'project-1',
            'local-user',
            NULL,
            'New Paper',
            'agentscience',
            'active',
            'local_only',
            'local_only',
            NULL,
            NULL,
            '2026-03-01T00:00:00.000Z',
            '2026-03-01T00:00:00.000Z',
            NULL
          ),
          (
            'thread-2',
            'project-1',
            'local-user',
            NULL,
            'New Paper',
            'agentscience',
            'active',
            'local_only',
            'local_only',
            NULL,
            NULL,
            '2026-03-02T00:00:00.000Z',
            '2026-03-02T00:00:00.000Z',
            NULL
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 23 });

      const [projectRows, chatRows, projectColumns, indexRows] = yield* Effect.all([
        sql<{
          readonly projectId: string;
          readonly folderSlug: string;
        }>`
          SELECT
            project_id AS "projectId",
            folder_slug AS "folderSlug"
          FROM research_projects
          ORDER BY project_id ASC
        `,
        sql<{
          readonly threadId: string;
          readonly folderSlug: string | null;
        }>`
          SELECT
            chat_id AS "threadId",
            folder_slug AS "folderSlug"
          FROM research_chats
          ORDER BY chat_id ASC
        `,
        sql<{
          readonly name: string;
        }>`
          PRAGMA table_info(research_projects)
        `,
        sql<{
          readonly name: string;
        }>`
          SELECT name
          FROM sqlite_master
          WHERE type = 'index'
            AND tbl_name = 'research_projects'
          ORDER BY name ASC
        `,
      ]);

      expect(projectRows).toEqual([
        { projectId: "project-1", folderSlug: "shared-title" },
        { projectId: "project-2", folderSlug: "shared-title-2" },
      ]);
      expect(chatRows).toEqual([
        { threadId: "thread-1", folderSlug: "new-paper" },
        { threadId: "thread-2", folderSlug: "new-paper-2" },
      ]);
      expect(projectColumns.map((column) => column.name)).toContain("folder_slug");
      expect(projectColumns.map((column) => column.name)).not.toContain("workspace_root");
      expect(indexRows.map((row) => row.name)).toContain(
        "idx_sqlite_research_projects_user_folder_slug",
      );
      expect(indexRows.map((row) => row.name)).not.toContain(
        "idx_sqlite_research_projects_user_workspace_root",
      );
    }).pipe(Effect.provide(testLayer), Effect.runPromise);
  });
});
