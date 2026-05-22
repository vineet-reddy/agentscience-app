import { type CanvasBrowserState, type PaperReviewSnapshot, type ThreadId } from "@agentscience/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCcwIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchCanvasBrowserState } from "~/lib/canvasBrowser";
import {
  compilePaperReview,
  fetchPaperReviewSnapshot,
  fetchPaperReviewText,
} from "~/lib/paperReview";
import { cn } from "~/lib/utils";
import { CanvasBrowserSurface } from "./CanvasBrowserSurface";
import ChatMarkdown from "./ChatMarkdown";
import PdfPreviewSurface from "./PdfPreviewSurface";
import { toastManager } from "./ui/toast";
import "./PaperReviewCanvas.css";

type PaperReviewTab = "browser" | "preview" | "source";
type CanvasState = "working" | "browser" | "figure" | "paper" | "source" | "resting" | "miss";

interface PaperReviewPanelProps {
  threadId: ThreadId;
}

export function PaperReviewPanel({ threadId }: PaperReviewPanelProps) {
  const queryClient = useQueryClient();
  const [selectedTab, setSelectedTab] = useState<PaperReviewTab | null>(null);

  const snapshotQuery = useQuery({
    queryKey: ["paper-review", threadId],
    queryFn: () => fetchPaperReviewSnapshot(threadId),
    refetchInterval: (query) => (query.state.data?.compile.status === "compiling" ? 1_000 : false),
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
  const browserQuery = useQuery({
    queryKey: ["canvas-browser", threadId],
    queryFn: () => fetchCanvasBrowserState(threadId),
    refetchInterval: (query) => {
      const state = query.state.data;
      return state?.requestedUrl || state?.currentUrl ? 1_500 : 3_000;
    },
  });
  const browserState = browserQuery.data;
  const isWorking = snapshot?.compile.status === "compiling" || compileMutation.isPending;
  const hasPreview = Boolean(snapshot?.reviewRecommended);
  const hasSource = Boolean(snapshot?.source?.url);
  const hasBrowser = Boolean(browserState?.requestedUrl || browserState?.currentUrl);
  const browserIsNewest =
    hasBrowser &&
    (!snapshot?.preview.updatedAt ||
      (browserState?.updatedAt ?? "") >= snapshot.preview.updatedAt);
  const activeTab: PaperReviewTab =
    selectedTab === "browser" && hasBrowser
      ? "browser"
      : selectedTab === "source" && hasSource
        ? "source"
        : hasBrowser && browserIsNewest
            ? "browser"
            : hasPreview
              ? "preview"
              : hasBrowser
                ? "browser"
                : hasSource
                  ? "source"
                  : "preview";

  useEffect(() => {
    if (!hasPreview && selectedTab === "preview") {
      setSelectedTab(null);
    }
    if (!hasBrowser && selectedTab === "browser") {
      setSelectedTab(null);
    }
    if (!hasSource && selectedTab === "source") {
      setSelectedTab(null);
    }
  }, [hasBrowser, hasPreview, hasSource, selectedTab]);

  const sourceUrl = snapshot?.source?.url ?? null;
  const sourceQuery = useQuery({
    queryKey: ["paper-review", threadId, "source", sourceUrl],
    queryFn: () => fetchPaperReviewText(sourceUrl as string),
    enabled: sourceUrl !== null && activeTab === "source",
  });

  const previewTextUrl =
    snapshot?.preview.kind === "markdown" && snapshot.preview.url ? snapshot.preview.url : null;
  const previewTextQuery = useQuery({
    queryKey: ["paper-review", threadId, "preview-text", previewTextUrl],
    queryFn: () => fetchPaperReviewText(previewTextUrl as string),
    enabled: previewTextUrl !== null && activeTab === "preview",
  });

  const canvasState = resolveCanvasState({ activeTab, isWorking, snapshot });
  const voice = snapshot
    ? getCanvasVoice({ activeTab, browserState, canvasState, snapshot })
    : browserState && hasBrowser
      ? getCanvasVoice({ activeTab, browserState, canvasState, snapshot: undefined })
    : snapshotQuery.isPending
      ? "Looking through the workspace."
      : "Ready when you are.";
  const artifactLabel = snapshot ? getPreviewArtifactLabel(snapshot).toLowerCase() : "";
  const sourceLabel = snapshot?.source?.relativePath?.toLowerCase() ?? "paper.tex";
  const transitionKey = useMemo(
    () =>
      [
        canvasState,
        activeTab,
        snapshot?.preview.kind,
        snapshot?.preview.relativePath,
        snapshot?.preview.updatedAt,
        snapshot?.source?.relativePath,
        snapshot?.source?.updatedAt,
        browserState?.requestedUrl,
        browserState?.currentUrl,
        browserState?.navigationSequence,
      ]
        .filter(Boolean)
        .join(":"),
    [activeTab, browserState, canvasState, snapshot],
  );

  const rebuild = () => {
    if (!snapshot?.compile.canCompile || isWorking) return;
    compileMutation.mutate();
  };

  return (
    <section
      className="paper-review-canvas flex h-full min-h-0 flex-col text-foreground"
      data-state={canvasState}
    >
      <div className="paper-review-canvas__field" aria-hidden="true" />
      <header className="paper-review-canvas__top">
        <nav className="paper-review-canvas__view" aria-label="Workspace canvas view">
          {hasBrowser ? (
            <button
              type="button"
              className={cn(activeTab === "browser" && "paper-review-canvas__view-button--active")}
              onClick={() => setSelectedTab("browser")}
            >
              Browser
            </button>
          ) : null}
          {hasPreview ? (
            <button
              type="button"
              className={cn(activeTab === "preview" && "paper-review-canvas__view-button--active")}
              onClick={() => setSelectedTab("preview")}
            >
              Preview
            </button>
          ) : null}
          {hasSource ? (
            <button
              type="button"
              className={cn(activeTab === "source" && "paper-review-canvas__view-button--active")}
              onClick={() => setSelectedTab("source")}
            >
              Source
            </button>
          ) : null}
        </nav>
        {snapshot?.compile.canCompile ? (
          <button
            type="button"
            className="paper-review-canvas__rebuild"
            onClick={rebuild}
            disabled={isWorking}
            aria-label="Rebuild paper preview"
            title="Rebuild"
          >
            <RefreshCcwIcon aria-hidden />
          </button>
        ) : null}
      </header>

      <div className="paper-review-canvas__voice">
        <ConstellationPresence key={transitionKey} isWorking={canvasState === "working"} />
        <p key={voice} className="paper-review-canvas__voice-line">
          {voice}
        </p>
      </div>

      <div className="paper-review-canvas__stage">
        <div key={transitionKey} className="paper-review-canvas__artifact">
          {renderCanvasArtifact({
            activeTab,
            artifactLabel,
            canvasState,
            browserState,
            isLoadingSnapshot: snapshotQuery.isPending && !snapshot,
            isWorking,
            onRebuild: rebuild,
            previewText: previewTextQuery.data,
            previewTextError: previewTextQuery.error,
            previewTextPending: previewTextQuery.isPending,
            snapshot,
            sourceLabel,
            sourceText: sourceQuery.data,
            sourceTextError: sourceQuery.error,
            sourceTextPending: sourceQuery.isPending,
          })}
        </div>
      </div>
    </section>
  );
}

export default PaperReviewPanel;

function renderCanvasArtifact({
  activeTab,
  artifactLabel,
  canvasState,
  browserState,
  isLoadingSnapshot,
  isWorking,
  onRebuild,
  previewText,
  previewTextError,
  previewTextPending,
  snapshot,
  sourceLabel,
  sourceText,
  sourceTextError,
  sourceTextPending,
}: {
  activeTab: PaperReviewTab;
  artifactLabel: string;
  canvasState: CanvasState;
  browserState: CanvasBrowserState | undefined;
  isLoadingSnapshot: boolean;
  isWorking: boolean;
  onRebuild: () => void;
  previewText: string | undefined;
  previewTextError: unknown;
  previewTextPending: boolean;
  snapshot: PaperReviewSnapshot | undefined;
  sourceLabel: string;
  sourceText: string | undefined;
  sourceTextError: unknown;
  sourceTextPending: boolean;
}) {
  if (canvasState === "browser" && browserState) {
    return <CanvasBrowserSurface state={browserState} threadId={snapshot?.threadId ?? browserState.threadId} />;
  }

  if (isLoadingSnapshot || canvasState === "resting") {
    return <RestingCanvasLine text={isLoadingSnapshot ? "Looking through the workspace." : "Ready when you are."} />;
  }

  if (!snapshot) {
    return <RestingCanvasLine text="Ready when you are." />;
  }

  if (canvasState === "miss") {
    return (
      <CanvasMiss
        canRebuild={snapshot.compile.canCompile && !isWorking}
        onRebuild={onRebuild}
      />
    );
  }

  if (activeTab === "source") {
    return (
      <SourceArtifact
        error={sourceTextError}
        isPending={sourceTextPending}
        label={sourceLabel}
        outputExcerpt={snapshot.compile.outputExcerpt}
        text={sourceText}
      />
    );
  }

  if (snapshot.preview.kind === "pdf" && snapshot.preview.url) {
    return (
      <PdfPreviewSurface
        title={snapshot.threadTitle}
        url={snapshot.preview.url}
        {...(snapshot.compile.canCompile ? { onRenderAgain: onRebuild } : {})}
      />
    );
  }

  if (snapshot.preview.kind === "image" && snapshot.preview.url) {
    return (
      <FigureArtifact
        alt={snapshot.preview.relativePath ?? "Workspace figure"}
        label={artifactLabel}
        url={snapshot.preview.url}
      />
    );
  }

  if (snapshot.preview.kind === "markdown") {
    return (
      <MarkdownArtifact
        cwd={snapshot.workspaceRoot ?? undefined}
        error={previewTextError}
        isPending={previewTextPending}
        label={artifactLabel}
        text={previewText}
      />
    );
  }

  if (snapshot.source) {
    return (
      <CanvasPending
        canRebuild={snapshot.compile.canCompile && !isWorking}
        onRebuild={onRebuild}
        text={
          isWorking
            ? ""
            : "That render didn't come through. The source is intact, so I can compile it again."
        }
      />
    );
  }

  return <RestingCanvasLine text="Ready when you are." />;
}

function resolveCanvasState({
  activeTab,
  isWorking,
  snapshot,
}: {
  activeTab: PaperReviewTab;
  isWorking: boolean;
  snapshot: PaperReviewSnapshot | undefined;
}): CanvasState {
  if (activeTab === "browser") return "browser";
  if (isWorking) return "working";
  if (!snapshot || !snapshot.reviewRecommended) return "resting";
  if (snapshot.compile.status === "error") return "miss";
  if (activeTab === "source") return "source";
  if (snapshot.preview.kind === "pdf") return "paper";
  if (snapshot.preview.kind === "image") return "figure";
  if (snapshot.preview.kind === "markdown") return "paper";
  if (snapshot.preview.kind === "latex" || snapshot.preview.kind === "empty") return "miss";
  return "resting";
}

function getCanvasVoice({
  activeTab,
  browserState,
  canvasState,
  snapshot,
}: {
  activeTab: PaperReviewTab;
  browserState?: CanvasBrowserState | undefined;
  canvasState: CanvasState;
  snapshot: PaperReviewSnapshot | undefined;
}): string {
  if (canvasState === "browser") {
    const host = browserState?.currentUrl ?? browserState?.requestedUrl;
    if (!host) return "I have the browser ready.";
    try {
      return `I'm looking at ${new URL(host).hostname.replace(/^www\./, "")}.`;
    } catch {
      return "I'm using the browser now.";
    }
  }
  if (canvasState === "working") {
    if (activeTab === "source") return "Updating the source view.";
    if (snapshot?.preview.kind === "image") return "Working on the paper now.";
    return "Working on the paper now.";
  }
  if (canvasState === "figure") {
    return `Here's ${formatArtifactName(snapshot?.preview.relativePath ?? snapshot?.figure?.relativePath ?? "the figure")}.`;
  }
  if (canvasState === "paper") return "The paper's compiled. Here it is.";
  if (canvasState === "source") return "This is the source it built from.";
  if (canvasState === "miss") return "That render slipped - let me look.";
  return "Ready when you are.";
}

function formatArtifactName(path: string): string {
  const rawName = path.split("/").pop()?.replace(/\.[^.]+$/, "") || "the figure";
  const clean = rawName
    .replace(/^figure[-_\s]*/i, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .toLowerCase();
  return clean.length > 0 ? `the ${clean} figure` : "the figure";
}

function getPreviewArtifactLabel(snapshot: PaperReviewSnapshot): string {
  if (snapshot.preview.relativePath) return snapshot.preview.relativePath;
  switch (snapshot.preview.kind) {
    case "pdf":
      return "paper.pdf";
    case "image":
      return snapshot.figure?.relativePath ?? "figure";
    case "markdown":
      return "document.md";
    case "latex":
      return snapshot.source?.relativePath ?? "paper.tex";
    case "empty":
      return snapshot.source?.relativePath ?? "workspace";
    default:
      return "workspace";
  }
}

function ConstellationPresence({ isWorking }: { isWorking: boolean }) {
  return (
    <span
      className={cn(
        "paper-review-canvas__presence-constellation",
        isWorking && "paper-review-canvas__presence-constellation--working",
      )}
      aria-hidden="true"
    >
      <svg viewBox="0 0 30 30">
        <g className="paper-review-canvas__constellation-group">
          <line className="paper-review-canvas__constellation-edge" x1="7" y1="9" x2="15" y2="5" />
          <line className="paper-review-canvas__constellation-edge" x1="15" y1="5" x2="22" y2="11" />
          <line className="paper-review-canvas__constellation-edge" x1="7" y1="9" x2="12" y2="18" />
          <line className="paper-review-canvas__constellation-edge" x1="12" y1="18" x2="20" y2="21" />
          <line className="paper-review-canvas__constellation-edge" x1="22" y1="11" x2="20" y2="21" />
          <circle className="paper-review-canvas__constellation-node" cx="7" cy="9" r="1.5" />
          <circle className="paper-review-canvas__constellation-node paper-review-canvas__constellation-lead" cx="15" cy="5" r="2" />
          <circle className="paper-review-canvas__constellation-node" cx="22" cy="11" r="1.6" />
          <circle className="paper-review-canvas__constellation-node" cx="12" cy="18" r="1.4" />
          <circle className="paper-review-canvas__constellation-node" cx="20" cy="21" r="1.7" />
        </g>
      </svg>
    </span>
  );
}

function FigureArtifact({ alt, label, url }: { alt: string; label: string; url: string }) {
  return (
    <figure className="paper-review-canvas__figure-artifact">
      <div className="paper-review-canvas__figure-frame">
        <img src={url} alt={alt} />
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function SourceArtifact({
  error,
  isPending,
  label,
  outputExcerpt,
  text,
}: {
  error: unknown;
  isPending: boolean;
  label: string;
  outputExcerpt: string | null;
  text: string | undefined;
}) {
  return (
    <div className="paper-review-canvas__source-artifact">
      <p className="paper-review-canvas__source-label">{label}</p>
      <pre className="paper-review-canvas__source-code">
        {isPending
          ? "Loading manuscript source..."
          : text ||
            (error instanceof Error ? error.message : "The manuscript source is not available yet.")}
      </pre>
      {outputExcerpt ? (
        <>
          <p className="paper-review-canvas__source-label paper-review-canvas__source-label--output">
            build output
          </p>
          <pre className="paper-review-canvas__source-code paper-review-canvas__source-code--output">
            {outputExcerpt}
          </pre>
        </>
      ) : null}
    </div>
  );
}

function MarkdownArtifact({
  cwd,
  error,
  isPending,
  label,
  text,
}: {
  cwd: string | undefined;
  error: unknown;
  isPending: boolean;
  label: string;
  text: string | undefined;
}) {
  return (
    <article className="paper-review-canvas__markdown-artifact">
      <p className="paper-review-canvas__source-label">{label}</p>
      {isPending ? (
        <p className="paper-review-canvas__muted-line">Loading workspace document...</p>
      ) : text ? (
        <ChatMarkdown text={text} cwd={cwd} isStreaming={false} />
      ) : (
        <p className="paper-review-canvas__muted-line">
          {error instanceof Error ? error.message : "The workspace document is not available yet."}
        </p>
      )}
    </article>
  );
}

function RestingCanvasLine({ text }: { text: string }) {
  return (
    <div className="paper-review-canvas__resting">
      <p>{text}</p>
    </div>
  );
}

function CanvasMiss({
  canRebuild,
  onRebuild,
}: {
  canRebuild: boolean;
  onRebuild: () => void;
}) {
  return (
    <div className="paper-review-canvas__miss">
      <p>That render didn't come through. The source is intact, so I can compile it again.</p>
      <button type="button" onClick={onRebuild} disabled={!canRebuild}>
        Render again
      </button>
    </div>
  );
}

function CanvasPending({
  canRebuild,
  onRebuild,
  text,
}: {
  canRebuild: boolean;
  onRebuild: () => void;
  text: string;
}) {
  return (
    <div className="paper-review-canvas__miss">
      {text ? <p>{text}</p> : null}
      {canRebuild ? (
        <button type="button" onClick={onRebuild}>
          Render again
        </button>
      ) : null}
    </div>
  );
}
