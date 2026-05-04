import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above all imports, so the mock factories must be
// hoisted too. Bare `const` references would be in the temporal dead zone.
const { initializeMock, trackEventMock } = vi.hoisted(() => ({
  initializeMock: vi.fn<(appKey: string, options?: unknown) => Promise<void>>(() =>
    Promise.resolve(),
  ),
  trackEventMock: vi.fn<(eventName: string, props?: unknown) => Promise<void>>(() =>
    Promise.resolve(),
  ),
}));

// Stub the SDK so the `electron` runtime never has to load under vitest.
vi.mock("@aptabase/electron/main", () => ({
  initialize: initializeMock,
  trackEvent: trackEventMock,
}));

import {
  __resetAnalyticsServiceForTests,
  bootstrapAnalytics,
  getAnalyticsSettings,
  initializeAnalyticsIfEligible,
  setAnalyticsEnabled,
  tryTrackAppOpened,
} from "./analyticsService";

let tmpDir: string;
let settingsPath: string;

const APP_KEY = "A-US-1234567890";

function seedSettings(value: unknown): void {
  FS.writeFileSync(settingsPath, JSON.stringify(value, null, 2), "utf8");
}

beforeEach(() => {
  initializeMock.mockClear();
  trackEventMock.mockClear();
  __resetAnalyticsServiceForTests();
  tmpDir = FS.mkdtempSync(Path.join(OS.tmpdir(), "analytics-svc-"));
  settingsPath = Path.join(tmpDir, "settings.json");
});

afterEach(() => {
  FS.rmSync(tmpDir, { recursive: true, force: true });
});

describe("bootstrapAnalytics", () => {
  it("loads defaults when settings file is missing", () => {
    bootstrapAnalytics({ settingsPath });
    expect(getAnalyticsSettings()).toEqual({ enabled: true, lastPingDay: null });
  });

  it("loads previously-persisted state from disk", () => {
    seedSettings({
      telemetry: { analytics: { enabled: false, lastPingDay: "2026-05-03" } },
    });
    bootstrapAnalytics({ settingsPath });
    expect(getAnalyticsSettings()).toEqual({ enabled: false, lastPingDay: "2026-05-03" });
  });

  it("falls back to defaults on a corrupt settings.json", () => {
    FS.writeFileSync(settingsPath, "{ this is not json", "utf8");
    bootstrapAnalytics({ settingsPath });
    expect(getAnalyticsSettings()).toEqual({ enabled: true, lastPingDay: null });
  });
});

describe("initializeAnalyticsIfEligible", () => {
  it("does not initialize when no app key is provided", () => {
    bootstrapAnalytics({ settingsPath });
    initializeAnalyticsIfEligible({ appKey: undefined });
    expect(initializeMock).not.toHaveBeenCalled();
  });

  it("does not initialize when the app key is empty", () => {
    bootstrapAnalytics({ settingsPath });
    initializeAnalyticsIfEligible({ appKey: "" });
    expect(initializeMock).not.toHaveBeenCalled();
  });

  it("does not initialize when the user is opted out", () => {
    seedSettings({ telemetry: { analytics: { enabled: false } } });
    bootstrapAnalytics({ settingsPath });
    initializeAnalyticsIfEligible({ appKey: APP_KEY });
    expect(initializeMock).not.toHaveBeenCalled();
  });

  it("initializes exactly once when key + opt-in are present", () => {
    bootstrapAnalytics({ settingsPath });
    initializeAnalyticsIfEligible({ appKey: APP_KEY });
    initializeAnalyticsIfEligible({ appKey: APP_KEY });
    expect(initializeMock).toHaveBeenCalledTimes(1);
    expect(initializeMock).toHaveBeenCalledWith(APP_KEY);
  });
});

describe("tryTrackAppOpened", () => {
  const now = new Date("2026-05-04T03:42:00.000Z");

  it("short-circuits when the SDK was never initialized", () => {
    bootstrapAnalytics({ settingsPath });
    expect(tryTrackAppOpened({ now })).toBe(false);
    expect(trackEventMock).not.toHaveBeenCalled();
  });

  // Acts as the "smoke test" called out in the implementation plan: with
  // analytics.enabled = false the SDK is never initialized, so trackEvent
  // is unreachable from this code path — zero outbound Aptabase requests.
  it("never reaches trackEvent when the user is opted out", () => {
    seedSettings({ telemetry: { analytics: { enabled: false } } });
    bootstrapAnalytics({ settingsPath });
    initializeAnalyticsIfEligible({ appKey: APP_KEY });
    expect(tryTrackAppOpened({ now })).toBe(false);
    expect(trackEventMock).not.toHaveBeenCalled();
  });

  it("short-circuits when we already pinged for the current UTC day", () => {
    seedSettings({
      telemetry: { analytics: { enabled: true, lastPingDay: "2026-05-04" } },
    });
    bootstrapAnalytics({ settingsPath });
    initializeAnalyticsIfEligible({ appKey: APP_KEY });
    expect(tryTrackAppOpened({ now })).toBe(false);
    expect(trackEventMock).not.toHaveBeenCalled();
  });

  it("emits app_opened and persists lastPingDay when due", () => {
    bootstrapAnalytics({ settingsPath });
    initializeAnalyticsIfEligible({ appKey: APP_KEY });
    expect(tryTrackAppOpened({ now })).toBe(true);
    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith("app_opened");
    expect(getAnalyticsSettings().lastPingDay).toBe("2026-05-04");

    const persisted = JSON.parse(FS.readFileSync(settingsPath, "utf8"));
    expect(persisted.telemetry.analytics).toEqual({
      enabled: true,
      lastPingDay: "2026-05-04",
    });
  });

  it("dedupes successive calls within the same UTC day", () => {
    bootstrapAnalytics({ settingsPath });
    initializeAnalyticsIfEligible({ appKey: APP_KEY });
    expect(tryTrackAppOpened({ now })).toBe(true);
    expect(tryTrackAppOpened({ now })).toBe(false);
    expect(trackEventMock).toHaveBeenCalledTimes(1);
  });

  it("re-fires once after a UTC midnight rollover", () => {
    const day1 = new Date("2026-05-04T03:42:00.000Z");
    const day2 = new Date("2026-05-05T00:30:00.000Z");
    bootstrapAnalytics({ settingsPath });
    initializeAnalyticsIfEligible({ appKey: APP_KEY });
    expect(tryTrackAppOpened({ now: day1 })).toBe(true);
    expect(tryTrackAppOpened({ now: day2 })).toBe(true);
    expect(trackEventMock).toHaveBeenCalledTimes(2);
  });
});

describe("setAnalyticsEnabled", () => {
  it("persists the toggle to disk", () => {
    bootstrapAnalytics({ settingsPath });
    setAnalyticsEnabled(false);
    const persisted = JSON.parse(FS.readFileSync(settingsPath, "utf8"));
    expect(persisted.telemetry.analytics.enabled).toBe(false);
    expect(getAnalyticsSettings().enabled).toBe(false);
  });

  it("preserves unrelated keys in settings.json when toggling", () => {
    seedSettings({ providers: { codex: { homePath: "/home/me/codex" } } });
    bootstrapAnalytics({ settingsPath });
    setAnalyticsEnabled(false);
    const persisted = JSON.parse(FS.readFileSync(settingsPath, "utf8"));
    expect(persisted.providers.codex.homePath).toBe("/home/me/codex");
  });

  it("is a no-op when the value already matches", () => {
    bootstrapAnalytics({ settingsPath });
    setAnalyticsEnabled(true);
    expect(FS.existsSync(settingsPath)).toBe(false);
  });

  it("lazily initializes the SDK when newly enabled with the app key cached", () => {
    seedSettings({ telemetry: { analytics: { enabled: false } } });
    bootstrapAnalytics({ settingsPath });
    initializeAnalyticsIfEligible({ appKey: APP_KEY });
    expect(initializeMock).not.toHaveBeenCalled();
    setAnalyticsEnabled(true);
    expect(initializeMock).toHaveBeenCalledTimes(1);
  });

  it("does not initialize on toggle-on when no app key is configured", () => {
    seedSettings({ telemetry: { analytics: { enabled: false } } });
    bootstrapAnalytics({ settingsPath });
    initializeAnalyticsIfEligible({ appKey: undefined });
    setAnalyticsEnabled(true);
    expect(initializeMock).not.toHaveBeenCalled();
  });
});
