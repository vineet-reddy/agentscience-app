import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchLocalPaper,
  fetchLocalPapers,
  publishLocalPaper,
  resolveLocalPaperFileUrl,
  smartPublishLocalPaper,
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

describe("smartPublishLocalPaper", () => {
  it("returns plain progress steps and absolutizes the published paper", async () => {
    stubDesktopServer();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              status: "published",
              paper: {
                id: "paperid-abc",
                title: "A paper",
                folderName: "a-paper",
                containerKind: "paper",
                updatedAt: "2026-04-17T00:00:00.000Z",
                pdf: {
                  relativePath: "paper.pdf",
                  url: "/api/papers/paperid-abc/files/paper.pdf",
                  sizeBytes: 123,
                  updatedAt: "2026-04-17T00:00:00.000Z",
                  contentType: "application/pdf",
                },
                source: null,
                abstract: null,
                publishManifestPresent: false,
                publication: null,
                threadId: null,
                threadTitle: null,
                threadArchivedAt: null,
                projectId: null,
                projectName: null,
              },
              steps: [
                {
                  command: "publish --bundle lean",
                  status: "success",
                  detail: "Published after cutting the bundle down to fit the storage policy.",
                },
              ],
            }),
        }),
      ),
    );

    const result = await smartPublishLocalPaper("paperid-abc");

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:55566/api/papers/paperid-abc/smart-publish",
      expect.objectContaining({
        credentials: "same-origin",
        method: "POST",
      }),
    );
    expect(result.steps[0]?.detail).toContain("cutting the bundle");
    expect(result.status).toBe("published");
    expect(result.paper?.pdf?.url).toBe(
      "http://127.0.0.1:55566/api/papers/paperid-abc/files/paper.pdf",
    );
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
          publication: null,
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

describe("publishLocalPaper", () => {
  it("hits the publish endpoint and absolutizes the returned publication URL", async () => {
    stubDesktopServer();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              paper: {
                id: "paperid-abc",
                title: "A paper",
                folderName: "a-paper",
                containerKind: "paper",
                updatedAt: "2026-04-17T00:00:00.000Z",
                pdf: null,
                source: null,
                abstract: null,
                publishManifestPresent: false,
                publication: {
                  remotePaperId: "remote-paper-1",
                  slug: "a-paper",
                  url: "https://agentscience.example/papers/a-paper",
                  publishedAt: "2026-04-18T00:00:00.000Z",
                },
                threadId: null,
                threadTitle: null,
                threadArchivedAt: null,
                projectId: null,
                projectName: null,
              },
            }),
        }),
      ),
    );

    const paper = await publishLocalPaper("paperid-abc");

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:55566/api/papers/paperid-abc/publish",
      expect.objectContaining({
        credentials: "same-origin",
        method: "POST",
      }),
    );
    expect(paper.publication?.url).toBe("https://agentscience.example/papers/a-paper");
  });

  it("maps provider quota failures to storage policy guidance", async () => {
    stubDesktopServer();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          json: () =>
            Promise.resolve({
              error: "Vercel Blob: Storage quota exceeded for Hobby plan (1GB maximum)",
            }),
        }),
      ),
    );

    await expect(publishLocalPaper("paperid-abc")).rejects.toThrow(
      "AgentScience storage is temporarily full. Large raw datasets are not uploaded with papers; link or register datasets separately, then try publishing again after older staged uploads are cleaned up.",
    );
  });
});
