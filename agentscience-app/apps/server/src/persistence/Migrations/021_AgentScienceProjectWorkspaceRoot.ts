import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const tableInfo = yield* sql<{
    readonly name: string;
  }>`
    PRAGMA table_info(research_projects)
  `;
  const hasWorkspaceRootColumn = tableInfo.some((column) => column.name === "workspace_root");
  if (!hasWorkspaceRootColumn) {
    yield* sql`
      ALTER TABLE research_projects
      ADD COLUMN workspace_root TEXT
    `;
  }

  yield* sql`
    UPDATE research_projects
    SET workspace_root = (
      SELECT json_extract(device_state.value_json, '$.workspaceRoot')
      FROM device_state
      WHERE device_state.key = 'local.project.' || research_projects.project_id
    )
    WHERE workspace_root IS NULL
  `;

  yield* sql`
    DROP INDEX IF EXISTS idx_sqlite_research_projects_user_title
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sqlite_research_projects_user_workspace_root
    ON research_projects(user_id, workspace_root)
  `;
});
