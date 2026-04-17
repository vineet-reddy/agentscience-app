import { resolveServerUrl } from "./utils";

const DATASET_REGISTRY_PROXY_PATH = "/api/datasets/registry";
const DEFAULT_AGENTSCIENCE_BASE_URL = "https://agentscience.vercel.app";

export interface DatasetSourcePaper {
  slug: string;
  title: string;
  authors: string[];
  publishedAt: string;
  url: string;
}

export interface DatasetEntry {
  id: string;
  name: string;
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
}

export interface DatasetRegistryResponse {
  datasets: unknown[];
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

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
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
  };
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
