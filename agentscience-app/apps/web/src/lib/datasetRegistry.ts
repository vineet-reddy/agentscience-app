import { resolveServerUrl } from "./utils";

const DATASET_REGISTRY_PROXY_PATH = "/api/datasets/registry";
const DATASET_REGISTRY_CHECK_PROXY_PATH = "/api/datasets/registry/check";
const DATASET_REGISTRY_INSPECT_PROXY_PATH = "/api/datasets/registry/inspect";
const DATASET_PROVIDERS_PROXY_PATH = "/api/datasets/registry/providers";
const DATASET_TOPICS_PROXY_PATH = "/api/datasets/registry/topics";
const DEFAULT_AGENTSCIENCE_BASE_URL = "https://agentscience.app";

export type DatasetProviderSearchKind = "GRAPHQL" | "REST" | "HTML";

/** Closed vocabulary — mirrors the DatasetArea enum in the web Prisma schema. */
export const DATASET_AREA_KEYS = [
  "LIFE_SCIENCES",
  "MEDICINE_HEALTH",
  "SOCIAL_SCIENCES",
  "PHYSICAL_SCIENCES",
  "EARTH_ENVIRONMENT",
  "COMPUTING_ENGINEERING",
  "MATH_STATISTICS",
  "HUMANITIES",
  "OTHER",
] as const;

export type DatasetAreaKey = (typeof DATASET_AREA_KEYS)[number];

export interface DatasetAreaMeta {
  key: DatasetAreaKey;
  name: string;
  description: string;
}

export type DatasetTopicStatus = "ACTIVE" | "PENDING";

export interface DatasetTopicSummary {
  id: string;
  slug: string;
  name: string;
  area: DatasetAreaKey;
}

export interface DatasetTopic extends DatasetTopicSummary {
  description: string | null;
  agentInstructions: string | null;
  status: DatasetTopicStatus;
  providerCount: number;
  datasetCount: number;
  createdAt: string;
}

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
  topics: DatasetTopicSummary[];
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
  topics: DatasetTopicSummary[];
}

export interface DatasetRegistryResponse {
  datasets: unknown[];
}

export interface DatasetRegistryCandidateInput {
  name: string;
  shortName?: string | null;
  url: string;
  description: string;
  keywords?: string[];
  providerSlug?: string | null;
  topicSlugs?: string[];
  registryEligible?: boolean;
}

export type DatasetRegistryCheckStatus = "registered" | "possible-duplicate" | "new";

export interface DatasetRegistryCheckResult {
  candidate: {
    name: string;
    shortName: string | null;
    url: string;
    domain: string;
    description: string;
    keywords: string[];
    providerSlug: string | null;
    topicSlugs: string[];
    unknownTopicSlugs: string[];
    registryEligible: boolean;
  };
  status: DatasetRegistryCheckStatus;
  matches: DatasetEntry[];
}

export interface DatasetRegistryCreateResult {
  dataset: DatasetEntry;
  created: boolean;
  duplicateStatus: DatasetRegistryCheckStatus;
  check: DatasetRegistryCheckResult;
}

export interface DatasetValidationReport {
  status: string;
  summary: string;
  finalUrl?: string | null;
  httpStatus?: number | null;
  title?: string | null;
  contentType?: string | null;
  directFileLinks?: string[];
  githubDataLinks?: string[];
  apiLinks?: string[];
  providerEvidence?: string[];
  license?: string | null;
  licenseStatus?: string | null;
  notes?: string[];
}

export interface DatasetStandalonePolicyResult {
  ok: boolean;
  mode: string;
  errors: string[];
  identifiers: Record<string, string> | null;
}

export interface DatasetRegistryInspectResult {
  candidate: DatasetRegistryCandidateInput;
  check: DatasetRegistryCheckResult | null;
  validation: DatasetValidationReport | null;
  validationLines: string[];
  standalonePolicy: DatasetStandalonePolicyResult | null;
  standalonePolicyLines: string[];
  provider: DatasetProvider | null;
  hydratedFrom: "registered-match" | "provider-url-template" | "url";
}

export interface DatasetProvidersResponse {
  providers: unknown[];
}

export interface DatasetTopicsResponse {
  areas: unknown[];
  topics: unknown[];
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

function resolveDatasetRegistryCheckRequestUrl(): string {
  if (shouldUseEmbeddedRegistryProxy()) {
    return resolveServerUrl({
      protocol: "http",
      pathname: DATASET_REGISTRY_CHECK_PROXY_PATH,
      searchParams: {},
    });
  }

  return new URL("/api/v1/registry/check", resolveRegistryBaseUrl()).toString();
}

function resolveDatasetRegistryInspectRequestUrl(): string {
  if (shouldUseEmbeddedRegistryProxy()) {
    return resolveServerUrl({
      protocol: "http",
      pathname: DATASET_REGISTRY_INSPECT_PROXY_PATH,
      searchParams: {},
    });
  }

  return new URL(DATASET_REGISTRY_INSPECT_PROXY_PATH, window.location.origin).toString();
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

function resolveDatasetTopicsRequestUrl(): string {
  if (shouldUseEmbeddedRegistryProxy()) {
    return resolveServerUrl({
      protocol: "http",
      pathname: DATASET_TOPICS_PROXY_PATH,
      searchParams: {},
    });
  }

  return new URL("/api/v1/registry/topics", resolveRegistryBaseUrl()).toString();
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

function isDatasetAreaKey(value: unknown): value is DatasetAreaKey {
  return typeof value === "string" && (DATASET_AREA_KEYS as readonly string[]).includes(value);
}

function normalizeTopicSummary(value: unknown): DatasetTopicSummary | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const slug = typeof record.slug === "string" ? record.slug : null;
  const name = typeof record.name === "string" ? record.name : null;
  const area = isDatasetAreaKey(record.area) ? record.area : null;
  if (!id || !slug || !name || !area) return null;
  return { id, slug, name, area };
}

function normalizeTopicSummaries(value: unknown): DatasetTopicSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const topic = normalizeTopicSummary(entry);
    return topic ? [topic] : [];
  });
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
    topics: normalizeTopicSummaries((dataset as { topics?: unknown }).topics),
  };
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as Record<string, unknown>).error;
    if (typeof error === "string" && error.trim().length > 0) {
      return error;
    }
  }
  return fallback;
}

function normalizeDatasetRegistryCheckResult(value: unknown): DatasetRegistryCheckResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const candidateRecord =
    record.candidate && typeof record.candidate === "object"
      ? (record.candidate as Record<string, unknown>)
      : null;
  const status = record.status;
  if (
    !candidateRecord ||
    (status !== "registered" && status !== "possible-duplicate" && status !== "new")
  ) {
    return null;
  }

  return {
    candidate: {
      name: typeof candidateRecord.name === "string" ? candidateRecord.name : "",
      shortName:
        typeof candidateRecord.shortName === "string" ? candidateRecord.shortName : null,
      url: typeof candidateRecord.url === "string" ? candidateRecord.url : "",
      domain: typeof candidateRecord.domain === "string" ? candidateRecord.domain : "",
      description:
        typeof candidateRecord.description === "string" ? candidateRecord.description : "",
      keywords: normalizeStringArray(candidateRecord.keywords),
      providerSlug:
        typeof candidateRecord.providerSlug === "string" ? candidateRecord.providerSlug : null,
      topicSlugs: normalizeStringArray(candidateRecord.topicSlugs),
      unknownTopicSlugs: normalizeStringArray(candidateRecord.unknownTopicSlugs),
      registryEligible:
        typeof candidateRecord.registryEligible === "boolean"
          ? candidateRecord.registryEligible
          : true,
    },
    status,
    matches: Array.isArray(record.matches)
      ? record.matches
          .filter(
            (dataset): dataset is Partial<DatasetEntry> & Pick<DatasetEntry, "id" | "name"> =>
              typeof dataset === "object" &&
              dataset !== null &&
              "id" in dataset &&
              "name" in dataset &&
              typeof dataset.id === "string" &&
              typeof dataset.name === "string",
          )
          .map((dataset) => normalizeDatasetEntry(dataset))
      : [],
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
    topics: normalizeTopicSummaries(record.topics),
  };
}

function normalizeTopicStatus(value: unknown): DatasetTopicStatus {
  return value === "PENDING" ? "PENDING" : "ACTIVE";
}

function normalizeDatasetTopic(value: unknown): DatasetTopic | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const slug = typeof record.slug === "string" ? record.slug : null;
  const name = typeof record.name === "string" ? record.name : null;
  const area = isDatasetAreaKey(record.area) ? record.area : null;
  if (!id || !slug || !name || !area) return null;
  return {
    id,
    slug,
    name,
    area,
    description: typeof record.description === "string" ? record.description : null,
    agentInstructions:
      typeof record.agentInstructions === "string" ? record.agentInstructions : null,
    status: normalizeTopicStatus(record.status),
    providerCount: typeof record.providerCount === "number" ? record.providerCount : 0,
    datasetCount: typeof record.datasetCount === "number" ? record.datasetCount : 0,
    createdAt:
      typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
  };
}

function normalizeDatasetAreaMeta(value: unknown): DatasetAreaMeta | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const key = isDatasetAreaKey(record.key) ? record.key : null;
  const name = typeof record.name === "string" ? record.name : null;
  const description = typeof record.description === "string" ? record.description : null;
  if (!key || !name) return null;
  return { key, name, description: description ?? "" };
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
  area?: DatasetAreaKey;
  topicSlug?: string;
  signal?: AbortSignal;
}): Promise<DatasetEntry[]> {
  const url = new URL(resolveDatasetRegistryRequestUrl());
  if (options?.query && options.query.trim().length > 0) {
    url.searchParams.set("q", options.query.trim());
  }
  if (options?.area) {
    url.searchParams.set("area", options.area);
  }
  if (options?.topicSlug) {
    url.searchParams.set("topic", options.topicSlug);
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

export async function checkDatasetRegistryCandidate(
  dataset: DatasetRegistryCandidateInput,
  options?: { signal?: AbortSignal },
): Promise<DatasetRegistryCheckResult> {
  const response = await fetch(resolveDatasetRegistryCheckRequestUrl(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ datasets: [dataset] }),
    signal: options?.signal ?? null,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      extractErrorMessage(
        payload,
        `Registry check failed: ${response.status} ${response.statusText}`,
      ),
    );
  }

  const datasets = Array.isArray((payload as { datasets?: unknown[] } | null)?.datasets)
    ? (payload as { datasets: unknown[] }).datasets
    : [];
  const result = normalizeDatasetRegistryCheckResult(datasets[0]);
  if (!result) {
    throw new Error("Registry check returned an unexpected response.");
  }
  return result;
}

function normalizeDatasetValidationReport(value: unknown): DatasetValidationReport | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const status = typeof record.status === "string" ? record.status : null;
  const summary = typeof record.summary === "string" ? record.summary : null;
  if (!status || !summary) return null;
  return {
    status,
    summary,
    finalUrl: typeof record.finalUrl === "string" ? record.finalUrl : null,
    httpStatus: typeof record.httpStatus === "number" ? record.httpStatus : null,
    title: typeof record.title === "string" ? record.title : null,
    contentType: typeof record.contentType === "string" ? record.contentType : null,
    directFileLinks: normalizeStringArray(record.directFileLinks),
    githubDataLinks: normalizeStringArray(record.githubDataLinks),
    apiLinks: normalizeStringArray(record.apiLinks),
    providerEvidence: normalizeStringArray(record.providerEvidence),
    license: typeof record.license === "string" ? record.license : null,
    licenseStatus: typeof record.licenseStatus === "string" ? record.licenseStatus : null,
    notes: normalizeStringArray(record.notes),
  };
}

function normalizeStandalonePolicyResult(value: unknown): DatasetStandalonePolicyResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.ok !== "boolean" || typeof record.mode !== "string") return null;
  const rawIdentifiers =
    record.identifiers && typeof record.identifiers === "object"
      ? (record.identifiers as Record<string, unknown>)
      : null;
  const identifiers = rawIdentifiers
    ? Object.fromEntries(
        Object.entries(rawIdentifiers).flatMap(([key, value]) =>
          typeof value === "string" ? [[key, value]] : [],
        ),
      )
    : null;
  return {
    ok: record.ok,
    mode: record.mode,
    errors: normalizeStringArray(record.errors),
    identifiers,
  };
}

export async function inspectDatasetRegistryCandidate(
  input: {
    url: string;
    candidate?: Partial<DatasetRegistryCandidateInput>;
  },
  options?: { signal?: AbortSignal },
): Promise<DatasetRegistryInspectResult> {
  const response = await fetch(resolveDatasetRegistryInspectRequestUrl(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    signal: options?.signal ?? null,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      extractErrorMessage(
        payload,
        `Registry inspection failed: ${response.status} ${response.statusText}`,
      ),
    );
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("Registry inspection returned an unexpected response.");
  }

  const record = payload as Record<string, unknown>;
  const candidateRecord =
    record.candidate && typeof record.candidate === "object"
      ? (record.candidate as Record<string, unknown>)
      : null;
  if (!candidateRecord) {
    throw new Error("Registry inspection did not return a dataset candidate.");
  }

  const candidate: DatasetRegistryCandidateInput = {
    name: typeof candidateRecord.name === "string" ? candidateRecord.name : "",
    shortName:
      typeof candidateRecord.shortName === "string" ? candidateRecord.shortName : null,
    url: typeof candidateRecord.url === "string" ? candidateRecord.url : input.url,
    description:
      typeof candidateRecord.description === "string" ? candidateRecord.description : "",
    keywords: normalizeStringArray(candidateRecord.keywords),
    providerSlug:
      typeof candidateRecord.providerSlug === "string" ? candidateRecord.providerSlug : null,
    topicSlugs: normalizeStringArray(candidateRecord.topicSlugs),
    registryEligible:
      typeof candidateRecord.registryEligible === "boolean"
        ? candidateRecord.registryEligible
        : true,
  };

  return {
    candidate,
    check: normalizeDatasetRegistryCheckResult(record.check),
    validation: normalizeDatasetValidationReport(record.validation),
    validationLines: normalizeStringArray(record.validationLines),
    standalonePolicy: normalizeStandalonePolicyResult(record.standalonePolicy),
    standalonePolicyLines: normalizeStringArray(record.standalonePolicyLines),
    provider: normalizeDatasetProvider(record.provider),
    hydratedFrom:
      record.hydratedFrom === "registered-match" ||
      record.hydratedFrom === "provider-url-template" ||
      record.hydratedFrom === "url"
        ? record.hydratedFrom
        : "url",
  };
}

export async function createDatasetRegistryEntry(
  dataset: DatasetRegistryCandidateInput,
  options?: { signal?: AbortSignal },
): Promise<DatasetRegistryCreateResult> {
  const response = await fetch(resolveDatasetRegistryRequestUrl(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(dataset),
    signal: options?.signal ?? null,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      extractErrorMessage(
        payload,
        `Registry write failed: ${response.status} ${response.statusText}`,
      ),
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Registry write returned an unexpected response.");
  }
  const record = payload as Record<string, unknown>;
  const rawDataset = record.dataset;
  if (
    !rawDataset ||
    typeof rawDataset !== "object" ||
    typeof (rawDataset as Record<string, unknown>).id !== "string" ||
    typeof (rawDataset as Record<string, unknown>).name !== "string"
  ) {
    throw new Error("Registry write did not return a dataset.");
  }

  const check = normalizeDatasetRegistryCheckResult(record.check);
  if (!check) {
    throw new Error("Registry write did not return a validation result.");
  }

  const duplicateStatus = record.duplicateStatus;
  return {
    dataset: normalizeDatasetEntry(
      rawDataset as Partial<DatasetEntry> & Pick<DatasetEntry, "id" | "name">,
    ),
    created: record.created === true,
    duplicateStatus:
      duplicateStatus === "registered" ||
      duplicateStatus === "possible-duplicate" ||
      duplicateStatus === "new"
        ? duplicateStatus
        : check.status,
    check,
  };
}

export async function fetchDatasetProviders(options?: {
  query?: string;
  limit?: number;
  area?: DatasetAreaKey;
  topicSlug?: string;
  signal?: AbortSignal;
}): Promise<DatasetProvider[]> {
  const url = new URL(resolveDatasetProvidersRequestUrl());
  if (options?.query && options.query.trim().length > 0) {
    url.searchParams.set("q", options.query.trim());
  }
  if (options?.area) {
    url.searchParams.set("area", options.area);
  }
  if (options?.topicSlug) {
    url.searchParams.set("topic", options.topicSlug);
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

export interface FetchDatasetTopicsResult {
  areas: DatasetAreaMeta[];
  topics: DatasetTopic[];
}

/**
 * Fetch the registry taxonomy: the closed set of Areas plus ACTIVE Topics
 * (optionally scoped to an Area). The response also drives the registration
 * flow — callers know which slugs are valid before POSTing a dataset.
 */
export async function fetchDatasetTopics(options?: {
  area?: DatasetAreaKey;
  query?: string;
  limit?: number;
  includePending?: boolean;
  signal?: AbortSignal;
}): Promise<FetchDatasetTopicsResult> {
  const url = new URL(resolveDatasetTopicsRequestUrl());
  if (options?.area) {
    url.searchParams.set("area", options.area);
  }
  if (options?.query && options.query.trim().length > 0) {
    url.searchParams.set("q", options.query.trim());
  }
  if (options?.includePending) {
    url.searchParams.set("includePending", "true");
  }
  url.searchParams.set("limit", String(options?.limit ?? 200));

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: options?.signal ?? null,
  });

  if (!response.ok) {
    throw new Error(
      `Dataset topics request failed: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as DatasetTopicsResponse;
  const areas = Array.isArray(payload.areas)
    ? payload.areas.flatMap((area) => {
        const normalized = normalizeDatasetAreaMeta(area);
        return normalized ? [normalized] : [];
      })
    : [];
  const topics = Array.isArray(payload.topics)
    ? payload.topics.flatMap((topic) => {
        const normalized = normalizeDatasetTopic(topic);
        return normalized ? [normalized] : [];
      })
    : [];

  return { areas, topics };
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
