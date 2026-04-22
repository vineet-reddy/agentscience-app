import { describe, expect, it } from "vitest";

import {
  describeAgentScienceRuntimeStatus,
  shouldShowAgentScienceRuntimeNotice,
} from "./agentScienceRuntimeStatus";

describe("agentScienceRuntimeStatus", () => {
  it("shows no notice while startup check is still running", () => {
    const status = {
      state: "checking" as const,
      checkedAt: "2026-04-15T08:00:00.000Z",
      ok: false,
      updateAvailable: false,
      refreshRecommended: false,
      nextSteps: [],
    };

    expect(describeAgentScienceRuntimeStatus(status).settingsTitle).toBe("Checking on launch");
    expect(describeAgentScienceRuntimeStatus(status).settingsDescription).toBe(
      "AgentScience is checking the managed tools in this app.",
    );
    expect(shouldShowAgentScienceRuntimeNotice(status)).toBe(false);
  });

  it("surfaces a notice when the CLI update is available", () => {
    const status = {
      state: "ready" as const,
      checkedAt: "2026-04-15T08:00:00.000Z",
      ok: true,
      updateAvailable: true,
      refreshRecommended: false,
      nextSteps: ["npm install -g agentscience@latest"],
    };

    expect(describeAgentScienceRuntimeStatus(status)).toEqual({
      settingsTitle: "Update ready",
      settingsDescription: "A managed-tools update is ready in this app.",
      noticeTitle: "Managed tools update ready",
      noticeDescription: "Open Settings to update the managed tools.",
    });
    expect(shouldShowAgentScienceRuntimeNotice(status)).toBe(true);
  });

  it("surfaces a notice when a runtime refresh is recommended", () => {
    const status = {
      state: "ready" as const,
      checkedAt: "2026-04-15T08:00:00.000Z",
      ok: true,
      updateAvailable: false,
      refreshRecommended: true,
      nextSteps: [],
    };

    expect(describeAgentScienceRuntimeStatus(status)).toEqual({
      settingsTitle: "Refresh needed",
      settingsDescription: "The managed tools need a quick refresh in this app.",
      noticeTitle: "Managed tools need a refresh",
      noticeDescription: "Open Settings to refresh the managed tools.",
    });
    expect(shouldShowAgentScienceRuntimeNotice(status)).toBe(true);
  });

  it("shows no notice when startup checks are current", () => {
    const status = {
      state: "ready" as const,
      checkedAt: "2026-04-15T08:00:00.000Z",
      ok: true,
      updateAvailable: false,
      refreshRecommended: false,
      nextSteps: [],
    };

    expect(describeAgentScienceRuntimeStatus(status)).toEqual({
      settingsTitle: "Up to date",
      settingsDescription: "The managed tools bundled with this app are up to date.",
      noticeTitle: null,
      noticeDescription: null,
    });
    expect(shouldShowAgentScienceRuntimeNotice(status)).toBe(false);
  });
});
