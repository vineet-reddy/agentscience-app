import { type ThreadId } from "@agentscience/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CircleAlertIcon, LoaderCircleIcon, RefreshCcwIcon } from "lucide-react";

import {
  compilePaperReview,
  fetchPaperReviewSnapshot,
  fetchPaperReviewText,
} from "~/lib/paperReview";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { toastManager } from "./ui/toast";
import PdfPreviewSurface from "./PdfPreviewSurface";

type PaperReviewTab = "preview" | "source";

interface PaperReviewPanelProps {
  threadId: ThreadId;
}

export function PaperReviewPanel({ threadId }: PaperReviewPanelProps) {
  const queryClient = useQueryClient();
  const [selectedTab, setSelectedTab] = useState<PaperReviewTab | null>(null);

  const snapshotQuery = useQuery({
    queryKey: ["paper-review", threadId],
    queryFn: () => fetchPaperReviewSnapshot(threadId),
    refetchInterval: (query) => (query.state.data?.compile.status === "compiling" ? 1_000 : 5_000),
  });

  const compileMutation = useMutation({
    mutationKey: ["paper-review", threadId, "compile"],
    mutationFn: () => compilePaperReview(threadId),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(["paper-review", threadId], snapshot);
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Paper build failed",
        description: error instanceof Error ? error.message : "Paper build failed unexpectedly.",
        data: { threadId },
      });
    },
  });

  const snapshot = snapshotQuery.data;
  const showPreviewTab = snapshot?.preview.kind === "pdf";
  const activeTab: PaperReviewTab = showPreviewTab ? (selectedTab ?? "preview") : "source";
  const sourceUrl = snapshot?.source?.url ?? null;
  const sourceQuery = useQuery({
    queryKey: ["paper-review", threadId, "source", sourceUrl],
    queryFn: () => fetchPaperReviewText(sourceUrl as string),
    enabled:
      sourceUrl !== null &&
      (activeTab === "source" ||
        snapshot?.preview.kind !== "pdf" ||
        snapshot?.compile.status === "error"),
  });

  useEffect(() => {
    if (!showPreviewTab) {
      setSelectedTab(null);
    }
  }, [showPreviewTab]);

  const isBusy = snapshotQuery.isPending && !snapshot;
  const isCompiling = snapshot?.compile.status === "compiling" || compileMutation.isPending;
  const statusLabel = (() => {
    if (!snapshot) {
      return null;
    }
    switch (snapshot.compile.status) {
      case "error":
        return "Build failed";
      case "unavailable":
        return "Preview unavailable";
      default:
        return null;
    }
  })();

  const showRebuildControl = Boolean(snapshot?.compile.canCompile);
  const sourceLabel = snapshot?.source?.relativePath ?? "Source";

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="h-[52px] shrink-0 border-b border-border/80 px-5">
        <div className="flex h-full items-center justify-between gap-3">
          <div className="inline-flex rounded-full border border-border/70 p-0.5">
            {showPreviewTab ? (
              <button
                type="button"
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs transition-colors",
                  activeTab === "preview"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground/80 hover:text-foreground",
                )}
                onClick={() => setSelectedTab("preview")}
              >
                Preview
              </button>
            ) : null}
            <button
              type="button"
              className={cn(
                "rounded-full px-3 py-1.5 text-xs transition-colors",
                activeTab === "source"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground/80 hover:text-foreground",
              )}
              onClick={() => setSelectedTab(showPreviewTab ? "source" : null)}
            >
              Source
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {statusLabel ? (
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                {statusLabel}
              </div>
            ) : null}
            {showRebuildControl ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="px-1.5 text-muted-foreground/85 hover:text-foreground"
                onClick={() => compileMutation.mutate()}
                disabled={isCompiling}
              >
                {isCompiling ? (
                  <LoaderCircleIcon className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCcwIcon className="size-3.5" />
                )}
                {isCompiling ? "Updating" : "Rebuild"}
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      {snapshot?.compile.status === "error" && snapshot.compile.lastError ? (
        <div className="border-b border-border bg-destructive/5 px-4 py-3 text-sm text-foreground sm:px-5">
          <div className="flex items-start gap-2">
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0">
              <p className="font-medium">Preview build failed</p>
              <p className="mt-1 text-muted-foreground">{snapshot.compile.lastError}</p>
            </div>
          </div>
        </div>
      ) : null}

      {snapshot?.compile.status === "unavailable" && snapshot?.source?.kind === "latex" ? (
        <div className="border-b border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground sm:px-5">
          No LaTeX engine was detected, so the manuscript source is shown directly. Once a paper
          engine is available, the PDF preview will populate automatically.
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {isBusy ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading paper review...
          </div>
        ) : snapshot?.reviewRecommended ? (
          activeTab === "preview" && snapshot.preview.kind === "pdf" && snapshot.preview.url ? (
            <PdfPreviewSurface title={snapshot.threadTitle} url={snapshot.preview.url} />
          ) : (
            <div className="h-full overflow-y-auto px-4 py-4 sm:px-5">
              <div className="mb-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {sourceLabel}
              </div>
              {sourceQuery.isPending ? (
                <div className="text-sm text-muted-foreground">Loading manuscript source...</div>
              ) : sourceQuery.data ? (
                <pre className="overflow-x-auto whitespace-pre-wrap break-words border border-border/80 bg-card px-4 py-4 font-mono text-[12px] leading-6 text-foreground">
                  {sourceQuery.data}
                </pre>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {sourceQuery.error instanceof Error
                    ? sourceQuery.error.message
                    : "The manuscript source is not available yet."}
                </div>
              )}

              {snapshot.compile.outputExcerpt ? (
                <div className="mt-5 border-t border-border pt-4">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    Latest build output
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words border border-border/80 bg-card px-4 py-4 font-mono text-[12px] leading-6 text-muted-foreground">
                    {snapshot.compile.outputExcerpt}
                  </pre>
                </div>
              ) : null}
            </div>
          )
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div>
              <p className="font-display text-[1.65rem] text-foreground">No manuscript yet</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Once the agent writes `paper.tex`, `paper.md`, or a compiled PDF in this paper
                workspace, it will appear here automatically.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PaperReviewPanel;
