import { describe, expect, it } from "vitest";

import type {
  DatasetEntry,
  DatasetProvider,
  DatasetProviderSummary,
  DatasetTopic,
  DatasetTopicSummary,
} from "../lib/datasetRegistry";
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
} from "./DatasetsView.logic";

const neuroscienceTopic: DatasetTopicSummary = {
  id: "topic_neuroscience",
  slug: "neuroscience",
  name: "Neuroscience",
  area: "LIFE_SCIENCES",
};
const neuroimagingTopic: DatasetTopicSummary = {
  id: "topic_neuroimaging",
  slug: "neuroimaging",
  name: "Neuroimaging",
  area: "LIFE_SCIENCES",
};
const mlTopic: DatasetTopicSummary = {
  id: "topic_machine_learning",
  slug: "machine-learning",
  name: "Machine Learning",
  area: "COMPUTING_ENGINEERING",
};

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
    topics: [neuroscienceTopic, neuroimagingTopic],
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
    topics: [neuroscienceTopic, neuroimagingTopic],
    ...overrides,
  };
}

function makeTopic(overrides: Partial<DatasetTopic> = {}): DatasetTopic {
  return {
    id: "topic_neuroscience",
    slug: "neuroscience",
    name: "Neuroscience",
    area: "LIFE_SCIENCES",
    description: null,
    agentInstructions: null,
    status: "ACTIVE",
    providerCount: 2,
    datasetCount: 5,
    createdAt: "2026-04-01T00:00:00.000Z",
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

describe("countByArea", () => {
  it("counts unique providers and datasets per area, respecting multi-tagging", () => {
    const neuro = makeProvider({ id: "prov_neuro", topics: [neuroscienceTopic] });
    const hf = makeProvider({
      id: "prov_hf",
      topics: [mlTopic],
    });
    const crossover = makeProvider({
      id: "prov_cross",
      // Cross-tagged provider lives in two areas but should count once per area.
      topics: [neuroscienceTopic, mlTopic],
    });

    const datasets = [
      makeDataset({ id: "d1", topics: [neuroscienceTopic] }),
      makeDataset({ id: "d2", topics: [mlTopic] }),
      makeDataset({ id: "d3", topics: [neuroscienceTopic, mlTopic] }),
    ];

    const counts = countByArea([neuro, hf, crossover], datasets);

    expect(counts.providerByArea.get("LIFE_SCIENCES")?.size).toBe(2);
    expect(counts.providerByArea.get("COMPUTING_ENGINEERING")?.size).toBe(2);
    expect(counts.datasetByArea.get("LIFE_SCIENCES")?.size).toBe(2);
    expect(counts.datasetByArea.get("COMPUTING_ENGINEERING")?.size).toBe(2);
  });

  it("handles providers and datasets with no topics gracefully", () => {
    const bareProvider = makeProvider({ id: "prov_bare", topics: [] });
    const bareDataset = makeDataset({ id: "ds_bare", topics: [] });
    const counts = countByArea([bareProvider], [bareDataset]);
    expect(counts.providerByArea.size).toBe(0);
    expect(counts.datasetByArea.size).toBe(0);
  });
});

describe("buildTopicOptionsForArea", () => {
  it("returns only topics within the active area", () => {
    const topics = [
      makeTopic(),
      makeTopic({ id: "t2", slug: "ml", name: "ML", area: "COMPUTING_ENGINEERING" }),
    ];
    const scoped = buildTopicOptionsForArea(topics, "LIFE_SCIENCES");
    expect(scoped.map((t) => t.slug)).toEqual(["neuroscience"]);
  });

  it("returns every topic with counts when area filter is ALL", () => {
    const topics = [
      makeTopic(),
      makeTopic({ id: "t2", slug: "ml", name: "ML", area: "COMPUTING_ENGINEERING" }),
    ];
    const scoped = buildTopicOptionsForArea(topics, ALL_AREAS_ID);
    expect(scoped).toHaveLength(2);
  });

  it("drops topics with zero provider and dataset counts", () => {
    const topics = [
      makeTopic({ id: "t1", slug: "a", name: "A", providerCount: 0, datasetCount: 0 }),
      makeTopic({ id: "t2", slug: "b", name: "B", providerCount: 1, datasetCount: 0 }),
    ];
    const scoped = buildTopicOptionsForArea(topics, ALL_AREAS_ID);
    expect(scoped.map((t) => t.slug)).toEqual(["b"]);
  });

  it("sorts by providerCount desc then name", () => {
    const topics = [
      makeTopic({ id: "t1", slug: "a", name: "Alpha", providerCount: 1, datasetCount: 0 }),
      makeTopic({ id: "t2", slug: "b", name: "Bravo", providerCount: 3, datasetCount: 0 }),
      makeTopic({ id: "t3", slug: "c", name: "Charlie", providerCount: 3, datasetCount: 0 }),
    ];
    const scoped = buildTopicOptionsForArea(topics, ALL_AREAS_ID);
    expect(scoped.map((t) => t.slug)).toEqual(["b", "c", "a"]);
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
    topics: [mlTopic],
  });
  const kaggle = makeProvider({
    id: "prov_3",
    slug: "kaggle",
    name: "Kaggle",
    domain: "kaggle.com",
    datasetCount: 0,
    topics: [mlTopic],
  });

  it("sorts by live count desc, then by name", () => {
    const datasets = [
      makeDataset({ id: "a", provider: makeProviderSummary({ id: "prov_2", slug: "huggingface", name: "Hugging Face Datasets" }), topics: [mlTopic] }),
      makeDataset({ id: "b", provider: makeProviderSummary({ id: "prov_2", slug: "huggingface", name: "Hugging Face Datasets" }), topics: [mlTopic] }),
      makeDataset({ id: "c", provider: makeProviderSummary({ id: "prov_1" }) }),
    ];
    const counts = countDatasetsByProvider(datasets);
    const options = buildProviderOptions([openneuro, huggingface], counts);

    expect(options.map((o) => o.provider.id)).toEqual(["prov_2", "prov_1"]);
    expect(options[0]!.liveCount).toBe(2);
    expect(options[1]!.liveCount).toBe(1);
  });

  it("scopes providers to the active area", () => {
    const counts = countDatasetsByProvider([]);
    const options = buildProviderOptions([openneuro, huggingface], counts, {
      activeArea: "COMPUTING_ENGINEERING",
    });
    expect(options.map((o) => o.provider.id)).toEqual(["prov_2"]);
  });

  it("scopes providers to the active topic", () => {
    const counts = countDatasetsByProvider([]);
    const options = buildProviderOptions([openneuro, huggingface], counts, {
      activeTopicSlug: "neuroscience",
    });
    expect(options.map((o) => o.provider.id)).toEqual(["prov_1"]);
  });

  it("keeps providers that have declared datasetCount even when no live datasets", () => {
    const counts = countDatasetsByProvider([]);
    const options = buildProviderOptions([openneuro, huggingface], counts);

    expect(options.map((o) => o.provider.id).toSorted()).toEqual(["prov_1", "prov_2"]);
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
    const alpha = makeProvider({ id: "alpha", slug: "alpha", name: "Alpha", datasetCount: 1, topics: [mlTopic] });
    const bravo = makeProvider({ id: "bravo", slug: "bravo", name: "bravo", datasetCount: 1, topics: [mlTopic] });
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
      topics: [neuroscienceTopic, neuroimagingTopic],
    }),
    makeDataset({
      id: "b",
      name: "HF squad",
      description: "Question answering benchmark.",
      domain: "huggingface.co",
      url: "https://huggingface.co/datasets/squad",
      provider: huggingfaceSummary,
      keywords: ["qa"],
      topics: [mlTopic],
    }),
    makeDataset({
      id: "c",
      name: "Standalone",
      description: "A dataset without a registered provider.",
      domain: "example.org",
      url: "https://example.org/data",
      provider: null,
      keywords: [],
      topics: [],
    }),
  ];

  it("returns all datasets when every filter is ALL and no query", () => {
    const out = filterDatasets(datasets, {
      activeArea: ALL_AREAS_ID,
      activeTopicSlug: ALL_TOPICS_ID,
      activeProviderId: ALL_PROVIDERS_ID,
      searchQuery: "",
    });
    expect(out.map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("filters to a single area", () => {
    const out = filterDatasets(datasets, {
      activeArea: "COMPUTING_ENGINEERING",
      activeTopicSlug: ALL_TOPICS_ID,
      activeProviderId: ALL_PROVIDERS_ID,
      searchQuery: "",
    });
    expect(out.map((d) => d.id)).toEqual(["b"]);
  });

  it("filters to a single topic slug", () => {
    const out = filterDatasets(datasets, {
      activeArea: ALL_AREAS_ID,
      activeTopicSlug: "neuroimaging",
      activeProviderId: ALL_PROVIDERS_ID,
      searchQuery: "",
    });
    expect(out.map((d) => d.id)).toEqual(["a"]);
  });

  it("filters to a single provider when its id is the active filter", () => {
    const out = filterDatasets(datasets, {
      activeArea: ALL_AREAS_ID,
      activeTopicSlug: ALL_TOPICS_ID,
      activeProviderId: "prov_2",
      searchQuery: "",
    });
    expect(out.map((d) => d.id)).toEqual(["b"]);
  });

  it("shows only datasets without a provider when UNASSIGNED is active", () => {
    const out = filterDatasets(datasets, {
      activeArea: ALL_AREAS_ID,
      activeTopicSlug: ALL_TOPICS_ID,
      activeProviderId: UNASSIGNED_PROVIDER_ID,
      searchQuery: "",
    });
    expect(out.map((d) => d.id)).toEqual(["c"]);
  });

  it("matches the search query against topic names", () => {
    const out = filterDatasets(datasets, {
      activeArea: ALL_AREAS_ID,
      activeTopicSlug: ALL_TOPICS_ID,
      activeProviderId: ALL_PROVIDERS_ID,
      searchQuery: "machine learning",
    });
    expect(out.map((d) => d.id)).toEqual(["b"]);
  });

  it("matches the search query against keywords", () => {
    const out = filterDatasets(datasets, {
      activeArea: ALL_AREAS_ID,
      activeTopicSlug: ALL_TOPICS_ID,
      activeProviderId: ALL_PROVIDERS_ID,
      searchQuery: "epilepsy",
    });
    expect(out.map((d) => d.id)).toEqual(["a"]);
  });

  it("combines area, provider filter, and a search query", () => {
    const out = filterDatasets(datasets, {
      activeArea: "LIFE_SCIENCES",
      activeTopicSlug: ALL_TOPICS_ID,
      activeProviderId: "prov_1",
      searchQuery: "pediatric",
    });
    expect(out.map((d) => d.id)).toEqual(["a"]);
  });
});

describe("deriveRightPaneState", () => {
  const provider = makeProvider();
  const topic = makeTopic();
  const providerById = new Map<string, DatasetProvider>([[provider.id, provider]]);
  const topicBySlug = new Map<string, DatasetTopic>([[topic.slug, topic]]);
  const selectedDataset = makeDataset();

  it("prefers the selected dataset over an active provider filter", () => {
    const state = deriveRightPaneState({
      selectedDataset,
      activeProviderId: provider.id,
      activeTopicSlug: ALL_TOPICS_ID,
      providerById,
      topicBySlug,
      unassignedCount: 0,
    });
    expect(state).toEqual({ kind: "dataset", dataset: selectedDataset });
  });

  it("returns the provider detail when a provider is active and no dataset is selected", () => {
    const state = deriveRightPaneState({
      selectedDataset: null,
      activeProviderId: provider.id,
      activeTopicSlug: ALL_TOPICS_ID,
      providerById,
      topicBySlug,
      unassignedCount: 0,
    });
    expect(state).toEqual({ kind: "provider", provider });
  });

  it("returns the topic detail when only a topic is active", () => {
    const state = deriveRightPaneState({
      selectedDataset: null,
      activeProviderId: ALL_PROVIDERS_ID,
      activeTopicSlug: topic.slug,
      providerById,
      topicBySlug,
      unassignedCount: 0,
    });
    expect(state).toEqual({ kind: "topic", topic });
  });

  it("prefers the provider detail when both provider and topic are active", () => {
    const state = deriveRightPaneState({
      selectedDataset: null,
      activeProviderId: provider.id,
      activeTopicSlug: topic.slug,
      providerById,
      topicBySlug,
      unassignedCount: 0,
    });
    expect(state).toEqual({ kind: "provider", provider });
  });

  it("returns an unassigned state when the UNASSIGNED filter is active", () => {
    const state = deriveRightPaneState({
      selectedDataset: null,
      activeProviderId: UNASSIGNED_PROVIDER_ID,
      activeTopicSlug: ALL_TOPICS_ID,
      providerById,
      topicBySlug,
      unassignedCount: 3,
    });
    expect(state).toEqual({ kind: "unassigned", count: 3 });
  });

  it("falls back to empty when everything is ALL and nothing is selected", () => {
    const state = deriveRightPaneState({
      selectedDataset: null,
      activeProviderId: ALL_PROVIDERS_ID,
      activeTopicSlug: ALL_TOPICS_ID,
      providerById,
      topicBySlug,
      unassignedCount: 0,
    });
    expect(state).toEqual({ kind: "empty" });
  });

  it("falls back to empty if the active provider id is not in the map", () => {
    const state = deriveRightPaneState({
      selectedDataset: null,
      activeProviderId: "prov_missing",
      activeTopicSlug: ALL_TOPICS_ID,
      providerById,
      topicBySlug,
      unassignedCount: 0,
    });
    expect(state).toEqual({ kind: "empty" });
  });
});
