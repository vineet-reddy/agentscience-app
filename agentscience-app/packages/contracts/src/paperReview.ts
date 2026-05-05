import { Schema } from "effect";

import { IsoDateTime, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

export const PAPER_REVIEW_ROUTE_PREFIX = "/api/paper-review";

function encodeRelativePath(relativePath: string): string {
  return relativePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function paperReviewSnapshotRoutePath(threadId: string): string {
  return `${PAPER_REVIEW_ROUTE_PREFIX}/${encodeURIComponent(threadId)}`;
}

export function paperReviewCompileRoutePath(threadId: string): string {
  return `${paperReviewSnapshotRoutePath(threadId)}/compile`;
}

export function paperReviewFileRoutePath(threadId: string, relativePath: string): string {
  return `${paperReviewSnapshotRoutePath(threadId)}/files/${encodeRelativePath(relativePath)}`;
}

export const PaperReviewArtifactKind = Schema.Literals([
  "latex",
  "markdown",
  "pdf",
  "figure",
  "bibliography",
  "notes",
]);
export type PaperReviewArtifactKind = typeof PaperReviewArtifactKind.Type;

export const PaperReviewArtifact = Schema.Struct({
  kind: PaperReviewArtifactKind,
  label: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sizeBytes: NonNegativeInt,
  updatedAt: IsoDateTime,
  contentType: TrimmedNonEmptyString,
});
export type PaperReviewArtifact = typeof PaperReviewArtifact.Type;

export const PaperReviewPreviewKind = Schema.Literals([
  "empty",
  "latex",
  "markdown",
  "pdf",
  "image",
]);
export type PaperReviewPreviewKind = typeof PaperReviewPreviewKind.Type;

export const PaperReviewPreview = Schema.Struct({
  kind: PaperReviewPreviewKind,
  relativePath: Schema.NullOr(TrimmedNonEmptyString),
  url: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: Schema.NullOr(IsoDateTime),
});
export type PaperReviewPreview = typeof PaperReviewPreview.Type;

export const PaperReviewCompilerKind = Schema.Literals([
  "managed-tectonic",
  "managed-latexmk",
  "managed-pdflatex",
  "system-latexmk",
  "system-pdflatex",
  "none",
]);
export type PaperReviewCompilerKind = typeof PaperReviewCompilerKind.Type;

export const PaperReviewCompileStatus = Schema.Literals([
  "idle",
  "compiling",
  "ready",
  "error",
  "unavailable",
]);
export type PaperReviewCompileStatus = typeof PaperReviewCompileStatus.Type;

export const PaperReviewCompileState = Schema.Struct({
  status: PaperReviewCompileStatus,
  compiler: PaperReviewCompilerKind,
  compilerLabel: Schema.NullOr(TrimmedNonEmptyString),
  canCompile: Schema.Boolean,
  needsBuild: Schema.Boolean,
  lastBuiltAt: Schema.NullOr(IsoDateTime),
  lastError: Schema.NullOr(Schema.String),
  outputExcerpt: Schema.NullOr(Schema.String),
});
export type PaperReviewCompileState = typeof PaperReviewCompileState.Type;

export const PaperReviewSnapshot = Schema.Struct({
  threadId: ThreadId,
  threadTitle: TrimmedNonEmptyString,
  workspaceRoot: Schema.NullOr(Schema.String),
  source: Schema.NullOr(PaperReviewArtifact),
  pdf: Schema.NullOr(PaperReviewArtifact),
  figure: Schema.NullOr(PaperReviewArtifact),
  bibliography: Schema.NullOr(PaperReviewArtifact),
  notes: Schema.NullOr(PaperReviewArtifact),
  preview: PaperReviewPreview,
  compile: PaperReviewCompileState,
  reviewRecommended: Schema.Boolean,
});
export type PaperReviewSnapshot = typeof PaperReviewSnapshot.Type;
