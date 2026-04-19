import { statSync } from "node:fs";
import { join } from "node:path";

const PAPER_TOOLCHAIN_DIRNAME = "paper-toolchain";
const SCIENCE_RUNTIME_DIRNAME = "science-runtime";

export interface ManagedPlatformBinDir {
  readonly rootDir: string;
  readonly binDir: string;
}

export interface ManagedScienceRuntime extends ManagedPlatformBinDir {
  readonly pythonPath?: string;
  readonly uvPath?: string;
}

function managedPythonCandidates(platform: NodeJS.Platform): ReadonlyArray<string> {
  return platform === "win32" ? ["python.exe", "python3.exe"] : ["python3", "python"];
}

function managedUvCandidates(platform: NodeJS.Platform): ReadonlyArray<string> {
  return platform === "win32" ? ["uv.exe"] : ["uv"];
}

function isDirectory(candidatePath: string): boolean {
  try {
    return statSync(candidatePath).isDirectory();
  } catch {
    return false;
  }
}

function isFile(candidatePath: string): boolean {
  try {
    return statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

function unique<T>(values: ReadonlyArray<T>): T[] {
  return Array.from(new Set(values));
}

function managedResourceRoots(input: {
  readonly resourceDirName: string;
  readonly resourcesPath: string;
  readonly repoRoot?: string;
}): string[] {
  return unique(
    [
      join(input.resourcesPath, "managed-resources", input.resourceDirName),
      input.repoRoot
        ? join(input.repoRoot, "apps", "desktop", "managed-resources", input.resourceDirName)
        : "",
      input.repoRoot ? join(input.repoRoot, "managed-resources", input.resourceDirName) : "",
    ].filter((candidate) => candidate.length > 0),
  );
}

function resolveManagedExecutable(
  binDir: string,
  executableNames: ReadonlyArray<string>,
): string | undefined {
  for (const executableName of executableNames) {
    const candidate = join(binDir, executableName);
    if (isFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function resolveManagedPlatformBinDir(input: {
  readonly resourceDirName: string;
  readonly resourcesPath: string;
  readonly repoRoot?: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
}): ManagedPlatformBinDir | null {
  const platformKey = `${input.platform}-${input.arch}`;

  for (const rootDir of managedResourceRoots(input)) {
    for (const binDir of [join(rootDir, platformKey, "bin"), join(rootDir, "bin")]) {
      if (isDirectory(binDir)) {
        return { rootDir, binDir };
      }
    }
  }

  return null;
}

export function resolveManagedScienceRuntime(input: {
  readonly resourcesPath: string;
  readonly repoRoot?: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
}): ManagedScienceRuntime | null {
  const runtime = resolveManagedPlatformBinDir({
    resourceDirName: SCIENCE_RUNTIME_DIRNAME,
    resourcesPath: input.resourcesPath,
    ...(input.repoRoot ? { repoRoot: input.repoRoot } : {}),
    platform: input.platform,
    arch: input.arch,
  });
  if (!runtime) {
    return null;
  }

  const pythonPath = resolveManagedExecutable(runtime.binDir, managedPythonCandidates(input.platform));
  const uvPath = resolveManagedExecutable(runtime.binDir, managedUvCandidates(input.platform));

  return {
    ...runtime,
    ...(pythonPath ? { pythonPath } : {}),
    ...(uvPath ? { uvPath } : {}),
  };
}

export function buildManagedDesktopServerEnv(input: {
  readonly resourcesPath: string;
  readonly repoRoot?: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  const paperToolchain = resolveManagedPlatformBinDir({
    resourceDirName: PAPER_TOOLCHAIN_DIRNAME,
    resourcesPath: input.resourcesPath,
    ...(input.repoRoot ? { repoRoot: input.repoRoot } : {}),
    platform: input.platform,
    arch: input.arch,
  });
  if (paperToolchain) {
    env.AGENTSCIENCE_PAPER_TOOLCHAIN_DIR = paperToolchain.rootDir;
    env.AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR = paperToolchain.binDir;
  }

  const scienceRuntime = resolveManagedScienceRuntime(input);
  if (scienceRuntime) {
    env.AGENTSCIENCE_MANAGED_SCIENCE_RUNTIME_DIR = scienceRuntime.rootDir;
    env.AGENTSCIENCE_MANAGED_SCIENCE_RUNTIME_BIN_DIR = scienceRuntime.binDir;
    if (scienceRuntime.pythonPath) {
      env.AGENTSCIENCE_MANAGED_PYTHON_PATH = scienceRuntime.pythonPath;
    }
    if (scienceRuntime.uvPath) {
      env.AGENTSCIENCE_MANAGED_UV_PATH = scienceRuntime.uvPath;
    }
  }

  return env;
}
