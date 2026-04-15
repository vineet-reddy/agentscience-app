import type { CodexSettings } from "@agentscience/contracts";

const DEFAULT_CODEX_BINARY_PATH = "codex";
const MANAGED_BINARY_ENV = "AGENTSCIENCE_MANAGED_CODEX_BINARY_PATH";
const MANAGED_PATH_DIR_ENV = "AGENTSCIENCE_MANAGED_CODEX_PATH_DIR";
const CODEX_PYTHON_GUARD_ENV = {
  PIP_REQUIRE_VIRTUALENV: "1",
  PIP_DISABLE_PIP_VERSION_CHECK: "1",
  PIP_NO_INPUT: "1",
  PYTHONNOUSERSITE: "1",
} as const;

function prependPath(pathValue: string | undefined, extraDir: string): string {
  const separator = process.platform === "win32" ? ";" : ":";
  const entries = (pathValue ?? "")
    .split(separator)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return [extraDir, ...entries.filter((entry) => entry !== extraDir)].join(separator);
}

export function resolveCodexBinaryPath(settings: Pick<CodexSettings, "binaryPath">): string {
  const explicitBinaryPath = settings.binaryPath.trim();
  if (explicitBinaryPath.length > 0) {
    return explicitBinaryPath;
  }

  const managedBinaryPath = process.env[MANAGED_BINARY_ENV]?.trim();
  if (managedBinaryPath) {
    return managedBinaryPath;
  }

  return DEFAULT_CODEX_BINARY_PATH;
}

export function buildCodexSpawnEnv(input: {
  readonly binaryPath: string;
  readonly homePath?: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...CODEX_PYTHON_GUARD_ENV,
  };

  const managedBinaryPath = process.env[MANAGED_BINARY_ENV]?.trim();
  const managedPathDir = process.env[MANAGED_PATH_DIR_ENV]?.trim();
  if (
    managedBinaryPath &&
    managedPathDir &&
    input.binaryPath === managedBinaryPath &&
    managedPathDir.length > 0
  ) {
    env.PATH = prependPath(env.PATH, managedPathDir);
  }

  const homePath = input.homePath?.trim();
  if (homePath && homePath.length > 0) {
    env.CODEX_HOME = homePath;
  }

  return env;
}
