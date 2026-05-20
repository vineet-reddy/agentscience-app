import { type QueryClient } from "@tanstack/react-query";
import { type ThreadId } from "@agentscience/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  localPaperQueryKey,
  localPapersQueryKey,
  smartPublishLocalPaper,
  type LocalPaper,
} from "./lib/papers";
import { useLocalPaperPublishStore } from "./localPaperPublishStore";
import { toastManager } from "./components/ui/toast";

vi.mock("./lib/papers", () => ({
  localPaperQueryKey: (paperId: string) => ["local-papers", paperId] as const,
  localPapersQueryKey: ["local-papers"] as const,
  smartPublishLocalPaper: vi.fn(),
}));

vi.mock("./components/ui/toast", () => ({
  toastManager: {
    add: vi.fn(),
  },
}));

function makePaper(overrides: Partial<LocalPaper> = {}): LocalPaper {
  return {
    id: "paper-1",
    title: "Bundle Repair Paper",
    folderName: "bundle-repair-paper",
    containerKind: "paper",
    updatedAt: "2026-05-20T00:00:00.000Z",
    pdf: {
      relativePath: "paper.pdf",
      url: "http://127.0.0.1:55566/api/papers/paper-1/files/paper.pdf",
      sizeBytes: 12_345,
      updatedAt: "2026-05-20T00:00:00.000Z",
      contentType: "application/pdf",
    },
    source: {
      relativePath: "paper.tex",
      url: "http://127.0.0.1:55566/api/papers/paper-1/files/paper.tex",
      sizeBytes: 1_234,
      updatedAt: "2026-05-20T00:00:00.000Z",
      contentType: "text/x-tex",
    },
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

function makeQueryClient(): QueryClient {
  return {
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(() => Promise.resolve()),
  } as unknown as QueryClient;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  useLocalPaperPublishStore.setState({ progressByPaperId: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("localPaperPublishStore", () => {
  it("keeps publish progress outside the paper preview component lifecycle", async () => {
    const paper = makePaper();
    const queryClient = makeQueryClient();
    const result = deferred<Awaited<ReturnType<typeof smartPublishLocalPaper>>>();
    vi.mocked(smartPublishLocalPaper).mockReturnValue(result.promise);

    const request = useLocalPaperPublishStore.getState().startPublish({ paper, queryClient });

    expect(useLocalPaperPublishStore.getState().progressByPaperId[paper.id]).toMatchObject({
      status: "running",
      headline: "Preparing the paper for publishing",
    });

    result.resolve({
      status: "published",
      paper: {
        ...paper,
        publication: {
          remotePaperId: "pub-1",
          url: "https://agentscience.com/papers/pub-1",
          slug: "bundle-repair-paper",
          publishedAt: "2026-05-20T00:00:00.000Z",
        },
      },
      steps: [
        {
          command: "publish --bundle figures-only",
          status: "success",
          detail: "Published after cutting the bundle down to fit the storage policy.",
        },
      ],
    });
    await request;

    expect(useLocalPaperPublishStore.getState().progressByPaperId[paper.id]).toMatchObject({
      status: "success",
      headline: "Paper published",
    });
    expect(queryClient.setQueryData).toHaveBeenCalledWith(localPaperQueryKey(paper.id), {
      ...paper,
      publication: {
        remotePaperId: "pub-1",
        url: "https://agentscience.com/papers/pub-1",
        slug: "bundle-repair-paper",
        publishedAt: "2026-05-20T00:00:00.000Z",
      },
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: localPapersQueryKey });
    expect(toastManager.add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "success",
        title: "Paper published",
      }),
    );
  });

  it("deduplicates repeated publish clicks for the same paper", async () => {
    const paper = makePaper();
    const queryClient = makeQueryClient();
    const result = deferred<Awaited<ReturnType<typeof smartPublishLocalPaper>>>();
    vi.mocked(smartPublishLocalPaper).mockReturnValue(result.promise);

    const first = useLocalPaperPublishStore.getState().startPublish({ paper, queryClient });
    const second = useLocalPaperPublishStore.getState().startPublish({ paper, queryClient });

    expect(second).toBe(first);
    expect(smartPublishLocalPaper).toHaveBeenCalledTimes(1);

    result.resolve({
      status: "repairing",
      paper: null,
      steps: [
        {
          command: "repair paper bundle",
          status: "running",
          detail: "Started a paper agent to repair the publish bundle.",
        },
      ],
      error: "The paper-only bundle still exceeded storage limits.",
      repairThreadId: "thread-publish-repair-1" as ThreadId,
    });
    await first;

    expect(useLocalPaperPublishStore.getState().progressByPaperId[paper.id]).toMatchObject({
      status: "repairing",
      repairThreadId: "thread-publish-repair-1",
    });
  });

  it("shows elapsed in-flight status while waiting for the backend response", async () => {
    vi.useFakeTimers();
    const paper = makePaper();
    const queryClient = makeQueryClient();
    const result = deferred<Awaited<ReturnType<typeof smartPublishLocalPaper>>>();
    vi.mocked(smartPublishLocalPaper).mockReturnValue(result.promise);

    const request = useLocalPaperPublishStore.getState().startPublish({ paper, queryClient });

    await vi.advanceTimersByTimeAsync(4_000);

    expect(useLocalPaperPublishStore.getState().progressByPaperId[paper.id]).toMatchObject({
      status: "running",
      headline: "Uploading the safe paper bundle",
      steps: [
        expect.objectContaining({
          command: "smart-publish",
          status: "running",
        }),
      ],
    });

    result.resolve({
      status: "published",
      paper: {
        ...paper,
        publication: {
          remotePaperId: "pub-1",
          url: "https://agentscience.com/papers/pub-1",
          slug: "bundle-repair-paper",
          publishedAt: "2026-05-20T00:00:00.000Z",
        },
      },
      steps: [
        {
          command: "publish --bundle standard",
          status: "success",
          detail: "Published with the normal safe paper bundle.",
        },
      ],
    });
    await request;

    expect(useLocalPaperPublishStore.getState().progressByPaperId[paper.id]).toMatchObject({
      status: "success",
      steps: [
        expect.objectContaining({
          command: "publish --bundle standard",
          status: "success",
        }),
      ],
    });
  });

  it("turns a stalled publish into a visible timeout failure", async () => {
    vi.useFakeTimers();
    const paper = makePaper();
    const queryClient = makeQueryClient();
    let capturedSignal: AbortSignal | null = null;
    vi.mocked(smartPublishLocalPaper).mockImplementation((_paperId, signal) => {
      capturedSignal = signal ?? null;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("Request aborted")));
      });
    });

    const request = useLocalPaperPublishStore.getState().startPublish({ paper, queryClient });

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    await request;

    expect(capturedSignal).not.toBeNull();
    const signal = capturedSignal as unknown as AbortSignal;
    expect(signal.aborted).toBe(true);
    expect(useLocalPaperPublishStore.getState().progressByPaperId[paper.id]).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Publishing took longer than expected"),
    });
    expect(toastManager.add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        title: "Publish failed",
      }),
    );
  });

  it("clears retained publish progress when the user dismisses it", () => {
    const paper = makePaper();
    useLocalPaperPublishStore.setState({
      progressByPaperId: {
        [paper.id]: {
          status: "success",
          headline: "Paper published",
          steps: [
            {
              command: "publish",
              status: "success",
              detail: "Published.",
            },
          ],
        },
      },
    });

    useLocalPaperPublishStore.getState().clearProgress(paper.id);

    expect(useLocalPaperPublishStore.getState().progressByPaperId[paper.id]).toBeUndefined();
  });
});
