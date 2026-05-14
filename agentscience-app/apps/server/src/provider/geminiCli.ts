import type { GeminiSettings } from "@agentscience/contracts";

const DEFAULT_GEMINI_BINARY_PATH = "gemini";
const MANAGED_GEMINI_CLI_ENV = "AGENTSCIENCE_MANAGED_GEMINI_CLI_PATH";
const MANAGED_GEMINI_NODE_ENV = "AGENTSCIENCE_MANAGED_GEMINI_NODE_PATH";

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
