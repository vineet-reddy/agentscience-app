/**
 * Stateful glue between the persisted analytics settings, the Aptabase
 * SDK, and the IPC bridge exposed to the renderer. Keep this module the
 * single import site for `@aptabase/electron` so the "main process only"
 * invariant from PRIVACY.md is enforced by code structure.
 *
 * Lifecycle (called from `main.ts`):
 *   1. `bootstrapAnalytics({ settingsPath })`        — load persisted state at module load
 *   2. `initializeAnalyticsIfEligible({ appKey })`   — kick off SDK init BEFORE app.whenReady()
 *   3. `tryTrackAppOpened({ now })`                  — fire one `app_opened` per UTC day
 *   4. `setAnalyticsEnabled(enabled)`                — renderer-driven toggle
 */

import * as FS from "node:fs";

import { initialize, trackEvent } from "@aptabase/electron/main";

import {
  type AnalyticsSettings,
  DEFAULT_ANALYTICS_SETTINGS,
  currentUtcDay,
  mergeAnalyticsSettings,
  parseAnalyticsSettings,
  shouldSendPing,
} from "./analyticsConfig";

interface ServiceState {
  settings: AnalyticsSettings;
  initialized: boolean;
}

let state: ServiceState = {
  settings: DEFAULT_ANALYTICS_SETTINGS,
  initialized: false,
};

let settingsPath: string | null = null;
let cachedAppKey: string | undefined;

function readSettingsBlob(): string {
  if (!settingsPath) return "";
  try {
    if (!FS.existsSync(settingsPath)) return "";
    return FS.readFileSync(settingsPath, "utf8");
  } catch (error) {
    console.warn("[analytics] failed to read settings.json", error);
    return "";
  }
}

function persistSettings(next: AnalyticsSettings): void {
  if (!settingsPath) return;
  try {
    const merged = mergeAnalyticsSettings(readSettingsBlob(), next);
    FS.writeFileSync(settingsPath, merged, "utf8");
  } catch (error) {
    console.warn("[analytics] failed to write settings.json", error);
  }
}

/** Load the persisted analytics state from disk into the in-memory cache.
 *  Synchronous so it can run before `app.whenReady()`. */
export function bootstrapAnalytics(args: { readonly settingsPath: string }): void {
  settingsPath = args.settingsPath;
  state = {
    settings: parseAnalyticsSettings(readSettingsBlob()),
    initialized: false,
  };
}

/** Initialize the Aptabase SDK iff (a) an App Key is configured via the
 *  `AGENTSCIENCE_APTABASE_KEY` env var and (b) the user has not opted
 *  out. Must be called before `app.whenReady()` per the SDK contract.
 *  Safe to call multiple times — subsequent calls no-op. */
export function initializeAnalyticsIfEligible(args: {
  readonly appKey: string | undefined;
}): void {
  cachedAppKey = args.appKey;
  if (state.initialized) return;
  if (!args.appKey || args.appKey.length === 0) return;
  if (!state.settings.enabled) return;
  // SDK's `initialize` returns a Promise that internally awaits whenReady;
  // fire-and-forget is correct here. Errors are surfaced by the SDK itself.
  void initialize(args.appKey).catch((error) => {
    console.warn("[analytics] aptabase initialize failed", error);
  });
  state = { ...state, initialized: true };
}

/** Send today's `app_opened` ping if the user is opted in and we have not
 *  already pinged for the current UTC day. Safe to call on every window
 *  focus / activation — internally deduped against the persisted
 *  `lastPingDay`. Returns true iff a ping was emitted. */
export function tryTrackAppOpened(args: { readonly now: Date }): boolean {
  if (!state.initialized) return false;
  if (!shouldSendPing(state.settings, args.now)) return false;
  const day = currentUtcDay(args.now);
  // Optimistically advance lastPingDay so a fast successive call within
  // the same launch doesn't double-fire. Aptabase's SDK is fire-and-forget
  // and queues internally; we treat the queue as success for dedup purposes.
  const next: AnalyticsSettings = { ...state.settings, lastPingDay: day };
  state = { ...state, settings: next };
  persistSettings(next);
  void trackEvent("app_opened").catch((error) => {
    console.warn("[analytics] aptabase trackEvent failed", error);
  });
  return true;
}

/** Current in-memory analytics state. Cheap accessor for IPC handlers. */
export function getAnalyticsSettings(): AnalyticsSettings {
  return state.settings;
}

/** Renderer-driven toggle. Persists immediately and, when newly enabled,
 *  lazily initializes the SDK so the next `tryTrackAppOpened` can fire. */
export function setAnalyticsEnabled(enabled: boolean): AnalyticsSettings {
  if (state.settings.enabled === enabled) return state.settings;
  const next: AnalyticsSettings = { ...state.settings, enabled };
  state = { ...state, settings: next };
  persistSettings(next);
  if (enabled && !state.initialized) {
    initializeAnalyticsIfEligible({ appKey: cachedAppKey });
  }
  return next;
}

/** Reset module state. Test-only; not exported from any public surface. */
export function __resetAnalyticsServiceForTests(): void {
  state = { settings: DEFAULT_ANALYTICS_SETTINGS, initialized: false };
  settingsPath = null;
  cachedAppKey = undefined;
}
