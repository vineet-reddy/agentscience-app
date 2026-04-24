import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildManagedDesktopServerEnv,
  resolveManagedPlatformBinDir,
  resolveManagedScienceRuntime,
} from "./managedDesktopTooling";

function createTempRoot(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("resolveManagedPlatformBinDir", () => {
  it("prefers packaged managed resources when present", () => {
    const resourcesRoot = createTempRoot("agentscience-managed-resources-");
    const repoRoot = createTempRoot("agentscience-managed-repo-");

    try {
      const packagedBinDir = path.join(
        resourcesRoot,
        "managed-resources",
        "paper-toolchain",
        "darwin-arm64",
        "bin",
      );
      mkdirSync(packagedBinDir, { recursive: true });

      const resolved = resolveManagedPlatformBinDir({
        resourceDirName: "paper-toolchain",
        resourcesPath: resourcesRoot,
        repoRoot,
        platform: "darwin",
        arch: "arm64",
      });

      expect(resolved).toEqual({
        rootDir: path.join(resourcesRoot, "managed-resources", "paper-toolchain"),
        platformDir: path.join(
          resourcesRoot,
          "managed-resources",
          "paper-toolchain",
          "darwin-arm64",
        ),
        binDir: packagedBinDir,
      });
    } finally {
      rmSync(resourcesRoot, { recursive: true, force: true });
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("falls back to the repo-managed resources during development", () => {
    const resourcesRoot = createTempRoot("agentscience-managed-resources-");
    const repoRoot = createTempRoot("agentscience-managed-repo-");

    try {
      const repoBinDir = path.join(
        repoRoot,
        "apps",
        "desktop",
        "managed-resources",
        "paper-toolchain",
        "linux-x64",
        "bin",
      );
      mkdirSync(repoBinDir, { recursive: true });

      const resolved = resolveManagedPlatformBinDir({
        resourceDirName: "paper-toolchain",
        resourcesPath: resourcesRoot,
        repoRoot,
        platform: "linux",
        arch: "x64",
      });

      expect(resolved).toEqual({
        rootDir: path.join(repoRoot, "apps", "desktop", "managed-resources", "paper-toolchain"),
        platformDir: path.join(
          repoRoot,
          "apps",
          "desktop",
          "managed-resources",
          "paper-toolchain",
          "linux-x64",
        ),
        binDir: repoBinDir,
      });
    } finally {
      rmSync(resourcesRoot, { recursive: true, force: true });
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("supports a shared managed macOS universal toolchain", () => {
    const resourcesRoot = createTempRoot("agentscience-managed-resources-");

    try {
      const packagedBinDir = path.join(
        resourcesRoot,
        "managed-resources",
        "paper-toolchain",
        "darwin-universal",
        "bin",
      );
      mkdirSync(packagedBinDir, { recursive: true });

      const resolved = resolveManagedPlatformBinDir({
        resourceDirName: "paper-toolchain",
        resourcesPath: resourcesRoot,
        platform: "darwin",
        arch: "arm64",
      });

      expect(resolved).toEqual({
        rootDir: path.join(resourcesRoot, "managed-resources", "paper-toolchain"),
        platformDir: path.join(
          resourcesRoot,
          "managed-resources",
          "paper-toolchain",
          "darwin-universal",
        ),
        binDir: packagedBinDir,
      });
    } finally {
      rmSync(resourcesRoot, { recursive: true, force: true });
    }
  });
});

describe("resolveManagedScienceRuntime", () => {
  it("detects the managed python and uv executables", () => {
    const resourcesRoot = createTempRoot("agentscience-science-runtime-");

    try {
      const binDir = path.join(
        resourcesRoot,
        "managed-resources",
        "science-runtime",
        "linux-x64",
        "bin",
      );
      mkdirSync(binDir, { recursive: true });
      writeFileSync(path.join(binDir, "python3"), "");
      writeFileSync(path.join(binDir, "uv"), "");

      const runtime = resolveManagedScienceRuntime({
        resourcesPath: resourcesRoot,
        platform: "linux",
        arch: "x64",
      });

      expect(runtime).toEqual({
        rootDir: path.join(resourcesRoot, "managed-resources", "science-runtime"),
        platformDir: path.join(resourcesRoot, "managed-resources", "science-runtime", "linux-x64"),
        binDir,
        pythonPath: path.join(binDir, "python3"),
        uvPath: path.join(binDir, "uv"),
      });
    } finally {
      rmSync(resourcesRoot, { recursive: true, force: true });
    }
  });
});

describe("buildManagedDesktopServerEnv", () => {
  it("exports managed toolchain and science runtime variables for the backend", () => {
    const resourcesRoot = createTempRoot("agentscience-managed-env-");

    try {
      const paperBinDir = path.join(
        resourcesRoot,
        "managed-resources",
        "paper-toolchain",
        "linux-x64",
        "bin",
      );
      const scienceBinDir = path.join(
        resourcesRoot,
        "managed-resources",
        "science-runtime",
        "linux-x64",
        "bin",
      );
      mkdirSync(paperBinDir, { recursive: true });
      mkdirSync(scienceBinDir, { recursive: true });
      writeFileSync(path.join(scienceBinDir, "python3"), "");
      writeFileSync(path.join(scienceBinDir, "uv"), "");

      expect(
        buildManagedDesktopServerEnv({
          resourcesPath: resourcesRoot,
          platform: "linux",
          arch: "x64",
        }),
      ).toEqual({
        AGENTSCIENCE_PAPER_TOOLCHAIN_DIR: path.join(
          resourcesRoot,
          "managed-resources",
          "paper-toolchain",
        ),
        AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR: paperBinDir,
        AGENTSCIENCE_MANAGED_SCIENCE_RUNTIME_DIR: path.join(
          resourcesRoot,
          "managed-resources",
          "science-runtime",
          "linux-x64",
        ),
        AGENTSCIENCE_MANAGED_SCIENCE_RUNTIME_BIN_DIR: scienceBinDir,
        AGENTSCIENCE_MANAGED_PYTHON_PATH: path.join(scienceBinDir, "python3"),
        AGENTSCIENCE_MANAGED_UV_PATH: path.join(scienceBinDir, "uv"),
      });
    } finally {
      rmSync(resourcesRoot, { recursive: true, force: true });
    }
  });
});
