import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export interface ManagedCodexRuntime {
  readonly binaryPath: string;
  readonly pathDir: string;
}

function resolveCodexTargetTriple(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === "darwin") {
    if (arch === "arm64") return "aarch64-apple-darwin";
    if (arch === "x64") return "x86_64-apple-darwin";
    return null;
  }

  if (platform === "linux") {
    if (arch === "arm64") return "aarch64-unknown-linux-musl";
    if (arch === "x64") return "x86_64-unknown-linux-musl";
    return null;
  }

  if (platform === "win32") {
    if (arch === "arm64") return "aarch64-pc-windows-msvc";
    if (arch === "x64") return "x86_64-pc-windows-msvc";
    return null;
  }

  return null;
}

function resolveManagedCodexBinaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "codex.exe" : "codex";
}

function isManagedCodexRuntime(
  rootDir: string,
  targetTriple: string,
  platform: NodeJS.Platform,
): boolean {
  const binaryName = resolveManagedCodexBinaryName(platform);
  return (
    existsSync(join(rootDir, targetTriple, "codex", binaryName)) &&
    existsSync(join(rootDir, targetTriple, "path"))
  );
}

function fromRoot(
  rootDir: string,
  targetTriple: string,
  platform: NodeJS.Platform,
): ManagedCodexRuntime | null {
  if (!isManagedCodexRuntime(rootDir, targetTriple, platform)) {
    return null;
  }

  const binaryName = resolveManagedCodexBinaryName(platform);
  return {
    binaryPath: join(rootDir, targetTriple, "codex", binaryName),
    pathDir: join(rootDir, targetTriple, "path"),
  };
}

export function resolveManagedCodexRuntime(input: {
  readonly resourcesPath: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
}): ManagedCodexRuntime | null {
  const targetTriple = resolveCodexTargetTriple(input.platform, input.arch);
  if (!targetTriple) {
    return null;
  }

  const packagedRuntime = fromRoot(
    join(input.resourcesPath, "managed-resources", "codex-runtime"),
    targetTriple,
    input.platform,
  );
  if (packagedRuntime) {
    return packagedRuntime;
  }

  try {
    const packageJsonPath = require.resolve("@openai/codex/package.json");
    const packageRoot = dirname(packageJsonPath);
    const vendorRoot = join(
      dirname(packageRoot),
      `codex-${input.platform}-${input.arch}`,
      "vendor",
    );
    const localRuntime = fromRoot(vendorRoot, targetTriple, input.platform);
    if (localRuntime) {
      return localRuntime;
    }
  } catch {
    return null;
  }

  return null;
}
