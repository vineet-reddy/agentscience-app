import { describe, expect, it, vi } from "vitest";

import { findLocalPaperForPublishedSlug, handlePaperOpenDeepLink } from "./deepLinks";
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

describe("findLocalPaperForPublishedSlug", () => {
  it("matches the published AgentScience slug, not the local folder name", () => {
    const paper = localPaper({
      id: "paperid-published",
      folderName: "local-draft-folder",
      publication: {
        remotePaperId: "remote-paper-1",
        slug: "published-paper",
        url: "https://agentscience.app/papers/published-paper",
        publishedAt: "2026-04-18T00:00:00.000Z",
      },
    });

    expect(findLocalPaperForPublishedSlug([paper], "published-paper")?.id).toBe(
      "paperid-published",
    );
    expect(findLocalPaperForPublishedSlug([paper], "local-draft-folder")).toBeNull();
  });

  it("ignores local-only papers", () => {
    expect(findLocalPaperForPublishedSlug([localPaper({ folderName: "test-paper" })], "test-paper"))
      .toBeNull();
  });
});

describe("handlePaperOpenDeepLink", () => {
  it("loads local papers and navigates to the matching published paper", async () => {
    const paper = localPaper({
      id: "paperid-published",
      publication: {
        remotePaperId: "remote-paper-1",
        slug: "published-paper",
        url: "https://agentscience.app/papers/published-paper",
        publishedAt: "2026-04-18T00:00:00.000Z",
      },
    });
    const cachePapers = vi.fn();
    const navigateToPaper = vi.fn().mockResolvedValue(undefined);
    const notifyMissing = vi.fn();
    const notifyFailed = vi.fn();

    await expect(
      handlePaperOpenDeepLink(
        { type: "paper-open", slug: "published-paper" },
        {
          loadPapers: async () => [paper],
          cachePapers,
          navigateToPaper,
          notifyMissing,
          notifyFailed,
        },
      ),
    ).resolves.toBe("opened");

    expect(cachePapers).toHaveBeenCalledWith([paper]);
    expect(navigateToPaper).toHaveBeenCalledWith("paperid-published");
    expect(notifyMissing).not.toHaveBeenCalled();
    expect(notifyFailed).not.toHaveBeenCalled();
  });

  it("notifies when no local paper has the published slug", async () => {
    const notifyMissing = vi.fn();
    const notifyFailed = vi.fn();

    await expect(
      handlePaperOpenDeepLink(
        { type: "paper-open", slug: "missing-paper" },
        {
          loadPapers: async () => [localPaper({ folderName: "missing-paper" })],
          cachePapers: vi.fn(),
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
          loadPapers: async () => {
            throw error;
          },
          cachePapers: vi.fn(),
          navigateToPaper: vi.fn(),
          notifyMissing: vi.fn(),
          notifyFailed,
        },
      ),
    ).resolves.toBe("failed");

    expect(notifyFailed).toHaveBeenCalledWith(error);
  });
});
