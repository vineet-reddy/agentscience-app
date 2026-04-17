import type {
  DatasetEntry,
  DatasetProvider,
} from "../lib/datasetRegistry";

export const ALL_PROVIDERS_ID = "__all__" as const;
export const UNASSIGNED_PROVIDER_ID = "__unassigned__" as const;

export type ProviderFilter =
  | typeof ALL_PROVIDERS_ID
  | typeof UNASSIGNED_PROVIDER_ID
  | string;

export interface ProviderOption {
  provider: DatasetProvider;
  liveCount: number;
}

export interface DatasetCounts {
  byId: Map<string, number>;
  unassigned: number;
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
 * Provider options for the filter pill row. Only providers that either have at
 * least one dataset currently in the registry (`liveCount > 0`) or have a
 * declared `datasetCount > 0` upstream are shown. Sorted by liveCount desc
 * then name.
 */
export function buildProviderOptions(
  providers: DatasetProvider[],
  counts: DatasetCounts,
): ProviderOption[] {
  return providers
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
    activeProviderId: ProviderFilter;
    searchQuery: string;
  },
): DatasetEntry[] {
  const normalizedQuery = options.searchQuery.trim().toLowerCase();
  return datasets.filter((dataset) => {
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
  | { kind: "unassigned"; count: number };

export function deriveRightPaneState(input: {
  selectedDataset: DatasetEntry | null;
  activeProviderId: ProviderFilter;
  providerById: Map<string, DatasetProvider>;
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
  return { kind: "empty" };
}
