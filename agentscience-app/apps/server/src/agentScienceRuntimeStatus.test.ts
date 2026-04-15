import { describe, expect, it } from "vitest";

import {
  createErroredAgentScienceRuntimeStatus,
  createInitialAgentScienceRuntimeStatus,
  createUnavailableAgentScienceRuntimeStatus,
  parseInstalledAgentSciencePackageVersionJson,
  parseAgentScienceRuntimeStatusJson,
  reconcileInstalledAgentScienceCliVersion,
} from "./agentScienceRuntimeStatus";

describe("agentScienceRuntimeStatus", () => {
  it("builds an initial checking snapshot", () => {
    expect(createInitialAgentScienceRuntimeStatus("2026-04-15T08:00:00.000Z")).toEqual({
      state: "checking",
      checkedAt: "2026-04-15T08:00:00.000Z",
      ok: false,
      updateAvailable: false,
      refreshRecommended: false,
      nextSteps: [],
    });
  });

  it("parses runtime status JSON into the server snapshot shape", () => {
    const stdout = JSON.stringify({
      runtime: {
        ok: true,
        updateAvailable: true,
        cli: {
          version: "0.5.1",
          latestVersion: "0.5.2",
          personalityVersion: "1.0.2",
          personalityContentHash: "abc123",
          checkedAt: "2026-04-15T08:12:08.238Z",
          checkSource: "network",
        },
        codex: {
          active: {
            surface: "codex",
            scope: "user",
            installed: true,
            installMode: "linked",
            autoUpdates: true,
            personalityVersion: "1.0.2",
            personalityContentHash: "abc123",
            refreshRecommended: true,
            current: true,
          },
        },
        nextSteps: ["npm install -g agentscience@latest"],
      },
    });

    expect(parseAgentScienceRuntimeStatusJson(stdout, "2026-04-15T08:00:00.000Z")).toEqual({
      state: "ready",
      checkedAt: "2026-04-15T08:12:08.238Z",
      ok: true,
      updateAvailable: true,
      refreshRecommended: true,
      nextSteps: ["npm install -g agentscience@latest"],
      cli: {
        version: "0.5.1",
        latestVersion: "0.5.2",
        personalityVersion: "1.0.2",
        personalityContentHash: "abc123",
        checkSource: "network",
      },
      codexActive: {
        surface: "codex",
        scope: "user",
        installed: true,
        installMode: "linked",
        autoUpdates: true,
        personalityVersion: "1.0.2",
        personalityContentHash: "abc123",
        refreshRecommended: true,
        current: true,
      },
    });
  });

  it("builds unavailable and error snapshots", () => {
    expect(
      createUnavailableAgentScienceRuntimeStatus(
        "2026-04-15T08:00:00.000Z",
        "AgentScience runtime check is unavailable on this system.",
      ),
    ).toEqual({
      state: "unavailable",
      checkedAt: "2026-04-15T08:00:00.000Z",
      ok: false,
      updateAvailable: false,
      refreshRecommended: false,
      nextSteps: [],
      message: "AgentScience runtime check is unavailable on this system.",
    });
    expect(
      createErroredAgentScienceRuntimeStatus(
        "2026-04-15T08:00:00.000Z",
        "AgentScience runtime check failed.",
      ),
    ).toEqual({
      state: "error",
      checkedAt: "2026-04-15T08:00:00.000Z",
      ok: false,
      updateAvailable: false,
      refreshRecommended: false,
      nextSteps: [],
      message: "AgentScience runtime check failed.",
    });
  });

  it("parses the globally installed AgentScience package version from npm metadata", () => {
    expect(
      parseInstalledAgentSciencePackageVersionJson(
        JSON.stringify({
          dependencies: {
            agentscience: {
              version: "0.5.2",
            },
          },
        }),
      ),
    ).toBe("0.5.2");
  });

  it("treats the runtime as up to date when npm already installed the latest CLI", () => {
    const status = parseAgentScienceRuntimeStatusJson(
      JSON.stringify({
        runtime: {
          ok: true,
          updateAvailable: true,
          cli: {
            version: "0.5.1",
            latestVersion: "0.5.2",
            checkedAt: "2026-04-15T08:12:08.238Z",
          },
          codex: {
            active: {
              surface: "codex",
              scope: "user",
              installed: true,
              autoUpdates: true,
              refreshRecommended: true,
              current: true,
            },
          },
          nextSteps: [
            "npm install -g agentscience@latest",
            "agentscience setup codex",
          ],
        },
      }),
      "2026-04-15T08:00:00.000Z",
    );

    expect(reconcileInstalledAgentScienceCliVersion(status, "0.5.2")).toEqual({
      state: "ready",
      checkedAt: "2026-04-15T08:12:08.238Z",
      ok: true,
      updateAvailable: false,
      refreshRecommended: true,
      nextSteps: ["agentscience setup codex"],
      cli: {
        version: "0.5.2",
        latestVersion: "0.5.2",
      },
      codexActive: {
        surface: "codex",
        scope: "user",
        installed: true,
        autoUpdates: true,
        refreshRecommended: true,
        current: true,
      },
    });
  });
});
