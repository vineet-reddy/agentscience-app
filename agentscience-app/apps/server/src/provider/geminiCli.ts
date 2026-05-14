import type { GeminiSettings } from "@agentscience/contracts";
import path from "node:path";

import { resolveManagedAgentScienceCliPathDirs } from "../managedAgentScienceCli";

const DEFAULT_GEMINI_BINARY_PATH = "gemini";
const MANAGED_GEMINI_CLI_ENV = "AGENTSCIENCE_MANAGED_GEMINI_CLI_PATH";
const MANAGED_GEMINI_NODE_ENV = "AGENTSCIENCE_MANAGED_GEMINI_NODE_PATH";
const GEMINI_HOME_DIR_NAME = "gemini";

const GEMINI_AUTH_ENV_KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_ACCESS_TOKEN",
  "GOOGLE_GENAI_USE_GCA",
  "CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE",
] as const;

function prependPath(pathValue: string | undefined, extraDirs: ReadonlyArray<string>): string {
  const separator = process.platform === "win32" ? ";" : ":";
  const entries = (pathValue ?? "")
    .split(separator)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const normalizedExtraDirs = extraDirs
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return [
    ...normalizedExtraDirs,
    ...entries.filter((entry) => !normalizedExtraDirs.includes(entry)),
  ].join(separator);
}

export function resolveGeminiBinaryPath(settings: Pick<GeminiSettings, "binaryPath">): string {
  const explicitBinaryPath = settings.binaryPath.trim();
  if (explicitBinaryPath.length > 0) {
    return explicitBinaryPath;
  }

  const managedCliPath = process.env[MANAGED_GEMINI_CLI_ENV]?.trim();
  if (managedCliPath) {
    return managedCliPath;
  }

  return DEFAULT_GEMINI_BINARY_PATH;
}

export function buildGeminiLaunchSpec(input: {
  readonly binaryPath: string;
  readonly args: ReadonlyArray<string>;
  readonly processEnv?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
}): {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
  readonly shell: boolean;
} {
  const envSource = input.processEnv ?? process.env;
  const platform = input.platform ?? process.platform;
  const managedCliPath = envSource[MANAGED_GEMINI_CLI_ENV]?.trim();
  const managedNodePath = envSource[MANAGED_GEMINI_NODE_ENV]?.trim();
  const isManagedGemini =
    managedCliPath &&
    managedNodePath &&
    input.binaryPath === managedCliPath &&
    managedCliPath.length > 0 &&
    managedNodePath.length > 0;

  if (isManagedGemini) {
    return {
      command: managedNodePath,
      args: [input.binaryPath, ...input.args],
      env: {
        ...envSource,
        ELECTRON_RUN_AS_NODE: "1",
      },
      shell: platform === "win32",
    };
  }

  return {
    command: input.binaryPath,
    args: input.args,
    env: { ...envSource },
    shell: platform === "win32",
  };
}

export function resolveAgentScienceGeminiHome(stateDir: string): string {
  return path.join(stateDir, GEMINI_HOME_DIR_NAME);
}

export function buildAgentScienceGeminiEnv(input: {
  readonly stateDir: string;
  readonly cwd?: string | undefined;
  readonly processEnv?: NodeJS.ProcessEnv;
  readonly apiKey?: string | undefined;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(input.processEnv ?? process.env) };
  for (const key of GEMINI_AUTH_ENV_KEYS) {
    delete env[key];
  }
  env.GEMINI_CLI_HOME = resolveAgentScienceGeminiHome(input.stateDir);
  env.GEMINI_FORCE_ENCRYPTED_FILE_STORAGE = "false";
  const managedAgentScienceCliDirs = resolveManagedAgentScienceCliPathDirs({
    ...(input.cwd
      ? { shimRoot: path.join(input.cwd, ".cache", "agentscience", "bin") }
      : {}),
    runtimeCommand: process.execPath,
  });
  if (managedAgentScienceCliDirs.length > 0) {
    env.PATH = prependPath(env.PATH, managedAgentScienceCliDirs);
  }
  if (input.apiKey) {
    env.GEMINI_API_KEY = input.apiKey;
    env.GOOGLE_API_KEY = input.apiKey;
  }
  return env;
}
