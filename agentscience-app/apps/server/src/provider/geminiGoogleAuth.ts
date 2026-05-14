import { spawn } from "node:child_process";

import { ServerSettingsError } from "@agentscience/contracts";
import { Effect } from "effect";

import { ServerConfig } from "../config";
import { ServerSettingsService } from "../serverSettings";
import { AcpJsonRpcClient } from "./acpJsonRpcClient";
import { buildAgentScienceGeminiEnv, buildGeminiLaunchSpec } from "./geminiCli";
import { resolveEffectiveGeminiSettings } from "./geminiSettings";
import { markGeminiGoogleAuthenticated } from "./providerAuthMarkers";
import { removeProviderApiKey } from "./providerApiKeys";

const ACP_PROTOCOL_VERSION = 1;
const GEMINI_GOOGLE_AUTH_METHOD = "oauth-personal";
const GEMINI_AUTH_TIMEOUT_MS = 6 * 60_000;

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  if (cause && typeof cause === "object" && "message" in cause) {
    const message = String(cause.message);
    if (message.trim().length > 0) return message;
  }
  return fallback;
}

function settingsError(config: { settingsPath: string }, cause: unknown, fallback: string) {
  return new ServerSettingsError({
    settingsPath: config.settingsPath,
    detail: toMessage(cause, fallback),
    cause,
  });
}

export const loginGeminiWithGoogle = Effect.fn("loginGeminiWithGoogle")(function* () {
  const config = yield* ServerConfig;
  const serverSettings = yield* ServerSettingsService;
  const current = yield* serverSettings.getSettings;
  const settings = resolveEffectiveGeminiSettings(current.providers.gemini);
  const launchSpec = buildGeminiLaunchSpec({
    binaryPath: settings.binaryPath,
    args: ["--acp"],
    processEnv: buildAgentScienceGeminiEnv({
      stateDir: config.stateDir,
    }),
  });
  const stderr: string[] = [];
  const stdoutText: string[] = [];

  yield* Effect.tryPromise({
    try: async () => {
      const child = spawn(launchSpec.command, [...launchSpec.args], {
        cwd: config.cwd,
        env: launchSpec.env,
        shell: launchSpec.shell,
      });
      const client = new AcpJsonRpcClient(child, {
        requestTimeoutMs: GEMINI_AUTH_TIMEOUT_MS,
        onStdoutText: (text) => {
          stdoutText.push(text);
        },
        onStderrText: (text) => {
          stderr.push(text);
        },
        onRequest: async (_id, method) => {
          throw new Error(`Unsupported Gemini sign-in request: ${method}`);
        },
      });
      try {
        await client.request("initialize", {
          protocolVersion: ACP_PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: {
            name: "agentscience",
            title: "AgentScience",
            version: "0.0.0",
          },
        });
        await client.request("authenticate", {
          methodId: GEMINI_GOOGLE_AUTH_METHOD,
        });
      } finally {
        client.dispose();
      }
    },
    catch: (cause) => {
      const detail = [
        toMessage(cause, "Google sign-in failed."),
        stderr.join("").trim(),
        stdoutText.join("\n").trim(),
      ]
        .filter((part) => part.length > 0)
        .join("\n");
      return settingsError(config, cause, detail || "Google sign-in failed.");
    },
  });

  yield* markGeminiGoogleAuthenticated(config.stateDir);
  yield* removeProviderApiKey(config.stateDir, "gemini");

  return yield* serverSettings.updateSettings({
    providers: {
      ...current.providers,
      gemini: {
        ...current.providers.gemini,
        enabled: true,
        authMethod: GEMINI_GOOGLE_AUTH_METHOD,
      },
    },
  });
});
