/**
 * Persisted analytics settings for the desktop app.
 *
 * Lives under the `telemetry.analytics` subtree of the existing
 * `settings.json` (alongside provider config). The shape is intentionally
 * tiny: a single opt-out flag and a UTC day string used to dedupe the
 * once-per-day Aptabase ping. See `agentscience-app/docs/PRIVACY.md`.
 */

export interface AnalyticsSettings {
  readonly enabled: boolean;
  readonly lastPingDay: string | null;
}

export const DEFAULT_ANALYTICS_SETTINGS: AnalyticsSettings = {
  enabled: true,
  lastPingDay: null,
};

const UTC_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isUtcDay(value: unknown): value is string {
  return typeof value === "string" && UTC_DAY_PATTERN.test(value);
}

/**
 * Extract analytics settings from a parsed `settings.json` object.
 * Tolerant: missing or malformed fields fall back to defaults so that
 * a corrupt file never disables the toggle by surprise.
 */
export function extractAnalyticsSettings(input: unknown): AnalyticsSettings {
  if (typeof input !== "object" || input === null) {
    return DEFAULT_ANALYTICS_SETTINGS;
  }
  const telemetry = (input as { telemetry?: unknown }).telemetry;
  if (typeof telemetry !== "object" || telemetry === null) {
    return DEFAULT_ANALYTICS_SETTINGS;
  }
  const analytics = (telemetry as { analytics?: unknown }).analytics;
  if (typeof analytics !== "object" || analytics === null) {
    return DEFAULT_ANALYTICS_SETTINGS;
  }
  const { enabled, lastPingDay } = analytics as {
    enabled?: unknown;
    lastPingDay?: unknown;
  };
  return {
    enabled: typeof enabled === "boolean" ? enabled : DEFAULT_ANALYTICS_SETTINGS.enabled,
    lastPingDay: isUtcDay(lastPingDay) ? lastPingDay : null,
  };
}

/**
 * Parse a raw `settings.json` blob. Returns defaults when the file is
 * missing, empty, or unparseable — never throws.
 */
export function parseAnalyticsSettings(raw: string): AnalyticsSettings {
  try {
    return extractAnalyticsSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_ANALYTICS_SETTINGS;
  }
}

/**
 * Merge new analytics settings into an existing `settings.json` blob,
 * preserving every other top-level key untouched. Used when the renderer
 * toggles the opt-out so we don't clobber `providers.codex.homePath`,
 * `observability`, etc.
 */
export function mergeAnalyticsSettings(raw: string, next: AnalyticsSettings): string {
  let base: Record<string, unknown> = {};
  if (raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through with empty base; corrupt files should not block writes.
    }
  }
  const existingTelemetry =
    typeof base.telemetry === "object" && base.telemetry !== null && !Array.isArray(base.telemetry)
      ? (base.telemetry as Record<string, unknown>)
      : {};
  const merged = {
    ...base,
    telemetry: {
      ...existingTelemetry,
      analytics: {
        enabled: next.enabled,
        lastPingDay: next.lastPingDay,
      },
    },
  };
  return `${JSON.stringify(merged, null, 2)}\n`;
}

/**
 * UTC calendar day for `now`, formatted YYYY-MM-DD. The dedup key for
 * the once-per-day Aptabase ping.
 */
export function currentUtcDay(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Whether the desktop app should send today's `app_opened` ping. True iff
 * analytics is opted in AND we have not already pinged for the current
 * UTC day. The opt-out check runs first so that a disabled user never
 * triggers any Aptabase code path.
 */
export function shouldSendPing(settings: AnalyticsSettings, now: Date): boolean {
  if (!settings.enabled) return false;
  return settings.lastPingDay !== currentUtcDay(now);
}
