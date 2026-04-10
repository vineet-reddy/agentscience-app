import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeviceStateKeyInput,
  DeviceStatePrefixInput,
  DeviceStateRepository,
  type DeviceStateRepositoryShape,
  DeviceStateRow,
} from "../Services/DeviceState.ts";

const makeDeviceStateRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: DeviceStateRow,
    execute: (row) =>
      sql`
        INSERT INTO device_state (
          key,
          value_json,
          updated_at
        )
        VALUES (
          ${row.key},
          ${row.valueJson},
          ${row.updatedAt}
        )
        ON CONFLICT (key)
        DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `,
  });

  const getRowByKey = SqlSchema.findOneOption({
    Request: DeviceStateKeyInput,
    Result: DeviceStateRow,
    execute: ({ key }) =>
      sql`
        SELECT
          key,
          value_json AS "valueJson",
          updated_at AS "updatedAt"
        FROM device_state
        WHERE key = ${key}
      `,
  });

  const listRowsByPrefix = SqlSchema.findAll({
    Request: DeviceStatePrefixInput,
    Result: DeviceStateRow,
    execute: ({ prefix }) =>
      sql`
        SELECT
          key,
          value_json AS "valueJson",
          updated_at AS "updatedAt"
        FROM device_state
        WHERE key LIKE ${`${prefix}%`}
        ORDER BY key ASC
      `,
  });

  const deleteRowByKey = SqlSchema.void({
    Request: DeviceStateKeyInput,
    execute: ({ key }) =>
      sql`
        DELETE FROM device_state
        WHERE key = ${key}
      `,
  });

  return {
    upsert: (row) =>
      upsertRow(row).pipe(
        Effect.mapError(toPersistenceSqlError("DeviceStateRepository.upsert:query")),
      ),
    getByKey: (input) =>
      getRowByKey(input).pipe(
        Effect.mapError(toPersistenceSqlError("DeviceStateRepository.getByKey:query")),
      ),
    listByPrefix: (input) =>
      listRowsByPrefix(input).pipe(
        Effect.mapError(toPersistenceSqlError("DeviceStateRepository.listByPrefix:query")),
      ),
    deleteByKey: (input) =>
      deleteRowByKey(input).pipe(
        Effect.mapError(toPersistenceSqlError("DeviceStateRepository.deleteByKey:query")),
      ),
  } satisfies DeviceStateRepositoryShape;
});

export const DeviceStateRepositoryLive = Layer.effect(
  DeviceStateRepository,
  makeDeviceStateRepository,
);
