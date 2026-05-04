import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  protocol,
  shell,
} from "electron";
import type { MenuItemConstructorOptions } from "electron";
import * as Effect from "effect/Effect";
import type {
  DesktopTheme,
  DesktopUpdateActionResult,
  DesktopUpdateCheckResult,
  DesktopUpdateState,
} from "@agentscience/contracts";
import { autoUpdater } from "electron-updater";

import type { ContextMenuItem } from "@agentscience/contracts";
import { NetService } from "@agentscience/shared/Net";
import { RotatingFileSink } from "@agentscience/shared/logging";
import { parsePersistedServerObservabilitySettings } from "@agentscience/shared/serverSettings";
import { showDesktopConfirmDialog } from "./confirmDialog";
import { resolveManagedCodexRuntime } from "./codexManagedRuntime";
import { buildManagedDesktopServerEnv } from "./managedDesktopTooling";
import {
  resolveDefaultDesktopCodexHomePath,
  resolveDesktopServerSettingsPath,
  resolveDesktopStateDir,
} from "./statePaths";
import {
  bootstrapAnalytics,
  getAnalyticsSettings,
  initializeAnalyticsIfEligible,
  setAnalyticsEnabled,
  tryTrackAppOpened,
} from "./analyticsService";
import { syncShellEnvironment } from "./syncShellEnvironment";
import { getAutoUpdateDisabledReason, shouldBroadcastDownloadProgress } from "./updateState";
import {
  createInitialDesktopUpdateState,
  reduceDesktopUpdateStateOnCheckFailure,
  reduceDesktopUpdateStateOnCheckStart,
  reduceDesktopUpdateStateOnDownloadComplete,
  reduceDesktopUpdateStateOnDownloadFailure,
  reduceDesktopUpdateStateOnDownloadProgress,
  reduceDesktopUpdateStateOnDownloadStart,
  reduceDesktopUpdateStateOnInstallFailure,
  reduceDesktopUpdateStateOnNoUpdate,
  reduceDesktopUpdateStateOnUpdateAvailable,
} from "./updateMachine";
import { isArm64HostRunningIntelBuild, resolveDesktopRuntimeInfo } from "./runtimeArch";

syncShellEnvironment();

// Aptabase requires `initialize` to run BEFORE `app.whenReady()`. Loading
// persisted opt-out state and seeding the SDK at module load satisfies the
// SDK contract and keeps the main process the only import site for
// `@aptabase/electron` (see `agentscience-app/docs/PRIVACY.md`).
bootstrapAnalytics({
  settingsPath: resolveDesktopServerSettingsPath(
    process.env.AGENTSCIENCE_HOME?.trim() || Path.join(OS.homedir(), ".agentscience"),
    Boolean(process.env.VITE_DEV_SERVER_URL),
  ),
});
// `__AGENTSCIENCE_APTABASE_KEY__` is replaced with a JSON string literal at
// build time by `tsdown.config.ts`. The runtime `process.env` lookup is the
// dev fallback so a developer can ship un-baked builds and still test the
// pipeline by setting the variable in their shell or `.env.local`.
declare const __AGENTSCIENCE_APTABASE_KEY__: string;
const APTABASE_APP_KEY: string | undefined =
  (typeof __AGENTSCIENCE_APTABASE_KEY__ === "string" && __AGENTSCIENCE_APTABASE_KEY__) ||
  process.env.AGENTSCIENCE_APTABASE_KEY?.trim() ||
  undefined;
initializeAnalyticsIfEligible({ appKey: APTABASE_APP_KEY });

const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const CONFIRM_CHANNEL = "desktop:confirm";
const SET_THEME_CHANNEL = "desktop:set-theme";
const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
const MENU_ACTION_CHANNEL = "desktop:menu-action";
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
const UPDATE_CHECK_CHANNEL = "desktop:update-check";
const GET_WS_URL_CHANNEL = "desktop:get-ws-url";
const IS_FULL_SCREEN_CHANNEL = "desktop:is-full-screen";
const FULL_SCREEN_CHANGED_CHANNEL = "desktop:full-screen-changed";
const ANALYTICS_GET_CHANNEL = "desktop:analytics-get";
const ANALYTICS_SET_ENABLED_CHANNEL = "desktop:analytics-set-enabled";
const BASE_DIR = process.env.AGENTSCIENCE_HOME?.trim() || Path.join(OS.homedir(), ".agentscience");
const DESKTOP_SCHEME = "agentscience";
const ROOT_DIR = Path.resolve(__dirname, "../../..");
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const STATE_DIR = resolveDesktopStateDir(BASE_DIR, isDevelopment);
const APP_DISPLAY_NAME = isDevelopment ? "AgentScience (Dev)" : "AgentScience";
const APP_USER_MODEL_ID = "com.agentscience.app";
const LINUX_DESKTOP_ENTRY_NAME = isDevelopment
  ? "agentscience-dev.desktop"
  : "agentscience.desktop";
const LINUX_WM_CLASS = isDevelopment ? "agentscience-dev" : "agentscience";
const USER_DATA_DIR_NAME = isDevelopment ? "agentscience-dev" : "agentscience";
const LEGACY_USER_DATA_DIR_NAMES = isDevelopment
  ? ["AgentScience (Dev)", "Agent Science (Dev)"]
  : ["AgentScience", "Agent Science (Alpha)"];
const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/i;
const COMMIT_HASH_DISPLAY_LENGTH = 12;
const LOG_DIR = Path.join(STATE_DIR, "logs");
const LOG_FILE_MAX_BYTES = 5 * 1024 * 1024;
const LOG_FILE_MAX_FILES = 5;
const APP_RUN_ID = Crypto.randomBytes(6).toString("hex");
const SERVER_SETTINGS_PATH = resolveDesktopServerSettingsPath(BASE_DIR, isDevelopment);
const DEFAULT_STANDALONE_CODEX_HOME_PATH = resolveDefaultDesktopCodexHomePath(
  BASE_DIR,
  isDevelopment,
);
const AUTO_UPDATE_STARTUP_DELAY_MS = 15_000;
const AUTO_UPDATE_POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;
const BACKEND_READY_PATH = "/api/desktop/ready";
const BACKEND_READY_RETRY_DELAY_MS = 250;
const BACKEND_READY_REQUEST_TIMEOUT_MS = 1_500;
const BACKEND_READY_TIMEOUT_MS = 45_000;
const DESKTOP_UPDATE_CHANNEL = "latest";
const DESKTOP_UPDATE_ALLOW_PRERELEASE = false;
const AGENTSCIENCE_RELEASES_URL =
  "https://github.com/vineet-reddy/agentscience-app/releases/latest";
const MAC_APP_ICON_BASENAME = "app-icon";

type DesktopUpdateErrorContext = DesktopUpdateState["errorContext"];
type LinuxDesktopNamedApp = Electron.App & {
  setDesktopName?: (desktopName: string) => void;
};

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess.ChildProcess | null = null;
let backendPort = 0;
let backendAuthToken = "";
let backendWsUrl = "";
let restartAttempt = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let isQuitting = false;
let desktopProtocolRegistered = false;
let aboutCommitHashCache: string | null | undefined;
let desktopLogSink: RotatingFileSink | null = null;
let backendLogSink: RotatingFileSink | null = null;
let restoreStdIoCapture: (() => void) | null = null;
let backendObservabilitySettings = readPersistedBackendObservabilitySettings();

let destructiveMenuIconCache: Electron.NativeImage | null | undefined;
const expectedBackendExitChildren = new WeakSet<ChildProcess.ChildProcess>();
const desktopRuntimeInfo = resolveDesktopRuntimeInfo({
  platform: process.platform,
  processArch: process.arch,
  runningUnderArm64Translation: app.runningUnderARM64Translation === true,
});
const initialUpdateState = (): DesktopUpdateState =>
  createInitialDesktopUpdateState(app.getVersion(), desktopRuntimeInfo);
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function focusOrCreateMainWindow(): void {
  const existingWindow =
    BrowserWindow.getFocusedWindow() ?? mainWindow ?? BrowserWindow.getAllWindows()[0];
  const targetWindow = existingWindow ?? createWindow();
  if (!existingWindow) {
    mainWindow = targetWindow;
  }

  if (targetWindow.isMinimized()) {
    targetWindow.restore();
  }
  if (!targetWindow.isVisible()) {
    targetWindow.show();
  }
  targetWindow.focus();
  // Re-evaluate the daily ping on every reactivation so a long-running
  // session that crosses UTC midnight still gets counted on the new day.
  tryTrackAppOpened({ now: new Date() });
}

if (!hasSingleInstanceLock) {
  isQuitting = true;
  app.quit();
} else {
  app.on("second-instance", () => {
    focusOrCreateMainWindow();
  });
}

function logTimestamp(): string {
  return new Date().toISOString();
}

function logScope(scope: string): string {
  return `${scope} run=${APP_RUN_ID}`;
}

function sanitizeLogValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function readPersistedBackendObservabilitySettings(): {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
} {
  try {
    if (!FS.existsSync(SERVER_SETTINGS_PATH)) {
      return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
    }
    return parsePersistedServerObservabilitySettings(FS.readFileSync(SERVER_SETTINGS_PATH, "utf8"));
  } catch (error) {
    console.warn("[desktop] failed to read persisted backend observability settings", error);
    return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
  }
}

function readPersistedDesktopCodexHomePath(): string {
  try {
    if (!FS.existsSync(SERVER_SETTINGS_PATH)) {
      return DEFAULT_STANDALONE_CODEX_HOME_PATH;
    }

    const parsed = JSON.parse(FS.readFileSync(SERVER_SETTINGS_PATH, "utf8")) as {
      providers?: {
        codex?: {
          homePath?: unknown;
        };
      };
    };
    const configuredHomePath = parsed.providers?.codex?.homePath;
    return typeof configuredHomePath === "string" && configuredHomePath.trim().length > 0
      ? configuredHomePath.trim()
      : DEFAULT_STANDALONE_CODEX_HOME_PATH;
  } catch (error) {
    console.warn("[desktop] failed to read persisted Codex home path", error);
    return DEFAULT_STANDALONE_CODEX_HOME_PATH;
  }
}

function ensureDefaultDesktopServerSettings(): void {
  try {
    FS.mkdirSync(Path.dirname(SERVER_SETTINGS_PATH), { recursive: true });

    if (!FS.existsSync(SERVER_SETTINGS_PATH)) {
      FS.writeFileSync(
        SERVER_SETTINGS_PATH,
        `${JSON.stringify(
          {
            providers: {
              codex: {
                homePath: DEFAULT_STANDALONE_CODEX_HOME_PATH,
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }

    FS.mkdirSync(readPersistedDesktopCodexHomePath(), { recursive: true });
  } catch (error) {
    console.warn("[desktop] failed to seed default server settings", error);
  }
}

function backendChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.AGENTSCIENCE_PORT;
  delete env.AGENTSCIENCE_AUTH_TOKEN;
  delete env.AGENTSCIENCE_MODE;
  delete env.AGENTSCIENCE_NO_BROWSER;
  delete env.AGENTSCIENCE_HOST;
  delete env.AGENTSCIENCE_DESKTOP_WS_URL;
  return env;
}

function writeDesktopLogHeader(message: string): void {
  if (!desktopLogSink) return;
  desktopLogSink.write(`[${logTimestamp()}] [${logScope("desktop")}] ${message}\n`);
}

function writeBackendSessionBoundary(phase: "START" | "END", details: string): void {
  if (!backendLogSink) return;
  const normalizedDetails = sanitizeLogValue(details);
  backendLogSink.write(
    `[${logTimestamp()}] ---- APP SESSION ${phase} run=${APP_RUN_ID} ${normalizedDetails} ----\n`,
  );
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolvePackagedAppBundlePath(): string | null {
  if (!app.isPackaged || process.platform !== "darwin") {
    return null;
  }

  return Path.dirname(Path.dirname(Path.dirname(app.getPath("exe"))));
}

let macAutoUpdateDisabledReasonCache: string | null | undefined;

function resolveMacAutoUpdateDisabledReason(): string | null {
  if (process.platform !== "darwin" || !app.isPackaged) {
    return null;
  }
  if (macAutoUpdateDisabledReasonCache !== undefined) {
    return macAutoUpdateDisabledReasonCache;
  }

  const appBundlePath = resolvePackagedAppBundlePath();
  if (!appBundlePath) {
    macAutoUpdateDisabledReasonCache = null;
    return null;
  }

  try {
    const result = ChildProcess.spawnSync("codesign", ["-dv", "--verbose=4", appBundlePath], {
      encoding: "utf8",
    });
    const report = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0 && report.trim().length === 0) {
      throw new Error(`codesign exited with status ${result.status ?? "unknown"}`);
    }

    if (/Signature=adhoc/i.test(report) || /TeamIdentifier=not set/i.test(report)) {
      macAutoUpdateDisabledReasonCache =
        "This Mac build was released without Apple Developer signing, so AgentScience cannot install updates automatically yet. Download the latest release instead.";
      return macAutoUpdateDisabledReasonCache;
    }

    macAutoUpdateDisabledReasonCache = null;
    return null;
  } catch (error) {
    macAutoUpdateDisabledReasonCache =
      "AgentScience could not verify this Mac build for automatic installs. Download the latest release instead.";
    console.warn("[desktop-updater] Failed to inspect macOS code signature", error);
    return macAutoUpdateDisabledReasonCache;
  }
}

function getSafeExternalUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return null;
  }

  return parsedUrl.toString();
}

function getSafeTheme(rawTheme: unknown): DesktopTheme | null {
  if (rawTheme === "light" || rawTheme === "dark" || rawTheme === "system") {
    return rawTheme;
  }

  return null;
}

function writeDesktopStreamChunk(
  streamName: "stdout" | "stderr",
  chunk: unknown,
  encoding: BufferEncoding | undefined,
): void {
  if (!desktopLogSink) return;
  const buffer = Buffer.isBuffer(chunk)
    ? chunk
    : Buffer.from(String(chunk), typeof chunk === "string" ? encoding : undefined);
  desktopLogSink.write(`[${logTimestamp()}] [${logScope(streamName)}] `);
  desktopLogSink.write(buffer);
  if (buffer.length === 0 || buffer[buffer.length - 1] !== 0x0a) {
    desktopLogSink.write("\n");
  }
}

function installStdIoCapture(): void {
  if (!app.isPackaged || desktopLogSink === null || restoreStdIoCapture !== null) {
    return;
  }

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  const patchWrite =
    (streamName: "stdout" | "stderr", originalWrite: typeof process.stdout.write) =>
    (
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ): boolean => {
      const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : undefined;
      writeDesktopStreamChunk(streamName, chunk, encoding);
      if (typeof encodingOrCallback === "function") {
        return originalWrite(chunk, encodingOrCallback);
      }
      if (callback !== undefined) {
        return originalWrite(chunk, encoding, callback);
      }
      if (encoding !== undefined) {
        return originalWrite(chunk, encoding);
      }
      return originalWrite(chunk);
    };

  process.stdout.write = patchWrite("stdout", originalStdoutWrite);
  process.stderr.write = patchWrite("stderr", originalStderrWrite);

  restoreStdIoCapture = () => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    restoreStdIoCapture = null;
  };
}

function initializePackagedLogging(): void {
  if (!app.isPackaged) return;
  try {
    desktopLogSink = new RotatingFileSink({
      filePath: Path.join(LOG_DIR, "desktop-main.log"),
      maxBytes: LOG_FILE_MAX_BYTES,
      maxFiles: LOG_FILE_MAX_FILES,
    });
    backendLogSink = new RotatingFileSink({
      filePath: Path.join(LOG_DIR, "server-child.log"),
      maxBytes: LOG_FILE_MAX_BYTES,
      maxFiles: LOG_FILE_MAX_FILES,
    });
    installStdIoCapture();
    writeDesktopLogHeader(`runtime log capture enabled logDir=${LOG_DIR}`);
  } catch (error) {
    // Logging setup should never block app startup.
    console.error("[desktop] failed to initialize packaged logging", error);
  }
}

function captureBackendOutput(child: ChildProcess.ChildProcess): void {
  if (!app.isPackaged || backendLogSink === null) return;
  const writeChunk = (chunk: unknown): void => {
    if (!backendLogSink) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    backendLogSink.write(buffer);
  };
  child.stdout?.on("data", writeChunk);
  child.stderr?.on("data", writeChunk);
}

initializePackagedLogging();

if (process.platform === "linux") {
  app.commandLine.appendSwitch("class", LINUX_WM_CLASS);
}

function getDestructiveMenuIcon(): Electron.NativeImage | undefined {
  if (process.platform !== "darwin") return undefined;
  if (destructiveMenuIconCache !== undefined) {
    return destructiveMenuIconCache ?? undefined;
  }
  try {
    const icon = nativeImage.createFromNamedImage("trash").resize({
      width: 14,
      height: 14,
    });
    if (icon.isEmpty()) {
      destructiveMenuIconCache = null;
      return undefined;
    }
    icon.setTemplateImage(true);
    destructiveMenuIconCache = icon;
    return icon;
  } catch {
    destructiveMenuIconCache = null;
    return undefined;
  }
}
let updatePollTimer: ReturnType<typeof setInterval> | null = null;
let updateStartupTimer: ReturnType<typeof setTimeout> | null = null;
let updateCheckInFlight = false;
let updateDownloadInFlight = false;
let updateInstallInFlight = false;
let updaterConfigured = false;
let updateState: DesktopUpdateState = initialUpdateState();

function resolveUpdaterErrorContext(): DesktopUpdateErrorContext {
  if (updateInstallInFlight) return "install";
  if (updateDownloadInFlight) return "download";
  if (updateCheckInFlight) return "check";
  return updateState.errorContext;
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: DESKTOP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function resolveAppRoot(): string {
  if (!app.isPackaged) {
    return ROOT_DIR;
  }
  return app.getAppPath();
}

/** Read the baked-in app-update.yml config (if applicable). */
function readAppUpdateYml(): Record<string, string> | null {
  try {
    // electron-updater reads from process.resourcesPath in packaged builds,
    // or dev-app-update.yml via app.getAppPath() in dev.
    const ymlPath = app.isPackaged
      ? Path.join(process.resourcesPath, "app-update.yml")
      : Path.join(app.getAppPath(), "dev-app-update.yml");
    const raw = FS.readFileSync(ymlPath, "utf-8");
    // The YAML is simple key-value pairs — avoid pulling in a YAML parser by
    // doing a line-based parse (fields: provider, owner, repo, releaseType, …).
    const entries: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match?.[1] && match[2]) entries[match[1]] = match[2].trim();
    }
    return entries.provider ? entries : null;
  } catch {
    return null;
  }
}

function normalizeCommitHash(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!COMMIT_HASH_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.slice(0, COMMIT_HASH_DISPLAY_LENGTH).toLowerCase();
}

function resolveEmbeddedCommitHash(): string | null {
  const packageJsonPath = Path.join(resolveAppRoot(), "package.json");
  if (!FS.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const raw = FS.readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { agentscienceCommitHash?: unknown };
    return normalizeCommitHash(parsed.agentscienceCommitHash);
  } catch {
    return null;
  }
}

function resolveAboutCommitHash(): string | null {
  if (aboutCommitHashCache !== undefined) {
    return aboutCommitHashCache;
  }

  const envCommitHash = normalizeCommitHash(process.env.AGENTSCIENCE_COMMIT_HASH);
  if (envCommitHash) {
    aboutCommitHashCache = envCommitHash;
    return aboutCommitHashCache;
  }

  // Only packaged builds are required to expose commit metadata.
  if (!app.isPackaged) {
    aboutCommitHashCache = null;
    return aboutCommitHashCache;
  }

  aboutCommitHashCache = resolveEmbeddedCommitHash();

  return aboutCommitHashCache;
}

function resolveBackendEntry(): string {
  return Path.join(resolveAppRoot(), "apps/server/dist/bin.mjs");
}

function resolveBackendCwd(): string {
  if (!app.isPackaged) {
    return resolveAppRoot();
  }
  return OS.homedir();
}

function resolveDesktopStaticDir(): string | null {
  const appRoot = resolveAppRoot();
  const candidates = [
    Path.join(appRoot, "apps/server/dist/client"),
    Path.join(appRoot, "apps/web/dist"),
  ];

  for (const candidate of candidates) {
    if (FS.existsSync(Path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  return null;
}

function resolveDesktopStaticPath(staticRoot: string, requestUrl: string): string {
  const url = new URL(requestUrl);
  const rawPath = decodeURIComponent(url.pathname);
  const normalizedPath = Path.posix.normalize(rawPath).replace(/^\/+/, "");
  if (normalizedPath.includes("..")) {
    return Path.join(staticRoot, "index.html");
  }

  const requestedPath = normalizedPath.length > 0 ? normalizedPath : "index.html";
  const resolvedPath = Path.join(staticRoot, requestedPath);

  if (Path.extname(resolvedPath)) {
    return resolvedPath;
  }

  const nestedIndex = Path.join(resolvedPath, "index.html");
  if (FS.existsSync(nestedIndex)) {
    return nestedIndex;
  }

  return Path.join(staticRoot, "index.html");
}

function isStaticAssetRequest(requestUrl: string): boolean {
  try {
    const url = new URL(requestUrl);
    return Path.extname(url.pathname).length > 0;
  } catch {
    return false;
  }
}

function handleFatalStartupError(stage: string, error: unknown): void {
  const message = formatErrorMessage(error);
  const detail =
    error instanceof Error && typeof error.stack === "string" ? `\n${error.stack}` : "";
  writeDesktopLogHeader(`fatal startup error stage=${stage} message=${message}`);
  console.error(`[desktop] fatal startup error (${stage})`, error);
  if (!isQuitting) {
    isQuitting = true;
    dialog.showErrorBox("AgentScience failed to start", `Stage: ${stage}\n${message}${detail}`);
  }
  stopBackend();
  restoreStdIoCapture?.();
  app.quit();
}

function registerDesktopProtocol(): void {
  if (isDevelopment || desktopProtocolRegistered) return;

  const staticRoot = resolveDesktopStaticDir();
  if (!staticRoot) {
    throw new Error(
      "Desktop static bundle missing. Build apps/server (with bundled client) first.",
    );
  }

  const staticRootResolved = Path.resolve(staticRoot);
  const staticRootPrefix = `${staticRootResolved}${Path.sep}`;
  const fallbackIndex = Path.join(staticRootResolved, "index.html");

  protocol.registerFileProtocol(DESKTOP_SCHEME, (request, callback) => {
    try {
      const candidate = resolveDesktopStaticPath(staticRootResolved, request.url);
      const resolvedCandidate = Path.resolve(candidate);
      const isInRoot =
        resolvedCandidate === fallbackIndex || resolvedCandidate.startsWith(staticRootPrefix);
      const isAssetRequest = isStaticAssetRequest(request.url);

      if (!isInRoot || !FS.existsSync(resolvedCandidate)) {
        if (isAssetRequest) {
          callback({ error: -6 });
          return;
        }
        callback({ path: fallbackIndex });
        return;
      }

      callback({ path: resolvedCandidate });
    } catch {
      callback({ path: fallbackIndex });
    }
  });

  desktopProtocolRegistered = true;
}

function dispatchMenuAction(action: string): void {
  const existingWindow =
    BrowserWindow.getFocusedWindow() ?? mainWindow ?? BrowserWindow.getAllWindows()[0];
  const targetWindow = existingWindow ?? createWindow();
  if (!existingWindow) {
    mainWindow = targetWindow;
  }

  const send = () => {
    if (targetWindow.isDestroyed()) return;
    targetWindow.webContents.send(MENU_ACTION_CHANNEL, action);
    if (!targetWindow.isVisible()) {
      targetWindow.show();
    }
    targetWindow.focus();
  };

  if (targetWindow.webContents.isLoadingMainFrame()) {
    targetWindow.webContents.once("did-finish-load", send);
    return;
  }

  send();
}

function handleCheckForUpdatesMenuClick(): void {
  const disabledReason = resolveAutoUpdateDisabledReason();
  if (disabledReason) {
    console.info("[desktop-updater] Manual update check requested, but updates are disabled.");
    void dialog
      .showMessageBox({
        type: "info",
        title: "Updates unavailable",
        message: "Automatic updates are not available right now.",
        detail: disabledReason,
        buttons: /download the latest release/i.test(disabledReason)
          ? ["Open latest release", "OK"]
          : ["OK"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (/download the latest release/i.test(disabledReason) && response === 0) {
          void shell.openExternal(AGENTSCIENCE_RELEASES_URL);
        }
      });
    return;
  }

  if (!BrowserWindow.getAllWindows().length) {
    mainWindow = createWindow();
  }
  void checkForUpdatesFromMenu();
}

async function promptToInstallDownloadedUpdateFromMenu(): Promise<void> {
  const version = updateState.downloadedVersion ?? updateState.availableVersion ?? "update";
  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "Restart to finish update?",
    message: `AgentScience ${version} has downloaded.`,
    detail:
      "Restart now to install it. If you choose Later, AgentScience will install the update automatically the next time you quit and reopen the app.",
    buttons: ["Restart Now", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    await installDownloadedUpdate();
  }
}

async function downloadUpdateFromMenu(): Promise<void> {
  const version = updateState.availableVersion ?? "update";
  console.info(`[desktop-updater] Manual update check found ${version}; downloading now.`);
  const result = await downloadAvailableUpdate();
  if (result.accepted && result.completed && updateState.status === "downloaded") {
    await promptToInstallDownloadedUpdateFromMenu();
    return;
  }

  if (updateState.status === "error" || updateState.errorContext === "download") {
    void dialog.showMessageBox({
      type: "warning",
      title: "Update download failed",
      message: `Could not download AgentScience ${version}.`,
      detail: updateState.message ?? "An unknown error occurred. Please try again later.",
      buttons: ["OK"],
    });
  }
}

async function checkForUpdatesFromMenu(): Promise<void> {
  await checkForUpdates("menu");

  if (updateState.status === "up-to-date") {
    void dialog.showMessageBox({
      type: "info",
      title: "You're up to date!",
      message: `AgentScience ${updateState.currentVersion} is currently the newest version available.`,
      buttons: ["OK"],
    });
  } else if (updateState.status === "available") {
    await downloadUpdateFromMenu();
  } else if (updateState.status === "downloading") {
    const progress =
      typeof updateState.downloadPercent === "number"
        ? ` (${Math.floor(updateState.downloadPercent)}%)`
        : "";
    void dialog.showMessageBox({
      type: "info",
      title: "Update downloading",
      message: `AgentScience ${updateState.availableVersion ?? "update"} is downloading${progress}.`,
      detail: "AgentScience will ask to restart when the update is ready.",
      buttons: ["OK"],
    });
  } else if (updateState.status === "downloaded") {
    await promptToInstallDownloadedUpdateFromMenu();
  } else if (updateState.status === "error") {
    void dialog.showMessageBox({
      type: "warning",
      title: "Update check failed",
      message: "Could not check for updates.",
      detail: updateState.message ?? "An unknown error occurred. Please try again later.",
      buttons: ["OK"],
    });
  }
}

function configureApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates...",
          click: () => handleCheckForUpdatesMenuClick(),
        },
        { type: "separator" },
        {
          label: "Settings...",
          accelerator: "CmdOrCtrl+,",
          click: () => dispatchMenuAction("open-settings"),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push(
    {
      label: "File",
      submenu: [
        ...(process.platform === "darwin"
          ? []
          : [
              {
                label: "Settings...",
                accelerator: "CmdOrCtrl+,",
                click: () => dispatchMenuAction("open-settings"),
              },
              { type: "separator" as const },
            ]),
        { role: process.platform === "darwin" ? "close" : "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn", accelerator: "CmdOrCtrl+=" },
        { role: "zoomIn", accelerator: "CmdOrCtrl+Plus", visible: false },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Check for Updates...",
          click: () => handleCheckForUpdatesMenuClick(),
        },
      ],
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function resolveResourcePath(fileName: string): string | null {
  const candidates = [
    Path.join(__dirname, "../resources", fileName),
    Path.join(__dirname, "../prod-resources", fileName),
    Path.join(process.resourcesPath, "resources", fileName),
    Path.join(process.resourcesPath, fileName),
  ];

  for (const candidate of candidates) {
    if (FS.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveIconPath(ext: "ico" | "icns" | "png"): string | null {
  return resolveResourcePath(`icon.${ext}`);
}

function resolveMacIconPath(ext: "icns" | "png"): string | null {
  return resolveResourcePath(`${MAC_APP_ICON_BASENAME}.${ext}`) ?? resolveIconPath(ext);
}

/**
 * Resolve the Electron userData directory path.
 *
 * Electron derives the default userData path from `productName` in
 * package.json, which currently produces directories with spaces and
 * parentheses (e.g. `~/.config/AgentScience` on Linux). This is
 * unfriendly for shell usage and violates Linux naming conventions.
 *
 * We override it to a clean lowercase name (`agentscience`). If the legacy
 * directory already exists we keep using it so existing users don't
 * lose their Chromium profile data (localStorage, cookies, sessions).
 */
function resolveUserDataPath(): string {
  const appDataBase =
    process.platform === "win32"
      ? process.env.APPDATA || Path.join(OS.homedir(), "AppData", "Roaming")
      : process.platform === "darwin"
        ? Path.join(OS.homedir(), "Library", "Application Support")
        : process.env.XDG_CONFIG_HOME || Path.join(OS.homedir(), ".config");

  for (const legacyDirName of LEGACY_USER_DATA_DIR_NAMES) {
    const legacyPath = Path.join(appDataBase, legacyDirName);
    if (FS.existsSync(legacyPath)) {
      return legacyPath;
    }
  }

  return Path.join(appDataBase, USER_DATA_DIR_NAME);
}

function configureAppIdentity(): void {
  app.setName(APP_DISPLAY_NAME);
  const commitHash = resolveAboutCommitHash();
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion(),
    version: commitHash ?? "unknown",
  });

  if (process.platform === "win32") {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  }

  if (process.platform === "linux") {
    (app as LinuxDesktopNamedApp).setDesktopName?.(LINUX_DESKTOP_ENTRY_NAME);
  }

  if (process.platform === "darwin" && app.dock) {
    const iconPath = resolveMacIconPath("png");
    if (iconPath) {
      app.dock.setIcon(iconPath);
    }
  }
}

function clearUpdatePollTimer(): void {
  if (updateStartupTimer) {
    clearTimeout(updateStartupTimer);
    updateStartupTimer = null;
  }
  if (updatePollTimer) {
    clearInterval(updatePollTimer);
    updatePollTimer = null;
  }
}

function emitUpdateState(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(UPDATE_STATE_CHANNEL, updateState);
  }
}

function setUpdateState(patch: Partial<DesktopUpdateState>): void {
  updateState = { ...updateState, ...patch };
  emitUpdateState();
}

function resolveAutoUpdateDisabledReason(): string | null {
  return (
    getAutoUpdateDisabledReason({
      isDevelopment,
      isPackaged: app.isPackaged,
      platform: process.platform,
      appImage: process.env.APPIMAGE,
      disabledByEnv: process.env.AGENTSCIENCE_DISABLE_AUTO_UPDATE === "1",
    }) ?? resolveMacAutoUpdateDisabledReason()
  );
}

async function checkForUpdates(reason: string): Promise<boolean> {
  if (isQuitting || !updaterConfigured || updateCheckInFlight) return false;
  if (updateState.status === "downloading" || updateState.status === "downloaded") {
    console.info(
      `[desktop-updater] Skipping update check (${reason}) while status=${updateState.status}.`,
    );
    return false;
  }
  updateCheckInFlight = true;
  setUpdateState(reduceDesktopUpdateStateOnCheckStart(updateState, new Date().toISOString()));
  console.info(`[desktop-updater] Checking for updates (${reason})...`);

  try {
    await autoUpdater.checkForUpdates();
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    setUpdateState(
      reduceDesktopUpdateStateOnCheckFailure(updateState, message, new Date().toISOString()),
    );
    console.error(`[desktop-updater] Failed to check for updates: ${message}`);
    return true;
  } finally {
    updateCheckInFlight = false;
  }
}

async function downloadAvailableUpdate(): Promise<{ accepted: boolean; completed: boolean }> {
  if (!updaterConfigured || updateDownloadInFlight || updateState.status !== "available") {
    return { accepted: false, completed: false };
  }
  updateDownloadInFlight = true;
  setUpdateState(reduceDesktopUpdateStateOnDownloadStart(updateState));
  autoUpdater.disableDifferentialDownload = isArm64HostRunningIntelBuild(desktopRuntimeInfo);
  console.info("[desktop-updater] Downloading update...");

  try {
    await autoUpdater.downloadUpdate();
    return { accepted: true, completed: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    setUpdateState(reduceDesktopUpdateStateOnDownloadFailure(updateState, message));
    console.error(`[desktop-updater] Failed to download update: ${message}`);
    return { accepted: true, completed: false };
  } finally {
    updateDownloadInFlight = false;
  }
}

async function installDownloadedUpdate(): Promise<{ accepted: boolean; completed: boolean }> {
  if (isQuitting || !updaterConfigured || updateState.status !== "downloaded") {
    return { accepted: false, completed: false };
  }

  isQuitting = true;
  updateInstallInFlight = true;
  clearUpdatePollTimer();
  try {
    await stopBackendAndWaitForExit();
    // Destroy all windows before launching the NSIS installer to avoid the installer finding live windows it needs to close.
    for (const win of BrowserWindow.getAllWindows()) {
      win.destroy();
    }
    // `quitAndInstall()` only starts the handoff to the updater. The actual
    // install may still fail asynchronously, so keep the action incomplete
    // until we either quit or receive an updater error.
    autoUpdater.quitAndInstall(true, true);
    return { accepted: true, completed: false };
  } catch (error: unknown) {
    const message = formatErrorMessage(error);
    updateInstallInFlight = false;
    isQuitting = false;
    setUpdateState(reduceDesktopUpdateStateOnInstallFailure(updateState, message));
    console.error(`[desktop-updater] Failed to install update: ${message}`);
    return { accepted: true, completed: false };
  }
}

function configureAutoUpdater(): void {
  const disabledReason = resolveAutoUpdateDisabledReason();
  const enabled = disabledReason === null;
  setUpdateState({
    ...createInitialDesktopUpdateState(app.getVersion(), desktopRuntimeInfo),
    enabled,
    status: enabled ? "idle" : "disabled",
    message: disabledReason,
  });
  if (!enabled) {
    return;
  }
  updaterConfigured = true;

  const githubToken =
    process.env.AGENTSCIENCE_DESKTOP_UPDATE_GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim() ||
    "";
  if (githubToken) {
    // When a token is provided, re-configure the feed with `private: true` so
    // electron-updater uses the GitHub API (api.github.com) instead of the
    // public Atom feed (github.com/…/releases.atom) which rejects Bearer auth.
    const appUpdateYml = readAppUpdateYml();
    if (appUpdateYml?.provider === "github") {
      autoUpdater.setFeedURL({
        ...appUpdateYml,
        provider: "github" as const,
        private: true,
        token: githubToken,
      });
    }
  }

  if (process.env.AGENTSCIENCE_DESKTOP_MOCK_UPDATES) {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: `http://localhost:${process.env.AGENTSCIENCE_DESKTOP_MOCK_UPDATE_SERVER_PORT ?? 3000}`,
    });
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // Production builds always read from the stable AgentScience release channel.
  autoUpdater.channel = DESKTOP_UPDATE_CHANNEL;
  autoUpdater.allowPrerelease = DESKTOP_UPDATE_ALLOW_PRERELEASE;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableDifferentialDownload = isArm64HostRunningIntelBuild(desktopRuntimeInfo);
  let lastLoggedDownloadMilestone = -1;

  if (isArm64HostRunningIntelBuild(desktopRuntimeInfo)) {
    console.info(
      "[desktop-updater] Apple Silicon host detected while running Intel build; updates will switch to arm64 packages.",
    );
  }

  autoUpdater.on("checking-for-update", () => {
    console.info("[desktop-updater] Looking for updates...");
  });
  autoUpdater.on("update-available", (info) => {
    setUpdateState(
      reduceDesktopUpdateStateOnUpdateAvailable(
        updateState,
        info.version,
        new Date().toISOString(),
      ),
    );
    lastLoggedDownloadMilestone = -1;
    console.info(`[desktop-updater] Update available: ${info.version}`);
  });
  autoUpdater.on("update-not-available", () => {
    setUpdateState(reduceDesktopUpdateStateOnNoUpdate(updateState, new Date().toISOString()));
    lastLoggedDownloadMilestone = -1;
    console.info("[desktop-updater] No updates available.");
  });
  autoUpdater.on("error", (error) => {
    const message = formatErrorMessage(error);
    if (updateInstallInFlight) {
      updateInstallInFlight = false;
      isQuitting = false;
      setUpdateState(reduceDesktopUpdateStateOnInstallFailure(updateState, message));
      console.error(`[desktop-updater] Updater error: ${message}`);
      return;
    }
    if (!updateCheckInFlight && !updateDownloadInFlight) {
      setUpdateState({
        status: "error",
        message,
        checkedAt: new Date().toISOString(),
        downloadPercent: null,
        errorContext: resolveUpdaterErrorContext(),
        canRetry: updateState.availableVersion !== null || updateState.downloadedVersion !== null,
      });
    }
    console.error(`[desktop-updater] Updater error: ${message}`);
  });
  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.floor(progress.percent);
    if (
      shouldBroadcastDownloadProgress(updateState, progress.percent) ||
      updateState.message !== null
    ) {
      setUpdateState(reduceDesktopUpdateStateOnDownloadProgress(updateState, progress.percent));
    }
    const milestone = percent - (percent % 10);
    if (milestone > lastLoggedDownloadMilestone) {
      lastLoggedDownloadMilestone = milestone;
      console.info(`[desktop-updater] Download progress: ${percent}%`);
    }
  });
  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState(reduceDesktopUpdateStateOnDownloadComplete(updateState, info.version));
    console.info(`[desktop-updater] Update downloaded: ${info.version}`);
  });

  clearUpdatePollTimer();

  updateStartupTimer = setTimeout(() => {
    updateStartupTimer = null;
    void checkForUpdates("startup");
  }, AUTO_UPDATE_STARTUP_DELAY_MS);
  updateStartupTimer.unref();

  updatePollTimer = setInterval(() => {
    void checkForUpdates("poll");
  }, AUTO_UPDATE_POLL_INTERVAL_MS);
  updatePollTimer.unref();
}
function scheduleBackendRestart(reason: string): void {
  if (isQuitting || restartTimer) return;

  const delayMs = Math.min(500 * 2 ** restartAttempt, 10_000);
  restartAttempt += 1;
  console.error(`[desktop] backend exited unexpectedly (${reason}); restarting in ${delayMs}ms`);

  restartTimer = setTimeout(() => {
    restartTimer = null;
    startBackend();
  }, delayMs);
}

function startBackend(): void {
  if (isQuitting || backendProcess) return;

  ensureDefaultDesktopServerSettings();
  backendObservabilitySettings = readPersistedBackendObservabilitySettings();
  const backendEntry = resolveBackendEntry();
  if (!FS.existsSync(backendEntry)) {
    scheduleBackendRestart(`missing server entry at ${backendEntry}`);
    return;
  }

  const captureBackendLogs = app.isPackaged && backendLogSink !== null;
  const managedCodexRuntime = resolveManagedCodexRuntime({
    resourcesPath: process.resourcesPath,
    platform: process.platform,
    arch: process.arch,
  });
  const managedDesktopServerEnv = buildManagedDesktopServerEnv({
    resourcesPath: process.resourcesPath,
    repoRoot: ROOT_DIR,
    platform: process.platform,
    arch: process.arch,
  });
  const child = ChildProcess.spawn(process.execPath, [backendEntry, "--bootstrap-fd", "3"], {
    cwd: resolveBackendCwd(),
    // In Electron main, process.execPath points to the Electron binary.
    // Run the child in Node mode so this backend process does not become a GUI app instance.
    env: {
      ...backendChildEnv(),
      ELECTRON_RUN_AS_NODE: "1",
      ...(managedCodexRuntime
        ? {
            AGENTSCIENCE_MANAGED_CODEX_BINARY_PATH: managedCodexRuntime.binaryPath,
            AGENTSCIENCE_MANAGED_CODEX_PATH_DIR: managedCodexRuntime.pathDir,
          }
        : {}),
      ...managedDesktopServerEnv,
    },
    stdio: captureBackendLogs
      ? ["ignore", "pipe", "pipe", "pipe"]
      : ["ignore", "inherit", "inherit", "pipe"],
  });
  const bootstrapStream = child.stdio[3];
  if (bootstrapStream && "write" in bootstrapStream) {
    bootstrapStream.write(
      `${JSON.stringify({
        mode: "desktop",
        noBrowser: true,
        port: backendPort,
        agentScienceHome: BASE_DIR,
        authToken: backendAuthToken,
        ...(backendObservabilitySettings.otlpTracesUrl
          ? { otlpTracesUrl: backendObservabilitySettings.otlpTracesUrl }
          : {}),
        ...(backendObservabilitySettings.otlpMetricsUrl
          ? { otlpMetricsUrl: backendObservabilitySettings.otlpMetricsUrl }
          : {}),
      })}\n`,
    );
    bootstrapStream.end();
  } else {
    child.kill("SIGTERM");
    scheduleBackendRestart("missing desktop bootstrap pipe");
    return;
  }
  backendProcess = child;
  let backendSessionClosed = false;
  const closeBackendSession = (details: string) => {
    if (backendSessionClosed) return;
    backendSessionClosed = true;
    writeBackendSessionBoundary("END", details);
  };
  writeBackendSessionBoundary(
    "START",
    `pid=${child.pid ?? "unknown"} port=${backendPort} cwd=${resolveBackendCwd()}`,
  );
  captureBackendOutput(child);

  child.once("spawn", () => {
    restartAttempt = 0;
  });

  child.on("error", (error) => {
    const wasExpected = expectedBackendExitChildren.has(child);
    if (backendProcess === child) {
      backendProcess = null;
    }
    closeBackendSession(`pid=${child.pid ?? "unknown"} error=${error.message}`);
    if (wasExpected) {
      return;
    }
    scheduleBackendRestart(error.message);
  });

  child.on("exit", (code, signal) => {
    const wasExpected = expectedBackendExitChildren.has(child);
    if (backendProcess === child) {
      backendProcess = null;
    }
    closeBackendSession(
      `pid=${child.pid ?? "unknown"} code=${code ?? "null"} signal=${signal ?? "null"}`,
    );
    if (isQuitting || wasExpected) return;
    const reason = `code=${code ?? "null"} signal=${signal ?? "null"}`;
    scheduleBackendRestart(reason);
  });
}

function stopBackend(): void {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  const child = backendProcess;
  backendProcess = null;
  if (!child) return;

  if (child.exitCode === null && child.signalCode === null) {
    expectedBackendExitChildren.add(child);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 2_000).unref();
  }
}

async function stopBackendAndWaitForExit(timeoutMs = 5_000): Promise<void> {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  const child = backendProcess;
  backendProcess = null;
  if (!child) return;
  const backendChild = child;
  if (backendChild.exitCode !== null || backendChild.signalCode !== null) return;
  expectedBackendExitChildren.add(backendChild);

  await new Promise<void>((resolve) => {
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    let exitTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

    function settle(): void {
      if (settled) return;
      settled = true;
      backendChild.off("exit", onExit);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      if (exitTimeoutTimer) {
        clearTimeout(exitTimeoutTimer);
      }
      resolve();
    }

    function onExit(): void {
      settle();
    }

    backendChild.once("exit", onExit);
    backendChild.kill("SIGTERM");

    forceKillTimer = setTimeout(() => {
      if (backendChild.exitCode === null && backendChild.signalCode === null) {
        backendChild.kill("SIGKILL");
      }
    }, 2_000);
    forceKillTimer.unref();

    exitTimeoutTimer = setTimeout(() => {
      settle();
    }, timeoutMs);
    exitTimeoutTimer.unref();
  });
}

function registerIpcHandlers(): void {
  ipcMain.removeAllListeners(GET_WS_URL_CHANNEL);
  ipcMain.on(GET_WS_URL_CHANNEL, (event) => {
    event.returnValue = backendWsUrl;
  });

  ipcMain.removeAllListeners(IS_FULL_SCREEN_CHANNEL);
  ipcMain.on(IS_FULL_SCREEN_CHANNEL, (event) => {
    const owner =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? mainWindow;
    event.returnValue = owner?.isFullScreen() ?? false;
  });

  ipcMain.removeHandler(PICK_FOLDER_CHANNEL);
  ipcMain.handle(PICK_FOLDER_CHANNEL, async () => {
    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          properties: ["openDirectory", "createDirectory"],
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
        });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.removeHandler(CONFIRM_CHANNEL);
  ipcMain.handle(CONFIRM_CHANNEL, async (_event, message: unknown) => {
    if (typeof message !== "string") {
      return false;
    }

    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    return showDesktopConfirmDialog(message, owner);
  });

  ipcMain.removeHandler(SET_THEME_CHANNEL);
  ipcMain.handle(SET_THEME_CHANNEL, async (_event, rawTheme: unknown) => {
    const theme = getSafeTheme(rawTheme);
    if (!theme) {
      return;
    }

    nativeTheme.themeSource = theme;
  });

  ipcMain.removeHandler(CONTEXT_MENU_CHANNEL);
  ipcMain.handle(
    CONTEXT_MENU_CHANNEL,
    async (_event, items: ContextMenuItem[], position?: { x: number; y: number }) => {
      const normalizedItems = items
        .filter((item) => typeof item.id === "string" && typeof item.label === "string")
        .map((item) => ({
          id: item.id,
          label: item.label,
          destructive: item.destructive === true,
          disabled: item.disabled === true,
        }));
      if (normalizedItems.length === 0) {
        return null;
      }

      const popupPosition =
        position &&
        Number.isFinite(position.x) &&
        Number.isFinite(position.y) &&
        position.x >= 0 &&
        position.y >= 0
          ? {
              x: Math.floor(position.x),
              y: Math.floor(position.y),
            }
          : null;

      const window = BrowserWindow.getFocusedWindow() ?? mainWindow;
      if (!window) return null;

      return new Promise<string | null>((resolve) => {
        const template: MenuItemConstructorOptions[] = [];
        let hasInsertedDestructiveSeparator = false;
        for (const item of normalizedItems) {
          if (item.destructive && !hasInsertedDestructiveSeparator && template.length > 0) {
            template.push({ type: "separator" });
            hasInsertedDestructiveSeparator = true;
          }
          const itemOption: MenuItemConstructorOptions = {
            label: item.label,
            enabled: !item.disabled,
            click: () => resolve(item.id),
          };
          if (item.destructive) {
            const destructiveIcon = getDestructiveMenuIcon();
            if (destructiveIcon) {
              itemOption.icon = destructiveIcon;
            }
          }
          template.push(itemOption);
        }

        const menu = Menu.buildFromTemplate(template);
        menu.popup({
          window,
          ...popupPosition,
          callback: () => resolve(null),
        });
      });
    },
  );

  ipcMain.removeHandler(OPEN_EXTERNAL_CHANNEL);
  ipcMain.handle(OPEN_EXTERNAL_CHANNEL, async (_event, rawUrl: unknown) => {
    const externalUrl = getSafeExternalUrl(rawUrl);
    if (!externalUrl) {
      return false;
    }

    try {
      await shell.openExternal(externalUrl);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.removeHandler(UPDATE_GET_STATE_CHANNEL);
  ipcMain.handle(UPDATE_GET_STATE_CHANNEL, async () => updateState);

  ipcMain.removeHandler(UPDATE_DOWNLOAD_CHANNEL);
  ipcMain.handle(UPDATE_DOWNLOAD_CHANNEL, async () => {
    const result = await downloadAvailableUpdate();
    return {
      accepted: result.accepted,
      completed: result.completed,
      state: updateState,
    } satisfies DesktopUpdateActionResult;
  });

  ipcMain.removeHandler(UPDATE_INSTALL_CHANNEL);
  ipcMain.handle(UPDATE_INSTALL_CHANNEL, async () => {
    if (isQuitting) {
      return {
        accepted: false,
        completed: false,
        state: updateState,
      } satisfies DesktopUpdateActionResult;
    }
    const result = await installDownloadedUpdate();
    return {
      accepted: result.accepted,
      completed: result.completed,
      state: updateState,
    } satisfies DesktopUpdateActionResult;
  });

  ipcMain.removeHandler(UPDATE_CHECK_CHANNEL);
  ipcMain.handle(UPDATE_CHECK_CHANNEL, async () => {
    if (!updaterConfigured) {
      return {
        checked: false,
        state: updateState,
      } satisfies DesktopUpdateCheckResult;
    }
    const checked = await checkForUpdates("web-ui");
    return {
      checked,
      state: updateState,
    } satisfies DesktopUpdateCheckResult;
  });

  ipcMain.removeHandler(ANALYTICS_GET_CHANNEL);
  ipcMain.handle(ANALYTICS_GET_CHANNEL, async () => getAnalyticsSettings());

  ipcMain.removeHandler(ANALYTICS_SET_ENABLED_CHANNEL);
  ipcMain.handle(ANALYTICS_SET_ENABLED_CHANNEL, async (_event, rawEnabled: unknown) => {
    if (typeof rawEnabled !== "boolean") return getAnalyticsSettings();
    const next = setAnalyticsEnabled(rawEnabled);
    // If the user just opted in on a fresh UTC day, fire the ping now so
    // they don't have to wait until the next launch / window focus.
    tryTrackAppOpened({ now: new Date() });
    return next;
  });
}

function getIconOption(): { icon: string } | Record<string, never> {
  if (process.platform === "darwin") return {}; // macOS uses .icns from app bundle
  const ext = process.platform === "win32" ? "ico" : "png";
  const iconPath = resolveIconPath(ext);
  return iconPath ? { icon: iconPath } : {};
}

function resolveAppShellUrl(): string {
  return isDevelopment
    ? (process.env.VITE_DEV_SERVER_URL as string)
    : `${DESKTOP_SCHEME}://app/index.html`;
}

function resolveDesktopBootUrl(): string {
  const bootHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${APP_DISPLAY_NAME}</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: "IBM Plex Sans", "Helvetica Neue", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f5f5f5;
        color: #1a1a1a;
      }
      main {
        width: min(32rem, calc(100vw - 3rem));
        padding: 2rem;
      }
      h1 {
        margin: 0;
        font-family: "EB Garamond", Georgia, serif;
        font-size: 2.5rem;
        font-weight: 400;
        line-height: 1.05;
      }
      p {
        margin: 0.9rem 0 0;
        max-width: 28rem;
        font-size: 0.95rem;
        line-height: 1.6;
        color: #6e6e6e;
      }
      .rule {
        margin-top: 1.5rem;
        width: 5rem;
        height: 1px;
        background: #e5e5e5;
      }
      @media (prefers-color-scheme: dark) {
        body {
          background: #151515;
          color: #f5f5f5;
        }
        p {
          color: #b4b4b4;
        }
        .rule {
          background: #303030;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Starting AgentScience</h1>
      <p>Preparing your workspace and local tools. This usually takes a few seconds.</p>
      <div class="rule"></div>
    </main>
  </body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(bootHtml)}`;
}

function resolveBackendReadyUrl(): string {
  return `http://127.0.0.1:${backendPort}${BACKEND_READY_PATH}`;
}

async function waitForBackendReady(): Promise<void> {
  const deadline = Date.now() + BACKEND_READY_TIMEOUT_MS;
  let lastErrorMessage: string | null = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(resolveBackendReadyUrl(), {
        cache: "no-store",
        signal: AbortSignal.timeout(BACKEND_READY_REQUEST_TIMEOUT_MS),
      });
      if (response.ok) {
        return;
      }
      lastErrorMessage = `Startup check returned ${response.status}.`;
    } catch (error) {
      lastErrorMessage = formatErrorMessage(error);
    }

    await sleep(BACKEND_READY_RETRY_DELAY_MS);
  }

  throw new Error(
    lastErrorMessage
      ? `AgentScience took too long to start. ${lastErrorMessage}`
      : "AgentScience took too long to start.",
  );
}

function loadAppShell(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }

  void window.loadURL(resolveAppShellUrl());
  if (isDevelopment && !window.webContents.isDevToolsOpened()) {
    window.webContents.openDevTools({ mode: "detach" });
  }
}

function createWindow(options?: { readonly loadAppImmediately?: boolean }): BrowserWindow {
  const loadAppImmediately = options?.loadAppImmediately ?? true;
  const window = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 840,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    ...getIconOption(),
    title: APP_DISPLAY_NAME,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: Path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.on("context-menu", (event, params) => {
    event.preventDefault();

    const menuTemplate: MenuItemConstructorOptions[] = [];

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        menuTemplate.push({
          label: suggestion,
          click: () => window.webContents.replaceMisspelling(suggestion),
        });
      }
      if (params.dictionarySuggestions.length === 0) {
        menuTemplate.push({ label: "No suggestions", enabled: false });
      }
      menuTemplate.push({ type: "separator" });
    }

    menuTemplate.push(
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { role: "selectAll", enabled: params.editFlags.canSelectAll },
    );

    Menu.buildFromTemplate(menuTemplate).popup({ window });
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = getSafeExternalUrl(url);
    if (externalUrl) {
      void shell.openExternal(externalUrl);
    }
    return { action: "deny" };
  });

  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(APP_DISPLAY_NAME);
  });

  const sendFullScreenState = (isFullScreen: boolean) => {
    if (window.isDestroyed()) return;
    window.webContents.send(FULL_SCREEN_CHANGED_CHANNEL, isFullScreen);
  };
  window.on("enter-full-screen", () => sendFullScreenState(true));
  window.on("leave-full-screen", () => sendFullScreenState(false));
  window.webContents.on("did-finish-load", () => {
    window.setTitle(APP_DISPLAY_NAME);
    emitUpdateState();
  });
  window.once("ready-to-show", () => {
    window.show();
  });

  if (loadAppImmediately) {
    loadAppShell(window);
  } else {
    void window.loadURL(resolveDesktopBootUrl());
  }

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  return window;
}

// Override Electron's userData path before the `ready` event so that
// Chromium session data uses a filesystem-friendly directory name.
// Must be called synchronously at the top level — before `app.whenReady()`.
app.setPath("userData", resolveUserDataPath());

configureAppIdentity();

async function bootstrap(): Promise<void> {
  writeDesktopLogHeader("bootstrap start");
  backendPort = await Effect.service(NetService).pipe(
    Effect.flatMap((net) => net.reserveLoopbackPort()),
    Effect.provide(NetService.layer),
    Effect.runPromise,
  );
  writeDesktopLogHeader(`reserved backend port via NetService port=${backendPort}`);
  backendAuthToken = Crypto.randomBytes(24).toString("hex");
  const baseUrl = `ws://127.0.0.1:${backendPort}`;
  backendWsUrl = `${baseUrl}/?token=${encodeURIComponent(backendAuthToken)}`;
  writeDesktopLogHeader(`bootstrap resolved websocket endpoint baseUrl=${baseUrl}`);

  registerIpcHandlers();
  writeDesktopLogHeader("bootstrap ipc handlers registered");
  startBackend();
  writeDesktopLogHeader("bootstrap backend start requested");
  mainWindow = createWindow({ loadAppImmediately: false });
  writeDesktopLogHeader("bootstrap main window created");
  await waitForBackendReady();
  writeDesktopLogHeader("bootstrap backend ready confirmed");
  if (mainWindow && !mainWindow.isDestroyed()) {
    loadAppShell(mainWindow);
    writeDesktopLogHeader("bootstrap app shell loaded");
  }
  // Daily anonymous-usage ping. No-op when opted out, env var unset, or
  // we already pinged for the current UTC day. See docs/PRIVACY.md.
  tryTrackAppOpened({ now: new Date() });
}

app.on("before-quit", () => {
  isQuitting = true;
  updateInstallInFlight = false;
  writeDesktopLogHeader("before-quit received");
  clearUpdatePollTimer();
  stopBackend();
  restoreStdIoCapture?.();
});

if (hasSingleInstanceLock) {
  app
    .whenReady()
    .then(() => {
      writeDesktopLogHeader("app ready");
      configureAppIdentity();
      configureApplicationMenu();
      registerDesktopProtocol();
      configureAutoUpdater();
      void bootstrap().catch((error) => {
        handleFatalStartupError("bootstrap", error);
      });

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          mainWindow = createWindow();
        }
      });
    })
    .catch((error) => {
      handleFatalStartupError("whenReady", error);
    });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !isQuitting) {
    app.quit();
  }
});

if (process.platform !== "win32") {
  process.on("SIGINT", () => {
    if (isQuitting) return;
    isQuitting = true;
    writeDesktopLogHeader("SIGINT received");
    clearUpdatePollTimer();
    stopBackend();
    restoreStdIoCapture?.();
    app.quit();
  });

  process.on("SIGTERM", () => {
    if (isQuitting) return;
    isQuitting = true;
    writeDesktopLogHeader("SIGTERM received");
    clearUpdatePollTimer();
    stopBackend();
    restoreStdIoCapture?.();
    app.quit();
  });
}
