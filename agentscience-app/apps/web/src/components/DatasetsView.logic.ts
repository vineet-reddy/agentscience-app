import type {
  DatasetAreaKey,
  DatasetEntry,
  DatasetProvider,
  DatasetTopic,
} from "../lib/datasetRegistry";

export const ALL_PROVIDERS_ID = "__all__" as const;
export const UNASSIGNED_PROVIDER_ID = "__unassigned__" as const;
export const ALL_AREAS_ID = "__all_areas__" as const;
export const ALL_TOPICS_ID = "__all_topics__" as const;

export type ProviderFilter =
  | typeof ALL_PROVIDERS_ID
  | typeof UNASSIGNED_PROVIDER_ID
  | string;

export type AreaFilter = typeof ALL_AREAS_ID | DatasetAreaKey;
export type TopicFilter = typeof ALL_TOPICS_ID | string;

export interface ProviderOption {
  provider: DatasetProvider;
  liveCount: number;
}

export interface DatasetCounts {
  byId: Map<string, number>;
  unassigned: number;
}

export interface AreaCounts {
  providerByArea: Map<DatasetAreaKey, Set<string>>;
  datasetByArea: Map<DatasetAreaKey, Set<string>>;
}

export function countDatasetsByProvider(datasets: DatasetEntry[]): DatasetCounts {
  const byId = new Map<string, number>();
  let unassigned = 0;
  for (const dataset of datasets) {
    if (dataset.provider) {
      byId.set(dataset.provider.id, (byId.get(dataset.provider.id) ?? 0) + 1);
    } else {
      unassigned += 1;
    }
  }
  return { byId, unassigned };
}

/**
 * Walk providers + datasets to tally how many unique items wear each area.
 * "Unique" matters because a single provider can sit inside multiple areas
 * (via multi-tagged topics) — we don't want to double-count it.
 */
export function countByArea(
  providers: DatasetProvider[],
  datasets: DatasetEntry[],
): AreaCounts {
  const providerByArea = new Map<DatasetAreaKey, Set<string>>();
  const datasetByArea = new Map<DatasetAreaKey, Set<string>>();
  for (const provider of providers) {
    for (const topic of provider.topics) {
      const bucket = providerByArea.get(topic.area) ?? new Set<string>();
      bucket.add(provider.id);
      providerByArea.set(topic.area, bucket);
    }
  }
  for (const dataset of datasets) {
    for (const topic of dataset.topics) {
      const bucket = datasetByArea.get(topic.area) ?? new Set<string>();
      bucket.add(dataset.id);
      datasetByArea.set(topic.area, bucket);
    }
  }
  return { providerByArea, datasetByArea };
}

/**
 * Topics scoped to the active area (or all of them), filtered to those that
 * actually have a live provider or dataset behind them. Sorted by
 * providerCount desc then name.
 */
export function buildTopicOptionsForArea(
  topics: DatasetTopic[],
  activeArea: AreaFilter,
): DatasetTopic[] {
  const scoped = activeArea === ALL_AREAS_ID ? topics : topics.filter((t) => t.area === activeArea);
  return scoped
    .filter((topic) => topic.providerCount > 0 || topic.datasetCount > 0)
    .sort((a, b) => {
      if (b.providerCount !== a.providerCount) return b.providerCount - a.providerCount;
      return a.name.localeCompare(b.name);
    });
}

/**
 * Provider options for the filter pill row. Scoped to the active area/topic.
 * Only providers that either have at least one dataset currently in the
 * registry (`liveCount > 0`) or have a declared `datasetCount > 0` upstream
 * are shown. Sorted by liveCount desc then name.
 */
export function buildProviderOptions(
  providers: DatasetProvider[],
  counts: DatasetCounts,
  filters?: { activeArea?: AreaFilter; activeTopicSlug?: TopicFilter },
): ProviderOption[] {
  const activeArea = filters?.activeArea ?? ALL_AREAS_ID;
  const activeTopicSlug = filters?.activeTopicSlug ?? ALL_TOPICS_ID;
  return providers
    .filter((provider) => {
      if (activeArea !== ALL_AREAS_ID) {
        if (!provider.topics.some((topic) => topic.area === activeArea)) return false;
      }
      if (activeTopicSlug !== ALL_TOPICS_ID) {
        if (!provider.topics.some((topic) => topic.slug === activeTopicSlug)) return false;
      }
      return true;
    })
    .map((provider) => ({
      provider,
      liveCount: counts.byId.get(provider.id) ?? 0,
    }))
    .filter(
      ({ liveCount, provider }) => liveCount > 0 || provider.datasetCount > 0,
    )
    .sort((a, b) => {
      if (b.liveCount !== a.liveCount) return b.liveCount - a.liveCount;
      return a.provider.name.localeCompare(b.provider.name);
    });
}

export function filterDatasets(
  datasets: DatasetEntry[],
  options: {
    activeArea: AreaFilter;
    activeTopicSlug: TopicFilter;
    activeProviderId: ProviderFilter;
    searchQuery: string;
  },
): DatasetEntry[] {
  const normalizedQuery = options.searchQuery.trim().toLowerCase();
  return datasets.filter((dataset) => {
    if (options.activeArea !== ALL_AREAS_ID) {
      if (!dataset.topics.some((topic) => topic.area === options.activeArea)) {
        return false;
      }
    }
    if (options.activeTopicSlug !== ALL_TOPICS_ID) {
      if (!dataset.topics.some((topic) => topic.slug === options.activeTopicSlug)) {
        return false;
      }
    }
    if (options.activeProviderId === UNASSIGNED_PROVIDER_ID && dataset.provider) {
      return false;
    }
    if (
      options.activeProviderId !== ALL_PROVIDERS_ID &&
      options.activeProviderId !== UNASSIGNED_PROVIDER_ID &&
      dataset.provider?.id !== options.activeProviderId
    ) {
      return false;
    }
    if (!normalizedQuery) return true;
    const hayStack = [
      dataset.name,
      dataset.description,
      dataset.domain,
      dataset.provider?.name ?? "",
      dataset.sourcePaper?.title ?? "",
      ...(dataset.sourcePaper?.authors ?? []),
      ...dataset.keywords,
      ...dataset.topics.map((topic) => topic.name),
      ...dataset.topics.map((topic) => topic.slug),
    ]
      .join(" \n ")
      .toLowerCase();
    return hayStack.includes(normalizedQuery);
  });
}

export type RightPaneState =
  | { kind: "empty" }
  | { kind: "dataset"; dataset: DatasetEntry }
  | { kind: "provider"; provider: DatasetProvider }
  | { kind: "topic"; topic: DatasetTopic }
  | { kind: "unassigned"; count: number };

export function deriveRightPaneState(input: {
  selectedDataset: DatasetEntry | null;
  activeProviderId: ProviderFilter;
  activeTopicSlug: TopicFilter;
  providerById: Map<string, DatasetProvider>;
  topicBySlug: Map<string, DatasetTopic>;
  unassignedCount: number;
}): RightPaneState {
  if (input.selectedDataset) {
    return { kind: "dataset", dataset: input.selectedDataset };
  }
  if (
    input.activeProviderId !== ALL_PROVIDERS_ID &&
    input.activeProviderId !== UNASSIGNED_PROVIDER_ID
  ) {
    const provider = input.providerById.get(input.activeProviderId);
    if (provider) {
      return { kind: "provider", provider };
    }
  }
  if (input.activeProviderId === UNASSIGNED_PROVIDER_ID) {
    return { kind: "unassigned", count: input.unassignedCount };
  }
  if (input.activeTopicSlug !== ALL_TOPICS_ID) {
    const topic = input.topicBySlug.get(input.activeTopicSlug);
    if (topic) {
      return { kind: "topic", topic };
    }
  }
  return { kind: "empty" };
}
