import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export interface ManagedAgentScienceCliLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly version?: string;
}

interface AgentSciencePackageJson {
  readonly version?: unknown;
  readonly bin?: unknown;
}

interface ManagedAgentScienceCliPathOptions {
  readonly shimRoot?: string;
  readonly runtimeCommand?: string;
}

function readManagedAgentScienceBinPath(
  packageRoot: string,
  packageJson: AgentSciencePackageJson,
): string | null {
  if (typeof packageJson.bin === "string" && packageJson.bin.trim().length > 0) {
    return path.join(packageRoot, packageJson.bin);
  }

  if (
    packageJson.bin &&
    typeof packageJson.bin === "object" &&
    typeof (packageJson.bin as Record<string, unknown>).agentscience === "string"
  ) {
    const agentscienceBinPath = (packageJson.bin as Record<string, string | undefined>).agentscience;
    return agentscienceBinPath ? path.join(packageRoot, agentscienceBinPath) : null;
  }

  return null;
}

function findPackageJsonFromModuleEntry(moduleEntryPath: string): string | null {
  let currentDir = path.dirname(moduleEntryPath);

  while (currentDir !== path.dirname(currentDir)) {
    const candidate = path.join(currentDir, "package.json");
    if (existsSync(candidate)) {
      try {
        const packageJson = JSON.parse(readFileSync(candidate, "utf8")) as { name?: unknown };
        if (packageJson.name === "agentscience") {
          return candidate;
        }
      } catch {
        return null;
      }
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

function resolveManagedAgentSciencePackageJsonPath(): string | null {
  try {
    return require.resolve("agentscience/package.json");
  } catch {
    try {
      return findPackageJsonFromModuleEntry(require.resolve("agentscience"));
    } catch {
      return null;
    }
  }
}

function readManagedAgentSciencePackage():
  | { readonly packageRoot: string; readonly packageJson: AgentSciencePackageJson }
  | null {
  const packageJsonPath = resolveManagedAgentSciencePackageJsonPath();
  if (!packageJsonPath) {
    return null;
  }

  try {
    return {
      packageRoot: path.dirname(packageJsonPath),
      packageJson: JSON.parse(readFileSync(packageJsonPath, "utf8")) as AgentSciencePackageJson,
    };
  } catch {
    return null;
  }
}

function posixShellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function windowsBatchQuote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function writeExecutableIfChanged(filePath: string, content: string): void {
  if (existsSync(filePath)) {
    try {
      if (readFileSync(filePath, "utf8") === content) {
        chmodSync(filePath, 0o755);
        return;
      }
    } catch {
      // Rewrite below.
    }
  }

  writeFileSync(filePath, content, "utf8");
  chmodSync(filePath, 0o755);
}

function ensureManagedAgentScienceCliShim(input: {
  readonly shimRoot: string;
  readonly runtimeCommand: string;
  readonly cliBinPath: string;
}): string | null {
  try {
    mkdirSync(input.shimRoot, { recursive: true });

    writeExecutableIfChanged(
      path.join(input.shimRoot, "agentscience"),
      [
        "#!/bin/sh",
        `ELECTRON_RUN_AS_NODE=1 exec ${posixShellQuote(input.runtimeCommand)} ${posixShellQuote(input.cliBinPath)} "$@"`,
        "",
      ].join("\n"),
    );

    writeExecutableIfChanged(
      path.join(input.shimRoot, "agentscience.cmd"),
      [
        "@echo off",
        "set ELECTRON_RUN_AS_NODE=1",
        `${windowsBatchQuote(input.runtimeCommand)} ${windowsBatchQuote(input.cliBinPath)} %*`,
        "",
      ].join("\r\n"),
    );

    return input.shimRoot;
  } catch {
    return null;
  }
}

export function resolveManagedAgentScienceCliLaunch(
  cliArgs: readonly string[] = [],
): ManagedAgentScienceCliLaunch | null {
  const managedPackage = readManagedAgentSciencePackage();
  if (!managedPackage) {
    return null;
  }

  const binPath = readManagedAgentScienceBinPath(
    managedPackage.packageRoot,
    managedPackage.packageJson,
  );
  if (!binPath) {
    return null;
  }

  return {
    command: process.execPath,
    args: [binPath, ...cliArgs],
    ...(typeof managedPackage.packageJson.version === "string" &&
    managedPackage.packageJson.version.trim().length > 0
      ? { version: managedPackage.packageJson.version.trim() }
      : {}),
  };
}

export function resolveManagedAgentScienceCliPathDirs(
  options: ManagedAgentScienceCliPathOptions = {},
): readonly string[] {
  const managedPackage = readManagedAgentSciencePackage();
  if (!managedPackage) {
    return [];
  }

  const binPath = readManagedAgentScienceBinPath(
    managedPackage.packageRoot,
    managedPackage.packageJson,
  );
  if (!binPath) {
    return [];
  }

  const packageNodeModulesDir = path.dirname(managedPackage.packageRoot);
  const shimDir = options.shimRoot
    ? ensureManagedAgentScienceCliShim({
        shimRoot: options.shimRoot,
        runtimeCommand: options.runtimeCommand ?? process.execPath,
        cliBinPath: binPath,
      })
    : null;
  const candidates = [
    shimDir,
    path.dirname(binPath),
    path.join(packageNodeModulesDir, ".bin"),
  ].filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return Array.from(new Set(candidates));
}
