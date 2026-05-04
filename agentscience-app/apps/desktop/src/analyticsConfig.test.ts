import { describe, expect, it } from "vitest";

import {
  DEFAULT_ANALYTICS_SETTINGS,
  currentUtcDay,
  extractAnalyticsSettings,
  mergeAnalyticsSettings,
  parseAnalyticsSettings,
  shouldSendPing,
} from "./analyticsConfig";

describe("currentUtcDay", () => {
  it("formats a UTC date as YYYY-MM-DD", () => {
    expect(currentUtcDay(new Date("2026-05-04T03:42:00.000Z"))).toBe("2026-05-04");
  });

  it("returns the UTC day even when the local clock is on the previous day", () => {
    // 2026-05-04T00:30Z is still 2026-05-03 in PDT (UTC-7) but UTC-day rolls.
    expect(currentUtcDay(new Date("2026-05-04T00:30:00.000Z"))).toBe("2026-05-04");
  });

  it("zero-pads single-digit months and days", () => {
    expect(currentUtcDay(new Date("2026-01-09T12:00:00.000Z"))).toBe("2026-01-09");
  });
});

describe("extractAnalyticsSettings", () => {
  it("returns defaults for non-object input", () => {
    expect(extractAnalyticsSettings(null)).toEqual(DEFAULT_ANALYTICS_SETTINGS);
    expect(extractAnalyticsSettings("not an object")).toEqual(DEFAULT_ANALYTICS_SETTINGS);
    expect(extractAnalyticsSettings(42)).toEqual(DEFAULT_ANALYTICS_SETTINGS);
  });

  it("returns defaults when telemetry subtree is missing", () => {
    expect(extractAnalyticsSettings({ providers: { codex: {} } })).toEqual(
      DEFAULT_ANALYTICS_SETTINGS,
    );
  });

  it("reads enabled and lastPingDay when present", () => {
    expect(
      extractAnalyticsSettings({
        telemetry: { analytics: { enabled: false, lastPingDay: "2026-05-03" } },
      }),
    ).toEqual({ enabled: false, lastPingDay: "2026-05-03" });
  });

  it("falls back to default enabled when the field is malformed", () => {
    expect(
      extractAnalyticsSettings({
        telemetry: { analytics: { enabled: "yes please", lastPingDay: "2026-05-03" } },
      }),
    ).toEqual({ enabled: true, lastPingDay: "2026-05-03" });
  });

  it("rejects malformed lastPingDay strings", () => {
    expect(
      extractAnalyticsSettings({
        telemetry: { analytics: { enabled: true, lastPingDay: "yesterday" } },
      }),
    ).toEqual({ enabled: true, lastPingDay: null });
  });
});

describe("parseAnalyticsSettings", () => {
  it("returns defaults when the blob is empty", () => {
    expect(parseAnalyticsSettings("")).toEqual(DEFAULT_ANALYTICS_SETTINGS);
  });

  it("returns defaults when the blob is not valid JSON", () => {
    expect(parseAnalyticsSettings("{ broken")).toEqual(DEFAULT_ANALYTICS_SETTINGS);
  });

  it("round-trips a serialized settings file", () => {
    const merged = mergeAnalyticsSettings("{}", { enabled: false, lastPingDay: "2026-05-03" });
    expect(parseAnalyticsSettings(merged)).toEqual({
      enabled: false,
      lastPingDay: "2026-05-03",
    });
  });
});

describe("mergeAnalyticsSettings", () => {
  it("seeds an empty file with the analytics subtree", () => {
    const merged = mergeAnalyticsSettings("", { enabled: true, lastPingDay: null });
    expect(JSON.parse(merged)).toEqual({
      telemetry: { analytics: { enabled: true, lastPingDay: null } },
    });
  });

  it("preserves unrelated top-level keys when writing the analytics subtree", () => {
    const existing = JSON.stringify({
      providers: { codex: { homePath: "/home/me/codex" } },
      observability: { otlpTracesUrl: "http://localhost:4318/v1/traces" },
    });
    const merged = mergeAnalyticsSettings(existing, {
      enabled: false,
      lastPingDay: "2026-05-03",
    });
    const parsed = JSON.parse(merged);
    expect(parsed.providers.codex.homePath).toBe("/home/me/codex");
    expect(parsed.observability.otlpTracesUrl).toBe("http://localhost:4318/v1/traces");
    expect(parsed.telemetry.analytics).toEqual({ enabled: false, lastPingDay: "2026-05-03" });
  });

  it("preserves other telemetry subkeys when updating analytics", () => {
    const existing = JSON.stringify({
      telemetry: {
        analytics: { enabled: true, lastPingDay: "2026-05-01" },
        crashReports: { enabled: false },
      },
    });
    const merged = mergeAnalyticsSettings(existing, {
      enabled: true,
      lastPingDay: "2026-05-04",
    });
    const parsed = JSON.parse(merged);
    expect(parsed.telemetry.crashReports).toEqual({ enabled: false });
    expect(parsed.telemetry.analytics).toEqual({ enabled: true, lastPingDay: "2026-05-04" });
  });

  it("recovers from a corrupt existing file by writing fresh content", () => {
    const merged = mergeAnalyticsSettings("{ this is not json", {
      enabled: false,
      lastPingDay: null,
    });
    expect(JSON.parse(merged)).toEqual({
      telemetry: { analytics: { enabled: false, lastPingDay: null } },
    });
  });
});

describe("shouldSendPing", () => {
  const now = new Date("2026-05-04T03:42:00.000Z");

  it("returns false when analytics is opted out", () => {
    expect(shouldSendPing({ enabled: false, lastPingDay: null }, now)).toBe(false);
    expect(shouldSendPing({ enabled: false, lastPingDay: "2026-05-03" }, now)).toBe(false);
  });

  it("returns true on the first launch (no recorded ping)", () => {
    expect(shouldSendPing({ enabled: true, lastPingDay: null }, now)).toBe(true);
  });

  it("returns false when we already pinged today", () => {
    expect(shouldSendPing({ enabled: true, lastPingDay: "2026-05-04" }, now)).toBe(false);
  });

  it("returns true after a UTC midnight rollover", () => {
    expect(shouldSendPing({ enabled: true, lastPingDay: "2026-05-03" }, now)).toBe(true);
  });
});
