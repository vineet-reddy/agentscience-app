import { resolveServerUrl } from "./utils";

const DATASET_REGISTRY_PROXY_PATH = "/api/datasets/registry";
const DATASET_PROVIDERS_PROXY_PATH = "/api/datasets/registry/providers";
const DEFAULT_AGENTSCIENCE_BASE_URL = "https://agentscience.vercel.app";

export type DatasetProviderSearchKind = "GRAPHQL" | "REST" | "HTML";

export interface DatasetSourcePaper {
  slug: string;
  title: string;
  authors: string[];
  publishedAt: string;
  url: string;
}

export interface DatasetProviderSummary {
  id: string;
  slug: string;
  name: string;
  domain: string;
}

export interface DatasetProvider {
  id: string;
  slug: string;
  name: string;
  homeUrl: string;
  domain: string;
  description: string;
  logoUrl: string | null;
  searchKind: DatasetProviderSearchKind | null;
  searchEndpoint: string | null;
  searchQueryTemplate: string | null;
  datasetUrlTemplate: string | null;
  agentInstructions: string | null;
  datasetCount: number;
  createdAt: string;
}

export interface DatasetEntry {
  id: string;
  name: string;
  shortName: string | null;
  url: string;
  domain: string;
  description: string;
  keywords: string[];
  sourcePaperId: string | null;
  sourceRank: number | null;
  addedBy: string | null;
  createdAt: string;
  sourcePaper: DatasetSourcePaper | null;
  usedInPaperCount: number;
  provider: DatasetProviderSummary | null;
}

export interface DatasetRegistryResponse {
  datasets: unknown[];
}

export interface DatasetProvidersResponse {
  providers: unknown[];
}

export function resolveRegistryBaseUrl(): string {
  const envValue =
    (import.meta.env.VITE_AGENTSCIENCE_BASE_URL as string | undefined) ??
    (import.meta.env.VITE_AGENTSCIENCE_PLATFORM_URL as string | undefined);
  const raw = envValue && envValue.trim().length > 0 ? envValue : DEFAULT_AGENTSCIENCE_BASE_URL;
  return raw.replace(/\/+$/, "");
}

function shouldUseEmbeddedRegistryProxy(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const bridgeWsUrl = window.desktopBridge?.getWsUrl?.();
  const envWsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  return (
    (typeof bridgeWsUrl === "string" && bridgeWsUrl.length > 0) ||
    (typeof envWsUrl === "string" && envWsUrl.length > 0)
  );
}

function resolveDatasetRegistryRequestUrl(): string {
  if (shouldUseEmbeddedRegistryProxy()) {
    return resolveServerUrl({
      protocol: "http",
      pathname: DATASET_REGISTRY_PROXY_PATH,
      searchParams: {},
    });
  }

  return new URL("/api/v1/registry", resolveRegistryBaseUrl()).toString();
}

function resolveDatasetProvidersRequestUrl(): string {
  if (shouldUseEmbeddedRegistryProxy()) {
    return resolveServerUrl({
      protocol: "http",
      pathname: DATASET_PROVIDERS_PROXY_PATH,
      searchParams: {},
    });
  }

  return new URL("/api/v1/registry/providers", resolveRegistryBaseUrl()).toString();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeProviderSummary(value: unknown): DatasetProviderSummary | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const slug = typeof record.slug === "string" ? record.slug : null;
  const name = typeof record.name === "string" ? record.name : null;
  const domain = typeof record.domain === "string" ? record.domain : null;
  if (!id || !slug || !name || !domain) return null;
  return { id, slug, name, domain };
}

function normalizeDatasetEntry(
  dataset: Partial<DatasetEntry> & Pick<DatasetEntry, "id" | "name">,
): DatasetEntry {
  const sourcePaper = dataset.sourcePaper
    ? {
        slug: dataset.sourcePaper.slug,
        title: dataset.sourcePaper.title,
        authors: normalizeStringArray(dataset.sourcePaper.authors),
        publishedAt: dataset.sourcePaper.publishedAt,
        url: dataset.sourcePaper.url,
      }
    : null;

  return {
    id: dataset.id,
    name: dataset.name,
    shortName:
      typeof dataset.shortName === "string" && dataset.shortName.trim().length > 0
        ? dataset.shortName.trim()
        : null,
    url: dataset.url ?? "",
    domain: dataset.domain ?? "",
    description: dataset.description ?? "",
    keywords: normalizeStringArray(dataset.keywords),
    sourcePaperId: dataset.sourcePaperId ?? null,
    sourceRank: typeof dataset.sourceRank === "number" ? dataset.sourceRank : null,
    addedBy: typeof dataset.addedBy === "string" ? dataset.addedBy : null,
    createdAt: dataset.createdAt ?? new Date(0).toISOString(),
    sourcePaper,
    usedInPaperCount:
      typeof dataset.usedInPaperCount === "number"
        ? dataset.usedInPaperCount
        : sourcePaper
          ? 1
          : 0,
    provider: normalizeProviderSummary(dataset.provider),
  };
}

function normalizeSearchKind(value: unknown): DatasetProviderSearchKind | null {
  if (value === "GRAPHQL" || value === "REST" || value === "HTML") return value;
  return null;
}

function normalizeDatasetProvider(value: unknown): DatasetProvider | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const slug = typeof record.slug === "string" ? record.slug : null;
  const name = typeof record.name === "string" ? record.name : null;
  const homeUrl = typeof record.homeUrl === "string" ? record.homeUrl : null;
  const domain = typeof record.domain === "string" ? record.domain : null;
  const description = typeof record.description === "string" ? record.description : null;
  if (!id || !slug || !name || !homeUrl || !domain || description === null) return null;

  return {
    id,
    slug,
    name,
    homeUrl,
    domain,
    description,
    logoUrl: typeof record.logoUrl === "string" ? record.logoUrl : null,
    searchKind: normalizeSearchKind(record.searchKind),
    searchEndpoint: typeof record.searchEndpoint === "string" ? record.searchEndpoint : null,
    searchQueryTemplate:
      typeof record.searchQueryTemplate === "string" ? record.searchQueryTemplate : null,
    datasetUrlTemplate:
      typeof record.datasetUrlTemplate === "string" ? record.datasetUrlTemplate : null,
    agentInstructions:
      typeof record.agentInstructions === "string" ? record.agentInstructions : null,
    datasetCount: typeof record.datasetCount === "number" ? record.datasetCount : 0,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
  };
}

export function truncateDatasetChipLabel(dataset: Pick<DatasetEntry, "name" | "shortName">): string {
  const shortName = dataset.shortName?.trim();
  if (shortName && shortName.length > 0) {
    return shortName;
  }
  const name = dataset.name ?? "";
  if (name.length <= 35) {
    return name;
  }
  return `${name.slice(0, 32)}...`;
}

export async function fetchDatasetRegistry(options?: {
  query?: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<DatasetEntry[]> {
  const url = new URL(resolveDatasetRegistryRequestUrl());
  if (options?.query && options.query.trim().length > 0) {
    url.searchParams.set("q", options.query.trim());
  }
  url.searchParams.set("limit", String(options?.limit ?? 500));

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: options?.signal ?? null,
  });

  if (!response.ok) {
    throw new Error(`Registry request failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as DatasetRegistryResponse;
  if (!Array.isArray(payload.datasets)) {
    return [];
  }

  return payload.datasets
    .filter(
      (dataset): dataset is Partial<DatasetEntry> & Pick<DatasetEntry, "id" | "name"> =>
        typeof dataset === "object" &&
        dataset !== null &&
        "id" in dataset &&
        "name" in dataset &&
        typeof dataset.id === "string" &&
        typeof dataset.name === "string",
    )
    .map((dataset) => normalizeDatasetEntry(dataset));
}

export async function fetchDatasetProviders(options?: {
  query?: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<DatasetProvider[]> {
  const url = new URL(resolveDatasetProvidersRequestUrl());
  if (options?.query && options.query.trim().length > 0) {
    url.searchParams.set("q", options.query.trim());
  }
  url.searchParams.set("limit", String(options?.limit ?? 100));

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: options?.signal ?? null,
  });

  if (!response.ok) {
    throw new Error(
      `Dataset providers request failed: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as DatasetProvidersResponse;
  if (!Array.isArray(payload.providers)) {
    return [];
  }

  return payload.providers
    .map((provider) => normalizeDatasetProvider(provider))
    .filter((provider): provider is DatasetProvider => provider !== null);
}

export function datasetToSlug(dataset: Pick<DatasetEntry, "id" | "name">): string {
  const fromName = dataset.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (fromName.length > 0) return fromName;
  return dataset.id;
}

export function buildDatasetMentionRef(dataset: Pick<DatasetEntry, "id" | "name">): string {
  return `@dataset:${datasetToSlug(dataset)}`;
}

export function buildProviderMentionRef(provider: Pick<DatasetProvider, "slug">): string {
  return `@provider:${provider.slug}`;
}

export function truncateProviderChipLabel(provider: Pick<DatasetProvider, "name">): string {
  const name = provider.name ?? "";
  if (name.length <= 35) return name;
  return `${name.slice(0, 32)}...`;
}

export function resolveSourcePaperUrl(
  sourcePaper: Pick<DatasetSourcePaper, "slug"> & Partial<Pick<DatasetSourcePaper, "url">>,
): string {
  if (typeof sourcePaper.url === "string" && sourcePaper.url.length > 0) {
    return new URL(sourcePaper.url, resolveRegistryBaseUrl()).toString();
  }

  return new URL(
    `/papers/${encodeURIComponent(sourcePaper.slug)}`,
    resolveRegistryBaseUrl(),
  ).toString();
}
