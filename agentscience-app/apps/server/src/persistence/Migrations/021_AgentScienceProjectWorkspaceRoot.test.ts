import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const testLayer = Layer.mergeAll(NodeSqliteClient.layerMemory());

describe("021_AgentScienceProjectWorkspaceRoot", () => {
  it("backfills workspace roots and replaces the legacy title uniqueness index", async () => {
    await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 20 });
      yield* sql`
        INSERT INTO research_projects (
          project_id,
          user_id,
          title,
          sharing_strategy,
          sync_state,
          created_at,
          updated_at
        ) VALUES (
          'project-1',
          'local-user',
          'Shared Title',
          'local_only',
          'local_only',
          '2026-02-24T00:00:00.000Z',
          '2026-02-24T00:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO device_state (key, value_json, updated_at) VALUES (
          'local.project.project-1',
          '{"workspaceRoot":"/tmp/project-1","defaultModelSelection":null,"scripts":[],"deletedAt":null}',
          '2026-02-24T00:00:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 21 });

      const [projectRows, indexRows] = yield* Effect.all([
        sql<{
          readonly workspaceRoot: string | null;
        }>`
          SELECT workspace_root AS "workspaceRoot"
          FROM research_projects
          WHERE project_id = 'project-1'
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

      expect(projectRows).toEqual([{ workspaceRoot: "/tmp/project-1" }]);
      expect(indexRows.map((row) => row.name)).toContain(
        "idx_sqlite_research_projects_user_workspace_root",
      );
      expect(indexRows.map((row) => row.name)).not.toContain(
        "idx_sqlite_research_projects_user_title",
      );
    }).pipe(Effect.provide(testLayer), Effect.runPromise);
  });
});
