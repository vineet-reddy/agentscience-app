import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";

import { SqlitePersistenceMemory } from "./Layers/Sqlite.ts";

describe("Agent Science SQLite migrations", () => {
  it("create the local Agent Science tables needed by the replacement path", async () => {
    const rows = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{
        readonly name: string;
      }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('research_projects', 'research_chats', 'chat_messages', 'device_state')
        ORDER BY name ASC
      `;
    }).pipe(Effect.provide(SqlitePersistenceMemory), Effect.runPromise);

    expect(rows).toEqual([
      { name: "chat_messages" },
      { name: "device_state" },
      { name: "research_chats" },
      { name: "research_projects" },
    ]);
  });
});
