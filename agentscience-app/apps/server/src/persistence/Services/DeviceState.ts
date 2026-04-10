import { IsoDateTime } from "@agentscience/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const DeviceStateRow = Schema.Struct({
  key: Schema.String,
  valueJson: Schema.String,
  updatedAt: IsoDateTime,
});
export type DeviceStateRow = typeof DeviceStateRow.Type;

export const DeviceStateKeyInput = Schema.Struct({
  key: Schema.String,
});
export type DeviceStateKeyInput = typeof DeviceStateKeyInput.Type;

export const DeviceStatePrefixInput = Schema.Struct({
  prefix: Schema.String,
});
export type DeviceStatePrefixInput = typeof DeviceStatePrefixInput.Type;

export interface DeviceStateRepositoryShape {
  readonly upsert: (row: DeviceStateRow) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getByKey: (
    input: DeviceStateKeyInput,
  ) => Effect.Effect<Option.Option<DeviceStateRow>, ProjectionRepositoryError>;
  readonly listByPrefix: (
    input: DeviceStatePrefixInput,
  ) => Effect.Effect<ReadonlyArray<DeviceStateRow>, ProjectionRepositoryError>;
  readonly deleteByKey: (
    input: DeviceStateKeyInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class DeviceStateRepository extends ServiceMap.Service<
  DeviceStateRepository,
  DeviceStateRepositoryShape
>()("agentscience/persistence/Services/DeviceState/DeviceStateRepository") {}
