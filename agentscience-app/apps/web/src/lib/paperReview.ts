import {
  type PaperReviewSnapshot,
  paperReviewCompileRoutePath,
  paperReviewSnapshotRoutePath,
  type ThreadId,
} from "@agentscience/contracts";

async function parsePaperReviewResponse(response: Response): Promise<PaperReviewSnapshot> {
  if (!response.ok) {
    throw new Error(`Paper review request failed with status ${response.status}.`);
  }
  return (await response.json()) as PaperReviewSnapshot;
}

export async function fetchPaperReviewSnapshot(threadId: ThreadId): Promise<PaperReviewSnapshot> {
  const response = await fetch(paperReviewSnapshotRoutePath(threadId), {
    credentials: "same-origin",
  });
  return parsePaperReviewResponse(response);
}

export async function compilePaperReview(threadId: ThreadId): Promise<PaperReviewSnapshot> {
  const response = await fetch(paperReviewCompileRoutePath(threadId), {
    method: "POST",
    credentials: "same-origin",
  });
  return parsePaperReviewResponse(response);
}

export async function fetchPaperReviewText(url: string): Promise<string> {
  const response = await fetch(url, {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(`Paper source request failed with status ${response.status}.`);
  }
  return response.text();
}
