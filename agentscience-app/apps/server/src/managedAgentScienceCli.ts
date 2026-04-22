import { readFileSync } from "node:fs";
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

export function resolveManagedAgentScienceCliLaunch(
  cliArgs: readonly string[] = [],
): ManagedAgentScienceCliLaunch | null {
  try {
    const packageJsonPath = require.resolve("agentscience/package.json");
    const packageRoot = path.dirname(packageJsonPath);
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as AgentSciencePackageJson;
    const binPath = readManagedAgentScienceBinPath(packageRoot, packageJson);
    if (!binPath) {
      return null;
    }

    return {
      command: process.execPath,
      args: [binPath, ...cliArgs],
      ...(typeof packageJson.version === "string" && packageJson.version.trim().length > 0
        ? { version: packageJson.version.trim() }
        : {}),
    };
  } catch {
    return null;
  }
}
