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
import { resolveEffectiveGeminiSettings } from "../geminiSettings";
import { GeminiProvider } from "../Services/GeminiProvider";
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
  const geminiSettings = yield* settingsService.getSettings.pipe(
    Effect.map((settings) => resolveEffectiveGeminiSettings(settings.providers.gemini)),
  );
  const command = ChildProcess.make(geminiSettings.binaryPath, [...args], {
    shell: process.platform === "win32",
  });
  return yield* spawnAndCollect(geminiSettings.binaryPath, command);
});

export const checkGeminiProviderStatus = Effect.fn("checkGeminiProviderStatus")(function* () {
  const settingsService = yield* ServerSettingsService;
  const geminiSettings = yield* settingsService.getSettings.pipe(
    Effect.map((settings) => resolveEffectiveGeminiSettings(settings.providers.gemini)),
  );
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(BUILT_IN_MODELS, PROVIDER, geminiSettings.customModels);

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
          ? "AgentScience could not find Gemini CLI. Install it or set a custom Gemini binary path."
          : `Failed to execute Gemini CLI health check: ${
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
        message: "Gemini CLI is installed but failed to run. Timed out while running command.",
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
          ? `Gemini CLI is installed but failed to run. ${detail}`
          : "Gemini CLI is installed but failed to run.",
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
        status: "unknown",
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
        "Gemini CLI is installed. Authentication is verified when AgentScience starts a Gemini session.",
    },
  });
});

export const GeminiProviderLive = Layer.effect(
  GeminiProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const checkProvider = checkGeminiProviderStatus().pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
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
