import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<{ name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  const hasStageState = columns.some((column) => column.name === "stage_state_json");
  if (!hasStageState) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN stage_state_json TEXT
    `;
  }
});
