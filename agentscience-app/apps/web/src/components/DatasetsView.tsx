import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  CopyIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FileTextIcon,
  LibraryIcon,
  SearchIcon,
  TagIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { isElectron } from "../env";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useSettings } from "../hooks/useSettings";
import {
  DATASET_AREA_KEYS,
  type DatasetAreaKey,
  type DatasetAreaMeta,
  type DatasetEntry,
  type DatasetProvider,
  type DatasetProviderSummary,
  type DatasetSourcePaper,
  type DatasetTopic,
  type DatasetTopicSummary,
  buildDatasetMentionRef,
  buildProviderMentionRef,
  fetchDatasetProviders,
  fetchDatasetRegistry,
  fetchDatasetTopics,
  resolveSourcePaperUrl,
} from "../lib/datasetRegistry";
import { cn, newThreadId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../types";
import {
  ALL_AREAS_ID,
  ALL_PROVIDERS_ID,
  ALL_TOPICS_ID,
  UNASSIGNED_PROVIDER_ID,
  buildProviderOptions,
  buildTopicOptionsForArea,
  countByArea,
  countDatasetsByProvider,
  deriveRightPaneState,
  filterDatasets,
  type AreaFilter,
  type ProviderFilter,
  type ProviderOption,
  type RightPaneState,
  type TopicFilter,
} from "./DatasetsView.logic";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./ui/resizable";
import { SidebarInset, SidebarTrigger } from "./ui/sidebar";
import { MacTitlebarDragRow } from "./MacTitlebarDragRow";
import { SidebarReopenTrigger } from "./SidebarReopenTrigger";
import { toastManager } from "./ui/toast";

const DATASET_REGISTRY_QUERY_KEY = ["dataset-registry"] as const;
const DATASET_PROVIDERS_QUERY_KEY = ["dataset-providers"] as const;
const DATASET_TOPICS_QUERY_KEY = ["dataset-topics"] as const;
const EMPTY_DATASETS: DatasetEntry[] = [];
const EMPTY_PROVIDERS: DatasetProvider[] = [];
const EMPTY_TOPICS: DatasetTopic[] = [];

// Fallback labels for areas in case the topics endpoint hasn't responded yet.
// Mirrors DATASET_AREA_META on the backend.
const AREA_FALLBACK_LABELS: Record<DatasetAreaKey, string> = {
  LIFE_SCIENCES: "Life Sciences",
  MEDICINE_HEALTH: "Medicine & Health",
  SOCIAL_SCIENCES: "Social Sciences",
  PHYSICAL_SCIENCES: "Physical Sciences",
  EARTH_ENVIRONMENT: "Earth & Environment",
  COMPUTING_ENGINEERING: "Computing & Engineering",
  MATH_STATISTICS: "Math & Statistics",
  HUMANITIES: "Humanities",
  OTHER: "Other",
};

export function DatasetsView() {
  const datasetsQuery = useQuery({
    queryKey: DATASET_REGISTRY_QUERY_KEY,
    queryFn: ({ signal }) => fetchDatasetRegistry({ signal, limit: 500 }),
    retry: false,
    staleTime: 30_000,
  });
  const providersQuery = useQuery({
    queryKey: DATASET_PROVIDERS_QUERY_KEY,
    queryFn: ({ signal }) => fetchDatasetProviders({ signal, limit: 200 }),
    retry: false,
    staleTime: 30_000,
  });
  const topicsQuery = useQuery({
    queryKey: DATASET_TOPICS_QUERY_KEY,
    queryFn: ({ signal }) => fetchDatasetTopics({ signal, limit: 500 }),
    retry: false,
    staleTime: 30_000,
  });

  const datasets = datasetsQuery.data ?? EMPTY_DATASETS;
  const providers = providersQuery.data ?? EMPTY_PROVIDERS;
  const topics = topicsQuery.data?.topics ?? EMPTY_TOPICS;
  const areasMeta = useMemo<DatasetAreaMeta[]>(() => {
    const fromApi = topicsQuery.data?.areas;
    if (fromApi && fromApi.length > 0) return fromApi;
    return DATASET_AREA_KEYS.map((key) => ({
      key,
      name: AREA_FALLBACK_LABELS[key],
      description: "",
    }));
  }, [topicsQuery.data?.areas]);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeArea, setActiveArea] = useState<AreaFilter>(ALL_AREAS_ID);
  const [activeTopicSlug, setActiveTopicSlug] = useState<TopicFilter>(ALL_TOPICS_ID);
  const [activeProviderId, setActiveProviderId] = useState<ProviderFilter>(
    ALL_PROVIDERS_ID,
  );
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);

  const providerById = useMemo(() => {
    const map = new Map<string, DatasetProvider>();
    for (const provider of providers) {
      map.set(provider.id, provider);
    }
    return map;
  }, [providers]);

  const topicBySlug = useMemo(() => {
    const map = new Map<string, DatasetTopic>();
    for (const topic of topics) {
      map.set(topic.slug, topic);
    }
    return map;
  }, [topics]);

  const datasetCountsByProviderId = useMemo(
    () => countDatasetsByProvider(datasets),
    [datasets],
  );

  const areaCounts = useMemo(
    () => countByArea(providers, datasets),
    [providers, datasets],
  );

  const activeAreaMeta = useMemo(() => {
    if (activeArea === ALL_AREAS_ID) return null;
    return areasMeta.find((meta) => meta.key === activeArea) ?? null;
  }, [areasMeta, activeArea]);

  const visibleTopics = useMemo(
    () => buildTopicOptionsForArea(topics, activeArea),
    [topics, activeArea],
  );

  const providerOptions = useMemo(
    () =>
      buildProviderOptions(providers, datasetCountsByProviderId, {
        activeArea,
        activeTopicSlug,
      }),
    [providers, datasetCountsByProviderId, activeArea, activeTopicSlug],
  );

  const filteredDatasets = useMemo(
    () =>
      filterDatasets(datasets, {
        activeArea,
        activeTopicSlug,
        activeProviderId,
        searchQuery,
      }),
    [datasets, searchQuery, activeArea, activeTopicSlug, activeProviderId],
  );

  useEffect(() => {
    if (!selectedDatasetId) return;
    const stillVisible = filteredDatasets.some(
      (dataset) => dataset.id === selectedDatasetId,
    );
    if (!stillVisible) {
      setSelectedDatasetId(null);
    }
  }, [filteredDatasets, selectedDatasetId]);

  // Clamp filters down when a parent filter drops an invalid child out of view.
  useEffect(() => {
    if (activeTopicSlug === ALL_TOPICS_ID) return;
    const topic = topicBySlug.get(activeTopicSlug);
    if (!topic) return;
    if (activeArea !== ALL_AREAS_ID && topic.area !== activeArea) {
      setActiveTopicSlug(ALL_TOPICS_ID);
    }
  }, [activeArea, activeTopicSlug, topicBySlug]);

  useEffect(() => {
    if (
      activeProviderId === ALL_PROVIDERS_ID ||
      activeProviderId === UNASSIGNED_PROVIDER_ID
    ) {
      return;
    }
    const stillMatches = providerOptions.some(
      ({ provider }) => provider.id === activeProviderId,
    );
    if (!stillMatches) {
      setActiveProviderId(ALL_PROVIDERS_ID);
    }
  }, [providerOptions, activeProviderId]);

  const handleSelectArea = useCallback((next: AreaFilter) => {
    setActiveArea(next);
    setActiveTopicSlug(ALL_TOPICS_ID);
    setActiveProviderId(ALL_PROVIDERS_ID);
    setSelectedDatasetId(null);
  }, []);

  const handleSelectTopic = useCallback(
    (next: TopicFilter) => {
      setActiveTopicSlug(next);
      setActiveProviderId(ALL_PROVIDERS_ID);
      setSelectedDatasetId(null);
      if (next !== ALL_TOPICS_ID) {
        const topic = topicBySlug.get(next);
        if (topic && (activeArea === ALL_AREAS_ID || activeArea !== topic.area)) {
          setActiveArea(topic.area);
        }
      }
    },
    [activeArea, topicBySlug],
  );

  const handleSelectProvider = useCallback((providerId: ProviderFilter) => {
    setActiveProviderId(providerId);
    setSelectedDatasetId(null);
  }, []);

  const handleOpenProviderForDataset = useCallback(
    (provider: DatasetProviderSummary) => {
      setActiveProviderId(provider.id);
      setSelectedDatasetId(null);
    },
    [],
  );

  const handleOpenTopicFromChip = useCallback(
    (topic: DatasetTopicSummary) => {
      const hydrated = topicBySlug.get(topic.slug);
      setActiveArea(topic.area);
      setActiveTopicSlug(topic.slug);
      setActiveProviderId(ALL_PROVIDERS_ID);
      setSelectedDatasetId(null);
      void hydrated;
    },
    [topicBySlug],
  );

  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedDatasetId) ?? null,
    [datasets, selectedDatasetId],
  );

  const rightPaneState = useMemo(
    () =>
      deriveRightPaneState({
        selectedDataset,
        activeProviderId,
        activeTopicSlug,
        providerById,
        topicBySlug,
        unassignedCount: datasetCountsByProviderId.unassigned,
      }),
    [
      selectedDataset,
      activeProviderId,
      activeTopicSlug,
      providerById,
      topicBySlug,
      datasetCountsByProviderId.unassigned,
    ],
  );

  const isLoading =
    datasetsQuery.isLoading || providersQuery.isLoading || topicsQuery.isLoading;
  const errorMessage =
    datasetsQuery.error instanceof Error
      ? datasetsQuery.error.message
      : datasetsQuery.error
        ? "Could not load the dataset registry."
        : providersQuery.error instanceof Error
          ? providersQuery.error.message
          : providersQuery.error
            ? "Could not load dataset providers."
            : topicsQuery.error instanceof Error
              ? topicsQuery.error.message
              : topicsQuery.error
                ? "Could not load the dataset taxonomy."
                : null;

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
          <>
            <MacTitlebarDragRow />
            <div className="drag-region flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-6">
              <SidebarReopenTrigger />
              <span className="font-display text-[1.0625rem] text-ink">Datasets</span>
            </div>
          </>
        )}

        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="datasets-view-layout"
          className="flex min-h-0 flex-1"
        >
          <ResizablePanel
            defaultSize={34}
            minSize={22}
            maxSize={55}
            className="bg-card"
          >
            <DatasetSidebar
              datasets={filteredDatasets}
              totalCount={datasets.length}
              isLoading={isLoading}
              errorMessage={errorMessage}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              areas={areasMeta}
              areaCounts={areaCounts}
              activeArea={activeArea}
              activeAreaMeta={activeAreaMeta}
              onSelectArea={handleSelectArea}
              topicOptions={visibleTopics}
              activeTopicSlug={activeTopicSlug}
              onSelectTopic={handleSelectTopic}
              providerOptions={providerOptions}
              unassignedCount={datasetCountsByProviderId.unassigned}
              activeProviderId={activeProviderId}
              onActiveProviderChange={handleSelectProvider}
              selectedDatasetId={selectedDatasetId}
              onSelectDataset={setSelectedDatasetId}
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={66} minSize={35}>
            <RightPane
              state={rightPaneState}
              onOpenProvider={handleOpenProviderForDataset}
              onOpenTopic={handleOpenTopicFromChip}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </SidebarInset>
  );
}

function RightPane({
  state,
  onOpenProvider,
  onOpenTopic,
}: {
  state: RightPaneState;
  onOpenProvider: (provider: DatasetProviderSummary) => void;
  onOpenTopic: (topic: DatasetTopicSummary) => void;
}) {
  if (state.kind === "dataset") {
    return (
      <DatasetDetailBody
        dataset={state.dataset}
        onOpenProvider={onOpenProvider}
        onOpenTopic={onOpenTopic}
      />
    );
  }
  if (state.kind === "provider") {
    return <ProviderDetailBody provider={state.provider} onOpenTopic={onOpenTopic} />;
  }
  if (state.kind === "topic") {
    return <TopicDetailBody topic={state.topic} />;
  }
  if (state.kind === "unassigned") {
    return <UnassignedEmptyState count={state.count} />;
  }
  return <DefaultEmptyState />;
}

function DefaultEmptyState() {
  return (
    <section className="flex h-full flex-1 items-center justify-center px-8 py-10">
      <div className="max-w-[420px] text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-lg bg-secondary text-ink-light">
          <DatabaseIcon className="size-5" />
        </div>
        <p className="mt-4 font-display text-[1.25rem] text-ink">
          Pick a field or a dataset
        </p>
        <p className="mt-2 text-[0.8125rem] text-ink-light">
          Browse the field you care about, then pick a dataset to see how to cite
          it from a new paper.
        </p>
      </div>
    </section>
  );
}

function UnassignedEmptyState({ count }: { count: number }) {
  return (
    <section className="flex h-full flex-1 items-center justify-center px-8 py-10">
      <div className="max-w-[420px] text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-lg bg-secondary text-ink-light">
          <DatabaseIcon className="size-5" />
        </div>
        <p className="mt-4 font-display text-[1.25rem] text-ink">
          {count} {count === 1 ? "dataset" : "datasets"} without a provider
        </p>
        <p className="mt-2 text-[0.8125rem] text-ink-light">
          These rows aren't linked to a known compendium yet. Submit them again with a
          providerSlug, or they'll auto-link to a stub provider by domain.
        </p>
      </div>
    </section>
  );
}

interface DatasetSidebarProps {
  datasets: DatasetEntry[];
  totalCount: number;
  isLoading: boolean;
  errorMessage: string | null;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  areas: DatasetAreaMeta[];
  areaCounts: {
    providerByArea: Map<DatasetAreaKey, Set<string>>;
    datasetByArea: Map<DatasetAreaKey, Set<string>>;
  };
  activeArea: AreaFilter;
  activeAreaMeta: DatasetAreaMeta | null;
  onSelectArea: (next: AreaFilter) => void;
  topicOptions: DatasetTopic[];
  activeTopicSlug: TopicFilter;
  onSelectTopic: (next: TopicFilter) => void;
  providerOptions: ProviderOption[];
  unassignedCount: number;
  activeProviderId: ProviderFilter;
  onActiveProviderChange: (value: ProviderFilter) => void;
  selectedDatasetId: string | null;
  onSelectDataset: (id: string) => void;
}

/**
 * Sidebar has two display modes driven by `activeArea`:
 *   1. Overview — compact search + vertical list of 9 areas. No topic or
 *      source chips, because showing them across every area produces the
 *      "three filter layers at once" clutter we're explicitly designing
 *      away from.
 *   2. Drilldown — "All fields" back link, area title, topic + source
 *      chip rows scoped to the area, then the dataset list.
 *
 * This is the progressive-disclosure structure the design mockups call for.
 */
function DatasetSidebar({
  datasets,
  totalCount,
  isLoading,
  errorMessage,
  searchQuery,
  onSearchQueryChange,
  areas,
  areaCounts,
  activeArea,
  activeAreaMeta,
  onSelectArea,
  topicOptions,
  activeTopicSlug,
  onSelectTopic,
  providerOptions,
  unassignedCount,
  activeProviderId,
  onActiveProviderChange,
  selectedDatasetId,
  onSelectDataset,
}: DatasetSidebarProps) {
  const inOverview = activeArea === ALL_AREAS_ID;
  const displayCount = datasets.length;

  return (
    <aside className="flex h-full w-full min-w-0 flex-1 flex-col">
      <div className="flex flex-col gap-4 border-b border-border px-4 py-4">
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
            placeholder={
              inOverview
                ? 'Search datasets e.g. "pediatric cancer"'
                : `Search within ${activeAreaMeta?.name ?? "this field"}`
            }
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            className="pl-8"
          />
        </div>

        {inOverview ? (
          <AreaList
            areas={areas}
            areaCounts={areaCounts}
            onSelect={(key) => onSelectArea(key)}
          />
        ) : (
          <AreaDrilldownHeader
            area={activeAreaMeta}
            onClear={() => onSelectArea(ALL_AREAS_ID)}
            topicOptions={topicOptions}
            activeTopicSlug={activeTopicSlug}
            onSelectTopic={onSelectTopic}
            providerOptions={providerOptions}
            unassignedCount={unassignedCount}
            activeProviderId={activeProviderId}
            onSelectProvider={onActiveProviderChange}
          />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {errorMessage ? (
          <div className="px-4 py-6 text-[0.8125rem] text-ink-light">{errorMessage}</div>
        ) : isLoading ? (
          <div className="px-4 py-6 text-[0.8125rem] text-ink-light">
            Loading datasets…
          </div>
        ) : datasets.length === 0 ? (
          <EmptyListState
            totalCount={totalCount}
            hasQuery={searchQuery.trim().length > 0}
            activeAreaMeta={activeAreaMeta}
            onClearArea={() => onSelectArea(ALL_AREAS_ID)}
          />
        ) : (
          <ul>
            {!inOverview ? (
              <li>
                <DatasetListHeading
                  count={displayCount}
                  areaName={activeAreaMeta?.name ?? null}
                />
              </li>
            ) : (
              <li>
                <DatasetListHeading count={displayCount} areaName={null} />
              </li>
            )}
            {datasets.map((dataset) => (
              <li key={dataset.id}>
                <DatasetListRow
                  dataset={dataset}
                  isActive={dataset.id === selectedDatasetId}
                  mode={inOverview ? "overview" : "area"}
                  onSelect={onSelectDataset}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function DatasetListHeading({
  count,
  areaName,
}: {
  count: number;
  areaName: string | null;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-border/60 px-4 py-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        {areaName ? "Datasets" : "Recent datasets"}
      </span>
      <span className="text-[11px] text-ink-faint tabular-nums">
        {count} {count === 1 ? "dataset" : "datasets"}
      </span>
    </div>
  );
}

function AreaList({
  areas,
  areaCounts,
  onSelect,
}: {
  areas: DatasetAreaMeta[];
  areaCounts: {
    providerByArea: Map<DatasetAreaKey, Set<string>>;
    datasetByArea: Map<DatasetAreaKey, Set<string>>;
  };
  onSelect: (key: DatasetAreaKey) => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between pb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Browse by field
        </span>
        <span className="text-[11px] text-ink-faint">Pick one</span>
      </div>
      <div className="flex flex-col divide-y divide-border/60 rounded-md border border-border/70 bg-background/60">
        {areas.map((area) => {
          // Headline the count by DATASETS the user can actually browse —
          // not providers. Seeded providers without datasets used to read
          // as "4 providers" and then click into an empty list, which was
          // confusing. Empty areas are dimmed so the signal is obvious.
          const datasetCount = areaCounts.datasetByArea.get(area.key)?.size ?? 0;
          const empty = datasetCount === 0;
          return (
            <button
              key={area.key}
              type="button"
              onClick={() => onSelect(area.key)}
              className={cn(
                "flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary/60",
                empty && "opacity-55",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                {area.name}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                {empty
                  ? "Empty"
                  : `${datasetCount} ${datasetCount === 1 ? "dataset" : "datasets"}`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AreaDrilldownHeader({
  area,
  onClear,
  topicOptions,
  activeTopicSlug,
  onSelectTopic,
  providerOptions,
  unassignedCount,
  activeProviderId,
  onSelectProvider,
}: {
  area: DatasetAreaMeta | null;
  onClear: () => void;
  topicOptions: DatasetTopic[];
  activeTopicSlug: TopicFilter;
  onSelectTopic: (slug: TopicFilter) => void;
  providerOptions: ProviderOption[];
  unassignedCount: number;
  activeProviderId: ProviderFilter;
  onSelectProvider: (value: ProviderFilter) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onClear}
        className="inline-flex w-fit items-center gap-1 text-[11px] text-ink-light transition-colors hover:text-ink"
      >
        <ArrowLeftIcon className="size-3" />
        <span>All fields</span>
      </button>
      <div>
        <p className="font-display text-[1.0625rem] leading-tight text-ink">
          {area?.name ?? ""}
        </p>
        {area?.description ? (
          <p className="mt-0.5 text-[11px] leading-snug text-ink-light [text-wrap:pretty]">
            {area.description}
          </p>
        ) : null}
      </div>
      {topicOptions.length > 0 ? (
        <FilterRow
          label="Topic"
          icon={<TagIcon className="size-3" />}
          options={[
            {
              key: ALL_TOPICS_ID,
              label: "All",
              count: topicOptions.length,
              active: activeTopicSlug === ALL_TOPICS_ID,
              dim: false,
              onClick: () => onSelectTopic(ALL_TOPICS_ID),
            },
            ...topicOptions.map((topic) => ({
              key: topic.slug,
              label: topic.name,
              count: topic.datasetCount,
              active: activeTopicSlug === topic.slug,
              dim: topic.datasetCount === 0,
              onClick: () => onSelectTopic(topic.slug),
            })),
          ]}
        />
      ) : null}
      {providerOptions.length > 0 || unassignedCount > 0 ? (
        <FilterRow
          label="Source"
          icon={<LibraryIcon className="size-3" />}
          options={[
            {
              key: ALL_PROVIDERS_ID,
              label: "All",
              count: providerOptions.reduce(
                (sum, option) => sum + option.liveCount,
                0,
              ),
              active: activeProviderId === ALL_PROVIDERS_ID,
              dim: false,
              onClick: () => onSelectProvider(ALL_PROVIDERS_ID),
            },
            ...providerOptions.map(({ provider, liveCount }) => ({
              key: provider.id,
              label: provider.name,
              count: liveCount,
              active: activeProviderId === provider.id,
              dim: liveCount === 0,
              onClick: () => onSelectProvider(provider.id),
            })),
            ...(unassignedCount > 0
              ? [
                  {
                    key: UNASSIGNED_PROVIDER_ID,
                    label: "Unassigned",
                    count: unassignedCount,
                    active: activeProviderId === UNASSIGNED_PROVIDER_ID,
                    dim: false,
                    onClick: () => onSelectProvider(UNASSIGNED_PROVIDER_ID),
                  },
                ]
              : []),
          ]}
        />
      ) : null}
    </div>
  );
}

interface FilterOption {
  key: string;
  label: string;
  count: number;
  active: boolean;
  dim: boolean;
  onClick: () => void;
}

function FilterRow({
  label,
  icon,
  options,
}: {
  label: string;
  icon: React.ReactNode;
  options: FilterOption[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        {icon}
        <span>{label}</span>
      </div>
      <div className="-mx-1 flex max-h-[84px] flex-wrap gap-1 overflow-y-auto px-1 pb-0.5">
        {options.map((option) => (
          <FilterPill key={option.key} option={option} />
        ))}
      </div>
    </div>
  );
}

function FilterPill({ option }: { option: FilterOption }) {
  return (
    <button
      type="button"
      onClick={option.onClick}
      aria-pressed={option.active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[11px] font-medium transition-colors",
        option.active
          ? "border-ink bg-ink text-snow-white"
          : "border-border bg-transparent text-ink-light hover:bg-secondary",
        !option.active && option.dim && "opacity-55",
      )}
    >
      <span>{option.label}</span>
      <span
        className={cn(
          "text-[10px] tabular-nums",
          option.active ? "text-snow-white/70" : "text-ink-faint",
        )}
      >
        {option.count}
      </span>
    </button>
  );
}

function EmptyListState({
  totalCount,
  hasQuery,
  activeAreaMeta,
  onClearArea,
}: {
  totalCount: number;
  hasQuery: boolean;
  activeAreaMeta: DatasetAreaMeta | null;
  onClearArea: () => void;
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
  if (activeAreaMeta) {
    return (
      <div className="flex h-full flex-col items-start gap-3 px-4 py-6 text-[0.8125rem] text-ink-light">
        <p className="font-medium text-ink">
          {hasQuery
            ? `Nothing in ${activeAreaMeta.name} matches that search yet.`
            : `No datasets catalogued in ${activeAreaMeta.name} yet.`}
        </p>
        <button
          type="button"
          onClick={onClearArea}
          className="inline-flex items-center gap-1 rounded-sm border border-border px-2.5 py-1 text-[11px] text-ink transition-colors hover:border-ink"
        >
          <ArrowLeftIcon className="size-3" />
          Browse all fields
        </button>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-start gap-2 px-4 py-6 text-[0.8125rem] text-ink-light">
      <p className="font-medium text-ink">No matches.</p>
      <p>
        {hasQuery
          ? "Try broader search terms or clear the active filter."
          : "No datasets match the active filters. Clear them to see everything."}
      </p>
    </div>
  );
}

interface DatasetListRowProps {
  dataset: DatasetEntry;
  isActive: boolean;
  mode: "overview" | "area";
  onSelect: (id: string) => void;
}

function DatasetListRow({ dataset, isActive, mode, onSelect }: DatasetListRowProps) {
  const providerLabel = dataset.provider?.name ?? dataset.domain;
  // In the overview view we lead with the broadest area tag so the field is
  // visible at a glance. Inside an area the rows all share that area, so we
  // surface the first topic instead (the next level of specificity).
  const primaryTag =
    mode === "overview"
      ? dataset.topics[0]?.area.replaceAll("_", " ").toLowerCase() ?? null
      : dataset.topics[0]?.name ?? null;
  const formattedPrimaryTag = primaryTag
    ? primaryTag.replace(/\b\w/g, (char) => char.toUpperCase())
    : null;

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
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-light">
        {formattedPrimaryTag ? (
          <span className="inline-flex items-center rounded-full border border-border/70 px-2 py-[1px] text-[10px] text-ink">
            {formattedPrimaryTag}
          </span>
        ) : null}
        {providerLabel ? <span>{providerLabel}</span> : null}
      </div>
    </button>
  );
}

function DatasetDetailBody({
  dataset,
  onOpenProvider,
  onOpenTopic,
}: {
  dataset: DatasetEntry;
  onOpenProvider: (provider: DatasetProviderSummary) => void;
  onOpenTopic: (topic: DatasetTopicSummary) => void;
}) {
  return (
    <section className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[720px] flex-col gap-7 px-8 py-8">
          <DatasetHeader dataset={dataset} />
          <DatasetDescription description={dataset.description} />
          <DatasetMetadataGrid
            provider={dataset.provider}
            domain={dataset.domain}
            createdAt={dataset.createdAt}
            usedInPaperCount={dataset.usedInPaperCount}
            onOpenProvider={onOpenProvider}
          />
          <DatasetTopics topics={dataset.topics} onOpenTopic={onOpenTopic} />
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
      <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-ink-light">
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
  provider,
  domain,
  createdAt,
  usedInPaperCount,
  onOpenProvider,
}: {
  provider: DatasetProviderSummary | null;
  domain: string;
  createdAt: string;
  usedInPaperCount: number;
  onOpenProvider: (provider: DatasetProviderSummary) => void;
}) {
  return (
    <section className="grid grid-cols-1 gap-3 rounded-[12px] border border-rule bg-card p-4 sm:grid-cols-3">
      <MetadataCell label="Provider">
        {provider ? (
          <button
            type="button"
            onClick={() => onOpenProvider(provider)}
            className="inline-flex items-center gap-1.5 text-[0.875rem] text-ink hover:text-accent-color"
          >
            <LibraryIcon className="size-3.5 text-ink-light" />
            <span className="underline decoration-dotted underline-offset-[3px]">
              {provider.name}
            </span>
          </button>
        ) : (
          <span className="text-[0.875rem] text-ink-light">
            {domain || "—"}
          </span>
        )}
      </MetadataCell>
      <MetadataCell label="Added">
        <span className="text-[0.875rem] text-ink">{formatLongDate(createdAt)}</span>
      </MetadataCell>
      <MetadataCell label="Used in papers">
        <span className="text-[0.875rem] text-ink">{formatPaperCount(usedInPaperCount)}</span>
      </MetadataCell>
    </section>
  );
}

function MetadataCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        {label}
      </span>
      {children}
    </div>
  );
}

function DatasetTopics({
  topics,
  onOpenTopic,
}: {
  topics: DatasetTopicSummary[];
  onOpenTopic: (topic: DatasetTopicSummary) => void;
}) {
  if (topics.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        Topics
      </p>
      <div className="flex flex-wrap gap-1.5">
        {topics.map((topic) => (
          <button
            key={topic.id}
            type="button"
            onClick={() => onOpenTopic(topic)}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-transparent px-2.5 py-[3px] text-[11px] font-medium text-ink-light transition-colors hover:border-ink hover:text-ink"
            title={`Filter by ${topic.name} (${topic.area.replaceAll("_", " ").toLowerCase()})`}
          >
            <TagIcon className="size-3" />
            {topic.name}
          </button>
        ))}
      </div>
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
        <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-border bg-secondary text-ink-light">
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

function ProviderDetailBody({
  provider,
  onOpenTopic,
}: {
  provider: DatasetProvider;
  onOpenTopic: (topic: DatasetTopicSummary) => void;
}) {
  return (
    <section className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[720px] flex-col gap-7 px-8 py-8">
          <ProviderHeader provider={provider} />
          <ProviderDescription description={provider.description} />
          <ProviderMetadataGrid provider={provider} />
          <DatasetTopics topics={provider.topics} onOpenTopic={onOpenTopic} />
          <ProviderSearchRecipe provider={provider} />
        </div>
      </div>
      <ProviderActionBar provider={provider} />
    </section>
  );
}

function ProviderHeader({ provider }: { provider: DatasetProvider }) {
  return (
    <header className="flex items-start gap-4">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-ink-light">
        <LibraryIcon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-[1.5rem] leading-[1.2] text-ink sm:text-[1.625rem]">
          {provider.name}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.8125rem] text-ink-light">
          <a
            href={provider.homeUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-accent-color hover:underline"
            onClick={(event) => {
              event.preventDefault();
              void openExternal(provider.homeUrl);
            }}
          >
            <span className="truncate max-w-[360px]">{provider.domain}</span>
            <ExternalLinkIcon className="size-3.5" />
          </a>
          {provider.searchKind ? (
            <span className="inline-flex items-center rounded-full border border-border px-2 py-[2px] text-[11px] font-medium text-ink-light">
              Searchable via {provider.searchKind}
            </span>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function ProviderDescription({ description }: { description: string }) {
  if (!description) return null;
  return (
    <section className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        About
      </p>
      <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-ink">
        {description}
      </p>
    </section>
  );
}

function ProviderMetadataGrid({ provider }: { provider: DatasetProvider }) {
  const entries: Array<{ label: string; value: string }> = [
    { label: "Domain", value: provider.domain || "—" },
    { label: "Type", value: provider.searchKind ?? "Browse only" },
    { label: "Datasets", value: String(provider.datasetCount) },
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

function ProviderSearchRecipe({ provider }: { provider: DatasetProvider }) {
  const hasAny =
    provider.searchKind ||
    provider.searchEndpoint ||
    provider.searchQueryTemplate ||
    provider.datasetUrlTemplate ||
    provider.agentInstructions;

  if (!hasAny) {
    return (
      <section className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Agent search recipe
        </p>
        <p className="text-[0.8125rem] text-ink-light">
          No programmatic search recipe is registered for this provider yet. Agents can
          still cite specific datasets from it but cannot search inside it.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        Agent search recipe
      </p>
      <div className="flex flex-col gap-3 rounded-[12px] border border-rule bg-card p-4">
        {provider.searchEndpoint ? (
          <RecipeField label="Endpoint" value={provider.searchEndpoint} mono />
        ) : null}
        {provider.searchQueryTemplate ? (
          <RecipeField
            label="Query template"
            value={provider.searchQueryTemplate}
            mono
            multiline
          />
        ) : null}
        {provider.datasetUrlTemplate ? (
          <RecipeField
            label="Dataset URL template"
            value={provider.datasetUrlTemplate}
            mono
          />
        ) : null}
        {provider.agentInstructions ? (
          <RecipeField label="Instructions" value={provider.agentInstructions} />
        ) : null}
      </div>
    </section>
  );
}

function RecipeField({
  label,
  value,
  mono,
  multiline,
}: {
  label: string;
  value: string;
  mono?: boolean;
  multiline?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        {label}
      </span>
      <span
        className={cn(
          "text-[0.8125rem] leading-relaxed text-ink",
          mono && "font-mono text-[0.8125rem]",
          multiline && "whitespace-pre-wrap",
          !multiline && mono && "[overflow-wrap:anywhere]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function ProviderActionBar({ provider }: { provider: DatasetProvider }) {
  const mentionRef = useMemo(() => buildProviderMentionRef(provider), [provider]);
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

  const handleOpenSite = () => {
    void openExternal(provider.homeUrl);
  };

  const handleCopyRef = () => {
    copyToClipboard(mentionRef, undefined);
  };

  return (
    <footer className="flex items-center justify-end gap-3 border-t border-border bg-card px-6 py-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={handleOpenSite}>
          <ExternalLinkIcon className="size-3.5" />
          Open site
        </Button>
        <Button size="sm" variant="outline" onClick={handleCopyRef}>
          <CopyIcon className="size-3.5" />
          {isCopied ? "Copied" : "Copy @ref"}
        </Button>
      </div>
    </footer>
  );
}

function TopicDetailBody({ topic }: { topic: DatasetTopic }) {
  const humanArea = topic.area
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
  return (
    <section className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[720px] flex-col gap-7 px-8 py-8">
          <header className="flex items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-ink-light">
              <TagIcon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[1.5rem] leading-[1.2] text-ink sm:text-[1.625rem]">
                {topic.name}
              </h1>
              <p className="mt-1 text-[0.8125rem] text-ink-light">
                {humanArea} · {topic.providerCount}{" "}
                {topic.providerCount === 1 ? "provider" : "providers"} ·{" "}
                {topic.datasetCount} {topic.datasetCount === 1 ? "dataset" : "datasets"}
              </p>
            </div>
          </header>
          {topic.description ? (
            <section className="flex flex-col gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                About
              </p>
              <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-ink">
                {topic.description}
              </p>
            </section>
          ) : null}
          {topic.agentInstructions ? (
            <section className="flex flex-col gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                Instructions for agents
              </p>
              <div className="rounded-[12px] border border-rule bg-card p-4">
                <p className="whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-ink">
                  {topic.agentInstructions}
                </p>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </section>
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
