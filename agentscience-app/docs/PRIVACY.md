# Privacy

This is what AgentScience collects, what it doesn't, and how to turn it off.

The short version: we count daily app opens, broken down by app version and OS, so we know whether anyone is using the app and which platforms to support. We don't see your prompts, your files, your projects, your papers, your account, or anything you do inside the app. There's a single switch in **Settings → Privacy** that turns it off.

## TL;DR

- The desktop app sends **one anonymous ping per UTC day** when you open it, while opted in.
- The ping contains your **app version, OS name and version, locale, and Chromium engine version**. It does not contain your IP address, your name, your email, your projects, prompts, files, or any account identifier.
- Storage is handled by [Aptabase](https://aptabase.com), an open-source, privacy-first analytics service. We do not run the storage ourselves — see [Sub-processors](#sub-processors).
- You can **opt out at any time** in Settings → Privacy. The toggle takes effect immediately and persists across launches.

## What the desktop app sends

Once per UTC day, while the **Settings → Privacy → Anonymous usage** toggle is on, the desktop app's main process sends one HTTPS POST to `https://us.aptabase.com/api/v0/event`. The literal request body is:

```json
{
  "timestamp": "2026-05-04T03:42:00.000Z",
  "sessionId": "171234567890123456",
  "eventName": "app_opened",
  "systemProps": {
    "isDebug": false,
    "locale": "en-US",
    "osName": "macOS",
    "osVersion": "14.5",
    "engineName": "Chromium",
    "engineVersion": "118.0.5993.159",
    "appVersion": "1.4.2",
    "sdkVersion": "aptabase-electron@0.3.1"
  },
  "props": {}
}
```

Field by field, here is exactly what each one is and why it is there:

- `timestamp`: ISO-8601 time of the ping. Used to count active days. Does not reveal where you are — only when the ping arrived.
- `sessionId`: random opaque number generated in memory at app launch and rotated after one hour of inactivity. **Not** a stable install ID. It does not persist across reinstalls, app updates, or a long-enough idle period. We use it so a single launch doesn't show up as multiple events; we do not use it to follow you across days.
- `eventName`: always the literal string `app_opened` for this ping. There is currently no other event in the app.
- `isDebug`: `true` for unpackaged dev builds, `false` for packaged installers. Lets us exclude developer noise from "real" usage counts.
- `locale`: e.g. `en-US`. Sent automatically by the Aptabase SDK from `app.getLocale()`; we cannot disable this without forking the SDK. Tells us whether internationalization is worth investing in.
- `osName` / `osVersion`: e.g. `macOS 14.5`, `Windows 11`, `Ubuntu 22.04`. Tells us whether to keep supporting older OSes.
- `engineName` / `engineVersion`: the literal string `Chromium` plus the Chromium version bundled inside Electron (e.g. `118.0.5993.159`). Lets us reason about Electron upgrade paths. This is the Chromium runtime that ships *inside* the app's binary, not anything from your system.
- `appVersion`: which release of AgentScience you're on. Lets us see whether new releases are reaching users and whether old ones are still in the wild.
- `sdkVersion`: which version of the Aptabase Electron SDK we're using.
- `props`: always empty `{}` for the daily ping. We do not pass any custom properties.

That's the entire wire payload. There is no other call to Aptabase, no separate identify call, no cookie or `localStorage` write, no background pings while the app is idle.

### Server-side note about your IP

When the desktop app makes the HTTPS POST, the request itself necessarily exposes your IP address to the network — that's how TCP works. Aptabase's documented behavior is to **read the IP transiently to derive a coarse country, then discard it without storing it**. We don't store it either. See Aptabase's [privacy policy](https://aptabase.com/legal/privacy) for the canonical statement.

If the very fact of a third party seeing your IP at request time is unacceptable to you, **turn the toggle off**. That's why it exists.

## What we don't collect

The following are **never** collected, transmitted, or accessible to us:

- Your name, email, account, or any sign-in identifier.
- Your IP address (beyond the unavoidable network-level exposure noted above).
- Any persistent install identifier, cookie, or `localStorage` value set by the SDK.
- Anything you type into the app, including prompts, chat messages, paper drafts, search queries, or notes.
- Any file content, file path, file name, project name, dataset name, paper title, or model name.
- Any record of which AI provider, model, or API key you have configured.
- Crash dumps, stack traces, error messages, performance traces, or logs.
- Page views, click events, time-on-screen, mouse movements, or any other UI telemetry.
- Anything from the app's local SQLite database or its synced Postgres database.

If a future feature needs any of the above, this document and the in-app consent flow are updated **before** the change ships, and the change appears in the [Changelog](#changelog) below.

## Sub-processors

We use one external service to store and aggregate the daily ping:

- **[Aptabase, Inc.](https://aptabase.com)** — privacy-first, open-source analytics. We use their hosted Cloud product (US region). Aptabase's privacy posture and full data handling are documented at <https://aptabase.com/legal/privacy>. Aptabase is the only third party that receives the payload above; we do not forward it anywhere else.

We chose Aptabase over alternatives because their *defaults* match this policy — no IP storage, no persistent device IDs, no cookies, no cross-app tracking — rather than requiring us to disable many tracking features one at a time. The trade-off is that Aptabase's SDK auto-attaches a slightly broader system-properties payload than we would have hand-rolled. You're seeing the full literal payload above.

## Retention

- Aptabase stores the events according to their published [data retention policy](https://aptabase.com/legal/privacy). We do not have a custom retention agreement with them at this time. We have configured the integration to send the minimum events Aptabase will accept (one event per UTC day) so the volume stored is small by construction.
- We do not maintain a copy of the raw events outside Aptabase.

## Opting out

Open **Settings → Privacy → Anonymous usage** and toggle it off.

When the toggle is off:

- The Aptabase SDK is not initialized at startup.
- No HTTPS request is made to `aptabase.com` for any reason.
- No data is queued locally for "later" sending.
- The setting persists across launches.

You may toggle it back on at any time. There is no penalty for opting out and no feature of the app is gated behind telemetry.

The toggle defaults to **on** for new installs. If you want to opt out of the very first ping, change the setting before opening the app a second time on a new UTC day.

There is no per-event opt-out and no "delete my data" workflow because there is no per-user data to delete: no part of the payload identifies you across days.

## Source code

This document is the design specification. The implementation that backs it lives in the repo and can be inspected at any time:

- The toggle and stored preference: `apps/desktop/src/statePaths.ts` (config shape) and the persisted settings file at `~/.agentscience/userdata/settings.json`.
- The Aptabase SDK initialization and daily-ping logic: `apps/desktop/src/main.ts` (the only place that imports `@aptabase/electron`).
- The Settings → Privacy panel: `apps/web/src/components/settings/SettingsPanels.tsx` (`PrivacySettingsPanel`).
- The dedupe via `lastPingDay`: also in `apps/desktop/src/main.ts`.

If any of these files reference Aptabase outside the main process, that is a bug — please open an issue.

## Changelog

- **2026-05-03**: Initial draft. Establishes the daily-ping design, the Aptabase Cloud sub-processor relationship, the literal payload, the opt-out, and the no-collection commitments above.
- **2026-05-03**: Corrected the literal payload to match `@aptabase/electron@0.3.1` source. The Electron SDK does **not** send `deviceModel` or `appBuildNumber` (those appear in some other Aptabase SDKs but not Electron's), and the engine fields are `Chromium` + the bundled Chromium version, not Node.

## Contact

Questions, concerns, or corrections: open an issue at <https://github.com/vineet-reddy/agentscience-app/issues>. We treat privacy issues as bugs and aim to respond on the same cadence as security issues.
