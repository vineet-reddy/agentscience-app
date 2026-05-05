import {
  type PaperReviewSnapshot,
  paperReviewCompileRoutePath,
  paperReviewSnapshotRoutePath,
  type ThreadId,
} from "@agentscience/contracts";
import { resolveServerUrl } from "./utils";

export function paperReviewReadyPdfKey(
  snapshot: PaperReviewSnapshot | null | undefined,
): string | null {
  if (
    snapshot?.preview.kind !== "pdf" ||
    !snapshot.preview.url ||
    !snapshot.preview.relativePath ||
    !snapshot.preview.updatedAt ||
    snapshot.compile.status !== "ready" ||
    snapshot.compile.needsBuild
  ) {
    return null;
  }

  return `${snapshot.preview.relativePath}:${snapshot.preview.updatedAt}:${snapshot.preview.url}`;
}

export function paperReviewPreviewKey(
  snapshot: PaperReviewSnapshot | null | undefined,
): string | null {
  if (
    !snapshot?.reviewRecommended ||
    snapshot.preview.kind === "empty" ||
    !snapshot.preview.relativePath ||
    !snapshot.preview.updatedAt ||
    !snapshot.preview.url
  ) {
    return null;
  }

  return [
    snapshot.preview.kind,
    snapshot.preview.relativePath,
    snapshot.preview.updatedAt,
    snapshot.preview.url,
  ].join(":");
}

function resolvePaperReviewRequestUrl(url: string): string {
  return new URL(
    url,
    resolveServerUrl({
      protocol: "http",
      pathname: "/",
    }),
  ).toString();
}

function normalizeSnapshotUrls(snapshot: PaperReviewSnapshot): PaperReviewSnapshot {
  return {
    ...snapshot,
    ...(snapshot.source
      ? { source: { ...snapshot.source, url: resolvePaperReviewRequestUrl(snapshot.source.url) } }
      : {}),
    ...(snapshot.pdf
      ? { pdf: { ...snapshot.pdf, url: resolvePaperReviewRequestUrl(snapshot.pdf.url) } }
      : {}),
    ...(snapshot.figure
      ? { figure: { ...snapshot.figure, url: resolvePaperReviewRequestUrl(snapshot.figure.url) } }
      : {}),
    ...(snapshot.bibliography
      ? {
          bibliography: {
            ...snapshot.bibliography,
            url: resolvePaperReviewRequestUrl(snapshot.bibliography.url),
          },
        }
      : {}),
    ...(snapshot.notes
      ? { notes: { ...snapshot.notes, url: resolvePaperReviewRequestUrl(snapshot.notes.url) } }
      : {}),
    preview: snapshot.preview.url
      ? {
          ...snapshot.preview,
          url: resolvePaperReviewRequestUrl(snapshot.preview.url),
        }
      : snapshot.preview,
  };
}

async function parsePaperReviewResponse(response: Response): Promise<PaperReviewSnapshot> {
  if (!response.ok) {
    throw new Error(`Paper review request failed with status ${response.status}.`);
  }
  return normalizeSnapshotUrls((await response.json()) as PaperReviewSnapshot);
}

export async function fetchPaperReviewSnapshot(threadId: ThreadId): Promise<PaperReviewSnapshot> {
  const response = await fetch(
    resolvePaperReviewRequestUrl(paperReviewSnapshotRoutePath(threadId)),
    {
      credentials: "same-origin",
    },
  );
  return parsePaperReviewResponse(response);
}

export async function compilePaperReview(threadId: ThreadId): Promise<PaperReviewSnapshot> {
  const response = await fetch(
    resolvePaperReviewRequestUrl(paperReviewCompileRoutePath(threadId)),
    {
      method: "POST",
      credentials: "same-origin",
    },
  );
  return parsePaperReviewResponse(response);
}

export async function fetchPaperReviewText(url: string): Promise<string> {
  const response = await fetch(resolvePaperReviewRequestUrl(url), {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(`Paper source request failed with status ${response.status}.`);
  }
  return response.text();
}

export async function fetchPaperReviewBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(resolvePaperReviewRequestUrl(url), {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(`Paper file request failed with status ${response.status}.`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
