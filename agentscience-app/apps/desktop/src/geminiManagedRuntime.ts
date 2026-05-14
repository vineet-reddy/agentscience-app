import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export interface ManagedGeminiRuntime {
  readonly cliPath: string;
  readonly nodePath: string;
}

function fromCliPath(cliPath: string, nodePath: string): ManagedGeminiRuntime | null {
  return existsSync(cliPath) ? { cliPath, nodePath } : null;
}

export function resolveManagedGeminiRuntime(input: {
  readonly resourcesPath: string;
  readonly repoRoot?: string;
  readonly nodePath: string;
}): ManagedGeminiRuntime | null {
  const packagedRuntime = fromCliPath(
    join(input.resourcesPath, "managed-resources", "gemini-runtime", "gemini.js"),
    input.nodePath,
  );
  if (packagedRuntime) {
    return packagedRuntime;
  }

  if (input.repoRoot) {
    const devRuntime = fromCliPath(
      join(input.repoRoot, "apps", "desktop", "managed-resources", "gemini-runtime", "gemini.js"),
      input.nodePath,
    );
    if (devRuntime) {
      return devRuntime;
    }
  }

  try {
    const packageJsonPath = require.resolve("@google/gemini-cli/package.json");
    const packageRoot = dirname(packageJsonPath);
    const packageRuntime = fromCliPath(join(packageRoot, "bundle", "gemini.js"), input.nodePath);
    if (packageRuntime) {
      return packageRuntime;
    }
  } catch {
    return null;
  }

  return null;
}
