import {
  type LocalPaperSummary,
  type LocalPapersListResponse,
  LOCAL_PAPERS_ROUTE_PREFIX,
  localPaperFileRoutePath,
  localPapersListRoutePath,
} from "@agentscience/contracts";

import { resolveServerUrl } from "./utils";

/**
 * Client-side helpers for the local-papers HTTP API. The list is sourced
 * from a filesystem scan of the managed workspace root (so papers appear
 * whether or not the agent ever emitted a `paper.presented` activity), and
 * paper artifacts are served from the same embedded server. No remote
 * network calls.
 */

export type LocalPaper = LocalPaperSummary;

function absolutize(relativePath: string): string {
  return new URL(
    relativePath,
    resolveServerUrl({ protocol: "http", pathname: "/" }),
  ).toString();
}

/**
 * Absolute URL for a file inside a paper folder (PDF, source, etc.) as
 * served by the local embedded server.
 */
export function resolveLocalPaperFileUrl(paperId: string, relativePath: string): string {
  return absolutize(localPaperFileRoutePath(paperId, relativePath));
}

function withAbsoluteUrls(paper: LocalPaperSummary): LocalPaperSummary {
  return {
    ...paper,
    pdf: paper.pdf ? { ...paper.pdf, url: absolutize(paper.pdf.url) } : null,
    source: paper.source ? { ...paper.source, url: absolutize(paper.source.url) } : null,
  };
}

/**
 * Fetch the list of local papers. Throws on non-OK responses so the UI's
 * React Query wrapper can surface the error; callers are free to fall back
 * to an empty list on their own.
 */
export async function fetchLocalPapers(signal?: AbortSignal): Promise<LocalPaper[]> {
  const init: RequestInit = { credentials: "same-origin" };
  if (signal) init.signal = signal;
  const response = await fetch(absolutize(localPapersListRoutePath()), init);
  if (!response.ok) {
    throw new Error(`Failed to load papers (${response.status})`);
  }
  const body = (await response.json()) as LocalPapersListResponse;
  return body.papers.map(withAbsoluteUrls);
}

/**
 * Fetch a single paper summary by ID (convenience wrapper around the list
 * endpoint so the detail route doesn't need its own HTTP handler). Returns
 * `null` if no paper with that ID is currently on disk.
 */
export async function fetchLocalPaper(
  paperId: string,
  signal?: AbortSignal,
): Promise<LocalPaper | null> {
  const papers = await fetchLocalPapers(signal);
  return papers.find((paper) => paper.id === paperId) ?? null;
}

/** Query key helpers used with `@tanstack/react-query`. */
export const localPapersQueryKey = ["local-papers"] as const;
export const localPaperQueryKey = (paperId: string) => ["local-papers", paperId] as const;

// Re-export for convenience.
export { LOCAL_PAPERS_ROUTE_PREFIX };
