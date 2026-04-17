import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CopyIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FileTextIcon,
  SearchIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { isElectron } from "../env";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useSettings } from "../hooks/useSettings";
import {
  type DatasetEntry,
  type DatasetSourcePaper,
  buildDatasetMentionRef,
  fetchDatasetRegistry,
  resolveSourcePaperUrl,
} from "../lib/datasetRegistry";
import { cn, newThreadId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SidebarInset, SidebarTrigger } from "./ui/sidebar";
import { toastManager } from "./ui/toast";

const DATASET_REGISTRY_QUERY_KEY = ["dataset-registry"] as const;

export function DatasetsView() {
  const datasetsQuery = useQuery({
    queryKey: DATASET_REGISTRY_QUERY_KEY,
    queryFn: ({ signal }) => fetchDatasetRegistry({ signal, limit: 500 }),
    retry: false,
    staleTime: 30_000,
  });

  const datasets = datasetsQuery.data ?? [];
  const [searchQuery, setSearchQuery] = useState("");
  const [activeDomain, setActiveDomain] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const domainOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const dataset of datasets) {
      if (!dataset.domain) continue;
      counts.set(dataset.domain, (counts.get(dataset.domain) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([, leftCount], [, rightCount]) => rightCount - leftCount)
      .map(([domain, count]) => ({ domain, count }));
  }, [datasets]);

  const filteredDatasets = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return datasets.filter((dataset) => {
      if (activeDomain && dataset.domain !== activeDomain) {
        return false;
      }
      if (!normalizedQuery) return true;
      const hayStack = [
        dataset.name,
        dataset.description,
        dataset.domain,
        dataset.sourcePaper?.title ?? "",
        ...(dataset.sourcePaper?.authors ?? []),
        ...dataset.keywords,
      ]
        .join(" \n ")
        .toLowerCase();
      return hayStack.includes(normalizedQuery);
    });
  }, [datasets, searchQuery, activeDomain]);

  useEffect(() => {
    if (filteredDatasets.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (selectedId && filteredDatasets.some((dataset) => dataset.id === selectedId)) {
      return;
    }
    setSelectedId(filteredDatasets[0]!.id);
  }, [filteredDatasets, selectedId]);

  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedId) ?? null,
    [datasets, selectedId],
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 sm:px-5">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0 md:hidden" />
              <span className="text-sm font-medium text-foreground">Datasets</span>
            </div>
          </header>
        )}

        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-6">
            <span className="font-display text-[1.0625rem] text-ink">Datasets</span>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <DatasetListColumn
            datasets={filteredDatasets}
            totalCount={datasets.length}
            isLoading={datasetsQuery.isLoading}
            errorMessage={
              datasetsQuery.error instanceof Error
                ? datasetsQuery.error.message
                : datasetsQuery.error
                  ? "Could not load the dataset registry."
                  : null
            }
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            domainOptions={domainOptions}
            activeDomain={activeDomain}
            onActiveDomainChange={setActiveDomain}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <DatasetDetailColumn
            dataset={selectedDataset}
            isLoading={datasetsQuery.isLoading}
          />
        </div>
      </div>
    </SidebarInset>
  );
}

interface DatasetListColumnProps {
  datasets: DatasetEntry[];
  totalCount: number;
  isLoading: boolean;
  errorMessage: string | null;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  domainOptions: Array<{ domain: string; count: number }>;
  activeDomain: string | null;
  onActiveDomainChange: (value: string | null) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function DatasetListColumn({
  datasets,
  totalCount,
  isLoading,
  errorMessage,
  searchQuery,
  onSearchQueryChange,
  domainOptions,
  activeDomain,
  onActiveDomainChange,
  selectedId,
  onSelect,
}: DatasetListColumnProps) {
  const displayCount = datasets.length;
  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-r border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4">
        <div className="flex items-baseline justify-between">
          <p className="font-display text-[1.0625rem] text-ink">Dataset registry</p>
          <span className="text-[11px] uppercase tracking-[0.16em] text-ink-faint">
            {isLoading ? "Loading" : `${displayCount} of ${totalCount}`}
          </span>
        </div>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" />
          <Input
            size="sm"
            type="search"
            placeholder="Search datasets"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            className="pl-8"
          />
        </div>
        <DomainFilterPills
          options={domainOptions}
          activeDomain={activeDomain}
          onChange={onActiveDomainChange}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {errorMessage ? (
          <div className="px-4 py-6 text-[0.8125rem] text-ink-light">{errorMessage}</div>
        ) : isLoading ? (
          <div className="px-4 py-6 text-[0.8125rem] text-ink-light">
            Loading datasets…
          </div>
        ) : datasets.length === 0 ? (
          <EmptyListState totalCount={totalCount} hasQuery={searchQuery.trim().length > 0} />
        ) : (
          <ul>
            {datasets.map((dataset) => (
              <li key={dataset.id}>
                <DatasetListRow
                  dataset={dataset}
                  isActive={dataset.id === selectedId}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function EmptyListState({
  totalCount,
  hasQuery,
}: {
  totalCount: number;
  hasQuery: boolean;
}) {
  if (totalCount === 0) {
    return (
      <div className="flex h-full flex-col items-start gap-2 px-4 py-6 text-[0.8125rem] text-ink-light">
        <p className="font-medium text-ink">No datasets registered yet.</p>
        <p>
          Datasets added by published AgentScience papers will appear here. Run a paper with a
          data source and it will show up after review.
        </p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-start gap-2 px-4 py-6 text-[0.8125rem] text-ink-light">
      <p className="font-medium text-ink">No matches.</p>
      <p>
        {hasQuery
          ? "Try broader search terms or clear the active filter."
          : "No datasets match the active filter. Switch to All to see everything."}
      </p>
    </div>
  );
}

interface DatasetListRowProps {
  dataset: DatasetEntry;
  isActive: boolean;
  onSelect: (id: string) => void;
}

function DatasetListRow({ dataset, isActive, onSelect }: DatasetListRowProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(dataset.id)}
      className={cn(
        "flex w-full flex-col gap-1 border-b border-border/60 px-4 py-3 text-left transition-colors",
        "hover:bg-secondary/60",
        isActive && "bg-secondary",
      )}
      aria-pressed={isActive}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className="truncate text-[13px] font-medium text-ink"
          title={dataset.name}
        >
          {dataset.name}
        </span>
        <span className="shrink-0 text-[11px] text-ink-faint">
          {formatShortDate(dataset.createdAt)}
        </span>
      </div>
      {dataset.description ? (
        <p
          className="text-[12px] leading-snug text-ink-light"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {dataset.description}
        </p>
      ) : null}
      {dataset.domain ? (
        <span className="mt-1 inline-flex w-fit items-center rounded-full bg-[#E1F5EE] px-2 py-[2px] text-[11px] font-medium text-[#085041] dark:bg-[#11332a] dark:text-[#7ddcbd]">
          {dataset.domain}
        </span>
      ) : null}
    </button>
  );
}

function DomainFilterPills({
  options,
  activeDomain,
  onChange,
}: {
  options: Array<{ domain: string; count: number }>;
  activeDomain: string | null;
  onChange: (value: string | null) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="-mx-1 flex flex-wrap gap-1 px-1">
      <FilterPill
        label="All"
        isActive={activeDomain === null}
        onClick={() => onChange(null)}
      />
      {options.map(({ domain }) => (
        <FilterPill
          key={domain}
          label={domain}
          isActive={activeDomain === domain}
          onClick={() => onChange(domain)}
        />
      ))}
    </div>
  );
}

function FilterPill({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-[3px] text-[11px] font-medium transition-colors",
        isActive
          ? "border-ink bg-ink text-snow-white"
          : "border-border bg-transparent text-ink-light hover:bg-secondary",
      )}
      aria-pressed={isActive}
    >
      {label}
    </button>
  );
}

function DatasetDetailColumn({
  dataset,
  isLoading,
}: {
  dataset: DatasetEntry | null;
  isLoading: boolean;
}) {
  if (isLoading && !dataset) {
    return (
      <section className="flex h-full flex-1 items-center justify-center px-8 py-10 text-ink-light">
        Loading…
      </section>
    );
  }

  if (!dataset) {
    return (
      <section className="flex h-full flex-1 items-center justify-center px-8 py-10">
        <div className="max-w-[420px] text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-lg bg-secondary text-ink-light">
            <DatabaseIcon className="size-5" />
          </div>
          <p className="mt-4 font-display text-[1.25rem] text-ink">Select a dataset</p>
          <p className="mt-2 text-[0.8125rem] text-ink-light">
            Choose a dataset from the list to see its description, metadata, and how to
            reference it from a new paper.
          </p>
        </div>
      </section>
    );
  }

  return <DatasetDetailBody dataset={dataset} />;
}

function DatasetDetailBody({ dataset }: { dataset: DatasetEntry }) {
  return (
    <section className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[720px] flex-col gap-7 px-8 py-8">
          <DatasetHeader dataset={dataset} />
          <DatasetDescription description={dataset.description} />
          <DatasetMetadataGrid
            domain={dataset.domain}
            createdAt={dataset.createdAt}
            usedInPaperCount={dataset.usedInPaperCount}
          />
          <DatasetKeywords keywords={dataset.keywords} />
          <DatasetSourcePaperSection sourcePaper={dataset.sourcePaper} />
        </div>
      </div>
      <DatasetActionBar dataset={dataset} />
    </section>
  );
}

function DatasetHeader({ dataset }: { dataset: DatasetEntry }) {
  return (
    <header className="flex items-start gap-4">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-[#E1F5EE] text-[#0F6E56] dark:bg-[#11332a] dark:text-[#7ddcbd]">
        <DatabaseIcon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-[1.5rem] leading-[1.2] text-ink sm:text-[1.625rem]">
          {dataset.name}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.8125rem] text-ink-light">
          <a
            href={dataset.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-accent-color hover:underline"
            onClick={(event) => {
              event.preventDefault();
              void openExternal(dataset.url);
            }}
          >
            <span className="truncate max-w-[360px]">{dataset.url}</span>
            <ExternalLinkIcon className="size-3.5" />
          </a>
        </div>
      </div>
    </header>
  );
}

function DatasetDescription({ description }: { description: string }) {
  if (!description) return null;
  return (
    <section className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        Description
      </p>
      <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-ink">
        {description}
      </p>
    </section>
  );
}

function DatasetMetadataGrid({
  domain,
  createdAt,
  usedInPaperCount,
}: {
  domain: string;
  createdAt: string;
  usedInPaperCount: number;
}) {
  const entries: Array<{ label: string; value: string }> = [
    { label: "Domain", value: domain || "—" },
    { label: "Added", value: formatLongDate(createdAt) },
    { label: "Used in papers", value: formatPaperCount(usedInPaperCount) },
  ];
  return (
    <section className="grid grid-cols-1 gap-3 rounded-[12px] border border-rule bg-card p-4 sm:grid-cols-3">
      {entries.map((entry) => (
        <div key={entry.label} className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            {entry.label}
          </span>
          <span className="text-[0.875rem] text-ink">{entry.value}</span>
        </div>
      ))}
    </section>
  );
}

function DatasetSourcePaperSection({
  sourcePaper,
}: {
  sourcePaper: DatasetSourcePaper | null;
}) {
  if (!sourcePaper) return null;

  return (
    <section className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        Source paper
      </p>
      <button
        type="button"
        onClick={() => {
          void openExternal(resolveSourcePaperUrl(sourcePaper));
        }}
        className="flex items-start gap-3 rounded-[12px] border border-rule bg-card p-4 text-left transition-colors hover:bg-secondary/50"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#E6F1FB] text-[#185FA5]">
          <FileTextIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[0.9375rem] font-medium leading-snug text-ink">
            {sourcePaper.title}
          </p>
          <p className="mt-1 text-[0.8125rem] text-ink-light">
            {formatSourcePaperMeta(sourcePaper)}
          </p>
        </div>
        <ExternalLinkIcon className="mt-0.5 size-4 shrink-0 text-ink-faint" />
      </button>
    </section>
  );
}

function DatasetKeywords({ keywords }: { keywords: string[] }) {
  if (!keywords.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        Keywords
      </p>
      <div className="flex flex-wrap gap-1.5">
        {keywords.map((keyword) => (
          <span
            key={keyword}
            className="inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-[3px] text-[11px] font-medium text-ink-light"
          >
            {keyword}
          </span>
        ))}
      </div>
    </section>
  );
}

function DatasetActionBar({ dataset }: { dataset: DatasetEntry }) {
  const mentionRef = useMemo(() => buildDatasetMentionRef(dataset), [dataset]);
  const navigate = useNavigate();
  const defaultThreadEnvMode = useSettings((settings) => settings.defaultThreadEnvMode);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    timeout: 2000,
    onCopy: () =>
      toastManager.add({
        type: "success",
        title: "Reference copied",
        description: `${mentionRef} is on your clipboard.`,
      }),
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: "Could not copy",
        description: error.message,
      }),
  });

  const handleUseInNewPaper = () => {
    const promptPrefix = `${mentionRef} `;
    void (async () => {
      try {
        const threadId = newThreadId();
        const draftStore = useComposerDraftStore.getState();
        draftStore.setProjectDraftThreadId(null, threadId, {
          createdAt: new Date().toISOString(),
          envMode: defaultThreadEnvMode,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: DEFAULT_INTERACTION_MODE,
        });
        draftStore.applyStickyState(threadId);
        draftStore.setPrompt(threadId, promptPrefix);
        await navigate({ to: "/$threadId", params: { threadId } });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not start a new paper",
          description: error instanceof Error ? error.message : "Unknown error.",
        });
      }
    })();
  };

  const handleOpenSource = () => {
    void openExternal(dataset.url);
  };

  const handleCopyRef = () => {
    copyToClipboard(mentionRef, undefined);
  };

  return (
    <footer className="flex items-center justify-end gap-3 border-t border-border bg-card px-6 py-3">
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleUseInNewPaper}>
          Use in new paper
        </Button>
        <Button size="sm" variant="outline" onClick={handleOpenSource}>
          <ExternalLinkIcon className="size-3.5" />
          Open source
        </Button>
        <Button size="sm" variant="outline" onClick={handleCopyRef}>
          <CopyIcon className="size-3.5" />
          {isCopied ? "Copied" : "Copy @ref"}
        </Button>
      </div>
    </footer>
  );
}

async function openExternal(url: string): Promise<void> {
  const api = readNativeApi();
  if (api?.shell?.openExternal) {
    try {
      await api.shell.openExternal(url);
      return;
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not open link",
        description: error instanceof Error ? error.message : "Open external failed.",
      });
      return;
    }
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function formatLongDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatPaperCount(count: number): string {
  const value = Math.max(0, Math.floor(count));
  return `${value} ${value === 1 ? "paper" : "papers"}`;
}

function formatSourcePaperMeta(sourcePaper: DatasetSourcePaper): string {
  const authorLabel =
    sourcePaper.authors.length === 0
      ? "Unknown author"
      : sourcePaper.authors.length > 2
        ? `${sourcePaper.authors[0]}, ${sourcePaper.authors[1]}, et al.`
        : sourcePaper.authors.join(", ");
  return `${authorLabel} · ${formatLongDate(sourcePaper.publishedAt)}`;
}
