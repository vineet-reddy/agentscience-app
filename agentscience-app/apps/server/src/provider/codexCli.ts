import type { CodexSettings } from "@agentscience/contracts";
import { join } from "node:path";

const DEFAULT_CODEX_BINARY_PATH = "codex";
const MANAGED_BINARY_ENV = "AGENTSCIENCE_MANAGED_CODEX_BINARY_PATH";
const MANAGED_PATH_DIR_ENV = "AGENTSCIENCE_MANAGED_CODEX_PATH_DIR";
const PAPER_TOOLCHAIN_BIN_DIR_ENV = "AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR";
const MANAGED_SCIENCE_RUNTIME_BIN_DIR_ENV = "AGENTSCIENCE_MANAGED_SCIENCE_RUNTIME_BIN_DIR";
const CODEX_PYTHON_GUARD_ENV = {
  PIP_REQUIRE_VIRTUALENV: "1",
  PIP_DISABLE_PIP_VERSION_CHECK: "1",
  PIP_NO_INPUT: "1",
  PYTHONNOUSERSITE: "1",
} as const;

function prependPath(pathValue: string | undefined, extraDirs: ReadonlyArray<string>): string {
  const separator = process.platform === "win32" ? ";" : ":";
  const entries = (pathValue ?? "")
    .split(separator)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const normalizedExtraDirs = extraDirs
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return [...normalizedExtraDirs, ...entries.filter((entry) => !normalizedExtraDirs.includes(entry))]
    .join(separator);
}

function buildWorkspaceLocalExecutionEnv(cwd: string): NodeJS.ProcessEnv {
  const cacheRoot = join(cwd, ".cache");
  const configRoot = join(cwd, ".config");
  const tmpRoot = join(cwd, ".tmp");
  const texRoot = join(cwd, ".texlive");

  return {
    XDG_CACHE_HOME: cacheRoot,
    XDG_CONFIG_HOME: configRoot,
    TMPDIR: tmpRoot,
    TEMP: tmpRoot,
    TMP: tmpRoot,
    MPLBACKEND: "Agg",
    MPLCONFIGDIR: join(configRoot, "matplotlib"),
    PIP_CACHE_DIR: join(cacheRoot, "pip"),
    UV_CACHE_DIR: join(cacheRoot, "uv"),
    PYTHONPYCACHEPREFIX: join(cacheRoot, "pycache"),
    TEXMFVAR: join(texRoot, "texmf-var"),
    TEXMFCONFIG: join(texRoot, "texmf-config"),
    TEXMFHOME: join(texRoot, "texmf-home"),
  };
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
  readonly processEnv?: NodeJS.ProcessEnv;
  readonly cwd?: string;
}): NodeJS.ProcessEnv {
  const envSource = input.processEnv ?? process.env;
  const env: NodeJS.ProcessEnv = {
    ...envSource,
    ...CODEX_PYTHON_GUARD_ENV,
    ...(input.cwd ? buildWorkspaceLocalExecutionEnv(input.cwd) : {}),
  };

  const managedPathEntries = [
    envSource[MANAGED_SCIENCE_RUNTIME_BIN_DIR_ENV]?.trim() ?? "",
    envSource[PAPER_TOOLCHAIN_BIN_DIR_ENV]?.trim() ?? "",
  ].filter((entry) => entry.length > 0);
  const managedBinaryPath = envSource[MANAGED_BINARY_ENV]?.trim();
  const managedPathDir = envSource[MANAGED_PATH_DIR_ENV]?.trim();
  if (
    managedBinaryPath &&
    managedPathDir &&
    input.binaryPath === managedBinaryPath &&
    managedPathDir.length > 0
  ) {
    managedPathEntries.push(managedPathDir);
  }

  if (managedPathEntries.length > 0) {
    env.PATH = prependPath(env.PATH, managedPathEntries);
  }

  const homePath = input.homePath?.trim();
  if (homePath && homePath.length > 0) {
    env.CODEX_HOME = homePath;
  }

  return env;
}
