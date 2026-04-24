import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildCodexSpawnEnv } from "./codexCli";

function expectedManagedDesktopBasePath(): string {
  switch (process.platform) {
    case "darwin":
      return "/usr/bin:/bin:/usr/sbin:/sbin";
    case "linux":
      return "/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin";
    default:
      return "/usr/bin:/bin";
  }
}

describe("buildCodexSpawnEnv", () => {
  it("prepends managed science and paper toolchain bins to PATH", () => {
    const env = buildCodexSpawnEnv({
      binaryPath: "/opt/managed/codex",
      processEnv: {
        PATH: "/usr/bin:/bin",
        AGENTSCIENCE_MANAGED_CODEX_BINARY_PATH: "/opt/managed/codex",
        AGENTSCIENCE_MANAGED_CODEX_PATH_DIR: "/opt/managed/bin",
        AGENTSCIENCE_MANAGED_SCIENCE_RUNTIME_DIR: "/opt/science",
        AGENTSCIENCE_MANAGED_SCIENCE_RUNTIME_BIN_DIR: "/opt/science/bin",
        AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR: "/opt/tex/bin",
      },
    });

    expect(env.PATH).toBe(
      `/opt/science/bin:/opt/tex/bin:/opt/managed/bin:${expectedManagedDesktopBasePath()}`,
    );
    expect(env.PYTHONHOME).toBe("/opt/science");
  });

  it("infers the bundled paper toolchain from the managed science runtime tree", () => {
    const resourcesRoot = mkdtempSync(path.join(os.tmpdir(), "agentscience-codex-env-"));

    try {
      const platformKey = `${process.platform}-${process.arch}`;
      const scienceRuntimeDir = path.join(
        resourcesRoot,
        "managed-resources",
        "science-runtime",
        platformKey,
      );
      const scienceBinDir = path.join(scienceRuntimeDir, "bin");
      const paperBinDir = path.join(
        resourcesRoot,
        "managed-resources",
        "paper-toolchain",
        platformKey,
        "bin",
      );
      mkdirSync(scienceBinDir, { recursive: true });
      mkdirSync(paperBinDir, { recursive: true });

      const env = buildCodexSpawnEnv({
        binaryPath: "/opt/managed/codex",
        processEnv: {
          PATH: "/usr/bin:/bin",
          AGENTSCIENCE_MANAGED_CODEX_BINARY_PATH: "/opt/managed/codex",
          AGENTSCIENCE_MANAGED_CODEX_PATH_DIR: "/opt/managed/bin",
          AGENTSCIENCE_MANAGED_SCIENCE_RUNTIME_DIR: scienceRuntimeDir,
          AGENTSCIENCE_MANAGED_SCIENCE_RUNTIME_BIN_DIR: scienceBinDir,
        },
      });

      expect(env.AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR).toBe(paperBinDir);
      expect(env.PATH).toBe(
        `${scienceBinDir}:${paperBinDir}:/opt/managed/bin:${expectedManagedDesktopBasePath()}`,
      );
    } finally {
      rmSync(resourcesRoot, { recursive: true, force: true });
    }
  });

  it("injects workspace-local cache, temp, and TeX env defaults when a cwd is provided", () => {
    const env = buildCodexSpawnEnv({
      binaryPath: "codex",
      cwd: "/tmp/worktree",
      processEnv: {},
    });

    expect(env).toMatchObject({
      XDG_CACHE_HOME: "/tmp/worktree/.cache",
      XDG_CONFIG_HOME: "/tmp/worktree/.config",
      TMPDIR: "/tmp/worktree/.tmp",
      TEMP: "/tmp/worktree/.tmp",
      TMP: "/tmp/worktree/.tmp",
      MPLBACKEND: "Agg",
      MPLCONFIGDIR: "/tmp/worktree/.config/matplotlib",
      PIP_CACHE_DIR: "/tmp/worktree/.cache/pip",
      UV_CACHE_DIR: "/tmp/worktree/.cache/uv",
      PYTHONPYCACHEPREFIX: "/tmp/worktree/.cache/pycache",
      TEXMFVAR: "/tmp/worktree/.texlive/texmf-var",
      TEXMFCONFIG: "/tmp/worktree/.texlive/texmf-config",
      TEXMFHOME: "/tmp/worktree/.texlive/texmf-home",
    });
  });

  it("uses a safe system PATH for managed desktop Codex so host Anaconda does not leak in", () => {
    const env = buildCodexSpawnEnv({
      binaryPath: "/opt/managed/codex",
      processEnv: {
        PATH: "/opt/anaconda3/bin:/opt/homebrew/bin:/usr/bin:/bin",
        AGENTSCIENCE_MANAGED_CODEX_BINARY_PATH: "/opt/managed/codex",
        AGENTSCIENCE_MANAGED_CODEX_PATH_DIR: "/opt/managed/bin",
      },
    });

    expect(env.PATH).toBe(`/opt/managed/bin:${expectedManagedDesktopBasePath()}`);
  });
});
