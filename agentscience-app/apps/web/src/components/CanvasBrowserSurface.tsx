import {
  type CanvasBrowserAction,
  type CanvasBrowserBlocker,
  type CanvasBrowserState,
  type ThreadId,
} from "@agentscience/contracts";
import { AlertCircleIcon, ExternalLinkIcon, RefreshCcwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { recordCanvasBrowserActionResult, recordCanvasBrowserSnapshot } from "~/lib/canvasBrowser";
import { readNativeApi } from "~/nativeApi";

interface CanvasBrowserSurfaceProps {
  state: CanvasBrowserState;
  threadId: ThreadId;
}

type WebviewElement = HTMLElement & {
  loadURL?: (url: string) => void;
  getURL?: () => string;
  getTitle?: () => string;
  reload?: () => void;
  focus?: () => void;
  sendInputEvent?: (event: Record<string, unknown>) => void;
  insertText?: (text: string) => Promise<void> | void;
  executeJavaScript?: <T = unknown>(code: string) => Promise<T>;
  capturePage?: () => Promise<{
    toDataURL?: () => string;
    getSize?: () => { width: number; height: number };
  }>;
};

const SNAPSHOT_SCRIPT = `(() => {
  const readControlLabel = (control) => {
    if (control.getAttribute("aria-label")) return control.getAttribute("aria-label");
    if (control.labels && control.labels.length > 0) {
      return Array.from(control.labels).map((label) => label.innerText || label.textContent || "").join(" ").trim();
    }
    if (control.name) return control.name;
    if (control.id) return control.id;
    if (control.placeholder) return control.placeholder;
    return control.tagName.toLowerCase();
  };
  const readFormValues = () => Array.from(document.querySelectorAll("input, textarea, select"))
    .slice(0, 120)
    .flatMap((control) => {
      if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) return [];
      if (control instanceof HTMLInputElement && ["button", "checkbox", "file", "hidden", "image", "password", "radio", "reset", "submit"].includes(control.type)) return [];
      const value = control instanceof HTMLSelectElement
        ? Array.from(control.selectedOptions).map((option) => option.textContent || option.value).join(", ")
        : control.value;
      const normalized = value.trim();
      if (!normalized) return [];
      return [\`\${readControlLabel(control) || "field"}: \${normalized.slice(0, 400)}\`];
    });
  const bodyText = document.body ? document.body.innerText : "";
  const formValues = readFormValues();
  const text = formValues.length > 0
    ? \`\${bodyText}\\n\\nForm values:\\n\${formValues.join("\\n")}\`
    : bodyText;
  const readScrollPosition = () => {
    let scrollX = Number(window.scrollX || document.documentElement.scrollLeft || 0);
    let scrollY = Number(window.scrollY || document.documentElement.scrollTop || 0);
    if (scrollX > 0 || scrollY > 0) return { scrollX, scrollY };
    const candidates = Array.from(document.querySelectorAll('main, [role="main"], [class*="scroll"], [class*="overflow"], div')).slice(0, 500);
    let bestArea = 0;
    for (const element of candidates) {
      if (!(element instanceof HTMLElement)) continue;
      if (element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth) continue;
      const style = window.getComputedStyle(element);
      if (!/(auto|scroll|hidden)/.test(style.overflowY + style.overflowX)) continue;
      const area = element.clientWidth * element.clientHeight;
      if (area < bestArea) continue;
      bestArea = area;
      scrollX = Number(element.scrollLeft || 0);
      scrollY = Number(element.scrollTop || 0);
    }
    return { scrollX, scrollY };
  };
  const scrollPosition = readScrollPosition();
  return {
    currentUrl: location.href,
    title: document.title || "",
    text,
    viewport: {
      width: Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 0)),
      height: Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 0)),
      screenshotWidth: Math.max(1, Math.round((window.innerWidth || document.documentElement.clientWidth || 0) * (window.devicePixelRatio || 1))),
      screenshotHeight: Math.max(1, Math.round((window.innerHeight || document.documentElement.clientHeight || 0) * (window.devicePixelRatio || 1))),
      deviceScaleFactor: Number(window.devicePixelRatio || 1),
      scrollX: scrollPosition.scrollX,
      scrollY: scrollPosition.scrollY
    }
  };
})()`;

const AUTH_BLOCKER_PHRASES = [
  "continue with google",
  "continue with github",
  "sign in to continue",
  "log in to continue",
  "login to continue",
  "please sign in",
  "please log in",
  "authentication required",
] as const;
const TERMS_BLOCKER_PHRASES = [
  "accept terms",
  "review and accept",
  "i agree to the terms",
  "non-commercial terms",
  "accept the terms",
] as const;
const QUOTA_BLOCKER_PHRASES = [
  "api key required",
  "license key required",
  "quota exceeded",
  "usage limit exceeded",
  "subscription required",
  "upgrade required",
] as const;

const sleep = (durationMs: number) => new Promise((resolve) => window.setTimeout(resolve, durationMs));

function boundedDelay(durationMs: number | null | undefined, fallbackMs: number): number {
  if (!Number.isFinite(durationMs ?? Number.NaN)) return fallbackMs;
  return Math.max(0, Math.min(10_000, Math.round(durationMs ?? fallbackMs)));
}

function normalizeCoordinate(value: number | null | undefined, name: string): number {
  if (!Number.isFinite(value ?? Number.NaN)) {
    throw new Error(`Browser ${name} coordinate is required for this action.`);
  }
  return Math.max(0, Math.round(value ?? 0));
}

function normalizeModifiers(action: CanvasBrowserAction): string[] {
  const raw = action.modifiers ?? [];
  return raw
    .map((modifier) => modifier.trim().toLowerCase())
    .map((modifier) => {
      if (modifier === "cmd" || modifier === "command") return "meta";
      if (modifier === "ctrl") return "control";
      if (modifier === "option") return "alt";
      return modifier;
    })
    .filter((modifier) => ["shift", "control", "alt", "meta"].includes(modifier));
}

function parseKeyChord(action: CanvasBrowserAction): { keyCode: string; modifiers: string[] } {
  const key = action.key?.trim() || "Enter";
  const parts = key.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return { keyCode: key, modifiers: normalizeModifiers(action) };
  }
  const keyCode = parts.at(-1) ?? key;
  const chordModifiers = parts.slice(0, -1);
  return {
    keyCode,
    modifiers: normalizeModifiers({ ...action, modifiers: [...normalizeModifiers(action), ...chordModifiers] }),
  };
}

function readOrigin(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

function normalizeHttpUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function isChromiumErrorUrl(rawUrl: string | null | undefined): boolean {
  return Boolean(rawUrl?.startsWith("chrome-error://"));
}

function readServiceName(rawUrl: string | null | undefined, fallbackTitle?: string | null): string | null {
  try {
    const host = rawUrl ? new URL(rawUrl).hostname.replace(/^www\./i, "") : "";
    if (host) return host;
  } catch {
    // Fall through to title.
  }
  const title = fallbackTitle?.trim();
  return title || null;
}

function matchingPhrases(text: string, phrases: readonly string[]): string[] {
  return phrases.filter((phrase) => text.includes(phrase));
}

function detectSnapshotBlocker(input: {
  currentUrl: string;
  requestedUrl: string | null | undefined;
  title: string;
  text: string;
  message?: string | null;
}): CanvasBrowserBlocker | null {
  const lowerText = input.text.toLowerCase();
  const service = readServiceName(input.currentUrl, input.title);
  if (isChromiumErrorUrl(input.currentUrl)) {
    return {
      kind: "navigation_error",
      service,
      url: input.currentUrl,
      originalUrl: input.requestedUrl ?? null,
      requestedAction: "inspect_service",
      evidence: ["Chromium reached an internal error page."],
      technicalDetails: input.message ?? "The embedded Chromium webview reported an internal navigation error page.",
      userMessage: input.requestedUrl
        ? `Navigation to ${input.requestedUrl} failed in the browser panel.`
        : "Navigation failed in the browser panel.",
    };
  }
  const authEvidence = matchingPhrases(lowerText, AUTH_BLOCKER_PHRASES);
  if (authEvidence.length > 0) {
    return {
      kind: "auth_required",
      service,
      url: input.currentUrl,
      originalUrl: input.requestedUrl ?? null,
      requestedAction: "sign_in",
      evidence: authEvidence,
      technicalDetails: null,
      userMessage: `${service ?? "This site"} requires sign-in. Please sign in in the browser panel, then continue.`,
    };
  }
  const termsEvidence = matchingPhrases(lowerText, TERMS_BLOCKER_PHRASES);
  if (termsEvidence.length > 0) {
    return {
      kind: "terms_required",
      service,
      url: input.currentUrl,
      originalUrl: input.requestedUrl ?? null,
      requestedAction: "accept_terms",
      evidence: termsEvidence,
      technicalDetails: null,
      userMessage: `${service ?? "This site"} needs terms or consent reviewed. Please use the browser panel to continue if you agree.`,
    };
  }
  const quotaEvidence = matchingPhrases(lowerText, QUOTA_BLOCKER_PHRASES);
  if (quotaEvidence.length > 0) {
    return {
      kind: "quota_or_key_required",
      service,
      url: input.currentUrl,
      originalUrl: input.requestedUrl ?? null,
      requestedAction: quotaEvidence.some((entry) => entry.includes("key")) ? "provide_api_key" : "upgrade_or_wait",
      evidence: quotaEvidence,
      technicalDetails: null,
      userMessage: `${service ?? "This site"} requires a key, quota, billing, or license step before the agent can continue.`,
    };
  }
  return null;
}

function scaleCoordinate(
  value: number | null | undefined,
  sourceSize: number | undefined,
  targetSize: number | undefined,
): number | null {
  if (!Number.isFinite(value ?? Number.NaN)) return null;
  const source = sourceSize && sourceSize > 0 ? sourceSize : targetSize && targetSize > 0 ? targetSize : 1;
  const target = targetSize && targetSize > 0 ? targetSize : source;
  return Math.max(0, Math.round((value ?? 0) * target / source));
}

function scaleDelta(
  value: number | null | undefined,
  sourceSize: number | undefined,
  targetSize: number | undefined,
): number | null {
  if (!Number.isFinite(value ?? Number.NaN)) return null;
  const source = sourceSize && sourceSize > 0 ? sourceSize : targetSize && targetSize > 0 ? targetSize : 1;
  const target = targetSize && targetSize > 0 ? targetSize : source;
  return Math.round((value ?? 0) * target / source);
}

function normalizeActionForNativeInput(
  action: CanvasBrowserAction,
  viewport: CanvasBrowserState["viewport"],
  webview: WebviewElement,
): CanvasBrowserAction {
  const rect = webview.getBoundingClientRect();
  const cssWidth = viewport?.width && viewport.width > 0 ? viewport.width : rect.width;
  const cssHeight = viewport?.height && viewport.height > 0 ? viewport.height : rect.height;
  const screenshotWidth = viewport?.screenshotWidth && viewport.screenshotWidth > 0 ? viewport.screenshotWidth : cssWidth;
  const screenshotHeight = viewport?.screenshotHeight && viewport.screenshotHeight > 0 ? viewport.screenshotHeight : cssHeight;
  return {
    ...action,
    x: scaleCoordinate(action.x, screenshotWidth, cssWidth),
    y: scaleCoordinate(action.y, screenshotHeight, cssHeight),
    endX: scaleCoordinate(action.endX, screenshotWidth, cssWidth),
    endY: scaleCoordinate(action.endY, screenshotHeight, cssHeight),
    deltaX: scaleDelta(action.deltaX, screenshotWidth, cssWidth),
    deltaY: scaleDelta(action.deltaY, screenshotHeight, cssHeight),
  };
}

function sendInput(webview: WebviewElement, event: Record<string, unknown>) {
  if (!webview.sendInputEvent) {
    throw new Error("This browser surface does not support native input events.");
  }
  webview.sendInputEvent(event);
}

function sendKey(webview: WebviewElement, keyCode: string, modifiers: string[]) {
  sendInput(webview, { type: "keyDown", keyCode, modifiers });
  sendInput(webview, { type: "keyUp", keyCode, modifiers });
}

async function typeText(webview: WebviewElement, text: string) {
  if (webview.insertText) {
    await webview.insertText(text);
    return;
  }
  for (const character of text) {
    if (character === "\n") {
      sendKey(webview, "Enter", []);
    } else {
      sendInput(webview, { type: "char", keyCode: character });
    }
    await sleep(4);
  }
}

async function performNativeAction(webview: WebviewElement, action: CanvasBrowserAction): Promise<string> {
  webview.focus?.();
  if (action.kind === "wait") {
    await sleep(boundedDelay(action.durationMs, 750));
    return "Waited for the browser.";
  }
  if (action.kind === "type") {
    await typeText(webview, action.text ?? "");
    return "Typed into the browser.";
  }
  if (action.kind === "press") {
    const { keyCode, modifiers } = parseKeyChord(action);
    sendKey(webview, keyCode, modifiers);
    return `Pressed ${action.key ?? keyCode} in the browser.`;
  }
  if (action.kind === "click" || action.kind === "doubleClick") {
    const x = normalizeCoordinate(action.x, "x");
    const y = normalizeCoordinate(action.y, "y");
    const button = action.button ?? "left";
    const modifiers = normalizeModifiers(action);
    const clickCount = action.kind === "doubleClick" ? 2 : 1;
    sendInput(webview, { type: "mouseMove", x, y, modifiers });
    for (let count = 1; count <= clickCount; count += 1) {
      sendInput(webview, { type: "mouseDown", x, y, button, clickCount: count, modifiers });
      sendInput(webview, { type: "mouseUp", x, y, button, clickCount: count, modifiers });
      if (count < clickCount) await sleep(40);
    }
    return `${action.kind === "doubleClick" ? "Double clicked" : "Clicked"} at ${x}, ${y}.`;
  }
  if (action.kind === "drag") {
    const startX = normalizeCoordinate(action.x, "x");
    const startY = normalizeCoordinate(action.y, "y");
    const endX = normalizeCoordinate(action.endX, "endX");
    const endY = normalizeCoordinate(action.endY, "endY");
    const button = action.button ?? "left";
    const modifiers = normalizeModifiers(action);
    const durationMs = boundedDelay(action.durationMs, 450);
    const steps = Math.max(6, Math.min(32, Math.round(durationMs / 24)));
    sendInput(webview, { type: "mouseMove", x: startX, y: startY, modifiers });
    sendInput(webview, { type: "mouseDown", x: startX, y: startY, button, clickCount: 1, modifiers });
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      const x = Math.round(startX + (endX - startX) * progress);
      const y = Math.round(startY + (endY - startY) * progress);
      sendInput(webview, { type: "mouseMove", x, y, button, modifiers });
      await sleep(Math.max(1, Math.round(durationMs / steps)));
    }
    sendInput(webview, { type: "mouseUp", x: endX, y: endY, button, clickCount: 1, modifiers });
    return `Dragged from ${startX}, ${startY} to ${endX}, ${endY}.`;
  }
  if (action.kind === "scroll") {
    const rect = webview.getBoundingClientRect();
    const x = Number.isFinite(action.x ?? Number.NaN)
      ? Math.round(action.x ?? 0)
      : Math.max(1, Math.round(rect.width / 2));
    const y = Number.isFinite(action.y ?? Number.NaN)
      ? Math.round(action.y ?? 0)
      : Math.max(1, Math.round(rect.height / 2));
    const pages = Number.isFinite(action.pages ?? Number.NaN) ? Math.max(0.1, action.pages ?? 1) : 1;
    const deltaX =
      action.deltaX ??
      (action.direction === "left" ? -rect.width * pages : action.direction === "right" ? rect.width * pages : 0);
    const deltaY =
      action.deltaY ??
      (action.direction === "up" ? -rect.height * pages : action.direction === "down" ? rect.height * pages : 0);
    sendInput(webview, {
      type: "mouseWheel",
      x,
      y,
      deltaX: Math.round(deltaX),
      deltaY: Math.round(deltaY || rect.height * pages),
      modifiers: normalizeModifiers(action),
    });
    return "Scrolled the browser.";
  }
  throw new Error("Unsupported browser action.");
}

export function CanvasBrowserSurface({ state, threadId }: CanvasBrowserSurfaceProps) {
  const webviewRef = useRef<WebviewElement | null>(null);
  const lastSnapshotKeyRef = useRef<string | null>(null);
  const handledActionRef = useRef<{ actionId: string; attemptedAt: number } | null>(null);
  const webviewReadyRef = useRef(false);
  const [loadMessage, setLoadMessage] = useState<string | null>(null);
  const [webviewReady, setWebviewReady] = useState(false);
  const targetUrl =
    state.status === "requested" && state.requestedUrl
      ? state.requestedUrl
      : state.currentUrl ?? state.requestedUrl;
  const webviewPartition = useMemo(() => `persist:agentscience-canvas-${threadId}`, [threadId]);
  const loadInsideCanvas = useCallback(
    (rawUrl: string | null | undefined): boolean => {
      const url = normalizeHttpUrl(rawUrl);
      const webview = webviewRef.current;
      if (!url || !webview) return false;
      lastSnapshotKeyRef.current = null;
      webviewReadyRef.current = false;
      setWebviewReady(false);
      setLoadMessage("Loading page...");
      if (webview.loadURL) {
        webview.loadURL(url);
      } else {
        webview.setAttribute("src", url);
      }
      void recordCanvasBrowserSnapshot(threadId, {
        currentUrl: url,
        title: "Loading page...",
        status: "loading",
        message: "Loading page...",
      }).catch(() => undefined);
      return true;
    },
    [threadId],
  );

  const captureSnapshot = useCallback(async () => {
    const webview = webviewRef.current;
    if (!webview?.executeJavaScript) return;
    try {
      const snapshot = await webview.executeJavaScript<{
        currentUrl?: unknown;
        title?: unknown;
        text?: unknown;
        viewport?: unknown;
      }>(SNAPSHOT_SCRIPT);
      const currentUrl =
        typeof snapshot.currentUrl === "string"
          ? snapshot.currentUrl
          : typeof webview.getURL === "function"
            ? webview.getURL()
            : targetUrl;
      if (!currentUrl) return;
      if (state.status === "requested") {
        const currentOrigin = readOrigin(currentUrl);
        const requestedOrigin = readOrigin(targetUrl);
        if (!isChromiumErrorUrl(currentUrl) && currentOrigin && requestedOrigin && currentOrigin !== requestedOrigin) {
          return;
        }
        if (state.currentUrl && state.currentUrl !== targetUrl && currentUrl === state.currentUrl) {
          return;
        }
      }
      const title =
        typeof snapshot.title === "string"
          ? snapshot.title
          : typeof webview.getTitle === "function"
            ? webview.getTitle()
          : "";
      const text = typeof snapshot.text === "string" ? snapshot.text : "";
      webviewReadyRef.current = true;
      setWebviewReady(true);
      const viewport =
        snapshot.viewport &&
        typeof snapshot.viewport === "object" &&
        "width" in snapshot.viewport &&
        "height" in snapshot.viewport
          ? (snapshot.viewport as CanvasBrowserState["viewport"])
          : null;
      const capturedImage = await webview.capturePage?.().catch(() => undefined);
      const screenshotDataUrl = capturedImage?.toDataURL?.();
      const screenshotSize = capturedImage?.getSize?.();
      const viewportWithScreenshotSize =
        viewport && screenshotSize && screenshotSize.width > 0 && screenshotSize.height > 0
          ? {
              ...viewport,
              screenshotWidth: screenshotSize.width,
              screenshotHeight: screenshotSize.height,
            }
          : viewport;
      const screenshotSignature = screenshotDataUrl
        ? `${screenshotDataUrl.length}:${screenshotDataUrl.slice(0, 128)}:${screenshotDataUrl.slice(-128)}`
        : "none";
      const snapshotKey = `${currentUrl}:${title}:${text.length}:${viewportWithScreenshotSize?.scrollX ?? 0}:${viewportWithScreenshotSize?.scrollY ?? 0}:${screenshotSignature}`;
      if (lastSnapshotKeyRef.current === snapshotKey) return;
      lastSnapshotKeyRef.current = snapshotKey;
      const detectedBlocker = detectSnapshotBlocker({
        currentUrl,
        requestedUrl: state.requestedUrl ?? targetUrl,
        title,
        text,
      });
      await recordCanvasBrowserSnapshot(threadId, {
        currentUrl,
        title,
        text,
        ...(screenshotDataUrl ? { screenshotDataUrl } : {}),
        ...(viewportWithScreenshotSize ? { viewport: viewportWithScreenshotSize } : {}),
        status: detectedBlocker
          ? detectedBlocker.kind === "navigation_error"
            ? "error"
            : "blocked"
          : "ready",
        ...(detectedBlocker?.userMessage ? { message: detectedBlocker.userMessage } : {}),
        ...(detectedBlocker ? { detectedBlocker } : {}),
      });
    } catch (error) {
      if (state.screenshotUrl && state.currentUrl === targetUrl) {
        return;
      }
      const isStillLoading = state.status === "requested" || state.status === "loading";
      const lastTitleIsSnapshotError = state.title === "Browser snapshot unavailable";
      await recordCanvasBrowserSnapshot(threadId, {
        currentUrl: targetUrl ?? "https://example.com",
        title:
          state.title && !lastTitleIsSnapshotError
            ? state.title
            : isStillLoading
              ? "Loading page..."
              : "Browser snapshot unavailable",
        status: isStillLoading ? "loading" : "error",
        message: isStillLoading
          ? "Waiting for the page to become readable."
          : error instanceof Error
            ? error.message
            : "Could not read page content.",
      }).catch(() => undefined);
    }
  }, [state.currentUrl, state.requestedUrl, state.screenshotUrl, state.status, state.title, targetUrl, threadId]);

  useEffect(() => {
    webviewReadyRef.current = false;
    setWebviewReady(false);
  }, [targetUrl]);

  useEffect(() => {
    if (!targetUrl) return;
    const interval = window.setInterval(() => {
      void captureSnapshot();
    }, 1_500);
    void captureSnapshot();
    return () => window.clearInterval(interval);
  }, [captureSnapshot, targetUrl]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const onStart = () => {
      webviewReadyRef.current = false;
      setWebviewReady(false);
      setLoadMessage("Loading page...");
    };
    const onStop = () => {
      setLoadMessage(null);
      webviewReadyRef.current = true;
      setWebviewReady(true);
      void captureSnapshot();
    };
    const onDomReady = () => {
      webviewReadyRef.current = true;
      setWebviewReady(true);
      setLoadMessage(null);
      void captureSnapshot();
    };
    const onFail = (event: Event) => {
      const detail = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        validatedURL?: string;
      };
      webviewReadyRef.current = false;
      setWebviewReady(false);
      const failedUrl = detail.validatedURL || webview.getURL?.() || targetUrl || "chrome-error://chromewebdata/";
      const message = detail.errorDescription ?? "Page load failed.";
      setLoadMessage(message);
      void recordCanvasBrowserSnapshot(threadId, {
        currentUrl: isChromiumErrorUrl(failedUrl) ? failedUrl : webview.getURL?.() || failedUrl,
        title: "Browser navigation failed",
        status: "error",
        message,
        detectedBlocker: {
          kind: "navigation_error",
          service: readServiceName(failedUrl, null),
          url: failedUrl,
          originalUrl: state.requestedUrl ?? targetUrl ?? failedUrl,
          requestedAction: "inspect_service",
          evidence: [
            detail.errorDescription ? `Chromium: ${detail.errorDescription}` : "Chromium reported a load failure.",
            Number.isFinite(detail.errorCode ?? Number.NaN) ? `errorCode ${detail.errorCode}` : "",
          ].filter((entry): entry is string => entry.length > 0),
          technicalDetails: Number.isFinite(detail.errorCode ?? Number.NaN)
            ? `Chromium did-fail-load errorCode=${detail.errorCode}.`
            : null,
          userMessage: `Navigation to ${state.requestedUrl ?? targetUrl ?? failedUrl} failed in the browser panel.`,
        },
      }).catch(() => undefined);
    };
    const onNewWindow = (event: Event) => {
      const detail = event as Event & { url?: string; newURL?: string };
      const candidate = detail.url ?? detail.newURL;
      if (!normalizeHttpUrl(candidate)) return;
      event.preventDefault();
      loadInsideCanvas(candidate);
    };
    const onNavigation = () => {
      window.setTimeout(() => {
        void captureSnapshot();
      }, 250);
    };

    webview.addEventListener("did-start-loading", onStart);
    webview.addEventListener("did-stop-loading", onStop);
    webview.addEventListener("did-finish-load", onDomReady);
    webview.addEventListener("did-frame-finish-load", onDomReady);
    webview.addEventListener("did-fail-load", onFail);
    webview.addEventListener("dom-ready", onDomReady);
    webview.addEventListener("new-window", onNewWindow);
    webview.addEventListener("did-navigate", onNavigation);
    webview.addEventListener("did-navigate-in-page", onNavigation);
    webview.addEventListener("page-title-updated", onNavigation);
    return () => {
      webview.removeEventListener("did-start-loading", onStart);
      webview.removeEventListener("did-stop-loading", onStop);
      webview.removeEventListener("did-finish-load", onDomReady);
      webview.removeEventListener("did-frame-finish-load", onDomReady);
      webview.removeEventListener("did-fail-load", onFail);
      webview.removeEventListener("dom-ready", onDomReady);
      webview.removeEventListener("new-window", onNewWindow);
      webview.removeEventListener("did-navigate", onNavigation);
      webview.removeEventListener("did-navigate-in-page", onNavigation);
      webview.removeEventListener("page-title-updated", onNavigation);
    };
  }, [captureSnapshot, loadInsideCanvas, state.requestedUrl, targetUrl, threadId]);

  useEffect(() => {
    const action = state.pendingAction;
    if (!action) return;
    const handledAction = handledActionRef.current;
    if (handledAction?.actionId === action.id && Date.now() - handledAction.attemptedAt < 10_000) return;
    const webview = webviewRef.current;
    if (!webviewReadyRef.current || !webview) return;
    handledActionRef.current = { actionId: action.id, attemptedAt: Date.now() };
    let actionPromise: Promise<string>;
    try {
      const nativeAction = normalizeActionForNativeInput(action, state.viewport, webview);
      actionPromise = performNativeAction(webview, nativeAction);
    } catch (error) {
      void recordCanvasBrowserActionResult(threadId, action.id, {
        status: "error",
        message: error instanceof Error ? error.message : "Browser action failed.",
      });
      return;
    }
    void actionPromise
      .then((result) =>
        recordCanvasBrowserActionResult(threadId, action.id, {
          status: "success",
          message: result,
        }),
      )
      .then(() => sleep(200))
      .then(() => captureSnapshot())
      .catch((error) => {
        void recordCanvasBrowserActionResult(threadId, action.id, {
          status: "error",
          message: error instanceof Error ? error.message : "Browser action failed.",
        });
      });
  }, [captureSnapshot, state.pendingAction, state.status, state.viewport, threadId, webviewReady]);

  const reload = () => {
    webviewRef.current?.reload?.();
  };

  const openExternal = () => {
    const url = webviewRef.current?.getURL?.() ?? targetUrl;
    if (!url) return;
    void readNativeApi()?.shell.openExternal(url);
  };

  const blocker = state.detectedBlocker;

  if (!targetUrl) {
    return <div className="paper-review-canvas__resting"><p>No browser page requested yet.</p></div>;
  }

  return (
    <div className="canvas-browser-surface">
      <div className="canvas-browser-surface__bar">
        <div className="canvas-browser-surface__location" title={state.currentUrl ?? targetUrl}>
          <span>{state.title || state.currentUrl || targetUrl}</span>
        </div>
        <button type="button" onClick={reload} aria-label="Reload browser page" title="Reload">
          <RefreshCcwIcon aria-hidden />
        </button>
        <button type="button" onClick={openExternal} aria-label="Open page in browser" title="Open external">
          <ExternalLinkIcon aria-hidden />
        </button>
      </div>
      {loadMessage ? <div className="canvas-browser-surface__status">{loadMessage}</div> : null}
      {blocker ? (
        <div className="canvas-browser-surface__blocker" role="status">
          <AlertCircleIcon aria-hidden />
          <span>{blocker.userMessage}</span>
        </div>
      ) : null}
      <webview
        key={`${targetUrl}:${state.navigationSequence}`}
        ref={(element) => {
          webviewRef.current = element as WebviewElement | null;
        }}
        className="canvas-browser-surface__webview"
        src={targetUrl}
        partition={webviewPartition}
        allowpopups={true}
        webpreferences="nativeWindowOpen=no"
      />
    </div>
  );
}
