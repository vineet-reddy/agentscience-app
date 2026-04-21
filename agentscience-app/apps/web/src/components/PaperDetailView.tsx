import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  HardDriveIcon,
  Loader2Icon,
  MessageSquareTextIcon,
} from "lucide-react";
import { useState } from "react";

import { isElectron } from "../env";
import { fetchLocalPaper, localPaperQueryKey, type LocalPaper } from "../lib/papers";
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
              {paper?.pdf ? <DownloadButton paper={paper} /> : null}
            </div>
          </div>
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
  const Icon = paper.publishManifestPresent ? FileTextIcon : HardDriveIcon;
  const statusLabel = paper.publishManifestPresent ? "Publish manifest" : "Local only";

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
