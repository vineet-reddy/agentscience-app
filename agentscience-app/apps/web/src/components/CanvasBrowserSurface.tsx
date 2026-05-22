import {
  type CanvasBrowserAction,
  type CanvasBrowserState,
  type ThreadId,
} from "@agentscience/contracts";
import { ExternalLinkIcon, RefreshCcwIcon } from "lucide-react";
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

function createVisualActionScript(
  action: CanvasBrowserAction,
  viewport: CanvasBrowserState["viewport"],
): string {
  return `(async () => {
  const action = ${JSON.stringify(action)};
  const viewport = ${JSON.stringify(viewport)};
  const sleep = (durationMs) => new Promise((resolve) => window.setTimeout(resolve, durationMs));
  const screenshotWidth = Math.max(1, Number(viewport?.screenshotWidth || window.innerWidth || 1));
  const screenshotHeight = Math.max(1, Number(viewport?.screenshotHeight || window.innerHeight || 1));
  const toCssPoint = (rawX, rawY) => ({
    x: Math.max(0, Math.min(window.innerWidth - 1, Math.round(Number(rawX) * window.innerWidth / screenshotWidth))),
    y: Math.max(0, Math.min(window.innerHeight - 1, Math.round(Number(rawY) * window.innerHeight / screenshotHeight)))
  });
  const requirePoint = (x, y, label) => {
    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) {
      throw new Error(\`Browser \${label} coordinates are required for this action.\`);
    }
    return toCssPoint(x, y);
  };
  const modifiers = Array.isArray(action.modifiers) ? action.modifiers.map((entry) => String(entry).toLowerCase()) : [];
  const modifierInit = {
    shiftKey: modifiers.includes("shift"),
    ctrlKey: modifiers.includes("control") || modifiers.includes("ctrl"),
    altKey: modifiers.includes("alt") || modifiers.includes("option"),
    metaKey: modifiers.includes("meta") || modifiers.includes("cmd") || modifiers.includes("command")
  };
  const buttonNumber = action.button === "right" ? 2 : action.button === "middle" ? 1 : 0;
  const buttonsNumber = action.button === "right" ? 2 : action.button === "middle" ? 4 : 1;
  const targetAt = (point) => document.elementFromPoint(point.x, point.y) || document.body || document.documentElement;
  const eventInit = (point, detail = 1) => ({
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: point.x,
    clientY: point.y,
    screenX: point.x,
    screenY: point.y,
    button: buttonNumber,
    buttons: buttonsNumber,
    detail,
    ...modifierInit
  });
  const dispatchPointer = (target, type, point, detail = 1) => {
    if (window.PointerEvent) {
      target.dispatchEvent(new PointerEvent(type, {
        ...eventInit(point, detail),
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true
      }));
    }
  };
  const dispatchMouse = (target, type, point, detail = 1) => {
    target.dispatchEvent(new MouseEvent(type, eventInit(point, detail)));
  };
  const focusTarget = (target) => {
    if (target instanceof HTMLElement || target instanceof SVGElement) {
      target.focus?.({ preventScroll: true });
    }
  };
  const clickAt = async (point, detail) => {
    const target = targetAt(point);
    const activationTarget =
      target instanceof Element
        ? target.closest('a[href], button, input, textarea, select, label, summary, [role="button"], [role="link"]') || target
        : target;
    const anchorTarget =
      activationTarget instanceof HTMLAnchorElement
        ? activationTarget
        : activationTarget instanceof Element
          ? activationTarget.closest("a[href]")
          : null;
    const anchorHref =
      anchorTarget instanceof HTMLAnchorElement && !anchorTarget.hasAttribute("download")
        ? anchorTarget.href
        : null;
    dispatchPointer(target, "pointerover", point, detail);
    dispatchMouse(target, "mouseover", point, detail);
    dispatchPointer(target, "pointermove", point, detail);
    dispatchMouse(target, "mousemove", point, detail);
    dispatchPointer(target, "pointerdown", point, detail);
    dispatchMouse(target, "mousedown", point, detail);
    focusTarget(activationTarget);
    dispatchPointer(target, "pointerup", point, detail);
    dispatchMouse(target, "mouseup", point, detail);
    dispatchMouse(target, "click", point, detail);
    if (activationTarget instanceof HTMLElement && typeof activationTarget.click === "function") {
      activationTarget.click();
    }
    if (
      activationTarget instanceof HTMLButtonElement &&
      (activationTarget.type === "submit" || activationTarget.getAttribute("type") === null) &&
      activationTarget.form
    ) {
      activationTarget.form.requestSubmit(activationTarget);
    }
    if (
      activationTarget instanceof HTMLInputElement &&
      activationTarget.type === "submit" &&
      activationTarget.form
    ) {
      activationTarget.form.requestSubmit(activationTarget);
    }
    if (
      anchorHref &&
      anchorTarget instanceof HTMLAnchorElement &&
      anchorTarget.target &&
      anchorTarget.target !== "_self" &&
      !modifierInit.metaKey &&
      !modifierInit.ctrlKey
    ) {
      await sleep(80);
      window.location.assign(anchorHref);
    }
    return activationTarget;
  };
  const editableTarget = () => {
    const active = document.activeElement;
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active?.isContentEditable
    ) {
      return active;
    }
    throw new Error("No editable browser element is focused.");
  };
  const typeIntoTarget = (text) => {
    const target = editableTarget();
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      target.setRangeText(text, start, end, "end");
      target.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    document.execCommand("insertText", false, text);
  };
  const dispatchKey = (key) => {
    const target = document.activeElement || document.body || document.documentElement;
    const init = { key, code: key, bubbles: true, cancelable: true, composed: true, ...modifierInit };
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    if (key === "Enter" && target instanceof HTMLElement) {
      const form = target.closest("form");
      if (form instanceof HTMLFormElement) {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
      }
    }
    target.dispatchEvent(new KeyboardEvent("keyup", init));
  };
  const scrollAt = (point) => {
    const pages = Number(action.pages || 0.85);
    const rawDeltaX = Number.isFinite(Number(action.deltaX))
      ? Number(action.deltaX)
      : action.direction === "left"
        ? -screenshotWidth * pages
        : action.direction === "right"
          ? screenshotWidth * pages
          : 0;
    const rawDeltaY = Number.isFinite(Number(action.deltaY))
      ? Number(action.deltaY)
      : action.direction === "up"
        ? -screenshotHeight * pages
        : action.direction === "down"
          ? screenshotHeight * pages
          : screenshotHeight * pages;
    const deltaX = Math.round(rawDeltaX * window.innerWidth / screenshotWidth);
    const deltaY = Math.round(rawDeltaY * window.innerHeight / screenshotHeight);
    const start = targetAt(point);
    start.dispatchEvent(new WheelEvent("wheel", { ...eventInit(point), deltaX, deltaY }));
    let scroller = start;
    while (scroller && scroller !== document.body && scroller !== document.documentElement) {
      const style = window.getComputedStyle(scroller);
      if (/(auto|scroll|hidden)/.test(style.overflowY + style.overflowX)) break;
      scroller = scroller.parentElement;
    }
    const scrollTargets = [
      scroller,
      document.scrollingElement,
      document.documentElement,
      document.body,
      ...Array.from(document.querySelectorAll("*")).filter((element) => {
        const style = window.getComputedStyle(element);
        return (
          /(auto|scroll|hidden)/.test(style.overflowY + style.overflowX) &&
          (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)
        );
      }),
    ].filter(Boolean);
    const seen = new Set();
    let moved = false;
    for (const target of scrollTargets) {
      if (seen.has(target)) continue;
      seen.add(target);
      const beforeTop = target.scrollTop || 0;
      const beforeLeft = target.scrollLeft || 0;
      if (typeof target.scrollBy === "function") {
        target.scrollBy({ left: deltaX, top: deltaY, behavior: "instant" });
      } else {
        target.scrollTop = beforeTop + deltaY;
        target.scrollLeft = beforeLeft + deltaX;
      }
      moved = moved || beforeTop !== (target.scrollTop || 0) || beforeLeft !== (target.scrollLeft || 0);
      if (moved) break;
    }
    if (!moved) window.scrollBy({ left: deltaX, top: deltaY, behavior: "instant" });
  };
  if (action.kind === "wait") {
    await sleep(Math.max(0, Math.min(10000, Number(action.durationMs || 750))));
    return { message: "Waited for the browser." };
  }
  if (action.kind === "click" || action.kind === "doubleClick") {
    const point = requirePoint(action.x, action.y, "click");
    const clickedTarget = await clickAt(point, 1);
    if (action.kind === "doubleClick") {
      await sleep(45);
      await clickAt(point, 2);
      dispatchMouse(targetAt(point), "dblclick", point, 2);
    }
    const targetName = clickedTarget instanceof Element
      ? clickedTarget.id
        ? \`\${clickedTarget.tagName.toLowerCase()}#\${clickedTarget.id}\`
        : clickedTarget.tagName.toLowerCase()
      : "page";
    return { message: \`\${action.kind === "doubleClick" ? "Double clicked" : "Clicked"} \${targetName} at \${Math.round(Number(action.x))}, \${Math.round(Number(action.y))}.\` };
  }
  if (action.kind === "drag") {
    const start = requirePoint(action.x, action.y, "drag start");
    const end = requirePoint(action.endX, action.endY, "drag end");
    const target = targetAt(start);
    const durationMs = Math.max(0, Math.min(10000, Number(action.durationMs || 450)));
    const steps = Math.max(6, Math.min(32, Math.round(durationMs / 24)));
    dispatchPointer(target, "pointerdown", start);
    dispatchMouse(target, "mousedown", start);
    focusTarget(target);
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      const point = {
        x: Math.round(start.x + (end.x - start.x) * progress),
        y: Math.round(start.y + (end.y - start.y) * progress)
      };
      dispatchPointer(target, "pointermove", point);
      dispatchMouse(target, "mousemove", point);
      await sleep(Math.max(1, Math.round(durationMs / steps)));
    }
    dispatchPointer(target, "pointerup", end);
    dispatchMouse(target, "mouseup", end);
    return { message: "Dragged in the browser." };
  }
  if (action.kind === "type") {
    typeIntoTarget(String(action.text || ""));
    const target = document.activeElement;
    const targetName = target instanceof Element
      ? target.id
        ? \`\${target.tagName.toLowerCase()}#\${target.id}\`
        : target.tagName.toLowerCase()
      : "page";
    const valueLength =
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        ? target.value.length
        : String(action.text || "").length;
    return { message: \`Typed into \${targetName}; value length \${valueLength}.\` };
  }
  if (action.kind === "press") {
    dispatchKey(String(action.key || "Enter"));
    return { message: \`Pressed \${action.key || "Enter"} in the browser.\` };
  }
  if (action.kind === "scroll") {
    const point =
      Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y))
        ? requirePoint(action.x, action.y, "scroll")
        : { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
    scrollAt(point);
    return { message: "Scrolled the browser." };
  }
  throw new Error("Unsupported browser action.");
})()`;
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
        if (currentOrigin && requestedOrigin && currentOrigin !== requestedOrigin) {
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
      await recordCanvasBrowserSnapshot(threadId, {
        currentUrl,
        title,
        text,
        ...(screenshotDataUrl ? { screenshotDataUrl } : {}),
        ...(viewportWithScreenshotSize ? { viewport: viewportWithScreenshotSize } : {}),
        status: "ready",
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
  }, [state.screenshotUrl, state.status, state.title, targetUrl, threadId]);

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
      if (webviewReadyRef.current) {
        void captureSnapshot();
      }
    };
    const onDomReady = () => {
      webviewReadyRef.current = true;
      setWebviewReady(true);
      setLoadMessage(null);
      void captureSnapshot();
    };
    const onFail = (event: Event) => {
      const detail = event as Event & { errorDescription?: string };
      webviewReadyRef.current = false;
      setWebviewReady(false);
      setLoadMessage(detail.errorDescription ?? "Page load failed.");
    };

    webview.addEventListener("did-start-loading", onStart);
    webview.addEventListener("did-stop-loading", onStop);
    webview.addEventListener("did-fail-load", onFail);
    webview.addEventListener("dom-ready", onDomReady);
    return () => {
      webview.removeEventListener("did-start-loading", onStart);
      webview.removeEventListener("did-stop-loading", onStop);
      webview.removeEventListener("did-fail-load", onFail);
      webview.removeEventListener("dom-ready", onDomReady);
    };
  }, [captureSnapshot]);

  useEffect(() => {
    const action = state.pendingAction;
    if (!action) return;
    const handledAction = handledActionRef.current;
    if (handledAction?.actionId === action.id && Date.now() - handledAction.attemptedAt < 10_000) return;
    const webview = webviewRef.current;
    if ((!webviewReady && state.status !== "ready") || !webview?.executeJavaScript) return;
    handledActionRef.current = { actionId: action.id, attemptedAt: Date.now() };
    let actionPromise: Promise<string | { message?: unknown }>;
    try {
      actionPromise = webview.executeJavaScript
        ? webview.executeJavaScript<{ message?: unknown }>(createVisualActionScript(action, state.viewport))
        : performNativeAction(webview, action);
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
          message:
            typeof result === "string"
              ? result
              : typeof result?.message === "string"
                ? result.message
                : "Browser action completed.",
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
  }, [captureSnapshot, state.pendingAction, state.viewport, threadId, webviewReady]);

  const reload = () => {
    webviewRef.current?.reload?.();
  };

  const openExternal = () => {
    const url = webviewRef.current?.getURL?.() ?? targetUrl;
    if (!url) return;
    void readNativeApi()?.shell.openExternal(url);
  };

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
      <webview
        key={`${targetUrl}:${state.navigationSequence}`}
        ref={(element) => {
          webviewRef.current = element as WebviewElement | null;
        }}
        className="canvas-browser-surface__webview"
        src={targetUrl}
        partition={webviewPartition}
        allowpopups={true}
      />
    </div>
  );
}
