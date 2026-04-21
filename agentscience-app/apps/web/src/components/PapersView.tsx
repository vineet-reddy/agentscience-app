import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  FileTextIcon,
  HardDriveIcon,
  Loader2Icon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { isElectron } from "../env";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import {
  fetchLocalPapers,
  localPapersQueryKey,
  type LocalPaper,
} from "../lib/papers";
import { useStore } from "../store";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { cn } from "../lib/utils";
import { MacTitlebarDragRow } from "./MacTitlebarDragRow";
import { SidebarReopenTrigger } from "./SidebarReopenTrigger";
import { Button, buttonVariants } from "./ui/button";
import { SidebarInset, SidebarTrigger } from "./ui/sidebar";

/**
 * PapersView — paper-first list of every paper discovered on this machine
 * (unassigned Papers + Project papers). Rows are intentionally minimal:
 * title, status, date. Clicking a row opens the paper itself, not the
 * thread that produced it; the thread link (if any) lives inside the
 * detail view.
 */
export function PapersView() {
  const papersQuery = useQuery({
    queryKey: localPapersQueryKey,
    queryFn: ({ signal }) => fetchLocalPapers(signal),
    retry: false,
    staleTime: 10_000,
  });

  const papers = papersQuery.data ?? [];
  const isLoading = papersQuery.isLoading;
  const hasPapers = papers.length > 0;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 sm:px-5">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0 md:hidden" />
              <span className="text-sm font-medium text-foreground">Papers</span>
            </div>
          </header>
        )}

        {isElectron && (
          <>
            <MacTitlebarDragRow />
            <div className="drag-region flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-6">
              <SidebarReopenTrigger />
              <span className="font-display text-[1.0625rem] text-ink">Papers</span>
            </div>
          </>
        )}

        <div className="flex min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[960px] flex-1 flex-col px-6 pb-20 pt-10 sm:px-10">
            {isLoading ? (
              <PapersLoadingState />
            ) : hasPapers ? (
              <PapersListLayout papers={papers} />
            ) : (
              <PapersEmptyState />
            )}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

function PapersLoadingState() {
  return (
    <div className="flex flex-1 items-center justify-center pt-16 text-ink-faint">
      <Loader2Icon className="size-4 animate-spin" aria-hidden />
    </div>
  );
}

function PapersListLayout({ papers }: { papers: ReadonlyArray<LocalPaper> }) {
  const publishedCount = papers.filter((paper) => paper.publication !== null).length;
  const manifestCount = papers.filter(
    (paper) => paper.publication === null && paper.publishManifestPresent,
  ).length;
  const localCount = papers.length - publishedCount - manifestCount;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-[1.875rem] leading-tight text-ink">Papers</h1>
        <p className="text-[0.8125rem] text-ink-faint">
          {papers.length} {papers.length === 1 ? "paper" : "papers"} on this computer
          {publishedCount > 0 ? <> · {publishedCount} published</> : null}
          {manifestCount > 0 ? <> · {manifestCount} with publish manifest</> : null}
          {localCount > 0 ? <> · {localCount} local only</> : null}
        </p>
      </header>

      <ul className="flex flex-col">
        {papers.map((paper) => (
          <li key={paper.id} className="border-t border-rule first:border-t-0">
            <PaperRow paper={paper} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PaperRow({ paper }: { paper: LocalPaper }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  const openPaper = () => {
    void navigate({ to: "/papers/$paperId", params: { paperId: paper.id } });
  };

  // Rough heuristic: a two-line clamp at body width holds ~220 chars. Only
  // show the "Show more" affordance when the abstract genuinely overflows
  // so short abstracts don't sprout a pointless toggle.
  const abstract = paper.abstract ?? null;
  const isAbstractLong = abstract !== null && abstract.length > 220;

  return (
    <div className="group flex w-full items-start gap-4 py-5">
      <button
        type="button"
        onClick={openPaper}
        aria-label={`Open ${paper.title}`}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-rule bg-snow-white text-ink-light transition-colors group-hover:text-accent"
      >
        <FileTextIcon className="size-4" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <button
          type="button"
          onClick={openPaper}
          className="text-left"
        >
          <h2 className="font-display text-[1.125rem] leading-snug text-ink transition-colors group-hover:text-accent">
            {paper.title}
          </h2>
        </button>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.75rem] text-ink-faint">
          <PaperStatusBadge paper={paper} />
          <span aria-hidden className="text-ink-faint/70">
            ·
          </span>
          <span title={new Date(paper.updatedAt).toLocaleString()}>
            {formatRelativeTimeLabel(paper.updatedAt)}
          </span>
        </div>
        {abstract ? (
          <div className="mt-0.5 flex flex-col gap-1">
            <p
              className={cn(
                "text-[0.8125rem] leading-relaxed text-ink-light",
                expanded ? undefined : "line-clamp-2",
              )}
            >
              {abstract}
            </p>
            {isAbstractLong ? (
              <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                aria-expanded={expanded}
                className="inline-flex w-fit items-center gap-1 text-[0.75rem] text-ink-faint transition-colors hover:text-ink"
              >
                <ChevronDownIcon
                  className={cn(
                    "size-3.5 transition-transform",
                    expanded ? "rotate-180" : undefined,
                  )}
                  aria-hidden
                />
                {expanded ? "Show less" : "Show more"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PaperStatusBadge({ paper }: { paper: LocalPaper }) {
  const isPublished = paper.publication !== null;
  const hasPublishManifest = paper.publishManifestPresent;
  const Icon = isPublished || hasPublishManifest ? FileTextIcon : HardDriveIcon;
  const label = isPublished
    ? "Published"
    : hasPublishManifest
      ? "Publish manifest"
      : "Local only";
  const hint = isPublished
    ? `Published to AgentScience on ${new Date(paper.publication.publishedAt).toLocaleString()}.`
    : hasPublishManifest
      ? "This workspace includes agentscience.publish.json. Publish it from the paper detail view."
      : "This paper lives only on this computer.";
  return (
    <span
      title={hint}
      className="inline-flex items-center gap-1 text-[0.75rem] text-ink-light"
    >
      <Icon className="size-3.5" aria-hidden />
      <span>{label}</span>
    </span>
  );
}

function PapersEmptyState(): ReactNode {
  const threads = useStore((state) => state.threads);
  const { handleNewThread } = useHandleNewThread();

  // If there are no threads either, the user simply hasn't started anything
  // yet. If they have threads but no papers, the agent never wrote a paper —
  // nudge them toward the right action in both cases.
  const hasAnyThreads = threads.some((thread) => !thread.archivedAt);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 pb-24 pt-16 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-full border border-rule bg-snow-white text-ink-faint">
        <FileTextIcon className="size-5" />
      </span>
      <div className="flex flex-col items-center gap-3">
        <h1 className="font-display text-[1.875rem] leading-tight text-ink">No papers yet</h1>
        <p className="max-w-[420px] text-[0.9375rem] leading-relaxed text-ink-light">
          {hasAnyThreads
            ? "Ask an agent to draft a paper and it will appear here. Papers live on this computer unless you export or share them yourself."
            : "Every manuscript you draft with an agent will appear here. Papers live on this computer unless you export or share them yourself."}
        </p>
        {hasAnyThreads ? (
          <p className="max-w-[420px] text-[0.8125rem] leading-relaxed text-ink-faint">
            Tip: Ask your agent to save the manuscript as <code className="rounded bg-muted px-1 py-0.5 text-[0.75rem]">paper.pdf</code> (or <code className="rounded bg-muted px-1 py-0.5 text-[0.75rem]">paper.tex</code>) in the chat's workspace folder.
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {hasAnyThreads ? (
          <Link to="/" className={cn(buttonVariants({ variant: "outline" }))}>
            Open a chat
          </Link>
        ) : null}
        <Button
          onClick={() => {
            void handleNewThread(null);
          }}
        >
          New Paper
        </Button>
      </div>
    </div>
  );
}
