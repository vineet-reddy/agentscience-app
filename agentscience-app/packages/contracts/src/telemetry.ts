/**
 * Persisted analytics opt-out state surfaced over the desktop IPC bridge.
 * Mirrors the on-disk shape under `telemetry.analytics` in the desktop
 * app's `settings.json`. See `agentscience-app/docs/PRIVACY.md` for the
 * design specification this type implements.
 */
export interface AnalyticsSettings {
  /** When false, the desktop app does not initialize the Aptabase SDK
   *  and never sends any HTTP request to `*.aptabase.com`. */
  readonly enabled: boolean;
  /** UTC calendar day (`YYYY-MM-DD`) of the most recent successful ping,
   *  or `null` if no ping has ever been sent on this install. Used by the
   *  desktop main process to dedupe the once-per-day `app_opened` event. */
  readonly lastPingDay: string | null;
}
