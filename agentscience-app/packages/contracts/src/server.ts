import { Schema } from "effect";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import { EditorId } from "./editor";
import { ModelCapabilities } from "./model";
import { ProviderKind } from "./orchestration";
import { ServerSettings } from "./settings";

export const ServerProviderState = Schema.Literals(["ready", "warning", "error", "disabled"]);
export type ServerProviderState = typeof ServerProviderState.Type;

export const ServerProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type ServerProviderAuthStatus = typeof ServerProviderAuthStatus.Type;

export const ServerProviderAuth = Schema.Struct({
  status: ServerProviderAuthStatus,
  type: Schema.optional(TrimmedNonEmptyString),
  label: Schema.optional(TrimmedNonEmptyString),
});
export type ServerProviderAuth = typeof ServerProviderAuth.Type;

export const ServerProviderModel = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  isCustom: Schema.Boolean,
  capabilities: Schema.NullOr(ModelCapabilities),
});
export type ServerProviderModel = typeof ServerProviderModel.Type;

export const ServerProvider = Schema.Struct({
  provider: ProviderKind,
  enabled: Schema.Boolean,
  installed: Schema.Boolean,
  version: Schema.NullOr(TrimmedNonEmptyString),
  status: ServerProviderState,
  auth: ServerProviderAuth,
  checkedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
  models: Schema.Array(ServerProviderModel),
});
export type ServerProvider = typeof ServerProvider.Type;

export const ServerProviders = Schema.Array(ServerProvider);
export type ServerProviders = typeof ServerProviders.Type;

export const CodexAuthLoginType = Schema.Literals(["apiKey", "chatgpt"]);
export type CodexAuthLoginType = typeof CodexAuthLoginType.Type;

export const CodexAuthStateStatus = Schema.Literals(["idle", "pending", "failed"]);
export type CodexAuthStateStatus = typeof CodexAuthStateStatus.Type;

export const CodexAuthState = Schema.Struct({
  status: CodexAuthStateStatus,
  updatedAt: IsoDateTime,
  defaultHomePath: TrimmedNonEmptyString,
  loginType: Schema.optional(CodexAuthLoginType),
  loginId: Schema.optional(TrimmedNonEmptyString),
  authUrl: Schema.optional(TrimmedNonEmptyString),
  message: Schema.optional(TrimmedNonEmptyString),
});
export type CodexAuthState = typeof CodexAuthState.Type;

export const CodexAuthApiKeyLoginInput = Schema.Struct({
  apiKey: TrimmedNonEmptyString,
});
export type CodexAuthApiKeyLoginInput = typeof CodexAuthApiKeyLoginInput.Type;

export const CodexAuthCancelLoginInput = Schema.Struct({
  loginId: Schema.optional(TrimmedNonEmptyString),
});
export type CodexAuthCancelLoginInput = typeof CodexAuthCancelLoginInput.Type;

export class CodexAuthError extends Schema.TaggedErrorClass<CodexAuthError>()("CodexAuthError", {
  message: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect),
}) {}

export class AgentScienceRuntimeActionError extends Schema.TaggedErrorClass<AgentScienceRuntimeActionError>()(
  "AgentScienceRuntimeActionError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ServerObservability = Schema.Struct({
  logsDirectoryPath: TrimmedNonEmptyString,
  localTracingEnabled: Schema.Boolean,
  otlpTracesUrl: Schema.optional(TrimmedNonEmptyString),
  otlpTracesEnabled: Schema.Boolean,
  otlpMetricsUrl: Schema.optional(TrimmedNonEmptyString),
  otlpMetricsEnabled: Schema.Boolean,
});
export type ServerObservability = typeof ServerObservability.Type;

export const ServerRuntimePersonality = Schema.Struct({
  version: TrimmedNonEmptyString,
  contentHash: TrimmedNonEmptyString,
});
export type ServerRuntimePersonality = typeof ServerRuntimePersonality.Type;

export const ServerRuntimeAgentScienceCheckState = Schema.Literals([
  "checking",
  "ready",
  "unavailable",
  "error",
]);
export type ServerRuntimeAgentScienceCheckState = typeof ServerRuntimeAgentScienceCheckState.Type;

export const ServerRuntimeAgentScienceCli = Schema.Struct({
  version: Schema.optional(TrimmedNonEmptyString),
  latestVersion: Schema.optional(TrimmedNonEmptyString),
  personalityVersion: Schema.optional(TrimmedNonEmptyString),
  personalityContentHash: Schema.optional(TrimmedNonEmptyString),
  checkSource: Schema.optional(TrimmedNonEmptyString),
});
export type ServerRuntimeAgentScienceCli = typeof ServerRuntimeAgentScienceCli.Type;

export const ServerRuntimeAgentScienceSurface = Schema.Struct({
  surface: TrimmedNonEmptyString,
  scope: TrimmedNonEmptyString,
  installed: Schema.Boolean,
  installMode: Schema.optional(TrimmedNonEmptyString),
  autoUpdates: Schema.Boolean,
  personalityVersion: Schema.optional(TrimmedNonEmptyString),
  personalityContentHash: Schema.optional(TrimmedNonEmptyString),
  refreshRecommended: Schema.Boolean,
  current: Schema.Boolean,
});
export type ServerRuntimeAgentScienceSurface = typeof ServerRuntimeAgentScienceSurface.Type;

export const ServerRuntimeAgentScience = Schema.Struct({
  state: ServerRuntimeAgentScienceCheckState,
  checkedAt: IsoDateTime,
  ok: Schema.Boolean,
  updateAvailable: Schema.Boolean,
  refreshRecommended: Schema.Boolean,
  nextSteps: Schema.Array(TrimmedNonEmptyString),
  message: Schema.optional(TrimmedNonEmptyString),
  cli: Schema.optional(ServerRuntimeAgentScienceCli),
  codexActive: Schema.optional(ServerRuntimeAgentScienceSurface),
  claudeCodeActive: Schema.optional(ServerRuntimeAgentScienceSurface),
});
export type ServerRuntimeAgentScience = typeof ServerRuntimeAgentScience.Type;

export const ServerRuntime = Schema.Struct({
  personality: ServerRuntimePersonality,
  agentScience: ServerRuntimeAgentScience,
});
export type ServerRuntime = typeof ServerRuntime.Type;

export const ServerConfig = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  providers: ServerProviders,
  availableEditors: Schema.Array(EditorId),
  observability: ServerObservability,
  runtime: ServerRuntime,
  settings: ServerSettings,
});
export type ServerConfig = typeof ServerConfig.Type;

export const ServerConfigProviderStatusesPayload = Schema.Struct({
  providers: ServerProviders,
});
export type ServerConfigProviderStatusesPayload = typeof ServerConfigProviderStatusesPayload.Type;

export const ServerConfigSettingsUpdatedPayload = Schema.Struct({
  settings: ServerSettings,
});
export type ServerConfigSettingsUpdatedPayload = typeof ServerConfigSettingsUpdatedPayload.Type;

export const ServerConfigRuntimeUpdatedPayload = Schema.Struct({
  runtime: ServerRuntime,
});
export type ServerConfigRuntimeUpdatedPayload = typeof ServerConfigRuntimeUpdatedPayload.Type;

export const ServerConfigStreamSnapshotEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("snapshot"),
  config: ServerConfig,
});
export type ServerConfigStreamSnapshotEvent = typeof ServerConfigStreamSnapshotEvent.Type;

export const ServerConfigStreamProviderStatusesEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("providerStatuses"),
  payload: ServerConfigProviderStatusesPayload,
});
export type ServerConfigStreamProviderStatusesEvent =
  typeof ServerConfigStreamProviderStatusesEvent.Type;

export const ServerConfigStreamSettingsUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("settingsUpdated"),
  payload: ServerConfigSettingsUpdatedPayload,
});
export type ServerConfigStreamSettingsUpdatedEvent =
  typeof ServerConfigStreamSettingsUpdatedEvent.Type;

export const ServerConfigStreamRuntimeUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("runtimeUpdated"),
  payload: ServerConfigRuntimeUpdatedPayload,
});
export type ServerConfigStreamRuntimeUpdatedEvent =
  typeof ServerConfigStreamRuntimeUpdatedEvent.Type;

export const ServerConfigStreamEvent = Schema.Union([
  ServerConfigStreamSnapshotEvent,
  ServerConfigStreamProviderStatusesEvent,
  ServerConfigStreamSettingsUpdatedEvent,
  ServerConfigStreamRuntimeUpdatedEvent,
]);
export type ServerConfigStreamEvent = typeof ServerConfigStreamEvent.Type;

export const ServerLifecycleReadyPayload = Schema.Struct({
  at: IsoDateTime,
});
export type ServerLifecycleReadyPayload = typeof ServerLifecycleReadyPayload.Type;

export const ServerLifecycleWelcomePayload = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  projectName: TrimmedNonEmptyString,
  bootstrapProjectId: Schema.optional(ProjectId),
  bootstrapThreadId: Schema.optional(ThreadId),
});
export type ServerLifecycleWelcomePayload = typeof ServerLifecycleWelcomePayload.Type;

export const ServerLifecycleStreamWelcomeEvent = Schema.Struct({
  version: Schema.Literal(1),
  sequence: NonNegativeInt,
  type: Schema.Literal("welcome"),
  payload: ServerLifecycleWelcomePayload,
});
export type ServerLifecycleStreamWelcomeEvent = typeof ServerLifecycleStreamWelcomeEvent.Type;

export const ServerLifecycleStreamReadyEvent = Schema.Struct({
  version: Schema.Literal(1),
  sequence: NonNegativeInt,
  type: Schema.Literal("ready"),
  payload: ServerLifecycleReadyPayload,
});
export type ServerLifecycleStreamReadyEvent = typeof ServerLifecycleStreamReadyEvent.Type;

export const ServerLifecycleStreamEvent = Schema.Union([
  ServerLifecycleStreamWelcomeEvent,
  ServerLifecycleStreamReadyEvent,
]);
export type ServerLifecycleStreamEvent = typeof ServerLifecycleStreamEvent.Type;

export const ServerProviderUpdatedPayload = Schema.Struct({
  providers: ServerProviders,
});
export type ServerProviderUpdatedPayload = typeof ServerProviderUpdatedPayload.Type;
