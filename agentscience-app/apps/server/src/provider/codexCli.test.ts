import { describe, expect, it } from "vitest";

import { buildCodexSpawnEnv } from "./codexCli";

describe("buildCodexSpawnEnv", () => {
  it("prepends managed science and paper toolchain bins to PATH", () => {
    const env = buildCodexSpawnEnv({
      binaryPath: "/opt/managed/codex",
      processEnv: {
        PATH: "/usr/bin:/bin",
        AGENTSCIENCE_MANAGED_CODEX_BINARY_PATH: "/opt/managed/codex",
        AGENTSCIENCE_MANAGED_CODEX_PATH_DIR: "/opt/managed/bin",
        AGENTSCIENCE_MANAGED_SCIENCE_RUNTIME_BIN_DIR: "/opt/science/bin",
        AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR: "/opt/tex/bin",
      },
    });

    expect(env.PATH).toBe("/opt/science/bin:/opt/tex/bin:/opt/managed/bin:/usr/bin:/bin");
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
});
