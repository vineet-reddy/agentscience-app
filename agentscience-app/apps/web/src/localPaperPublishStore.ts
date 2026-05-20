import { type QueryClient } from "@tanstack/react-query";
import { create } from "zustand";

import {
  localPaperQueryKey,
  localPapersQueryKey,
  smartPublishLocalPaper,
  type LocalPaper,
  type SmartPublishStep,
} from "./lib/papers";
import { toastManager } from "./components/ui/toast";

export type SmartPublishProgress = {
  readonly status: "running" | "success" | "failed" | "repairing";
  readonly headline: string;
  readonly steps: readonly SmartPublishStep[];
  readonly error?: string | undefined;
  readonly repairThreadId?: string | undefined;
};

type LocalPaperPublishStoreState = {
  readonly progressByPaperId: Record<string, SmartPublishProgress>;
  readonly startPublish: (input: {
    readonly paper: LocalPaper;
    readonly queryClient: QueryClient;
  }) => Promise<void>;
  readonly clearProgress: (paperId: string) => void;
};

type InFlightPublish = {
  request: Promise<void>;
  readonly timers: Array<ReturnType<typeof setTimeout>>;
  timedOut: boolean;
};

const PUBLISH_TIMEOUT_MS = 10 * 60 * 1000;

const inFlightPublishByPaperId = new Map<string, InFlightPublish>();

const publishProgressCheckpoints: Array<{
  readonly afterMs: number;
  readonly headline: string;
  readonly detail: string;
}> = [
  {
    afterMs: 4_000,
    headline: "Uploading the safe paper bundle",
    detail:
      "AgentScience is trying the standard bundle first: paper, figures, and bounded supplemental artifacts.",
  },
  {
    afterMs: 15_000,
    headline: "Waiting for the publish service",
    detail:
      "Large PDFs or figures can take longer while storage accepts the upload or rejects it for automatic repair.",
  },
  {
    afterMs: 45_000,
    headline: "Still working through publish checks",
    detail:
      "If the standard bundle is too large, AgentScience will retry with figures-only and paper-only bundles before starting repair.",
  },
  {
    afterMs: 120_000,
    headline: "Still waiting on the backend response",
    detail:
      "The request is still active. AgentScience has not returned success, failure, or repair instructions yet.",
  },
];

function initialProgress(): SmartPublishProgress {
  return {
    status: "running",
    headline: "Preparing the paper for publishing",
    steps: [
      {
        command: "publish",
        status: "running",
        detail:
          "Checking the paper files, storage limits, and whether the bundle needs to be cut down.",
      },
    ],
  };
}

function runningProgress(headline: string, detail: string): SmartPublishProgress {
  return {
    status: "running",
    headline,
    steps: [
      {
        command: "smart-publish",
        status: "running",
        detail,
      },
    ],
  };
}

function setProgress(paperId: string, progress: SmartPublishProgress): void {
  useLocalPaperPublishStore.setState((state) => ({
    progressByPaperId: {
      ...state.progressByPaperId,
      [paperId]: progress,
    },
  }));
}

async function runPublish(input: {
  readonly paper: LocalPaper;
  readonly queryClient: QueryClient;
  readonly signal: AbortSignal;
  readonly didTimeout: () => boolean;
}): Promise<void> {
  const { paper, queryClient, signal, didTimeout } = input;
  setProgress(paper.id, initialProgress());

  try {
    const result = await smartPublishLocalPaper(paper.id, signal);
    if (result.paper) {
      queryClient.setQueryData(localPaperQueryKey(paper.id), result.paper);
    }
    await queryClient.invalidateQueries({ queryKey: localPapersQueryKey });

    if (result.status === "published" && result.paper?.publication) {
      setProgress(paper.id, {
        status: "success",
        headline: paper.publication ? "Published paper updated" : "Paper published",
        steps: result.steps,
      });
      toastManager.add({
        type: "success",
        title: paper.publication ? "Published paper updated" : "Paper published",
        description: "AgentScience now has the latest version of this paper.",
      });
      return;
    }

    if (result.status === "repairing") {
      setProgress(paper.id, {
        status: "repairing",
        headline: "A paper agent is repairing the bundle",
        steps: result.steps,
        error: result.error,
        repairThreadId: result.repairThreadId,
      });
      toastManager.add({
        type: "warning",
        title: "Agent repair started",
        description:
          result.error ??
          "AgentScience is repairing the paper bundle before trying to publish again.",
      });
      return;
    }

    const message =
      result.error ?? "The paper could not be published. AgentScience needs attention first.";
    setProgress(paper.id, {
      status: "failed",
      headline: "Publishing needs attention",
      steps: result.steps,
      error: message,
    });
    toastManager.add({
      type: "error",
      title: "Publish needs attention",
      description: message,
    });
  } catch (error) {
    const message =
      didTimeout()
        ? "Publishing took longer than expected and was stopped. Try again; if it stalls here again, the backend is likely stuck while uploading or validating this oversized bundle."
        : error instanceof Error
        ? error.message
        : "The paper could not be published to AgentScience.";
    setProgress(paper.id, {
      status: "failed",
      headline: "Publishing needs attention",
      steps: [
        {
          command: "publish",
          status: "failed",
          detail: message,
        },
      ],
      error: message,
    });
    toastManager.add({
      type: "error",
      title: "Publish failed",
      description: message,
    });
  }
}

export const useLocalPaperPublishStore = create<LocalPaperPublishStoreState>()((set) => ({
  progressByPaperId: {},
  startPublish: ({ paper, queryClient }) => {
    const existing = inFlightPublishByPaperId.get(paper.id);
    if (existing) {
      return existing.request;
    }

    const controller = new AbortController();
    const inFlight: InFlightPublish = {
      request: Promise.resolve(),
      timers: [],
      timedOut: false,
    };

    for (const checkpoint of publishProgressCheckpoints) {
      inFlight.timers.push(
        setTimeout(() => {
          if (!inFlightPublishByPaperId.has(paper.id)) {
            return;
          }
          setProgress(paper.id, runningProgress(checkpoint.headline, checkpoint.detail));
        }, checkpoint.afterMs),
      );
    }

    inFlight.timers.push(
      setTimeout(() => {
        const active = inFlightPublishByPaperId.get(paper.id);
        if (active !== inFlight) {
          return;
        }
        inFlight.timedOut = true;
        controller.abort();
      }, PUBLISH_TIMEOUT_MS),
    );

    const request = runPublish({
      paper,
      queryClient,
      signal: controller.signal,
      didTimeout: () => inFlight.timedOut,
    }).finally(() => {
      for (const timer of inFlight.timers) {
        clearTimeout(timer);
      }
      inFlightPublishByPaperId.delete(paper.id);
    });

    inFlight.request = request;
    inFlightPublishByPaperId.set(paper.id, inFlight);
    return request;
  },
  clearProgress: (paperId) => {
    set((state) => {
      if (!state.progressByPaperId[paperId]) {
        return state;
      }
      const { [paperId]: _removed, ...progressByPaperId } = state.progressByPaperId;
      return { progressByPaperId };
    });
  },
}));
