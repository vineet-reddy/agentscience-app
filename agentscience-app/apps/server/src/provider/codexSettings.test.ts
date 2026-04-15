import { describe, expect, it } from "vitest";

import type { CodexSettings } from "@agentscience/contracts";

import { resolveCodexHomePath, resolveDefaultCodexHomePath, resolveEffectiveCodexSettings } from "./codexSettings";

const baseSettings: CodexSettings = {
  enabled: true,
  binaryPath: "",
  homePath: "",
  customModels: [],
};

describe("codexSettings", () => {
  it("defaults desktop installs to the app-managed Codex home", () => {
    expect(
      resolveDefaultCodexHomePath({
        stateDir: "/Users/test/.agentscience/userdata",
      }),
    ).toBe("/Users/test/.agentscience/userdata/codex");

    expect(
      resolveCodexHomePath(baseSettings, {
        mode: "desktop",
        stateDir: "/Users/test/.agentscience/userdata",
      }),
    ).toBe("/Users/test/.agentscience/userdata/codex");
  });

  it("preserves an explicit Codex home override", () => {
    expect(
      resolveCodexHomePath(
        {
          ...baseSettings,
          homePath: " /tmp/custom-codex-home ",
        },
        {
          mode: "desktop",
          stateDir: "/Users/test/.agentscience/userdata",
        },
      ),
    ).toBe("/tmp/custom-codex-home");
  });

  it("keeps web-mode settings blank when no home override is configured", () => {
    expect(
      resolveCodexHomePath(baseSettings, {
        mode: "web",
        stateDir: "/Users/test/.agentscience/userdata",
      }),
    ).toBe("");
  });

  it("resolves the effective binary and managed desktop home together", () => {
    expect(
      resolveEffectiveCodexSettings(baseSettings, {
        mode: "desktop",
        stateDir: "/Users/test/.agentscience/userdata",
      }),
    ).toEqual({
      ...baseSettings,
      binaryPath: "codex",
      homePath: "/Users/test/.agentscience/userdata/codex",
    });
  });
});
