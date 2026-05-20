import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  HardDriveIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  XIcon,
  XCircleIcon,
} from "lucide-react";
import { useState } from "react";

import { isElectron } from "../env";
import { useAgentScienceAccount } from "../hooks/useAgentScienceAccount";
import {
  fetchLocalPaper,
  localPaperQueryKey,
  type LocalPaper,
  type SmartPublishStep,
} from "../lib/papers";
import { useLocalPaperPublishStore, type SmartPublishProgress } from "../localPaperPublishStore";
import { cn } from "../lib/utils";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { MacTitlebarDragRow } from "./MacTitlebarDragRow";
import { PdfPreviewSurface } from "./PdfPreviewSurface";
import { SidebarReopenTrigger } from "./SidebarReopenTrigger";
import { Button, buttonVariants } from "./ui/button";
import { SidebarInset, SidebarTrigger } from "./ui/sidebar";
import { toastManager } from "./ui/toast";

/**
 * PaperDetailView — full-screen preview of a single paper. Backed by the
 * same local filesystem the list scans; the PDF, download, and optional
 * "open in chat" are all driven off `paper.id` (a base64url-encoded
 * workspace path).
 */
export function PaperDetailView() {
  const { paperId } = useParams({ from: "/papers/$paperId" });
  const paperQuery = useQuery({
    queryKey: localPaperQueryKey(paperId),
    queryFn: ({ signal }) => fetchLocalPaper(paperId, signal),
    retry: false,
    staleTime: 10_000,
  });

  const paper = paperQuery.data ?? null;
  const isLoading = paperQuery.isLoading;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <DetailHeader paper={paper} isLoading={isLoading} />
        <div className="flex min-h-0 flex-1 flex-col">
          {isLoading ? (
            <DetailLoadingState />
          ) : !paper ? (
            <DetailMissingState />
          ) : paper.pdf ? (
            <PdfPreviewSurface title={paper.title} url={paper.pdf.url} />
          ) : (
            <NoPdfState paper={paper} />
          )}
        </div>
      </div>
    </SidebarInset>
  );
}

function DetailHeader({
  paper,
  isLoading,
}: {
  paper: LocalPaper | null;
  isLoading: boolean;
}) {
  const navigate = useNavigate();
  const publishProgress = useLocalPaperPublishStore((state) =>
    paper ? (state.progressByPaperId[paper.id] ?? null) : null,
  );
  const clearPublishProgress = useLocalPaperPublishStore((state) => state.clearProgress);

  const goBack = () => {
    void navigate({ to: "/papers" });
  };

  // Single header block that works identically windowed and fullscreen.
  // MacTitlebarDragRow only renders the 36px drag reserve when appropriate
  // so we always get the right layout under macOS Electron.
  return (
    <>
      {!isElectron && (
        <header className="border-b border-border px-3 py-2 sm:px-5">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="size-7 shrink-0 md:hidden" />
            <BackToPapersButton onClick={goBack} />
            <span className="ms-2 truncate text-sm font-medium text-foreground">
              {paper ? paper.title : isLoading ? "Loading…" : "Paper"}
            </span>
          </div>
        </header>
      )}

      {isElectron && (
        <>
          <MacTitlebarDragRow />
          <div className="drag-region flex min-h-[52px] shrink-0 flex-wrap items-center gap-3 border-b border-border px-6 py-2">
            <SidebarReopenTrigger />
            <BackToPapersButton onClick={goBack} />
            <div className="no-drag-region flex min-w-0 flex-1 flex-col">
              <span
                className="truncate font-display text-[1.0625rem] text-ink"
                title={paper?.title}
              >
                {paper ? paper.title : isLoading ? "Loading…" : "Paper"}
              </span>
              {paper ? <DetailSubline paper={paper} /> : null}
            </div>
            <div className="no-drag-region ms-auto flex items-center gap-2">
              {paper?.threadId ? <OpenInChatButton threadId={paper.threadId} /> : null}
              {paper ? <OpenPublishedPaperButton paper={paper} /> : null}
              {paper ? <PublishPaperButton paper={paper} progress={publishProgress} /> : null}
              {paper?.pdf ? <DownloadButton paper={paper} /> : null}
            </div>
          </div>
          {paper && publishProgress ? (
            <PublishProgressTray
              progress={publishProgress}
              onDismiss={() => clearPublishProgress(paper.id)}
            />
          ) : null}
        </>
      )}
    </>
  );
}

function BackToPapersButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={onClick}
      className="no-drag-region gap-1.5 text-ink-light hover:text-ink"
      aria-label="Back to papers"
      title="Back to papers"
    >
      <ArrowLeftIcon className="size-3.5" aria-hidden />
      <span className="hidden sm:inline">Papers</span>
    </Button>
  );
}

function DetailSubline({ paper }: { paper: LocalPaper }) {
  const Icon =
    paper.publication || paper.publishManifestPresent ? FileTextIcon : HardDriveIcon;
  const statusLabel = paper.publication
    ? "Published"
    : paper.publishManifestPresent
      ? "Publish manifest"
      : "Local only";

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.75rem] text-ink-faint">
      <span className="inline-flex items-center gap-1 text-ink-light">
        <Icon className="size-3.5" aria-hidden />
        <span>{statusLabel}</span>
      </span>
      <span aria-hidden className="text-ink-faint/70">
        ·
      </span>
      <span title={new Date(paper.updatedAt).toLocaleString()}>
        {formatRelativeTimeLabel(paper.updatedAt)}
      </span>
      {paper.projectName ? (
        <>
          <span aria-hidden className="text-ink-faint/70">
            ·
          </span>
          <span className="truncate" title={paper.projectName}>
            {paper.projectName}
          </span>
        </>
      ) : null}
    </div>
  );
}

function OpenInChatButton({ threadId }: { threadId: string }) {
  return (
    <Link
      to="/$threadId"
      params={{ threadId }}
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
    >
      <MessageSquareTextIcon className="size-3.5" aria-hidden />
      <span>Open chat</span>
    </Link>
  );
}

function OpenPublishedPaperButton({ paper }: { paper: LocalPaper }) {
  if (!paper.publication) {
    return null;
  }

  return (
    <a
      href={paper.publication.url}
      target="_blank"
      rel="noreferrer"
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
    >
      <ExternalLinkIcon className="size-3.5" aria-hidden />
      <span>Open published</span>
    </a>
  );
}

function PublishPaperButton({
  paper,
  progress,
}: {
  paper: LocalPaper;
  progress: SmartPublishProgress | null;
}) {
  const queryClient = useQueryClient();
  const { state: authState } = useAgentScienceAccount();
  const startPublish = useLocalPaperPublishStore((state) => state.startPublish);

  const isSignedIn = authState?.status === "signed-in";
  const hasLatexSource = !!paper.source && paper.source.relativePath.endsWith(".tex");
  const isPublishable = !!paper.pdf && hasLatexSource;
  const isPublishing = progress?.status === "running";
  const disabled = isPublishing || !isSignedIn || !isPublishable;
  const title = !isSignedIn
    ? "Connect this device to AgentScience before publishing."
    : !paper.source
      ? "This paper needs a source file before it can be published."
      : !hasLatexSource
        ? "This paper needs a LaTeX source file before it can be published."
        : !paper.pdf
          ? "This paper needs a compiled PDF before it can be published."
          : paper.publication
            ? "Update the published AgentScience paper."
            : "Publish this paper to AgentScience.";

  return (
    <Button
      type="button"
      size="sm"
      variant={paper.publication ? "outline" : "default"}
      disabled={disabled}
      title={title}
      onClick={() => void startPublish({ paper, queryClient })}
      className="gap-1.5"
    >
      {isPublishing ? (
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <ExternalLinkIcon className="size-3.5" aria-hidden />
      )}
      <span>{isPublishing ? "Publishing" : paper.publication ? "Update" : "Publish"}</span>
    </Button>
  );
}

function PublishProgressTray({
  progress,
  onDismiss,
}: {
  progress: SmartPublishProgress;
  onDismiss: () => void;
}) {
  const latestStep = progress.steps.toReversed().find((step) => step.status === "running");
  const summary =
    latestStep?.detail ??
    progress.error ??
    progress.steps[progress.steps.length - 1]?.detail ??
    "AgentScience is preparing the paper.";
  const canDismiss = progress.status !== "running";
  const showStepList = !(progress.status === "running" && progress.steps.length === 1);

  return (
    <div className="no-drag-region border-b border-border bg-snow-white px-6 py-3">
      <div className="mx-auto flex max-w-[980px] flex-col gap-2">
        <div className="flex items-start gap-2">
          {progress.status === "success" ? (
            <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-ink" aria-hidden />
          ) : progress.status === "failed" ? (
            <XCircleIcon className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          ) : (
            <Loader2Icon className="mt-0.5 size-4 shrink-0 animate-spin text-ink" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="text-[0.8125rem] font-medium text-ink">{progress.headline}</p>
            <p className="mt-0.5 text-[0.75rem] leading-snug text-ink-light">{summary}</p>
          </div>
          {canDismiss ? (
            <button
              type="button"
              className="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-faint transition-colors hover:bg-snow-white-dark hover:text-ink"
              onClick={onDismiss}
              aria-label="Dismiss publish status"
              title="Dismiss publish status"
            >
              <XIcon className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
        {showStepList ? (
          <div className="grid gap-1.5 pl-6">
            {progress.steps.map((step) => (
              <PublishProgressStep
                key={`${step.command}-${step.status}-${step.detail}`}
                step={step}
              />
            ))}
          </div>
        ) : null}
        {progress.repairThreadId ? (
          <Link
            to="/$threadId"
            params={{ threadId: progress.repairThreadId }}
            className="ml-6 w-fit text-[0.75rem] font-medium text-accent-color hover:underline"
          >
            Open repair chat
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function PublishProgressStep({ step }: { step: SmartPublishStep }) {
  const Icon =
    step.status === "success"
      ? CheckCircle2Icon
      : step.status === "failed"
        ? XCircleIcon
        : step.status === "running"
          ? Loader2Icon
          : FileTextIcon;
  return (
    <div className="flex min-w-0 items-start gap-2 text-[0.75rem]">
      <Icon
        className={cn(
          "mt-0.5 size-3.5 shrink-0",
          step.status === "running" && "animate-spin",
          step.status === "failed" ? "text-danger" : "text-ink-faint",
        )}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="leading-snug text-ink-light">{step.detail}</p>
        <p className="truncate font-mono text-[0.6875rem] leading-snug text-ink-faint">
          {step.command}
        </p>
      </div>
    </div>
  );
}

function DownloadButton({ paper }: { paper: LocalPaper }) {
  const [state, setState] = useState<"idle" | "downloading">("idle");
  const disabled = state === "downloading" || !paper.pdf;

  const handleDownload = async () => {
    if (!paper.pdf || state === "downloading") return;
    setState("downloading");
    try {
      const response = await fetch(paper.pdf.url, { credentials: "same-origin" });
      if (!response.ok) {
        throw new Error(`Download failed (${response.status})`);
      }
      const blob = await response.blob();
      triggerBrowserDownload(blob, buildPdfFileName(paper.title));
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Download failed",
        description:
          error instanceof Error
            ? error.message
            : "The paper PDF could not be downloaded. Try rebuilding it and then download again.",
      });
    } finally {
      setState("idle");
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      onClick={() => void handleDownload()}
      disabled={disabled}
      className={cn("gap-1.5")}
      aria-label={`Download ${paper.title} as PDF`}
      title="Download PDF"
    >
      {state === "downloading" ? (
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <DownloadIcon className="size-3.5" aria-hidden />
      )}
      <span>{state === "downloading" ? "Downloading" : "Download"}</span>
    </Button>
  );
}

function DetailLoadingState() {
  return (
    <div className="flex flex-1 items-center justify-center text-ink-faint">
      <Loader2Icon className="size-4 animate-spin" aria-hidden />
    </div>
  );
}

function DetailMissingState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-full border border-rule bg-snow-white text-ink-faint">
        <FileTextIcon className="size-5" />
      </span>
      <h2 className="font-display text-[1.5rem] text-ink">Paper not found</h2>
      <p className="max-w-[420px] text-[0.9375rem] leading-relaxed text-ink-light">
        This paper was removed from disk or the workspace folder has changed. Return
        to the list to see what's still available.
      </p>
      <Link
        to="/papers"
        className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")}
      >
        <ArrowLeftIcon className="size-3.5" aria-hidden />
        Back to papers
      </Link>
    </div>
  );
}

function NoPdfState({ paper }: { paper: LocalPaper }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-full border border-rule bg-snow-white text-ink-faint">
        <FileTextIcon className="size-5" />
      </span>
      <h2 className="font-display text-[1.5rem] text-ink">No PDF yet</h2>
      <p className="max-w-[420px] text-[0.9375rem] leading-relaxed text-ink-light">
        This paper has source files but no compiled PDF on disk yet. Open the chat to
        ask the agent to build <code className="rounded bg-muted px-1 py-0.5 text-[0.75rem]">paper.pdf</code>.
      </p>
      {paper.threadId ? (
        <Link
          to="/$threadId"
          params={{ threadId: paper.threadId }}
          className={cn(buttonVariants({ variant: "default" }), "gap-1.5")}
        >
          <ExternalLinkIcon className="size-3.5" aria-hidden />
          Open chat
        </Link>
      ) : null}
    </div>
  );
}

function buildPdfFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${slug || "paper"}.pdf`;
}

function triggerBrowserDownload(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
}

export default PaperDetailView;
