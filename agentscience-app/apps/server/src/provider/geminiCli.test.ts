import { describe, expect, it } from "vitest";

import { buildGeminiLaunchSpec, resolveGeminiBinaryPath } from "./geminiCli";

describe("resolveGeminiBinaryPath", () => {
  it("prefers explicit Gemini binary paths", () => {
    expect(
      resolveGeminiBinaryPath({
        binaryPath: "/custom/gemini",
      }),
    ).toBe("/custom/gemini");
  });

  it("uses the managed Gemini CLI bundle when no explicit path is configured", () => {
    expect(
      resolveGeminiBinaryPath({
        binaryPath: "",
      }),
    ).toBe(process.env.AGENTSCIENCE_MANAGED_GEMINI_CLI_PATH?.trim() || "gemini");
  });
});

describe("buildGeminiLaunchSpec", () => {
  it("launches managed Gemini through the desktop Node runtime", () => {
    const spec = buildGeminiLaunchSpec({
      binaryPath: "/opt/agentscience/gemini.js",
      args: ["--acp"],
      processEnv: {
        AGENTSCIENCE_MANAGED_GEMINI_CLI_PATH: "/opt/agentscience/gemini.js",
        AGENTSCIENCE_MANAGED_GEMINI_NODE_PATH: "/Applications/AgentScience.app/Contents/MacOS/AgentScience",
      },
      platform: "darwin",
    });

    expect(spec.command).toBe("/Applications/AgentScience.app/Contents/MacOS/AgentScience");
    expect(spec.args).toEqual(["/opt/agentscience/gemini.js", "--acp"]);
    expect(spec.env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(spec.shell).toBe(false);
  });

  it("keeps custom Gemini binary overrides direct", () => {
    const spec = buildGeminiLaunchSpec({
      binaryPath: "/usr/local/bin/gemini",
      args: ["--version"],
      processEnv: {
        AGENTSCIENCE_MANAGED_GEMINI_CLI_PATH: "/opt/agentscience/gemini.js",
        AGENTSCIENCE_MANAGED_GEMINI_NODE_PATH: "/Applications/AgentScience.app/Contents/MacOS/AgentScience",
      },
      platform: "darwin",
    });

    expect(spec.command).toBe("/usr/local/bin/gemini");
    expect(spec.args).toEqual(["--version"]);
    expect(spec.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });
});
