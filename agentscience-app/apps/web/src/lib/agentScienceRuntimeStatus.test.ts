import { describe, expect, it } from "vitest";

import {
  describeAgentScienceRuntimeStatus,
  shouldShowAgentScienceRuntimeNotice,
} from "./agentScienceRuntimeStatus";

describe("agentScienceRuntimeStatus", () => {
  it("shows no notice before the runtime check has been requested", () => {
    const status = {
      state: "checking" as const,
      checkedAt: "2026-04-15T08:00:00.000Z",
      ok: false,
      updateAvailable: false,
      refreshRecommended: false,
      nextSteps: [],
    };

    expect(describeAgentScienceRuntimeStatus(status).settingsTitle).toBe("Not checked yet");
    expect(describeAgentScienceRuntimeStatus(status).settingsDescription).toBe(
      "AgentScience can check the background tools on demand from Settings.",
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
      settingsDescription: "A background-tools update is ready for this device.",
      noticeTitle: "Background tools update ready",
      noticeDescription: "Open Settings to update the background tools.",
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
      settingsDescription: "The background tools need a quick refresh on this device.",
      noticeTitle: "Background tools need a refresh",
      noticeDescription: "Open Settings to refresh the background tools.",
    });
    expect(shouldShowAgentScienceRuntimeNotice(status)).toBe(true);
  });

  it("shows no notice when runtime checks are current", () => {
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
      settingsDescription: "The background tools are up to date on this device.",
      noticeTitle: null,
      noticeDescription: null,
    });
    expect(shouldShowAgentScienceRuntimeNotice(status)).toBe(false);
  });
});
