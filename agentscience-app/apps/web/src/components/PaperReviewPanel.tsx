import { type ThreadId } from "@agentscience/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenTextIcon,
  CircleAlertIcon,
  FileCode2Icon,
  FileTextIcon,
  LoaderCircleIcon,
  RefreshCcwIcon,
} from "lucide-react";

import { compilePaperReview, fetchPaperReviewSnapshot, fetchPaperReviewText } from "~/lib/paperReview";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { toastManager } from "./ui/toast";

type PaperReviewTab = "preview" | "source";

interface PaperReviewPanelProps {
  threadId: ThreadId;
}

function formatCompilerLabel(label: string | null, status: string): string {
  if (!label) {
    return status === "unavailable" ? "No paper engine available" : "Paper engine unavailable";
  }
  return label;
}

export function PaperReviewPanel({ threadId }: PaperReviewPanelProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<PaperReviewTab>("preview");
  const announcedPdfUpdatedAtRef = useRef<string | null>(null);

  const snapshotQuery = useQuery({
    queryKey: ["paper-review", threadId],
    queryFn: () => fetchPaperReviewSnapshot(threadId),
    refetchInterval: 5_000,
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
  const sourceUrl = snapshot?.source?.url ?? null;
  const sourceQuery = useQuery({
    queryKey: ["paper-review", threadId, "source", sourceUrl],
    queryFn: () => fetchPaperReviewText(sourceUrl as string),
    enabled:
      sourceUrl !== null &&
      (activeTab === "source" || snapshot?.preview.kind !== "pdf" || snapshot?.compile.status === "error"),
  });

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    if (snapshot.preview.kind === "pdf") {
      setActiveTab((current) => (current === "source" ? current : "preview"));
      return;
    }
    setActiveTab("source");
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    if (
      snapshot.compile.canCompile &&
      snapshot.compile.needsBuild &&
      snapshot.compile.status === "idle" &&
      !compileMutation.isPending
    ) {
      compileMutation.mutate();
    }
  }, [compileMutation, snapshot]);

  useEffect(() => {
    if (!snapshot?.pdf?.updatedAt) {
      return;
    }
    const previous = announcedPdfUpdatedAtRef.current;
    announcedPdfUpdatedAtRef.current = snapshot.pdf.updatedAt;
    if (previous === null || previous === snapshot.pdf.updatedAt) {
      return;
    }
    toastManager.add({
      type: "success",
      title: "Paper preview updated",
      description: "The manuscript is ready to review on the right while you keep iterating in chat.",
      data: { threadId, dismissAfterVisibleMs: 3_500 },
    });
  }, [snapshot?.pdf?.updatedAt, threadId]);

  const isBusy = snapshotQuery.isPending && !snapshot;
  const compileLabel = formatCompilerLabel(snapshot?.compile.compilerLabel ?? null, snapshot?.compile.status ?? "idle");
  const statusLabel = useMemo(() => {
    if (!snapshot) {
      return "Loading";
    }
    switch (snapshot.compile.status) {
      case "compiling":
        return "Compiling";
      case "ready":
        return "Ready";
      case "error":
        return "Build failed";
      case "unavailable":
        return "Preview unavailable";
      default:
        return snapshot.preview.kind === "pdf" ? "Ready" : "Draft";
    }
  }, [snapshot]);

  const showPreviewTab = snapshot?.preview.kind === "pdf";

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="border-b border-border px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">
              <BookOpenTextIcon className="size-3.5" />
              Paper Review
            </div>
            <h2 className="font-display text-[1.85rem] leading-none text-foreground">
              {snapshot?.threadTitle ?? "Paper"}
            </h2>
            <p className="mt-2 max-w-[34rem] text-[13px] leading-relaxed text-muted-foreground">
              Keep the manuscript in view while you iterate in chat. Ask for figure, dataset, or
              analysis changes and the paper will refresh here.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="rounded-full border border-border px-2.5 py-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {statusLabel}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => compileMutation.mutate()}
              disabled={
                !snapshot?.compile.canCompile ||
                snapshot.compile.status === "compiling" ||
                compileMutation.isPending
              }
            >
              {snapshot?.compile.status === "compiling" || compileMutation.isPending ? (
                <LoaderCircleIcon className="size-3.5 animate-spin" />
              ) : (
                <RefreshCcwIcon className="size-3.5" />
              )}
              Rebuild
            </Button>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/70 pt-3">
          <div className="inline-flex rounded-full border border-border p-0.5">
            {showPreviewTab ? (
              <button
                type="button"
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs transition-colors",
                  activeTab === "preview"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setActiveTab("preview")}
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
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setActiveTab("source")}
            >
              Source
            </button>
          </div>
          <div className="text-right text-[12px] text-muted-foreground">
            <div>{compileLabel}</div>
            {snapshot?.workspaceRoot ? (
              <div className="max-w-[18rem] truncate" title={snapshot.workspaceRoot}>
                {snapshot.workspaceRoot}
              </div>
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
            <iframe
              title={`${snapshot.threadTitle} preview`}
              src={`${snapshot.preview.url}#view=FitH`}
              className="h-full w-full border-0 bg-background"
            />
          ) : (
            <div className="h-full overflow-y-auto px-4 py-4 sm:px-5">
              <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <FileCode2Icon className="size-3.5" />
                {snapshot.source?.relativePath ?? "Source"}
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
                  <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    <FileTextIcon className="size-3.5" />
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
