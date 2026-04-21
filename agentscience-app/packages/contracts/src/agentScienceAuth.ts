import { Schema } from "effect";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas";

export const AgentScienceAuthStateStatus = Schema.Literals([
  "signed-out",
  "pending",
  "signed-in",
  "failed",
]);
export type AgentScienceAuthStateStatus = typeof AgentScienceAuthStateStatus.Type;

export const AgentScienceAuthUser = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  handle: TrimmedNonEmptyString,
  email: Schema.NullOr(TrimmedNonEmptyString),
});
export type AgentScienceAuthUser = typeof AgentScienceAuthUser.Type;

export const AgentScienceAuthState = Schema.Struct({
  status: AgentScienceAuthStateStatus,
  updatedAt: IsoDateTime,
  baseUrl: TrimmedNonEmptyString,
  user: Schema.optional(AgentScienceAuthUser),
  code: Schema.optional(TrimmedNonEmptyString),
  verificationUrl: Schema.optional(TrimmedNonEmptyString),
  expiresAt: Schema.optional(IsoDateTime),
  message: Schema.optional(TrimmedNonEmptyString),
});
export type AgentScienceAuthState = typeof AgentScienceAuthState.Type;

export class AgentScienceAuthError extends Schema.TaggedErrorClass<AgentScienceAuthError>()(
  "AgentScienceAuthError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
