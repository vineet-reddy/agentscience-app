import {
  type CanvasBrowserAction,
  type CanvasBrowserActionInput,
  type CanvasBrowserActionResultInput,
  type CanvasBrowserNavigateInput,
  type CanvasBrowserSnapshotInput,
  type CanvasBrowserState,
  ThreadId,
  canvasBrowserScreenshotRoutePath,
} from "@agentscience/contracts";

const MAX_SNAPSHOT_TEXT_LENGTH = 80_000;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const states = new Map<ThreadId, CanvasBrowserState>();
const screenshots = new Map<
  ThreadId,
  {
    readonly bytes: Uint8Array;
    readonly contentType: "image/png" | "image/jpeg";
  }
>();
const actionWaiters = new Map<
  string,
  Set<(state: CanvasBrowserState) => void>
>();

function nowIso(): string {
  return new Date().toISOString();
}

function emptyState(threadId: ThreadId): CanvasBrowserState {
  return {
    threadId,
    requestedUrl: null,
    currentUrl: null,
    title: null,
    text: null,
    screenshotUrl: null,
    screenshotCapturedAt: null,
    viewport: null,
    status: "idle",
    message: null,
    pendingAction: null,
    lastActionResult: null,
    navigationSequence: 0,
    sequence: 0,
    updatedAt: null,
  };
}

function normalizeHttpUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function readOrigin(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

function truncateSnapshotText(text: string | undefined): string | null {
  if (!text) return null;
  const normalized = text.replace(/\s+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  if (normalized.length <= MAX_SNAPSHOT_TEXT_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_SNAPSHOT_TEXT_LENGTH)}\n\n[Snapshot truncated by AgentScience.]`;
}

function decodeScreenshotDataUrl(
  dataUrl: string | undefined,
): { bytes: Uint8Array; contentType: "image/png" | "image/jpeg" } | null {
  if (!dataUrl) return null;
  const match = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const contentType = match[1];
  const payload = match[2];
  if ((contentType !== "image/png" && contentType !== "image/jpeg") || !payload) {
    return null;
  }
  const bytes = Buffer.from(payload, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SCREENSHOT_BYTES) {
    return null;
  }
  return {
    bytes: new Uint8Array(bytes),
    contentType,
  };
}

function isSyntheticSnapshotErrorTitle(title: string | null): boolean {
  return title === "Browser snapshot unavailable";
}

export function getCanvasBrowserState(threadId: ThreadId): CanvasBrowserState {
  return states.get(threadId) ?? emptyState(threadId);
}

export function getCanvasBrowserScreenshot(
  threadId: ThreadId,
): { bytes: Uint8Array; contentType: "image/png" | "image/jpeg" } | null {
  return screenshots.get(threadId) ?? null;
}

export function requestCanvasBrowserNavigation(
  threadId: ThreadId,
  input: CanvasBrowserNavigateInput,
): CanvasBrowserState {
  const normalizedUrl = normalizeHttpUrl(input.url);
  const previous = getCanvasBrowserState(threadId);
  if (!normalizedUrl) {
    const next = {
      ...previous,
      status: "error" as const,
      message: "Canvas browser URLs must use http or https.",
      sequence: previous.sequence + 1,
      updatedAt: nowIso(),
    };
    states.set(threadId, next);
    return next;
  }

  if (previous.currentUrl !== normalizedUrl) {
    screenshots.delete(threadId);
  }

  const next = {
    ...previous,
    requestedUrl: normalizedUrl,
    currentUrl: previous.currentUrl,
    title:
      input.title ??
      (previous.currentUrl === normalizedUrl && !isSyntheticSnapshotErrorTitle(previous.title)
        ? previous.title
        : null),
    text: previous.currentUrl === normalizedUrl ? previous.text : null,
    screenshotUrl:
      previous.currentUrl === normalizedUrl ? previous.screenshotUrl : null,
    screenshotCapturedAt:
      previous.currentUrl === normalizedUrl ? previous.screenshotCapturedAt : null,
    viewport: previous.currentUrl === normalizedUrl ? previous.viewport : null,
    status: "requested" as const,
    message: null,
    navigationSequence: previous.navigationSequence + 1,
    sequence: previous.sequence + 1,
    updatedAt: nowIso(),
  };
  states.set(threadId, next);
  return next;
}

function makeActionId(nextSequence: number): string {
  return `canvas-action-${Date.now().toString(36)}-${nextSequence.toString(36)}`;
}

function actionWaiterKey(threadId: ThreadId, actionId: string): string {
  return `${threadId}:${actionId}`;
}

export function requestCanvasBrowserAction(
  threadId: ThreadId,
  input: CanvasBrowserActionInput,
): CanvasBrowserState {
  const previous = getCanvasBrowserState(threadId);
  const sequence = previous.sequence + 1;
  const action: CanvasBrowserAction = {
    id: makeActionId(sequence),
    kind: input.kind,
    selector: input.selector ?? null,
    x: input.x ?? null,
    y: input.y ?? null,
    endX: input.endX ?? null,
    endY: input.endY ?? null,
    deltaX: input.deltaX ?? null,
    deltaY: input.deltaY ?? null,
    button: input.button ?? null,
    modifiers: input.modifiers ?? null,
    text: input.text ?? null,
    key: input.key ?? null,
    direction: input.direction ?? null,
    pages: input.pages ?? null,
    durationMs: input.durationMs ?? null,
    createdAt: nowIso(),
  };
  const next = {
    ...previous,
    pendingAction: action,
    lastActionResult: null,
    sequence,
    updatedAt: nowIso(),
  };
  states.set(threadId, next);
  return next;
}

export function waitForCanvasBrowserActionResult(
  threadId: ThreadId,
  actionId: string,
  timeoutMs = 15_000,
): Promise<{ readonly completed: boolean; readonly state: CanvasBrowserState }> {
  const current = getCanvasBrowserState(threadId);
  if (current.lastActionResult?.actionId === actionId) {
    return Promise.resolve({ completed: true, state: current });
  }

  const boundedTimeoutMs = Math.max(250, Math.min(120_000, Math.round(timeoutMs)));
  return new Promise((resolve) => {
    const key = actionWaiterKey(threadId, actionId);
    const waiters = actionWaiters.get(key) ?? new Set<(state: CanvasBrowserState) => void>();
    let settled = false;
    const finish = (completed: boolean, state: CanvasBrowserState) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      waiters.delete(resolveWaiter);
      if (waiters.size === 0) {
        actionWaiters.delete(key);
      }
      resolve({ completed, state });
    };
    const resolveWaiter = (state: CanvasBrowserState) => finish(true, state);
    waiters.add(resolveWaiter);
    actionWaiters.set(key, waiters);
    const timer = setTimeout(
      () => finish(false, getCanvasBrowserState(threadId)),
      boundedTimeoutMs,
    );
  });
}

export function recordCanvasBrowserActionResult(
  threadId: ThreadId,
  actionId: string,
  input: CanvasBrowserActionResultInput,
): CanvasBrowserState {
  const previous = getCanvasBrowserState(threadId);
  const next = {
    ...previous,
    pendingAction: previous.pendingAction?.id === actionId ? null : previous.pendingAction,
    lastActionResult: {
      actionId,
      status: input.status,
      message: input.message ?? null,
      completedAt: nowIso(),
    },
    status: previous.status,
    message: input.status === "error" ? (input.message ?? "Browser action failed.") : previous.message,
    sequence: previous.sequence + 1,
    updatedAt: nowIso(),
  };
  states.set(threadId, next);
  const waiters = actionWaiters.get(actionWaiterKey(threadId, actionId));
  if (waiters) {
    for (const waiter of waiters) {
      waiter(next);
    }
    actionWaiters.delete(actionWaiterKey(threadId, actionId));
  }
  return next;
}

export function recordCanvasBrowserSnapshot(
  threadId: ThreadId,
  input: CanvasBrowserSnapshotInput,
): CanvasBrowserState {
  const previous = getCanvasBrowserState(threadId);
  if (previous.status === "requested" && previous.requestedUrl) {
    const requestedOrigin = readOrigin(previous.requestedUrl);
    const inputOrigin = readOrigin(input.currentUrl);
    if (requestedOrigin && inputOrigin && requestedOrigin !== inputOrigin) {
      return previous;
    }
    if (
      previous.currentUrl &&
      previous.currentUrl !== previous.requestedUrl &&
      input.currentUrl === previous.currentUrl
    ) {
      return previous;
    }
  }
  const screenshot = decodeScreenshotDataUrl(input.screenshotDataUrl);
  const loadingWithoutContent =
    input.status === "loading" &&
    !input.text &&
    !screenshot &&
    previous.status === "ready" &&
    previous.currentUrl === input.currentUrl;
  if (loadingWithoutContent) {
    const next = {
      ...previous,
      message: input.message ?? previous.message,
      sequence: previous.sequence + 1,
      updatedAt: nowIso(),
    };
    states.set(threadId, next);
    return next;
  }
  const capturedAt = screenshot ? nowIso() : previous.screenshotCapturedAt;
  if (screenshot) {
    screenshots.set(threadId, screenshot);
  }
  const next = {
    ...previous,
    currentUrl: input.currentUrl,
    requestedUrl: (input.status ?? "ready") === "ready" ? input.currentUrl : previous.requestedUrl ?? input.currentUrl,
    title: input.title ?? null,
    text: truncateSnapshotText(input.text),
    screenshotUrl: screenshot || previous.screenshotUrl
      ? canvasBrowserScreenshotRoutePath(threadId)
      : null,
    screenshotCapturedAt: capturedAt,
    viewport: input.viewport ?? previous.viewport,
    status: input.status ?? "ready",
    message: input.message ?? null,
    sequence: previous.sequence + 1,
    updatedAt: nowIso(),
  };
  states.set(threadId, next);
  return next;
}
