import { describe, expect, it } from "vitest";

import {
  buildAgentScienceGeminiEnv,
  buildGeminiLaunchSpec,
  resolveAgentScienceGeminiHome,
  resolveGeminiBinaryPath,
} from "./geminiCli";

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

describe("buildAgentScienceGeminiEnv", () => {
  it("isolates Gemini auth state from user CLI and Google credential env", () => {
    const env = buildAgentScienceGeminiEnv({
      stateDir: "/tmp/agentscience-state",
      processEnv: {
        GEMINI_CLI_HOME: "/Users/scientist",
        GEMINI_API_KEY: "external-gemini-key",
        GOOGLE_API_KEY: "external-google-key",
        GOOGLE_APPLICATION_CREDENTIALS: "/Users/scientist/.config/gcloud/application_default_credentials.json",
        GOOGLE_CLOUD_ACCESS_TOKEN: "external-access-token",
        GOOGLE_GENAI_USE_GCA: "1",
        CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: "/Users/scientist/gcloud.json",
        PATH: "/usr/bin",
      },
    });

    expect(env.GEMINI_CLI_HOME).toBe(resolveAgentScienceGeminiHome("/tmp/agentscience-state"));
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.GOOGLE_API_KEY).toBeUndefined();
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
    expect(env.GOOGLE_CLOUD_ACCESS_TOKEN).toBeUndefined();
    expect(env.GOOGLE_GENAI_USE_GCA).toBeUndefined();
    expect(env.CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE).toBeUndefined();
    expect(env.GEMINI_FORCE_ENCRYPTED_FILE_STORAGE).toBe("false");
    expect(env.PATH).toContain("/usr/bin");
  });

  it("uses only the AgentScience-stored Gemini API key when provided", () => {
    const env = buildAgentScienceGeminiEnv({
      stateDir: "/tmp/agentscience-state",
      processEnv: {
        GEMINI_API_KEY: "external-key",
        GOOGLE_API_KEY: "external-key",
      },
      apiKey: "agentscience-key",
    });

    expect(env.GEMINI_API_KEY).toBe("agentscience-key");
    expect(env.GOOGLE_API_KEY).toBe("agentscience-key");
  });

  it("prefers AgentScience-managed CLI paths inside Gemini sessions", () => {
    const env = buildAgentScienceGeminiEnv({
      stateDir: "/tmp/agentscience-state",
      cwd: "/tmp/agentscience-workspace",
      processEnv: {
        PATH: "/usr/bin",
      },
    });

    expect(env.PATH).toContain("/tmp/agentscience-workspace/.cache/agentscience/bin");
    expect(env.PATH?.endsWith("/usr/bin")).toBe(true);
  });
});
