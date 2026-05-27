import { Schema } from "effect";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

export const CANVAS_BROWSER_ROUTE_PREFIX = "/api/canvas-browser";

export function canvasBrowserRoutePath(threadId: string): string {
  return `${CANVAS_BROWSER_ROUTE_PREFIX}/${encodeURIComponent(threadId)}`;
}

export function canvasBrowserScreenshotRoutePath(threadId: string): string {
  return `${canvasBrowserRoutePath(threadId)}/screenshot`;
}

export const CanvasBrowserStatus = Schema.Literals([
  "idle",
  "requested",
  "loading",
  "ready",
  "blocked",
  "error",
]);
export type CanvasBrowserStatus = typeof CanvasBrowserStatus.Type;

export const CanvasBrowserBlockerKind = Schema.Literals([
  "auth_required",
  "terms_required",
  "quota_or_key_required",
  "navigation_error",
  "service_unavailable",
]);
export type CanvasBrowserBlockerKind = typeof CanvasBrowserBlockerKind.Type;

export const CanvasBrowserBlockerAction = Schema.Literals([
  "sign_in",
  "accept_terms",
  "provide_api_key",
  "upgrade_or_wait",
  "inspect_service",
]);
export type CanvasBrowserBlockerAction = typeof CanvasBrowserBlockerAction.Type;

export const CanvasBrowserBlocker = Schema.Struct({
  kind: CanvasBrowserBlockerKind,
  service: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  originalUrl: Schema.NullOr(Schema.String),
  requestedAction: Schema.NullOr(CanvasBrowserBlockerAction),
  evidence: Schema.Array(Schema.String),
  technicalDetails: Schema.NullOr(Schema.String),
  userMessage: Schema.String,
});
export type CanvasBrowserBlocker = typeof CanvasBrowserBlocker.Type;

export const CanvasBrowserActionKind = Schema.Literals([
  "click",
  "doubleClick",
  "drag",
  "type",
  "press",
  "scroll",
  "wait",
]);
export type CanvasBrowserActionKind = typeof CanvasBrowserActionKind.Type;

export const CanvasBrowserActionStatus = Schema.Literals(["success", "error"]);
export type CanvasBrowserActionStatus = typeof CanvasBrowserActionStatus.Type;

export const CanvasBrowserScrollDirection = Schema.Literals(["up", "down", "left", "right"]);
export type CanvasBrowserScrollDirection = typeof CanvasBrowserScrollDirection.Type;

export const CanvasBrowserMouseButton = Schema.Literals(["left", "middle", "right"]);
export type CanvasBrowserMouseButton = typeof CanvasBrowserMouseButton.Type;

export const CanvasBrowserViewport = Schema.Struct({
  width: Schema.Number,
  height: Schema.Number,
  screenshotWidth: Schema.Number,
  screenshotHeight: Schema.Number,
  deviceScaleFactor: Schema.Number,
  scrollX: Schema.Number,
  scrollY: Schema.Number,
});
export type CanvasBrowserViewport = typeof CanvasBrowserViewport.Type;

export const CanvasBrowserAction = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: CanvasBrowserActionKind,
  x: Schema.NullOr(Schema.Number),
  y: Schema.NullOr(Schema.Number),
  endX: Schema.NullOr(Schema.Number),
  endY: Schema.NullOr(Schema.Number),
  deltaX: Schema.NullOr(Schema.Number),
  deltaY: Schema.NullOr(Schema.Number),
  button: Schema.NullOr(CanvasBrowserMouseButton),
  modifiers: Schema.NullOr(Schema.Array(Schema.String)),
  text: Schema.NullOr(Schema.String),
  key: Schema.NullOr(Schema.String),
  direction: Schema.NullOr(CanvasBrowserScrollDirection),
  pages: Schema.NullOr(Schema.Number),
  durationMs: Schema.NullOr(Schema.Number),
  createdAt: IsoDateTime,
});
export type CanvasBrowserAction = typeof CanvasBrowserAction.Type;

export const CanvasBrowserActionResult = Schema.Struct({
  actionId: TrimmedNonEmptyString,
  status: CanvasBrowserActionStatus,
  message: Schema.NullOr(Schema.String),
  completedAt: IsoDateTime,
});
export type CanvasBrowserActionResult = typeof CanvasBrowserActionResult.Type;

export const CanvasBrowserState = Schema.Struct({
  threadId: ThreadId,
  requestedUrl: Schema.NullOr(TrimmedNonEmptyString),
  currentUrl: Schema.NullOr(TrimmedNonEmptyString),
  title: Schema.NullOr(Schema.String),
  text: Schema.NullOr(Schema.String),
  screenshotUrl: Schema.NullOr(Schema.String),
  screenshotCapturedAt: Schema.NullOr(IsoDateTime),
  viewport: Schema.NullOr(CanvasBrowserViewport),
  status: CanvasBrowserStatus,
  message: Schema.NullOr(Schema.String),
  detectedBlocker: Schema.NullOr(CanvasBrowserBlocker),
  pendingAction: Schema.NullOr(CanvasBrowserAction),
  lastActionResult: Schema.NullOr(CanvasBrowserActionResult),
  navigationSequence: Schema.Number,
  sequence: Schema.Number,
  updatedAt: Schema.NullOr(IsoDateTime),
});
export type CanvasBrowserState = typeof CanvasBrowserState.Type;

export const CanvasBrowserNavigateInput = Schema.Struct({
  url: TrimmedNonEmptyString,
  title: Schema.optional(Schema.String),
});
export type CanvasBrowserNavigateInput = typeof CanvasBrowserNavigateInput.Type;

export const CanvasBrowserSnapshotInput = Schema.Struct({
  currentUrl: TrimmedNonEmptyString,
  title: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  screenshotDataUrl: Schema.optional(Schema.String),
  viewport: Schema.optional(CanvasBrowserViewport),
  status: Schema.optional(CanvasBrowserStatus),
  message: Schema.optional(Schema.String),
  detectedBlocker: Schema.optional(CanvasBrowserBlocker),
});
export type CanvasBrowserSnapshotInput = typeof CanvasBrowserSnapshotInput.Type;

export const CanvasBrowserActionInput = Schema.Struct({
  kind: CanvasBrowserActionKind,
  x: Schema.optional(Schema.Number),
  y: Schema.optional(Schema.Number),
  endX: Schema.optional(Schema.Number),
  endY: Schema.optional(Schema.Number),
  deltaX: Schema.optional(Schema.Number),
  deltaY: Schema.optional(Schema.Number),
  button: Schema.optional(CanvasBrowserMouseButton),
  modifiers: Schema.optional(Schema.Array(Schema.String)),
  text: Schema.optional(Schema.String),
  key: Schema.optional(Schema.String),
  direction: Schema.optional(CanvasBrowserScrollDirection),
  pages: Schema.optional(Schema.Number),
  durationMs: Schema.optional(Schema.Number),
});
export type CanvasBrowserActionInput = typeof CanvasBrowserActionInput.Type;

export const CanvasBrowserActionResultInput = Schema.Struct({
  status: CanvasBrowserActionStatus,
  message: Schema.optional(Schema.String),
});
export type CanvasBrowserActionResultInput = typeof CanvasBrowserActionResultInput.Type;
