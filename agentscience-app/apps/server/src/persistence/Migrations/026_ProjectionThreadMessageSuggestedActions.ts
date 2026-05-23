import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<{ name: string }>`
    PRAGMA table_info(projection_thread_messages)
  `;
  const hasSuggestedActions = columns.some((column) => column.name === "suggested_actions_json");
  if (!hasSuggestedActions) {
    yield* sql`
      ALTER TABLE projection_thread_messages
      ADD COLUMN suggested_actions_json TEXT
    `;
  }
});
