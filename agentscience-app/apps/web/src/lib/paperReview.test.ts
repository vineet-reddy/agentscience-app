import { ThreadId } from "@agentscience/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchPaperReviewBytes, fetchPaperReviewSnapshot } from "./paperReview";

const threadId = ThreadId.makeUnsafe("thread-paper-review");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("paperReview", () => {
  it("targets the desktop backend origin and normalizes artifact URLs", async () => {
    vi.stubGlobal("window", {
      desktopBridge: {
        getWsUrl: () => "ws://127.0.0.1:55566/?token=desktop-token",
      },
      location: {
        origin: "http://localhost:5734",
      },
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          threadId,
          threadTitle: "Paper thread",
          workspaceRoot: "/tmp/paper",
          source: {
            kind: "latex",
            label: "Manuscript",
            relativePath: "paper.tex",
            url: `/api/paper-review/${threadId}/files/paper.tex`,
            sizeBytes: 12,
            updatedAt: "2026-04-16T08:00:00.000Z",
            contentType: "application/x-tex",
          },
          pdf: null,
          bibliography: null,
          notes: null,
          preview: {
            kind: "latex",
            relativePath: "paper.tex",
            url: `/api/paper-review/${threadId}/files/paper.tex`,
            updatedAt: "2026-04-16T08:00:00.000Z",
          },
          compile: {
            status: "idle",
            compiler: "none",
            compilerLabel: null,
            canCompile: false,
            needsBuild: false,
            lastBuiltAt: null,
            lastError: null,
            outputExcerpt: null,
          },
          reviewRecommended: true,
        }),
        { status: 200 },
      ),
    );

    const snapshot = await fetchPaperReviewSnapshot(threadId);

    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:55566/api/paper-review/${threadId}`,
      expect.objectContaining({
        credentials: "same-origin",
      }),
    );
    expect(snapshot.source?.url).toBe(
      `http://127.0.0.1:55566/api/paper-review/${threadId}/files/paper.tex`,
    );
    expect(snapshot.preview.url).toBe(
      `http://127.0.0.1:55566/api/paper-review/${threadId}/files/paper.tex`,
    );
  });

  it("fetches manuscript bytes from the desktop backend origin", async () => {
    vi.stubGlobal("window", {
      desktopBridge: {
        getWsUrl: () => "ws://127.0.0.1:55566/?token=desktop-token",
      },
      location: {
        origin: "http://localhost:5734",
      },
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }),
    );

    const bytes = await fetchPaperReviewBytes(`/api/paper-review/${threadId}/files/paper.pdf`);

    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:55566/api/paper-review/${threadId}/files/paper.pdf`,
      expect.objectContaining({
        credentials: "same-origin",
      }),
    );
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });
});
