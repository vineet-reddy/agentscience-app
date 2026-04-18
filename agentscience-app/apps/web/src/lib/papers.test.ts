import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchLocalPaper,
  fetchLocalPapers,
  resolveLocalPaperFileUrl,
} from "./papers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubDesktopServer() {
  vi.stubGlobal("window", {
    desktopBridge: {
      getWsUrl: () => "ws://127.0.0.1:55566/?token=desktop-token",
    },
    location: { origin: "http://localhost:5734" },
  });
}

describe("resolveLocalPaperFileUrl", () => {
  it("routes file requests through the local embedded server", () => {
    stubDesktopServer();
    const url = resolveLocalPaperFileUrl("paperid-abc", "paper.pdf");
    expect(url).toBe("http://127.0.0.1:55566/api/papers/paperid-abc/files/paper.pdf");
  });

  it("percent-encodes nested paths", () => {
    stubDesktopServer();
    const url = resolveLocalPaperFileUrl("paperid-abc", "figures/fig 1.png");
    expect(url).toBe("http://127.0.0.1:55566/api/papers/paperid-abc/files/figures/fig%201.png");
  });
});

describe("fetchLocalPapers", () => {
  it("hits /api/papers and absolutizes artifact URLs", async () => {
    stubDesktopServer();
    const responseBody = {
      papers: [
        {
          id: "paperid-abc",
          title: "A paper",
          folderName: "a-paper",
          containerKind: "paper",
          updatedAt: "2026-04-17T00:00:00.000Z",
          pdf: {
            relativePath: "paper.pdf",
            url: "/api/papers/paperid-abc/files/paper.pdf",
            sizeBytes: 1024,
            updatedAt: "2026-04-17T00:00:00.000Z",
            contentType: "application/pdf",
          },
          source: null,
          publishManifestPresent: false,
          threadId: null,
          threadTitle: null,
          threadArchivedAt: null,
          projectId: null,
          projectName: null,
        },
      ],
    };

    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(responseBody),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const papers = await fetchLocalPapers();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:55566/api/papers",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(papers).toHaveLength(1);
    expect(papers[0]!.pdf?.url).toBe(
      "http://127.0.0.1:55566/api/papers/paperid-abc/files/paper.pdf",
    );
  });

  it("throws on non-OK responses so callers can surface errors", async () => {
    stubDesktopServer();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })),
    );

    await expect(fetchLocalPapers()).rejects.toThrow(/500/);
  });
});

describe("fetchLocalPaper", () => {
  it("returns null when no paper with the given id exists", async () => {
    stubDesktopServer();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ papers: [] }),
        }),
      ),
    );

    expect(await fetchLocalPaper("nope")).toBeNull();
  });
});
