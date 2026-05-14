import type { GeminiSettings, ModelCapabilities, ServerProviderModel } from "@agentscience/contracts";
import { Effect, Equal, Layer, Option, Result, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
} from "../providerSnapshot";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import { buildAgentScienceGeminiEnv, buildGeminiLaunchSpec } from "../geminiCli";
import { resolveEffectiveGeminiSettings } from "../geminiSettings";
import { hasGeminiGoogleAuthMarker } from "../providerAuthMarkers";
import { readProviderApiKey } from "../providerApiKeys";
import { GeminiProvider } from "../Services/GeminiProvider";
import { ServerConfig } from "../../config";
import { ServerSettingsService } from "../../serverSettings";

const PROVIDER = "gemini" as const;

const GEMINI_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview",
    isCustom: false,
    capabilities: GEMINI_CAPABILITIES,
  },
  {
    slug: "gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview",
    isCustom: false,
    capabilities: GEMINI_CAPABILITIES,
  },
  {
    slug: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash-Lite",
    isCustom: false,
    capabilities: GEMINI_CAPABILITIES,
  },
];

const runGeminiCommand = Effect.fn("runGeminiCommand")(function* (args: ReadonlyArray<string>) {
  const settingsService = yield* ServerSettingsService;
  const serverConfig = yield* ServerConfig;
  const geminiSettings = yield* settingsService.getSettings.pipe(
    Effect.map((settings) => resolveEffectiveGeminiSettings(settings.providers.gemini)),
  );
  const geminiApiKey =
    geminiSettings.authMethod === "gemini-api-key"
      ? yield* readProviderApiKey(serverConfig.stateDir, PROVIDER)
      : undefined;
  const launchSpec = buildGeminiLaunchSpec({
    binaryPath: geminiSettings.binaryPath,
    args,
    processEnv: buildAgentScienceGeminiEnv({
      stateDir: serverConfig.stateDir,
      apiKey: geminiApiKey,
    }),
  });
  const command = ChildProcess.make(launchSpec.command, [...launchSpec.args], {
    env: launchSpec.env,
    shell: launchSpec.shell,
  });
  return yield* spawnAndCollect(launchSpec.command, command);
});

export const checkGeminiProviderStatus = Effect.fn("checkGeminiProviderStatus")(function* () {
  const settingsService = yield* ServerSettingsService;
  const serverConfig = yield* ServerConfig;
  const geminiSettings = yield* settingsService.getSettings.pipe(
    Effect.map((settings) => resolveEffectiveGeminiSettings(settings.providers.gemini)),
  );
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(BUILT_IN_MODELS, PROVIDER, geminiSettings.customModels);
  const geminiApiKey =
    geminiSettings.authMethod === "gemini-api-key"
      ? yield* readProviderApiKey(serverConfig.stateDir, PROVIDER)
      : undefined;
  const hasGoogleAuth =
    geminiSettings.authMethod === "oauth-personal"
      ? yield* hasGeminiGoogleAuthMarker(serverConfig.stateDir)
      : false;

  if (!geminiSettings.enabled) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Gemini is turned off in AgentScience advanced settings.",
      },
    });
  }

  const versionProbe = yield* runGeminiCommand(["--version"]).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      provider: PROVIDER,
      enabled: geminiSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "AgentScience could not start Gemini. Reinstall AgentScience or open advanced setup."
          : `Failed to check Gemini: ${
              error instanceof Error ? error.message : String(error)
            }.`,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: geminiSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Gemini did not respond in time.",
      },
    });
  }

  const version = versionProbe.success.value;
  const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return buildServerProvider({
      provider: PROVIDER,
      enabled: geminiSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `Gemini failed to start. ${detail}`
          : "Gemini failed to start.",
      },
    });
  }

  return buildServerProvider({
    provider: PROVIDER,
    enabled: geminiSettings.enabled,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: parsedVersion,
      status: "ready",
      auth: {
        status:
          geminiSettings.authMethod === "gemini-api-key" && geminiApiKey
            ? "authenticated"
            : geminiSettings.authMethod === "oauth-personal" && hasGoogleAuth
              ? "authenticated"
              : "unknown",
        type: geminiSettings.authMethod,
        label:
          geminiSettings.authMethod === "oauth-personal"
            ? "Google account"
            : geminiSettings.authMethod === "gemini-api-key"
              ? "Gemini API key"
              : geminiSettings.authMethod === "vertex-ai"
                ? "Vertex AI"
                : "AI API Gateway",
      },
      message:
        geminiSettings.authMethod === "gemini-api-key" && geminiApiKey
          ? "Gemini is ready to use."
          : geminiSettings.authMethod === "oauth-personal" && hasGoogleAuth
            ? "Gemini is ready to use."
            : "Gemini is installed. Sign in to use it in AgentScience.",
    },
  });
});

export const GeminiProviderLive = Layer.effect(
  GeminiProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const serverConfig = yield* ServerConfig;
    const checkProvider = checkGeminiProviderStatus().pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.provideService(ServerConfig, serverConfig),
    );

    return yield* makeManagedServerProvider<GeminiSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.gemini),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.gemini),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider,
    });
  }),
);
