import { Schema } from "effect";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";

/**
 * Routes for the local-papers API. Listing and file access are backed by a
 * filesystem scan of the managed workspace root on this machine. Publishing
 * uses the same local paper identity but forwards the bundle to AgentScience.
 */
export const LOCAL_PAPERS_ROUTE_PREFIX = "/api/papers";

function encodeRelativePath(relativePath: string): string {
  return relativePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function localPapersListRoutePath(): string {
  return LOCAL_PAPERS_ROUTE_PREFIX;
}

export function localPaperFileRoutePath(paperId: string, relativePath: string): string {
  return `${LOCAL_PAPERS_ROUTE_PREFIX}/${encodeURIComponent(paperId)}/files/${encodeRelativePath(relativePath)}`;
}

export function localPaperPublishRoutePath(paperId: string): string {
  return `${LOCAL_PAPERS_ROUTE_PREFIX}/${encodeURIComponent(paperId)}/publish`;
}

/**
 * A single on-disk artifact inside a paper folder (PDF, source LaTeX, etc.).
 */
export const LocalPaperFile = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sizeBytes: NonNegativeInt,
  updatedAt: IsoDateTime,
  contentType: TrimmedNonEmptyString,
});
export type LocalPaperFile = typeof LocalPaperFile.Type;

/**
 * Where on disk the paper folder lives under the managed workspace root.
 * `paper`: `{root}/Papers/{slug}/`
 * `project-paper`: `{root}/Projects/{slug}/papers/{slug}/`
 */
export const LocalPaperContainerKind = Schema.Literals(["paper", "project-paper"]);
export type LocalPaperContainerKind = typeof LocalPaperContainerKind.Type;

export const LocalPaperPublication = Schema.Struct({
  remotePaperId: TrimmedNonEmptyString,
  slug: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  publishedAt: IsoDateTime,
});
export type LocalPaperPublication = typeof LocalPaperPublication.Type;

/**
 * A single paper discovered by scanning the managed workspace root. Papers
 * are identified by their folder, not by the thread that produced them, so
 * orphaned papers (where the thread was deleted or the agent never emitted
 * a `paper.presented` activity) still show up.
 */
export const LocalPaperSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  folderName: TrimmedNonEmptyString,
  containerKind: LocalPaperContainerKind,
  updatedAt: IsoDateTime,
  pdf: Schema.NullOr(LocalPaperFile),
  source: Schema.NullOr(LocalPaperFile),
  /**
   * Abstract text extracted from the paper source when available. Used by
   * the list UI to jog memory ("oh yeah, that paper") without forcing a
   * click into the detail view. May be longer than a list row can show;
   * the UI truncates and offers an inline expand.
   */
  abstract: Schema.NullOr(TrimmedNonEmptyString),
  publishManifestPresent: Schema.Boolean,
  publication: Schema.NullOr(LocalPaperPublication),
  /** Thread that owns this folder, if one can be matched by workspace path. */
  threadId: Schema.NullOr(ThreadId),
  threadTitle: Schema.NullOr(TrimmedNonEmptyString),
  threadArchivedAt: Schema.NullOr(IsoDateTime),
  /** Project the paper belongs to, if it lives in a project-scoped folder. */
  projectId: Schema.NullOr(ProjectId),
  projectName: Schema.NullOr(TrimmedNonEmptyString),
});
export type LocalPaperSummary = typeof LocalPaperSummary.Type;

export const LocalPapersListResponse = Schema.Struct({
  papers: Schema.Array(LocalPaperSummary),
});
export type LocalPapersListResponse = typeof LocalPapersListResponse.Type;

export const LocalPaperPublishResponse = Schema.Struct({
  paper: LocalPaperSummary,
});
export type LocalPaperPublishResponse = typeof LocalPaperPublishResponse.Type;
