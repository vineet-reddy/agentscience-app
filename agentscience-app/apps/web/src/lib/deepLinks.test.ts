import { describe, expect, it, vi } from "vitest";

import { handlePaperOpenDeepLink } from "./deepLinks";
import type { LocalPaper } from "./papers";

function localPaper(overrides: Partial<LocalPaper>): LocalPaper {
  return {
    id: "paperid-abc",
    title: "A paper",
    folderName: "a-paper",
    containerKind: "paper",
    updatedAt: "2026-04-17T00:00:00.000Z",
    pdf: null,
    source: null,
    abstract: null,
    publishManifestPresent: false,
    publication: null,
    threadId: null,
    threadTitle: null,
    threadArchivedAt: null,
    projectId: null,
    projectName: null,
    ...overrides,
  };
}

describe("handlePaperOpenDeepLink", () => {
  it("resolves the published paper and navigates to it", async () => {
    const paper = localPaper({
      id: "paperid-published",
      publication: {
        remotePaperId: "remote-paper-1",
        slug: "published-paper",
        url: "https://agentscience.app/papers/published-paper",
        publishedAt: "2026-04-18T00:00:00.000Z",
      },
    });
    const cachePaper = vi.fn();
    const resolvePublishedPaper = vi.fn().mockResolvedValue(paper);
    const navigateToPaper = vi.fn().mockResolvedValue(undefined);
    const notifyMissing = vi.fn();
    const notifyFailed = vi.fn();

    await expect(
      handlePaperOpenDeepLink(
        { type: "paper-open", slug: "published-paper" },
        {
          resolvePublishedPaper,
          cachePaper,
          navigateToPaper,
          notifyMissing,
          notifyFailed,
        },
      ),
    ).resolves.toBe("opened");

    expect(resolvePublishedPaper).toHaveBeenCalledWith("published-paper", undefined);
    expect(cachePaper).toHaveBeenCalledWith(paper);
    expect(navigateToPaper).toHaveBeenCalledWith("paperid-published");
    expect(notifyMissing).not.toHaveBeenCalled();
    expect(notifyFailed).not.toHaveBeenCalled();
  });

  it("passes the web origin through to the local resolver", async () => {
    const paper = localPaper({ id: "paperid-published" });
    const resolvePublishedPaper = vi.fn().mockResolvedValue(paper);

    await expect(
      handlePaperOpenDeepLink(
        {
          type: "paper-open",
          slug: "published-paper",
          baseUrl: "http://localhost:3000",
        },
        {
          resolvePublishedPaper,
          cachePaper: vi.fn(),
          navigateToPaper: vi.fn().mockResolvedValue(undefined),
          notifyMissing: vi.fn(),
          notifyFailed: vi.fn(),
        },
      ),
    ).resolves.toBe("opened");

    expect(resolvePublishedPaper).toHaveBeenCalledWith(
      "published-paper",
      "http://localhost:3000",
    );
  });

  it("notifies when no local paper has the published slug", async () => {
    const notifyMissing = vi.fn();
    const notifyFailed = vi.fn();

    await expect(
      handlePaperOpenDeepLink(
        { type: "paper-open", slug: "missing-paper" },
        {
          resolvePublishedPaper: async () => null,
          cachePaper: vi.fn(),
          navigateToPaper: vi.fn(),
          notifyMissing,
          notifyFailed,
        },
      ),
    ).resolves.toBe("missing");

    expect(notifyMissing).toHaveBeenCalledWith("missing-paper");
    expect(notifyFailed).not.toHaveBeenCalled();
  });

  it("notifies when the local paper list cannot be loaded", async () => {
    const error = new Error("offline");
    const notifyFailed = vi.fn();

    await expect(
      handlePaperOpenDeepLink(
        { type: "paper-open", slug: "published-paper" },
        {
          resolvePublishedPaper: async () => {
            throw error;
          },
          cachePaper: vi.fn(),
          navigateToPaper: vi.fn(),
          notifyMissing: vi.fn(),
          notifyFailed,
        },
      ),
    ).resolves.toBe("failed");

    expect(notifyFailed).toHaveBeenCalledWith(error);
  });
});
