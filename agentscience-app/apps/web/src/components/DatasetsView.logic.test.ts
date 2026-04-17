import { describe, expect, it } from "vitest";

import type {
  DatasetEntry,
  DatasetProvider,
  DatasetProviderSummary,
} from "../lib/datasetRegistry";
import {
  ALL_PROVIDERS_ID,
  UNASSIGNED_PROVIDER_ID,
  buildProviderOptions,
  countDatasetsByProvider,
  deriveRightPaneState,
  filterDatasets,
} from "./DatasetsView.logic";

function makeProvider(overrides: Partial<DatasetProvider> = {}): DatasetProvider {
  return {
    id: "prov_1",
    slug: "openneuro",
    name: "OpenNeuro",
    homeUrl: "https://openneuro.org",
    domain: "openneuro.org",
    description: "A compendium of neuroimaging datasets.",
    logoUrl: null,
    searchKind: "GRAPHQL",
    searchEndpoint: "https://openneuro.org/crn/graphql",
    searchQueryTemplate: "query { datasets(search: {{query}}) { id } }",
    datasetUrlTemplate: "https://openneuro.org/datasets/{{accession}}",
    agentInstructions: "Use GraphQL.",
    datasetCount: 2,
    createdAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeProviderSummary(
  overrides: Partial<DatasetProviderSummary> = {},
): DatasetProviderSummary {
  return {
    id: "prov_1",
    slug: "openneuro",
    name: "OpenNeuro",
    domain: "openneuro.org",
    ...overrides,
  };
}

function makeDataset(overrides: Partial<DatasetEntry> = {}): DatasetEntry {
  return {
    id: "ds_1",
    name: "OpenNeuro ds005398",
    shortName: null,
    url: "https://openneuro.org/datasets/ds005398",
    domain: "openneuro.org",
    description: "Pediatric epilepsy iEEG sleep dataset.",
    keywords: ["epilepsy", "ieeg"],
    sourcePaperId: null,
    sourceRank: null,
    addedBy: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    sourcePaper: null,
    usedInPaperCount: 0,
    provider: makeProviderSummary(),
    ...overrides,
  };
}

describe("countDatasetsByProvider", () => {
  it("counts datasets per provider id and tracks unassigned separately", () => {
    const datasets = [
      makeDataset({ id: "a", provider: makeProviderSummary({ id: "prov_1" }) }),
      makeDataset({ id: "b", provider: makeProviderSummary({ id: "prov_1" }) }),
      makeDataset({ id: "c", provider: makeProviderSummary({ id: "prov_2", slug: "hf", name: "HF" }) }),
      makeDataset({ id: "d", provider: null }),
      makeDataset({ id: "e", provider: null }),
    ];

    const counts = countDatasetsByProvider(datasets);

    expect(counts.byId.get("prov_1")).toBe(2);
    expect(counts.byId.get("prov_2")).toBe(1);
    expect(counts.byId.has("prov_missing")).toBe(false);
    expect(counts.unassigned).toBe(2);
  });

  it("handles an empty dataset list", () => {
    const counts = countDatasetsByProvider([]);
    expect(counts.byId.size).toBe(0);
    expect(counts.unassigned).toBe(0);
  });
});

describe("buildProviderOptions", () => {
  const openneuro = makeProvider({ id: "prov_1", slug: "openneuro", name: "OpenNeuro" });
  const huggingface = makeProvider({
    id: "prov_2",
    slug: "huggingface",
    name: "Hugging Face Datasets",
    domain: "huggingface.co",
    datasetCount: 1,
  });
  const kaggle = makeProvider({
    id: "prov_3",
    slug: "kaggle",
    name: "Kaggle",
    domain: "kaggle.com",
    datasetCount: 0,
  });

  it("sorts by live count desc, then by name", () => {
    const datasets = [
      makeDataset({ id: "a", provider: makeProviderSummary({ id: "prov_2", slug: "huggingface", name: "Hugging Face Datasets" }) }),
      makeDataset({ id: "b", provider: makeProviderSummary({ id: "prov_2", slug: "huggingface", name: "Hugging Face Datasets" }) }),
      makeDataset({ id: "c", provider: makeProviderSummary({ id: "prov_1" }) }),
    ];
    const counts = countDatasetsByProvider(datasets);
    const options = buildProviderOptions([openneuro, huggingface], counts);

    expect(options.map((o) => o.provider.id)).toEqual(["prov_2", "prov_1"]);
    expect(options[0]!.liveCount).toBe(2);
    expect(options[1]!.liveCount).toBe(1);
  });

  it("keeps providers that have declared datasetCount even when no live datasets", () => {
    const counts = countDatasetsByProvider([]);
    const options = buildProviderOptions([openneuro, huggingface], counts);

    expect(options.map((o) => o.provider.id).sort()).toEqual(["prov_1", "prov_2"]);
    options.forEach((option) => {
      expect(option.liveCount).toBe(0);
    });
  });

  it("drops providers with no live datasets and no declared datasetCount", () => {
    const counts = countDatasetsByProvider([]);
    const options = buildProviderOptions([kaggle], counts);
    expect(options).toHaveLength(0);
  });

  it("breaks ties on liveCount via case-insensitive name sort", () => {
    const alpha = makeProvider({ id: "alpha", slug: "alpha", name: "Alpha", datasetCount: 1 });
    const bravo = makeProvider({ id: "bravo", slug: "bravo", name: "bravo", datasetCount: 1 });
    const counts = countDatasetsByProvider([]);
    const options = buildProviderOptions([bravo, alpha], counts);
    expect(options.map((o) => o.provider.id)).toEqual(["alpha", "bravo"]);
  });
});

describe("filterDatasets", () => {
  const openneuroSummary = makeProviderSummary({
    id: "prov_1",
    slug: "openneuro",
    name: "OpenNeuro",
  });
  const huggingfaceSummary = makeProviderSummary({
    id: "prov_2",
    slug: "huggingface",
    name: "Hugging Face",
    domain: "huggingface.co",
  });

  const datasets: DatasetEntry[] = [
    makeDataset({
      id: "a",
      name: "OpenNeuro ds005398",
      description: "Pediatric epilepsy iEEG sleep dataset.",
      provider: openneuroSummary,
      keywords: ["epilepsy"],
    }),
    makeDataset({
      id: "b",
      name: "HF squad",
      description: "Question answering benchmark.",
      domain: "huggingface.co",
      url: "https://huggingface.co/datasets/squad",
      provider: huggingfaceSummary,
      keywords: ["qa"],
    }),
    makeDataset({
      id: "c",
      name: "Standalone",
      description: "A dataset without a registered provider.",
      domain: "example.org",
      url: "https://example.org/data",
      provider: null,
      keywords: [],
    }),
  ];

  it("returns all datasets when the filter is ALL and no query", () => {
    const out = filterDatasets(datasets, {
      activeProviderId: ALL_PROVIDERS_ID,
      searchQuery: "",
    });
    expect(out.map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("filters to a single provider when its id is the active filter", () => {
    const out = filterDatasets(datasets, {
      activeProviderId: "prov_2",
      searchQuery: "",
    });
    expect(out.map((d) => d.id)).toEqual(["b"]);
  });

  it("shows only datasets without a provider when UNASSIGNED is active", () => {
    const out = filterDatasets(datasets, {
      activeProviderId: UNASSIGNED_PROVIDER_ID,
      searchQuery: "",
    });
    expect(out.map((d) => d.id)).toEqual(["c"]);
  });

  it("matches the search query against the provider name", () => {
    const out = filterDatasets(datasets, {
      activeProviderId: ALL_PROVIDERS_ID,
      searchQuery: "hugging",
    });
    expect(out.map((d) => d.id)).toEqual(["b"]);
  });

  it("matches the search query against keywords", () => {
    const out = filterDatasets(datasets, {
      activeProviderId: ALL_PROVIDERS_ID,
      searchQuery: "epilepsy",
    });
    expect(out.map((d) => d.id)).toEqual(["a"]);
  });

  it("combines provider filter with a search query", () => {
    const out = filterDatasets(datasets, {
      activeProviderId: "prov_1",
      searchQuery: "pediatric",
    });
    expect(out.map((d) => d.id)).toEqual(["a"]);
  });

  it("returns an empty list when provider filter and query do not match any dataset", () => {
    const out = filterDatasets(datasets, {
      activeProviderId: "prov_1",
      searchQuery: "squad",
    });
    expect(out).toHaveLength(0);
  });
});

describe("deriveRightPaneState", () => {
  const provider = makeProvider();
  const providerById = new Map<string, DatasetProvider>([[provider.id, provider]]);
  const selectedDataset = makeDataset();

  it("prefers the selected dataset over an active provider filter", () => {
    const state = deriveRightPaneState({
      selectedDataset,
      activeProviderId: provider.id,
      providerById,
      unassignedCount: 0,
    });
    expect(state).toEqual({ kind: "dataset", dataset: selectedDataset });
  });

  it("returns the provider detail when a provider is active and no dataset is selected", () => {
    const state = deriveRightPaneState({
      selectedDataset: null,
      activeProviderId: provider.id,
      providerById,
      unassignedCount: 0,
    });
    expect(state).toEqual({ kind: "provider", provider });
  });

  it("returns an unassigned state when the UNASSIGNED filter is active", () => {
    const state = deriveRightPaneState({
      selectedDataset: null,
      activeProviderId: UNASSIGNED_PROVIDER_ID,
      providerById,
      unassignedCount: 3,
    });
    expect(state).toEqual({ kind: "unassigned", count: 3 });
  });

  it("falls back to empty when ALL is active and nothing is selected", () => {
    const state = deriveRightPaneState({
      selectedDataset: null,
      activeProviderId: ALL_PROVIDERS_ID,
      providerById,
      unassignedCount: 0,
    });
    expect(state).toEqual({ kind: "empty" });
  });

  it("falls back to empty if the active provider id is not in the map", () => {
    const state = deriveRightPaneState({
      selectedDataset: null,
      activeProviderId: "prov_missing",
      providerById,
      unassignedCount: 0,
    });
    expect(state).toEqual({ kind: "empty" });
  });
});
