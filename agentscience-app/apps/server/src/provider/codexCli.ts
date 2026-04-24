import type { CodexSettings } from "@agentscience/contracts";
import { statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { resolveManagedAgentScienceCliPathDirs } from "../managedAgentScienceCli";

const DEFAULT_CODEX_BINARY_PATH = "codex";
const MANAGED_BINARY_ENV = "AGENTSCIENCE_MANAGED_CODEX_BINARY_PATH";
const MANAGED_PATH_DIR_ENV = "AGENTSCIENCE_MANAGED_CODEX_PATH_DIR";
const PAPER_TOOLCHAIN_DIR_ENV = "AGENTSCIENCE_PAPER_TOOLCHAIN_DIR";
const PAPER_TOOLCHAIN_BIN_DIR_ENV = "AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR";
const MANAGED_SCIENCE_RUNTIME_DIR_ENV = "AGENTSCIENCE_MANAGED_SCIENCE_RUNTIME_DIR";
const MANAGED_SCIENCE_RUNTIME_BIN_DIR_ENV = "AGENTSCIENCE_MANAGED_SCIENCE_RUNTIME_BIN_DIR";
const MANAGED_PYTHON_PATH_ENV = "AGENTSCIENCE_MANAGED_PYTHON_PATH";
const PAPER_TOOLCHAIN_DIRNAME = "paper-toolchain";
const SCIENCE_RUNTIME_DIRNAME = "science-runtime";
const SAFE_MANAGED_DESKTOP_PATHS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "/usr/bin:/bin:/usr/sbin:/sbin",
  linux: "/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin",
};
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

  return [
    ...normalizedExtraDirs,
    ...entries.filter((entry) => !normalizedExtraDirs.includes(entry)),
  ].join(separator);
}

function normalizePathEnv(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function isDirectory(candidatePath: string | undefined): candidatePath is string {
  if (!candidatePath) {
    return false;
  }
  try {
    return statSync(candidatePath).isDirectory();
  } catch {
    return false;
  }
}

function managedPlatformKeys(): ReadonlyArray<string> {
  return [
    `${process.platform}-${process.arch}`,
    ...(process.platform === "darwin" ? ["darwin-universal"] : []),
  ];
}

function inferPaperToolchainBinDirFromScienceRuntimeDir(
  runtimeDir: string | undefined,
): string | undefined {
  const normalizedRuntimeDir = normalizePathEnv(runtimeDir);
  if (!normalizedRuntimeDir) {
    return undefined;
  }

  const runtimeDirName = basename(normalizedRuntimeDir);
  if (runtimeDirName === SCIENCE_RUNTIME_DIRNAME) {
    return join(dirname(normalizedRuntimeDir), PAPER_TOOLCHAIN_DIRNAME, "bin");
  }

  const runtimeRoot = dirname(normalizedRuntimeDir);
  if (basename(runtimeRoot) === SCIENCE_RUNTIME_DIRNAME) {
    return join(dirname(runtimeRoot), PAPER_TOOLCHAIN_DIRNAME, runtimeDirName, "bin");
  }

  return undefined;
}

function resolveManagedPaperToolchainBinDir(envSource: NodeJS.ProcessEnv): string | undefined {
  const explicitBinDir = normalizePathEnv(envSource[PAPER_TOOLCHAIN_BIN_DIR_ENV]);
  if (explicitBinDir) {
    return explicitBinDir;
  }

  const managedToolchainRoot = normalizePathEnv(envSource[PAPER_TOOLCHAIN_DIR_ENV]);
  const candidates = [
    ...managedPlatformKeys().map((platformKey) =>
      managedToolchainRoot ? join(managedToolchainRoot, platformKey, "bin") : undefined,
    ),
    managedToolchainRoot ? join(managedToolchainRoot, "bin") : undefined,
    inferPaperToolchainBinDirFromScienceRuntimeDir(envSource[MANAGED_SCIENCE_RUNTIME_DIR_ENV]),
    inferPaperToolchainBinDirFromScienceRuntimeDir(
      envSource[MANAGED_SCIENCE_RUNTIME_BIN_DIR_ENV]
        ? dirname(envSource[MANAGED_SCIENCE_RUNTIME_BIN_DIR_ENV]!)
        : undefined,
    ),
    inferPaperToolchainBinDirFromScienceRuntimeDir(
      envSource[MANAGED_PYTHON_PATH_ENV]
        ? dirname(dirname(envSource[MANAGED_PYTHON_PATH_ENV]!))
        : undefined,
    ),
  ];

  return candidates.find(isDirectory);
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
    TECTONIC_CACHE_DIR: join(cacheRoot, "tectonic"),
    TEXMFVAR: join(texRoot, "texmf-var"),
    TEXMFCONFIG: join(texRoot, "texmf-config"),
    TEXMFHOME: join(texRoot, "texmf-home"),
  };
}

function resolveSafeManagedDesktopBasePath(
  platform: NodeJS.Platform,
  pathValue: string | undefined,
): string | undefined {
  const safeDefault = SAFE_MANAGED_DESKTOP_PATHS[platform];
  return safeDefault ?? pathValue;
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

  const managedPaperToolchainBinDir = resolveManagedPaperToolchainBinDir(envSource);
  if (managedPaperToolchainBinDir) {
    env[PAPER_TOOLCHAIN_BIN_DIR_ENV] = managedPaperToolchainBinDir;
  }

  const managedPathEntries = [
    normalizePathEnv(envSource[MANAGED_SCIENCE_RUNTIME_BIN_DIR_ENV]) ?? "",
    managedPaperToolchainBinDir ?? "",
  ].filter((entry) => entry.length > 0);
  const managedBinaryPath = envSource[MANAGED_BINARY_ENV]?.trim();
  const managedPathDir = envSource[MANAGED_PATH_DIR_ENV]?.trim();
  const isManagedDesktopCodex =
    managedBinaryPath && managedBinaryPath.length > 0 && input.binaryPath === managedBinaryPath;
  if (
    managedBinaryPath &&
    managedPathDir &&
    input.binaryPath === managedBinaryPath &&
    managedPathDir.length > 0
  ) {
    managedPathEntries.push(managedPathDir);
  }
  managedPathEntries.push(
    ...resolveManagedAgentScienceCliPathDirs({
      ...(input.cwd ? { shimRoot: join(input.cwd, ".cache", "agentscience", "bin") } : {}),
      runtimeCommand: process.execPath,
    }),
  );

  const basePath = isManagedDesktopCodex
    ? resolveSafeManagedDesktopBasePath(process.platform, env.PATH)
    : env.PATH;

  if (managedPathEntries.length > 0) {
    env.PATH = prependPath(basePath, managedPathEntries);
  } else if (basePath !== undefined && basePath !== env.PATH) {
    env.PATH = basePath;
  }

  const managedScienceRuntimeDir = envSource[MANAGED_SCIENCE_RUNTIME_DIR_ENV]?.trim();
  if (managedScienceRuntimeDir && managedScienceRuntimeDir.length > 0) {
    env.PYTHONHOME = managedScienceRuntimeDir;
  }

  const homePath = input.homePath?.trim();
  if (homePath && homePath.length > 0) {
    env.CODEX_HOME = homePath;
  }

  return env;
}
