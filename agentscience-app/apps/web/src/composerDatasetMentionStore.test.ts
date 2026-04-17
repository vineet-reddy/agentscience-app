import { describe, expect, it } from "vitest";
import { type ThreadId } from "@agentscience/contracts";

import {
  appendDatasetReferencesToPrompt,
  collectDatasetMentionsFromPrompt,
  type ComposerRegistryMention,
  datasetEntryToMention,
  datasetProviderToMention,
  formatDatasetReferencesAppendix,
  getDatasetMentionForPath,
  useComposerDatasetMentionStore,
} from "./composerDatasetMentionStore";
import {
  truncateDatasetChipLabel,
  type DatasetEntry,
  type DatasetProvider,
} from "./lib/datasetRegistry";

function buildDatasetMention(
  overrides: Partial<Extract<ComposerRegistryMention, { kind: "dataset" }>> = {},
): Extract<ComposerRegistryMention, { kind: "dataset" }> {
  return {
    kind: "dataset",
    slug: "open-climate-archive",
    datasetId: "dataset-1",
    name: "Open Climate Archive",
    shortName: null,
    url: "https://data.example.org/archive",
    domain: "data.example.org",
    provider: null,
    ...overrides,
  };
}

function buildProviderMention(
  overrides: Partial<Extract<ComposerRegistryMention, { kind: "provider" }>> = {},
): Extract<ComposerRegistryMention, { kind: "provider" }> {
  return {
    kind: "provider",
    slug: "openneuro",
    providerId: "prov_openneuro",
    name: "OpenNeuro",
    homeUrl: "https://openneuro.org",
    domain: "openneuro.org",
    description: "Public archive of BIDS-formatted neuroimaging datasets.",
    search: {
      kind: "GRAPHQL",
      endpoint: "https://openneuro.org/crn/graphql",
      queryTemplate: "query Search($q: String!) { datasets(first: 25, query: { text: $q }) { edges { node { id } } } }",
    },
    datasetUrlTemplate: "https://openneuro.org/datasets/{datasetId}/versions/{version}",
    agentInstructions: "Use GraphQL. Dataset IDs look like ds000000.",
    ...overrides,
  };
}

describe("composerDatasetMentionStore", () => {
  it("keys dataset and provider mentions under distinct namespaces", () => {
    const threadId = "thread-ns" as ThreadId;
    const dataset = buildDatasetMention({ slug: "shared" });
    const provider = buildProviderMention({ slug: "shared" });

    useComposerDatasetMentionStore.getState().registerDatasetMention(threadId, dataset);
    useComposerDatasetMentionStore.getState().registerDatasetMention(threadId, provider);

    const stored = useComposerDatasetMentionStore.getState().mentionsByThreadId[threadId];
    expect(stored?.["dataset:shared"]).toEqual(dataset);
    expect(stored?.["provider:shared"]).toEqual(provider);

    useComposerDatasetMentionStore.getState().clearDatasetMentions(threadId);
  });

  it("does not modify state when registering an identical mention twice", () => {
    const threadId = "thread-b" as ThreadId;
    const mention = buildDatasetMention();
    useComposerDatasetMentionStore.getState().registerDatasetMention(threadId, mention);
    const first = useComposerDatasetMentionStore.getState().mentionsByThreadId[threadId];
    useComposerDatasetMentionStore.getState().registerDatasetMention(threadId, mention);
    const second = useComposerDatasetMentionStore.getState().mentionsByThreadId[threadId];
    expect(first).toBe(second);
    useComposerDatasetMentionStore.getState().clearDatasetMentions(threadId);
  });
});

describe("datasetEntryToMention / datasetProviderToMention", () => {
  it("carries provider context from the dataset entry into the mention", () => {
    const dataset: DatasetEntry = {
      id: "dataset-1",
      name: "ds005398",
      shortName: "ds005398",
      url: "https://openneuro.org/datasets/ds005398",
      domain: "openneuro.org",
      description: "Pediatric epilepsy iEEG dataset.",
      keywords: [],
      sourcePaperId: null,
      sourceRank: null,
      addedBy: null,
      createdAt: new Date(0).toISOString(),
      sourcePaper: null,
      usedInPaperCount: 0,
      provider: {
        id: "prov_openneuro",
        slug: "openneuro",
        name: "OpenNeuro",
        domain: "openneuro.org",
      },
    };
    const mention = datasetEntryToMention(dataset);
    expect(mention.kind).toBe("dataset");
    expect(mention.provider).toEqual({ slug: "openneuro", name: "OpenNeuro" });
  });

  it("includes the search recipe when the provider has one", () => {
    const provider: DatasetProvider = {
      id: "prov_openneuro",
      slug: "openneuro",
      name: "OpenNeuro",
      homeUrl: "https://openneuro.org",
      domain: "openneuro.org",
      description: "Open BIDS datasets.",
      logoUrl: null,
      searchKind: "GRAPHQL",
      searchEndpoint: "https://openneuro.org/crn/graphql",
      searchQueryTemplate: "query { datasets { edges { node { id } } } }",
      datasetUrlTemplate: "https://openneuro.org/datasets/{datasetId}",
      agentInstructions: "Use GraphQL.",
      datasetCount: 42,
      createdAt: new Date(0).toISOString(),
    };
    const mention = datasetProviderToMention(provider);
    expect(mention.kind).toBe("provider");
    expect(mention.search).toEqual({
      kind: "GRAPHQL",
      endpoint: "https://openneuro.org/crn/graphql",
      queryTemplate: "query { datasets { edges { node { id } } } }",
    });
  });
});

describe("collectDatasetMentionsFromPrompt", () => {
  it("returns providers and datasets in prompt order, uniquely", () => {
    const provider = buildProviderMention();
    const dataset = buildDatasetMention();
    const prompt =
      `poll @provider:${provider.slug} then @dataset:${dataset.slug} and also ` +
      `@provider:${provider.slug}`;

    const mentions = collectDatasetMentionsFromPrompt(prompt, {
      [`provider:${provider.slug}`]: provider,
      [`dataset:${dataset.slug}`]: dataset,
    });

    expect(mentions).toHaveLength(2);
    expect(mentions[0]?.kind).toBe("provider");
    expect(mentions[1]?.kind).toBe("dataset");
  });

  it("ignores mentions without registered metadata", () => {
    const dataset = buildDatasetMention();
    const prompt = `reference @dataset:missing @dataset:${dataset.slug}`;
    const result = collectDatasetMentionsFromPrompt(prompt, {
      [`dataset:${dataset.slug}`]: dataset,
    });
    expect(result).toEqual([dataset]);
  });
});

describe("getDatasetMentionForPath", () => {
  it("resolves provider paths to their provider mention", () => {
    const provider = buildProviderMention();
    const store = { [`provider:${provider.slug}`]: provider };
    expect(getDatasetMentionForPath(store, `provider:${provider.slug}`)).toEqual(provider);
  });

  it("resolves dataset paths to their dataset mention", () => {
    const dataset = buildDatasetMention();
    const store = { [`dataset:${dataset.slug}`]: dataset };
    expect(getDatasetMentionForPath(store, `dataset:${dataset.slug}`)).toEqual(dataset);
  });

  it("returns null for an unrecognized path", () => {
    expect(getDatasetMentionForPath({}, "src/index.ts")).toBeNull();
  });
});

describe("formatDatasetReferencesAppendix", () => {
  it("renders dataset entries with kind: dataset and optional provider metadata", () => {
    const dataset = buildDatasetMention({
      shortName: "OCA",
      provider: { slug: "example-archive", name: "Example Archive" },
    });
    expect(formatDatasetReferencesAppendix([dataset])).toBe(
      [
        "<dataset_context>",
        "- kind: dataset",
        "  mention: @dataset:open-climate-archive",
        "  name: Open Climate Archive",
        "  short_name: OCA",
        "  id: dataset-1",
        "  url: https://data.example.org/archive",
        "  domain: data.example.org",
        "  provider_slug: example-archive",
        "  provider_name: Example Archive",
        "</dataset_context>",
      ].join("\n"),
    );
  });

  it("renders provider entries with their search recipe", () => {
    const provider = buildProviderMention();
    expect(formatDatasetReferencesAppendix([provider])).toBe(
      [
        "<dataset_context>",
        "- kind: provider",
        "  mention: @provider:openneuro",
        "  name: OpenNeuro",
        "  id: prov_openneuro",
        "  home_url: https://openneuro.org",
        "  domain: openneuro.org",
        "  description: Public archive of BIDS-formatted neuroimaging datasets.",
        "  search_kind: GRAPHQL",
        "  search_endpoint: https://openneuro.org/crn/graphql",
        "  search_query_template: query Search($q: String!) { datasets(first: 25, query: { text: $q }) { edges { node { id } } } }",
        "  dataset_url_template: https://openneuro.org/datasets/{datasetId}/versions/{version}",
        "  agent_instructions: Use GraphQL. Dataset IDs look like ds000000.",
        "</dataset_context>",
      ].join("\n"),
    );
  });

  it("omits short_name when it matches the name or is missing", () => {
    expect(formatDatasetReferencesAppendix([buildDatasetMention()])).not.toContain("short_name:");
  });

  it("returns an empty string when there are no referenced mentions", () => {
    expect(formatDatasetReferencesAppendix([])).toBe("");
  });
});

describe("appendDatasetReferencesToPrompt", () => {
  it("appends a <dataset_context> block covering both providers and datasets", () => {
    const provider = buildProviderMention({
      search: null,
      datasetUrlTemplate: null,
      agentInstructions: null,
    });
    const dataset = buildDatasetMention();
    const prompt = `look at @provider:${provider.slug} and @dataset:${dataset.slug}`;
    const result = appendDatasetReferencesToPrompt(prompt, {
      [`provider:${provider.slug}`]: provider,
      [`dataset:${dataset.slug}`]: dataset,
    });
    expect(result).toBe(
      [
        `look at @provider:${provider.slug} and @dataset:${dataset.slug}`,
        "",
        "<dataset_context>",
        "- kind: provider",
        "  mention: @provider:openneuro",
        "  name: OpenNeuro",
        "  id: prov_openneuro",
        "  home_url: https://openneuro.org",
        "  domain: openneuro.org",
        "  description: Public archive of BIDS-formatted neuroimaging datasets.",
        "- kind: dataset",
        "  mention: @dataset:open-climate-archive",
        "  name: Open Climate Archive",
        "  id: dataset-1",
        "  url: https://data.example.org/archive",
        "  domain: data.example.org",
        "</dataset_context>",
      ].join("\n"),
    );
  });

  it("leaves the prompt unchanged when no mentions are referenced", () => {
    expect(appendDatasetReferencesToPrompt("hello world", {})).toBe("hello world");
  });
});

describe("truncateDatasetChipLabel", () => {
  it("prefers the short name when provided", () => {
    expect(truncateDatasetChipLabel({ name: "Full Name", shortName: "FN" })).toBe("FN");
  });

  it("returns the full name when it fits", () => {
    expect(truncateDatasetChipLabel({ name: "Short", shortName: null })).toBe("Short");
  });

  it("truncates long names with an ellipsis", () => {
    const longName = "A".repeat(60);
    const result = truncateDatasetChipLabel({ name: longName, shortName: null });
    expect(result.length).toBeLessThanOrEqual(35);
    expect(result.endsWith("...")).toBe(true);
  });
});
