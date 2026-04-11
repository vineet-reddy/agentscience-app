import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const testLayer = Layer.mergeAll(NodeSqliteClient.layerMemory());

describe("022_NullableThreadProjectIds", () => {
  it("runs successfully after the Agent Science local schema migration", async () => {
    await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 21 });
      yield* runMigrations({ toMigrationInclusive: 22 });

      const [latestMigration] = yield* sql<{
        readonly migrationId: number;
      }>`
        SELECT MAX(migration_id) AS "migrationId"
        FROM effect_sql_migrations
      `;

      expect(latestMigration?.migrationId).toBe(22);
    }).pipe(Effect.provide(testLayer), Effect.runPromise);
  });
});
