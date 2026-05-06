import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import Mime from "@effect/platform-node/Mime";
import { Data, Effect, FileSystem, Layer, Option, Path } from "effect";
import { cast } from "effect/Function";
import {
  HttpBody,
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServerResponse,
  HttpServerRequest,
} from "effect/unstable/http";
import { OtlpTracer } from "effect/unstable/observability";

import {
  ATTACHMENTS_ROUTE_PREFIX,
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachmentPaths.ts";
import { resolveAttachmentPathById } from "./attachmentStore.ts";
import { ServerConfig } from "./config.ts";
import { decodeOtlpTraceRecords } from "./observability/TraceRecord.ts";
import { BrowserTraceCollector } from "./observability/Services/BrowserTraceCollector.ts";
import {
  LOCAL_PAPERS_ROUTE_PREFIX,
  PAPER_REVIEW_ROUTE_PREFIX,
  ThreadId,
  type LocalPapersListResponse,
  type LocalPaperPublishResponse,
} from "@agentscience/contracts";
import { LocalPapersService } from "./localPapers.ts";
import { PaperReviewService } from "./paperReview.ts";
import { ProjectFaviconResolver } from "./project/Services/ProjectFaviconResolver.ts";
import { ServerRuntimeStartup } from "./serverRuntimeStartup.ts";
import { AgentScienceAuthService } from "./agentScienceAuth.ts";

const DESKTOP_READY_PATH = "/api/desktop/ready";
const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";
const FALLBACK_PROJECT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;
const OTLP_TRACES_PROXY_PATH = "/api/observability/v1/traces";
const DATASET_REGISTRY_PROXY_PATH = "/api/datasets/registry";
const DATASET_REGISTRY_CHECK_PROXY_PATH = "/api/datasets/registry/check";
const DATASET_REGISTRY_INSPECT_PROXY_PATH = "/api/datasets/registry/inspect";
const DATASET_REGISTRY_PROVIDERS_PROXY_PATH = "/api/datasets/registry/providers";
const DATASET_REGISTRY_TOPICS_PROXY_PATH = "/api/datasets/registry/topics";
const DATASET_REGISTRY_DEFAULT_LIMIT = 500;
const DATASET_REGISTRY_MAX_LIMIT = 500;
const DATASET_PROVIDERS_DEFAULT_LIMIT = 100;
const DATASET_PROVIDERS_MAX_LIMIT = 200;
const DATASET_TOPICS_DEFAULT_LIMIT = 200;
const DATASET_TOPICS_MAX_LIMIT = 500;

class DecodeOtlpTraceRecordsError extends Data.TaggedError("DecodeOtlpTraceRecordsError")<{
  readonly cause: unknown;
  readonly bodyJson: OtlpTracer.TraceData;
}> {}

class DatasetRegistryProxyError extends Data.TaggedError("DatasetRegistryProxyError")<{
  readonly cause: unknown;
  readonly upstreamUrl: string;
}> {}

class DatasetRegistryPostProxyError extends Data.TaggedError(
  "DatasetRegistryPostProxyError",
)<{
  readonly cause: unknown;
  readonly upstreamUrl: string;
}> {}

class DatasetProvidersProxyError extends Data.TaggedError("DatasetProvidersProxyError")<{
  readonly cause: unknown;
  readonly upstreamUrl: string;
}> {}

class DatasetTopicsProxyError extends Data.TaggedError("DatasetTopicsProxyError")<{
  readonly cause: unknown;
  readonly upstreamUrl: string;
}> {}

type NormalizedDatasetSourcePaper = {
  slug: string;
  title: string;
  authors: string[];
  publishedAt: string;
  url: string;
};

type NormalizedPaperSummary = NormalizedDatasetSourcePaper & {
  id: string;
};

type DatasetRegistryCandidate = {
  name: string;
  shortName?: string | null | undefined;
  url: string;
  description: string;
  keywords?: string[] | undefined;
  providerSlug?: string | null | undefined;
  topicSlugs?: string[] | undefined;
  registryEligible?: boolean | undefined;
};

type RegistryProvider = {
  slug: string;
  name: string;
  domain: string;
  homeUrl?: string | undefined;
  description?: string | undefined;
  searchKind?: string | null | undefined;
  searchEndpoint?: string | null | undefined;
  searchQueryTemplate?: string | null | undefined;
  datasetUrlTemplate?: string | null | undefined;
  agentInstructions?: string | null | undefined;
  topics?: Array<{ slug?: string; name?: string }>;
};

type DatasetValidationModule = {
  validateDatasetCandidate: (candidate: DatasetRegistryCandidate) => Promise<unknown>;
  formatDatasetValidationLines: (report: unknown) => string[];
};

type StandalonePolicyModule = {
  evaluateStandaloneRegistryPolicy: (input: {
    candidate: DatasetRegistryCandidate;
    provider: RegistryProvider | null;
    knownTopicSlugs: Set<string> | null;
  }) => unknown;
  formatStandaloneRegistryPolicyLines: (policy: unknown) => string[];
  extractProviderDatasetIdentifiers: (
    template: string,
    datasetUrl: string,
    providerDomain: string,
  ) => Record<string, string> | null;
};

const requireFromServer = createRequire(import.meta.url);
let agentScienceCliModulesPromise:
  | Promise<{
      validation: DatasetValidationModule;
      standalonePolicy: StandalonePolicyModule;
    }>
  | null = null;

function parsePositiveInt(value: string | null, fallback: number, max = DATASET_REGISTRY_MAX_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(max, Math.floor(parsed));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeDatasetUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Dataset URL must use http or https.");
  }
  parsed.hash = "";
  if (parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  return parsed.toString();
}

function normalizeUrlDomain(value: string): string {
  return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
}

function slugifyValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function providerFromUnknown(value: unknown): RegistryProvider | null {
  if (!isRecord(value)) return null;
  const slug = typeof value.slug === "string" ? value.slug : null;
  const name = typeof value.name === "string" ? value.name : null;
  const domain = typeof value.domain === "string" ? value.domain : null;
  if (!slug || !name || !domain) return null;
  return {
    slug,
    name,
    domain,
    homeUrl: typeof value.homeUrl === "string" ? value.homeUrl : undefined,
    description: typeof value.description === "string" ? value.description : undefined,
    searchKind: typeof value.searchKind === "string" ? value.searchKind : null,
    searchEndpoint: typeof value.searchEndpoint === "string" ? value.searchEndpoint : null,
    searchQueryTemplate:
      typeof value.searchQueryTemplate === "string" ? value.searchQueryTemplate : null,
    datasetUrlTemplate:
      typeof value.datasetUrlTemplate === "string" ? value.datasetUrlTemplate : null,
    agentInstructions:
      typeof value.agentInstructions === "string" ? value.agentInstructions : null,
    topics: Array.isArray(value.topics)
      ? value.topics.flatMap((topic) =>
          isRecord(topic) && typeof topic.slug === "string"
            ? [{ slug: topic.slug, name: typeof topic.name === "string" ? topic.name : topic.slug }]
            : [],
        )
      : [],
  };
}

function findProviderForUrl(providers: RegistryProvider[], url: string): RegistryProvider | null {
  const domain = normalizeUrlDomain(url);
  return (
    providers.find((provider) => provider.domain.toLowerCase() === domain) ??
    providers.find((provider) => domain.endsWith(`.${provider.domain.toLowerCase()}`)) ??
    null
  );
}

function extractFallbackDatasetIdentifier(parsedUrl: URL): string {
  const queryId =
    parsedUrl.searchParams.get("id") ??
    parsedUrl.searchParams.get("dataset") ??
    parsedUrl.searchParams.get("accession") ??
    null;
  if (queryId) return queryId;
  const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
  const datasetIndex = pathSegments.findIndex((segment) => segment.toLowerCase() === "datasets");
  if (datasetIndex >= 0 && pathSegments[datasetIndex + 1]) {
    return decodeURIComponent(pathSegments[datasetIndex + 1]!);
  }
  return decodeURIComponent(pathSegments[pathSegments.length - 1] ?? "");
}

function firstProviderIdentifier(
  identifiers: Record<string, string> | null | undefined,
): string | null {
  if (!identifiers) return null;
  return (
    identifiers.studyId ??
    identifiers.datasetId ??
    identifiers.articleId ??
    identifiers.recordId ??
    identifiers.id ??
    Object.values(identifiers)[0] ??
    null
  );
}

async function loadAgentScienceCliModules() {
  agentScienceCliModulesPromise ??= (async () => {
    const packageJsonPath = requireFromServer.resolve("agentscience/package.json");
    const packageRoot = dirname(packageJsonPath);
    const validation = (await import(
      pathToFileURL(join(packageRoot, "lib/dataset-validation.mjs")).href
    )) as DatasetValidationModule;
    const standalonePolicy = (await import(
      pathToFileURL(join(packageRoot, "lib/registry-standalone-policy.mjs")).href
    )) as StandalonePolicyModule;
    return { validation, standalonePolicy };
  })();
  return agentScienceCliModulesPromise;
}

function buildCandidateFromUrl(input: {
  url: string;
  provider: RegistryProvider | null;
  identifiers: Record<string, string> | null;
  overrides: Partial<DatasetRegistryCandidate>;
}): DatasetRegistryCandidate {
  const parsedUrl = new URL(input.url);
  const identifier =
    firstProviderIdentifier(input.identifiers) || extractFallbackDatasetIdentifier(parsedUrl);
  const providerName = input.provider?.name ?? normalizeUrlDomain(input.url);
  const providerSlug = input.provider?.slug ?? null;
  const topicSlugs =
    input.overrides.topicSlugs ??
    input.provider?.topics?.flatMap((topic) => (topic.slug ? [topic.slug] : [])) ??
    [];
  const providerKeyword = providerSlug ?? slugifyValue(providerName);
  const identifierKeywords = identifier
    ? identifier
        .split(/[^A-Za-z0-9]+/)
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part.length > 1)
    : [];

  return {
    name:
      input.overrides.name?.trim() ||
      (identifier ? `${providerName} ${identifier}` : `${providerName} dataset`),
    shortName:
      input.overrides.shortName === null
        ? null
        : input.overrides.shortName?.trim() ||
          (identifier && identifier.length <= 35 ? identifier : null),
    url: input.url,
    description:
      input.overrides.description?.trim() ||
      (identifier
        ? `Dataset reference for ${identifier} hosted by ${providerName}.`
        : `Dataset reference hosted by ${providerName}.`),
    keywords:
      input.overrides.keywords && input.overrides.keywords.length > 0
        ? input.overrides.keywords
        : Array.from(new Set([providerKeyword, ...identifierKeywords])).slice(0, 8),
    providerSlug: input.overrides.providerSlug ?? providerSlug,
    topicSlugs,
    registryEligible: input.overrides.registryEligible ?? true,
  };
}

function hydrateCandidateFromRegisteredMatch(
  candidate: DatasetRegistryCandidate,
  checkPayload: unknown,
): { candidate: DatasetRegistryCandidate; hydrated: boolean } {
  if (!isRecord(checkPayload) || !Array.isArray(checkPayload.datasets)) {
    return { candidate, hydrated: false };
  }
  const firstCheck = checkPayload.datasets.find(isRecord);
  if (!firstCheck || firstCheck.status !== "registered" || !Array.isArray(firstCheck.matches)) {
    return { candidate, hydrated: false };
  }
  const firstMatch = firstCheck.matches.find(isRecord);
  if (!firstMatch) return { candidate, hydrated: false };
  return {
    hydrated: true,
    candidate: {
      ...candidate,
      name: typeof firstMatch.name === "string" ? firstMatch.name : candidate.name,
      shortName:
        typeof firstMatch.shortName === "string" ? firstMatch.shortName : candidate.shortName,
      url: typeof firstMatch.url === "string" ? firstMatch.url : candidate.url,
      description:
        typeof firstMatch.description === "string"
          ? firstMatch.description
          : candidate.description,
      keywords:
        Array.isArray(firstMatch.keywords) && firstMatch.keywords.length > 0
          ? normalizeStringArray(firstMatch.keywords)
          : candidate.keywords,
      providerSlug:
        isRecord(firstMatch.provider) && typeof firstMatch.provider.slug === "string"
          ? firstMatch.provider.slug
          : candidate.providerSlug,
      topicSlugs:
        Array.isArray(firstMatch.topics) && firstMatch.topics.length > 0
          ? firstMatch.topics.flatMap((topic) =>
              isRecord(topic) && typeof topic.slug === "string" ? [topic.slug] : [],
            )
          : candidate.topicSlugs,
    },
  };
}

function resolveAbsoluteAgentScienceUrl(baseUrl: string, rawPathOrUrl: string): string {
  return new URL(rawPathOrUrl, `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

function normalizeSourcePaperSummary(
  sourcePaper: unknown,
  baseUrl: string,
): NormalizedDatasetSourcePaper | null {
  if (!isRecord(sourcePaper)) {
    return null;
  }

  const slug = typeof sourcePaper.slug === "string" ? sourcePaper.slug : null;
  const title = typeof sourcePaper.title === "string" ? sourcePaper.title : null;
  const publishedAt =
    typeof sourcePaper.publishedAt === "string" ? sourcePaper.publishedAt : null;
  if (!slug || !title || !publishedAt) {
    return null;
  }

  const authors = Array.isArray(sourcePaper.authors)
    ? sourcePaper.authors.filter((author): author is string => typeof author === "string")
    : [];
  const url =
    typeof sourcePaper.url === "string" && sourcePaper.url.length > 0
      ? resolveAbsoluteAgentScienceUrl(baseUrl, sourcePaper.url)
      : resolveAbsoluteAgentScienceUrl(baseUrl, `/papers/${encodeURIComponent(slug)}`);

  return {
    slug,
    title,
    authors,
    publishedAt,
    url,
  };
}

function normalizePaperSummary(
  paper: unknown,
  baseUrl: string,
): NormalizedPaperSummary | null {
  if (!isRecord(paper)) {
    return null;
  }

  const id = typeof paper.id === "string" ? paper.id : null;
  const slug = typeof paper.slug === "string" ? paper.slug : null;
  const title = typeof paper.title === "string" ? paper.title : null;
  const publishedAt = typeof paper.publishedAt === "string" ? paper.publishedAt : null;
  if (!id || !slug || !title || !publishedAt) {
    return null;
  }

  const authors = Array.isArray(paper.authors)
    ? paper.authors.flatMap((author) =>
        isRecord(author) && typeof author.name === "string" ? [author.name] : [],
      )
    : [];

  return {
    id,
    slug,
    title,
    authors,
    publishedAt,
    url: resolveAbsoluteAgentScienceUrl(baseUrl, `/papers/${encodeURIComponent(slug)}`),
  };
}

async function fetchPublicPaperMap(baseUrl: string): Promise<Map<string, NormalizedPaperSummary>> {
  try {
    const papersUrl = new URL("/api/v1/papers", baseUrl);
    papersUrl.searchParams.set("limit", String(DATASET_REGISTRY_MAX_LIMIT));

    const response = await fetch(papersUrl.toString(), {
      headers: {
        accept: "application/json",
      },
    });
    if (!response.ok) {
      return new Map();
    }

    const payload = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.papers)) {
      return new Map();
    }

    const entries = payload.papers.flatMap((paper) => {
      const normalized = normalizePaperSummary(paper, baseUrl);
      return normalized ? [[normalized.id, normalized] as const] : [];
    });
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function enrichDatasetRegistryPayload(
  payload: Record<string, unknown>,
  baseUrl: string,
  paperById: Map<string, NormalizedPaperSummary>,
) {
  if (!Array.isArray(payload.datasets)) {
    return payload;
  }

  return {
    ...payload,
    datasets: payload.datasets.map((dataset) => {
      if (!isRecord(dataset)) {
        return dataset;
      }

      const existingSourcePaper = normalizeSourcePaperSummary(dataset.sourcePaper, baseUrl);
      const sourcePaperId =
        typeof dataset.sourcePaperId === "string" && dataset.sourcePaperId.length > 0
          ? dataset.sourcePaperId
          : null;
      const hydratedPaper = sourcePaperId ? paperById.get(sourcePaperId) ?? null : null;
      const hydratedSourcePaper = hydratedPaper
        ? {
            slug: hydratedPaper.slug,
            title: hydratedPaper.title,
            authors: hydratedPaper.authors,
            publishedAt: hydratedPaper.publishedAt,
            url: hydratedPaper.url,
          }
        : null;
      const resolvedSourcePaper = existingSourcePaper ?? hydratedSourcePaper;
      const usedInPaperCount =
        typeof dataset.usedInPaperCount === "number"
          ? dataset.usedInPaperCount
          : resolvedSourcePaper
            ? 1
            : 0;

      return {
        ...dataset,
        sourcePaper: resolvedSourcePaper,
        usedInPaperCount,
      };
    }),
  };
}

async function loadDatasetRegistryPayload(input: {
  baseUrl: string;
  query: string | undefined;
  limit: number;
  area: string | undefined;
  topic: string | undefined;
}): Promise<unknown> {
  const registryUrl = new URL("/api/v1/registry", input.baseUrl);
  if (input.query) {
    registryUrl.searchParams.set("q", input.query);
  }
  if (input.area) {
    registryUrl.searchParams.set("area", input.area);
  }
  if (input.topic) {
    registryUrl.searchParams.set("topic", input.topic);
  }
  registryUrl.searchParams.set("limit", String(input.limit));

  const response = await fetch(registryUrl.toString(), {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Dataset registry request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.datasets)) {
    return payload;
  }

  const needsSourcePaperHydration = payload.datasets.some(
    (dataset) =>
      isRecord(dataset) &&
      typeof dataset.sourcePaperId === "string" &&
      dataset.sourcePaperId.length > 0 &&
      normalizeSourcePaperSummary(dataset.sourcePaper, input.baseUrl) === null,
  );
  const paperById = needsSourcePaperHydration
    ? await fetchPublicPaperMap(input.baseUrl)
    : new Map();

  return enrichDatasetRegistryPayload(payload, input.baseUrl, paperById);
}

async function loadDatasetProvidersPayload(input: {
  baseUrl: string;
  query: string | undefined;
  limit: number;
  area: string | undefined;
  topic: string | undefined;
}): Promise<unknown> {
  const providersUrl = new URL("/api/v1/registry/providers", input.baseUrl);
  if (input.query) {
    providersUrl.searchParams.set("q", input.query);
  }
  if (input.area) {
    providersUrl.searchParams.set("area", input.area);
  }
  if (input.topic) {
    providersUrl.searchParams.set("topic", input.topic);
  }
  providersUrl.searchParams.set("limit", String(input.limit));

  const response = await fetch(providersUrl.toString(), {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Dataset providers request failed: ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}

async function loadDatasetTopicsPayload(input: {
  baseUrl: string;
  query: string | undefined;
  limit: number;
  area: string | undefined;
  includePending: boolean;
}): Promise<unknown> {
  const topicsUrl = new URL("/api/v1/registry/topics", input.baseUrl);
  if (input.query) {
    topicsUrl.searchParams.set("q", input.query);
  }
  if (input.area) {
    topicsUrl.searchParams.set("area", input.area);
  }
  if (input.includePending) {
    topicsUrl.searchParams.set("includePending", "true");
  }
  topicsUrl.searchParams.set("limit", String(input.limit));

  const response = await fetch(topicsUrl.toString(), {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Dataset topics request failed: ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}

async function postAgentScienceJson(input: {
  baseUrl: string;
  pathname: string;
  body: unknown;
  bearerToken?: string;
}): Promise<{ status: number; payload: unknown }> {
  const upstreamUrl = new URL(input.pathname, input.baseUrl);
  const response = await fetch(upstreamUrl.toString(), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(input.bearerToken ? { authorization: `Bearer ${input.bearerToken}` } : {}),
    },
    body: JSON.stringify(input.body),
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    const text = await response.text().catch(() => "");
    payload = {
      error: text.trim().length > 0 ? text : response.statusText,
    };
  }

  return {
    status: response.status,
    payload,
  };
}

export const otlpTracesProxyRouteLayer = HttpRouter.add(
  "POST",
  OTLP_TRACES_PROXY_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig;
    const otlpTracesUrl = config.otlpTracesUrl;
    const browserTraceCollector = yield* BrowserTraceCollector;
    const httpClient = yield* HttpClient.HttpClient;
    const bodyJson = cast<unknown, OtlpTracer.TraceData>(yield* request.json);

    yield* Effect.try({
      try: () => decodeOtlpTraceRecords(bodyJson),
      catch: (cause) => new DecodeOtlpTraceRecordsError({ cause, bodyJson }),
    }).pipe(
      Effect.flatMap((records) => browserTraceCollector.record(records)),
      Effect.catch((cause) =>
        Effect.logWarning("Failed to decode browser OTLP traces", {
          cause,
          bodyJson,
        }),
      ),
    );

    if (otlpTracesUrl === undefined) {
      return HttpServerResponse.empty({ status: 204 });
    }

    return yield* httpClient
      .post(otlpTracesUrl, {
        body: HttpBody.jsonUnsafe(bodyJson),
      })
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.as(HttpServerResponse.empty({ status: 204 })),
        Effect.tapError((cause) =>
          Effect.logWarning("Failed to export browser OTLP traces", {
            cause,
            otlpTracesUrl,
          }),
        ),
        Effect.catch(() =>
          Effect.succeed(HttpServerResponse.text("Trace export failed.", { status: 502 })),
        ),
      );
  }),
).pipe(
  Layer.provide(
    HttpRouter.cors({
      allowedMethods: ["POST", "OPTIONS"],
      allowedHeaders: ["content-type"],
      maxAge: 600,
    }),
  ),
);

export const desktopReadyRouteLayer = HttpRouter.add(
  "GET",
  DESKTOP_READY_PATH,
  Effect.gen(function* () {
    const startup = yield* ServerRuntimeStartup;
    yield* startup.awaitCommandReady;
    return yield* HttpServerResponse.json({
      ready: true,
      at: new Date().toISOString(),
    });
  }),
);

export const attachmentsRouteLayer = HttpRouter.add(
  "GET",
  `${ATTACHMENTS_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig;
    const rawRelativePath = url.value.pathname.slice(ATTACHMENTS_ROUTE_PREFIX.length);
    const normalizedRelativePath = normalizeAttachmentRelativePath(rawRelativePath);
    if (!normalizedRelativePath) {
      return HttpServerResponse.text("Invalid attachment path", { status: 400 });
    }

    const isIdLookup =
      !normalizedRelativePath.includes("/") && !normalizedRelativePath.includes(".");
    const filePath = isIdLookup
      ? resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: normalizedRelativePath,
        })
      : resolveAttachmentRelativePath({
          attachmentsDir: config.attachmentsDir,
          relativePath: normalizedRelativePath,
        });
    if (!filePath) {
      return HttpServerResponse.text(isIdLookup ? "Not Found" : "Invalid attachment path", {
        status: isIdLookup ? 404 : 400,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    return yield* HttpServerResponse.file(filePath, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
      ),
    );
  }),
);

export const projectFaviconRouteLayer = HttpRouter.add(
  "GET",
  "/api/project-favicon",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const projectCwd = url.value.searchParams.get("cwd");
    if (!projectCwd) {
      return HttpServerResponse.text("Missing cwd parameter", { status: 400 });
    }

    const faviconResolver = yield* ProjectFaviconResolver;
    const faviconFilePath = yield* faviconResolver.resolvePath(projectCwd);
    if (!faviconFilePath) {
      return HttpServerResponse.text(FALLBACK_PROJECT_FAVICON_SVG, {
        status: 200,
        contentType: "image/svg+xml",
        headers: {
          "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL,
        },
      });
    }

    return yield* HttpServerResponse.file(faviconFilePath, {
      status: 200,
      headers: {
        "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL,
      },
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
      ),
    );
  }),
);

export const datasetProvidersRouteLayer = HttpRouter.add(
  "GET",
  DATASET_REGISTRY_PROVIDERS_PROXY_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig;
    const upstreamUrl = new URL("/api/v1/registry/providers", config.agentScienceBaseUrl);
    const query = url.value.searchParams.get("q")?.trim();
    const area = url.value.searchParams.get("area")?.trim();
    const topic = url.value.searchParams.get("topic")?.trim();
    const limit = parsePositiveInt(
      url.value.searchParams.get("limit"),
      DATASET_PROVIDERS_DEFAULT_LIMIT,
      DATASET_PROVIDERS_MAX_LIMIT,
    );

    if (query) {
      upstreamUrl.searchParams.set("q", query);
    }
    if (area) {
      upstreamUrl.searchParams.set("area", area);
    }
    if (topic) {
      upstreamUrl.searchParams.set("topic", topic);
    }
    upstreamUrl.searchParams.set("limit", String(limit));

    return yield* Effect.tryPromise({
      try: () =>
        loadDatasetProvidersPayload({
          baseUrl: config.agentScienceBaseUrl,
          query: query || undefined,
          limit,
          area: area || undefined,
          topic: topic || undefined,
        }),
      catch: (cause) =>
        new DatasetProvidersProxyError({
          cause,
          upstreamUrl: upstreamUrl.toString(),
        }),
    }).pipe(
      Effect.flatMap((payload) =>
        HttpServerResponse.json(payload, {
          status: 200,
          headers: {
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        }),
      ),
      Effect.tapError((cause) =>
        Effect.logWarning("Failed to load dataset providers from AgentScience", {
          cause,
          upstreamUrl: upstreamUrl.toString(),
        }),
      ),
      Effect.catchTag("DatasetProvidersProxyError", () =>
        Effect.succeed(
          HttpServerResponse.text("Dataset providers unavailable.", {
            status: 502,
            headers: {
              "Access-Control-Allow-Origin": "*",
            },
          }),
        ),
      ),
    );
  }),
);

export const datasetTopicsRouteLayer = HttpRouter.add(
  "GET",
  DATASET_REGISTRY_TOPICS_PROXY_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig;
    const upstreamUrl = new URL("/api/v1/registry/topics", config.agentScienceBaseUrl);
    const query = url.value.searchParams.get("q")?.trim();
    const area = url.value.searchParams.get("area")?.trim();
    const includePending = url.value.searchParams.get("includePending") === "true";
    const limit = parsePositiveInt(
      url.value.searchParams.get("limit"),
      DATASET_TOPICS_DEFAULT_LIMIT,
      DATASET_TOPICS_MAX_LIMIT,
    );

    if (query) {
      upstreamUrl.searchParams.set("q", query);
    }
    if (area) {
      upstreamUrl.searchParams.set("area", area);
    }
    if (includePending) {
      upstreamUrl.searchParams.set("includePending", "true");
    }
    upstreamUrl.searchParams.set("limit", String(limit));

    return yield* Effect.tryPromise({
      try: () =>
        loadDatasetTopicsPayload({
          baseUrl: config.agentScienceBaseUrl,
          query: query || undefined,
          limit,
          area: area || undefined,
          includePending,
        }),
      catch: (cause) =>
        new DatasetTopicsProxyError({
          cause,
          upstreamUrl: upstreamUrl.toString(),
        }),
    }).pipe(
      Effect.flatMap((payload) =>
        HttpServerResponse.json(payload, {
          status: 200,
          headers: {
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        }),
      ),
      Effect.tapError((cause) =>
        Effect.logWarning("Failed to load dataset topics from AgentScience", {
          cause,
          upstreamUrl: upstreamUrl.toString(),
        }),
      ),
      Effect.catchTag("DatasetTopicsProxyError", () =>
        Effect.succeed(
          HttpServerResponse.text("Dataset topics unavailable.", {
            status: 502,
            headers: {
              "Access-Control-Allow-Origin": "*",
            },
          }),
        ),
      ),
    );
  }),
);

export const datasetRegistryInspectRouteLayer = HttpRouter.add(
  "POST",
  DATASET_REGISTRY_INSPECT_PROXY_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig;
    const bodyJson = yield* request.json;

    return yield* Effect.tryPromise({
      try: async () => {
        if (!isRecord(bodyJson) || typeof bodyJson.url !== "string") {
          return {
            status: 400,
            payload: { error: "Dataset inspection requires a url." },
          };
        }

        const normalizedUrl = normalizeDatasetUrl(bodyJson.url);
        const overridesRecord = isRecord(bodyJson.candidate) ? bodyJson.candidate : {};
        const candidateOverrides: Partial<DatasetRegistryCandidate> = {};
        if (typeof overridesRecord.name === "string") {
          candidateOverrides.name = overridesRecord.name;
        }
        if (typeof overridesRecord.shortName === "string" || overridesRecord.shortName === null) {
          candidateOverrides.shortName = overridesRecord.shortName;
        }
        if (typeof overridesRecord.description === "string") {
          candidateOverrides.description = overridesRecord.description;
        }
        const overrideKeywords = normalizeStringArray(overridesRecord.keywords);
        if (overrideKeywords.length > 0) {
          candidateOverrides.keywords = overrideKeywords;
        }
        if (typeof overridesRecord.providerSlug === "string") {
          candidateOverrides.providerSlug = overridesRecord.providerSlug;
        }
        const overrideTopicSlugs = normalizeStringArray(overridesRecord.topicSlugs);
        if (overrideTopicSlugs.length > 0) {
          candidateOverrides.topicSlugs = overrideTopicSlugs;
        }
        if (typeof overridesRecord.registryEligible === "boolean") {
          candidateOverrides.registryEligible = overridesRecord.registryEligible;
        }

        const [providersPayload, topicsPayload, cliModules] = await Promise.all([
          loadDatasetProvidersPayload({
            baseUrl: config.agentScienceBaseUrl,
            query: undefined,
            limit: DATASET_PROVIDERS_MAX_LIMIT,
            area: undefined,
            topic: undefined,
          }),
          loadDatasetTopicsPayload({
            baseUrl: config.agentScienceBaseUrl,
            query: undefined,
            limit: DATASET_TOPICS_MAX_LIMIT,
            area: undefined,
            includePending: true,
          }),
          loadAgentScienceCliModules(),
        ]);

        const providers = isRecord(providersPayload) && Array.isArray(providersPayload.providers)
          ? providersPayload.providers.flatMap((provider) => {
              const normalized = providerFromUnknown(provider);
              return normalized ? [normalized] : [];
            })
          : [];
        const provider =
          (candidateOverrides.providerSlug
            ? providers.find((entry) => entry.slug === candidateOverrides.providerSlug)
            : null) ?? findProviderForUrl(providers, normalizedUrl);
        const identifiers =
          provider?.datasetUrlTemplate
            ? cliModules.standalonePolicy.extractProviderDatasetIdentifiers(
                provider.datasetUrlTemplate,
                normalizedUrl,
                provider.domain,
              )
            : null;
        const initialCandidate = buildCandidateFromUrl({
          url: normalizedUrl,
          provider,
          identifiers,
          overrides: candidateOverrides,
        });

        const firstCheck = await postAgentScienceJson({
          baseUrl: config.agentScienceBaseUrl,
          pathname: "/api/v1/registry/check",
          body: { datasets: [initialCandidate] },
        });
        const hydrated = hydrateCandidateFromRegisteredMatch(
          initialCandidate,
          firstCheck.payload,
        );
        const candidate = hydrated.candidate;
        const finalCheck = hydrated.hydrated
          ? await postAgentScienceJson({
              baseUrl: config.agentScienceBaseUrl,
              pathname: "/api/v1/registry/check",
              body: { datasets: [candidate] },
            })
          : firstCheck;

        const knownTopicSlugs =
          isRecord(topicsPayload) && Array.isArray(topicsPayload.topics)
            ? new Set(
                topicsPayload.topics.flatMap((topic) =>
                  isRecord(topic) && typeof topic.slug === "string" ? [topic.slug] : [],
                ),
              )
            : null;
        const validation = await cliModules.validation.validateDatasetCandidate(candidate);
        const validationLines = cliModules.validation.formatDatasetValidationLines(validation);
        const standalonePolicy = cliModules.standalonePolicy.evaluateStandaloneRegistryPolicy({
          candidate,
          provider,
          knownTopicSlugs,
        });
        const standalonePolicyLines =
          cliModules.standalonePolicy.formatStandaloneRegistryPolicyLines(standalonePolicy);

        return {
          status: finalCheck.status,
          payload: {
            candidate,
            check:
              isRecord(finalCheck.payload) && Array.isArray(finalCheck.payload.datasets)
                ? finalCheck.payload.datasets[0] ?? null
                : null,
            validation,
            validationLines,
            standalonePolicy,
            standalonePolicyLines,
            provider,
            hydratedFrom: hydrated.hydrated
              ? "registered-match"
              : identifiers
                ? "provider-url-template"
                : "url",
          },
        };
      },
      catch: (cause) =>
        new DatasetRegistryPostProxyError({
          cause,
          upstreamUrl: new URL("/api/v1/registry/check", config.agentScienceBaseUrl).toString(),
        }),
    }).pipe(
      Effect.flatMap(({ status, payload }) =>
        HttpServerResponse.json(payload, {
          status,
          headers: {
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        }),
      ),
      Effect.tapError((cause) =>
        Effect.logWarning("Failed to inspect dataset registry candidate", {
          cause,
        }),
      ),
      Effect.catchTag("DatasetRegistryPostProxyError", (error) =>
        HttpServerResponse.json(
          {
            error:
              error.cause instanceof Error
                ? error.cause.message
                : "Dataset registry inspection unavailable.",
          },
          {
            status: 502,
            headers: {
              "Access-Control-Allow-Origin": "*",
            },
          },
        ),
      ),
    );
  }),
);

export const datasetRegistryCheckRouteLayer = HttpRouter.add(
  "POST",
  DATASET_REGISTRY_CHECK_PROXY_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig;
    const upstreamUrl = new URL("/api/v1/registry/check", config.agentScienceBaseUrl);
    const bodyJson = yield* request.json;

    return yield* Effect.tryPromise({
      try: () =>
        postAgentScienceJson({
          baseUrl: config.agentScienceBaseUrl,
          pathname: "/api/v1/registry/check",
          body: bodyJson,
        }),
      catch: (cause) =>
        new DatasetRegistryPostProxyError({
          cause,
          upstreamUrl: upstreamUrl.toString(),
        }),
    }).pipe(
      Effect.flatMap(({ payload, status }) =>
        HttpServerResponse.json(payload, {
          status,
          headers: {
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        }),
      ),
      Effect.tapError((cause) =>
        Effect.logWarning("Failed to check dataset registry candidate with AgentScience", {
          cause,
          upstreamUrl: upstreamUrl.toString(),
        }),
      ),
      Effect.catchTag("DatasetRegistryPostProxyError", () =>
        HttpServerResponse.json(
          { error: "Dataset registry check unavailable." },
          {
            status: 502,
            headers: {
              "Access-Control-Allow-Origin": "*",
            },
          },
        ),
      ),
    );
  }),
);

export const datasetRegistryCreateRouteLayer = HttpRouter.add(
  "POST",
  DATASET_REGISTRY_PROXY_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig;
    const agentScienceAuth = yield* AgentScienceAuthService;
    const upstreamUrl = new URL("/api/v1/registry", config.agentScienceBaseUrl);
    const bodyJson = yield* request.json;
    const authState = yield* agentScienceAuth.getState;
    const token = yield* agentScienceAuth.getBearerToken;

    if (authState.status !== "signed-in" || !authState.user || !token) {
      return yield* HttpServerResponse.json(
        { error: "Connect this device to AgentScience before adding datasets." },
        {
          status: 401,
          headers: {
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }

    return yield* Effect.tryPromise({
      try: () =>
        postAgentScienceJson({
          baseUrl: config.agentScienceBaseUrl,
          pathname: "/api/v1/registry",
          body: bodyJson,
          bearerToken: token,
        }),
      catch: (cause) =>
        new DatasetRegistryPostProxyError({
          cause,
          upstreamUrl: upstreamUrl.toString(),
        }),
    }).pipe(
      Effect.flatMap(({ payload, status }) =>
        HttpServerResponse.json(payload, {
          status,
          headers: {
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        }),
      ),
      Effect.tapError((cause) =>
        Effect.logWarning("Failed to create dataset registry entry with AgentScience", {
          cause,
          upstreamUrl: upstreamUrl.toString(),
        }),
      ),
      Effect.catchTag("DatasetRegistryPostProxyError", () =>
        HttpServerResponse.json(
          { error: "Dataset registry write unavailable." },
          {
            status: 502,
            headers: {
              "Access-Control-Allow-Origin": "*",
            },
          },
        ),
      ),
    );
  }),
);

export const datasetRegistryRouteLayer = HttpRouter.add(
  "GET",
  DATASET_REGISTRY_PROXY_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig;
    const upstreamUrl = new URL("/api/v1/registry", config.agentScienceBaseUrl);
    const query = url.value.searchParams.get("q")?.trim();
    const area = url.value.searchParams.get("area")?.trim();
    const topic = url.value.searchParams.get("topic")?.trim();
    const limit = parsePositiveInt(
      url.value.searchParams.get("limit"),
      DATASET_REGISTRY_DEFAULT_LIMIT,
    );

    if (query) {
      upstreamUrl.searchParams.set("q", query);
    }
    if (area) {
      upstreamUrl.searchParams.set("area", area);
    }
    if (topic) {
      upstreamUrl.searchParams.set("topic", topic);
    }
    upstreamUrl.searchParams.set("limit", String(limit));

    return yield* Effect.tryPromise({
      try: () =>
        loadDatasetRegistryPayload({
          baseUrl: config.agentScienceBaseUrl,
          query: query || undefined,
          limit,
          area: area || undefined,
          topic: topic || undefined,
        }),
      catch: (cause) =>
        new DatasetRegistryProxyError({
          cause,
          upstreamUrl: upstreamUrl.toString(),
        }),
    }).pipe(
      Effect.flatMap((payload) =>
        HttpServerResponse.json(payload, {
          status: 200,
          headers: {
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        }),
      ),
      Effect.tapError((cause) =>
        Effect.logWarning("Failed to load dataset registry from AgentScience", {
          cause,
          upstreamUrl: upstreamUrl.toString(),
        }),
      ),
      Effect.catchTag("DatasetRegistryProxyError", () =>
        Effect.succeed(
          HttpServerResponse.text("Dataset registry unavailable.", {
            status: 502,
            headers: {
              "Access-Control-Allow-Origin": "*",
            },
          }),
        ),
      ),
    );
  }),
);

function decodePaperReviewSegments(rawPathname: string): string[] {
  return rawPathname
    .slice(PAPER_REVIEW_ROUTE_PREFIX.length)
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));
}

export const paperReviewSnapshotRouteLayer = HttpRouter.add(
  "GET",
  `${PAPER_REVIEW_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const segments = decodePaperReviewSegments(url.value.pathname);
    const threadIdSegment = segments[0];
    if (segments.length === 1 && threadIdSegment) {
      const paperReview = yield* PaperReviewService;
      const snapshot = yield* paperReview.getSnapshot(ThreadId.makeUnsafe(threadIdSegment));
      return yield* HttpServerResponse.json(snapshot);
    }

    if (segments.length >= 3 && threadIdSegment && segments[1] === "files") {
      const paperReview = yield* PaperReviewService;
      const relativePath = segments.slice(2).join("/");
      const filePath = yield* paperReview.resolveFilePath(
        ThreadId.makeUnsafe(threadIdSegment),
        relativePath,
      );
      if (!filePath) {
        return HttpServerResponse.text("Not Found", { status: 404 });
      }

      return yield* HttpServerResponse.file(filePath, {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      }).pipe(
        Effect.catch(() =>
          Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
        ),
      );
    }

    return HttpServerResponse.text("Not Found", { status: 404 });
  }),
);

export const paperReviewCompileRouteLayer = HttpRouter.add(
  "POST",
  `${PAPER_REVIEW_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const segments = decodePaperReviewSegments(url.value.pathname);
    const threadIdSegment = segments[0];
    if (segments.length === 2 && threadIdSegment && segments[1] === "compile") {
      const paperReview = yield* PaperReviewService;
      const snapshot = yield* paperReview.compile(ThreadId.makeUnsafe(threadIdSegment));
      return yield* HttpServerResponse.json(snapshot);
    }

    return HttpServerResponse.text("Not Found", { status: 404 });
  }),
);

function decodeLocalPapersSegments(rawPathname: string): string[] {
  return rawPathname
    .slice(LOCAL_PAPERS_ROUTE_PREFIX.length)
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));
}

/**
 * Single GET handler for the entire `/api/papers` subtree. We intentionally
 * register this as one `/*` catch-all (matching `paperReviewSnapshotRouteLayer`
 * above) because find-my-way-ts treats `/api/papers/*` and `/api/papers`
 * as the same route key, so registering them separately errors at startup
 * with "Method 'GET' already declared".
 *
 * Shape:
 *   GET /api/papers                         — list all local papers
 *   GET /api/papers/:paperId/files/<path>   — serve a file from a paper folder
 *   POST /api/papers/:paperId/publish       — publish or update a local paper on AgentScience
 */
export const localPapersRouteLayer = HttpRouter.add(
  "GET",
  `${LOCAL_PAPERS_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const segments = decodeLocalPapersSegments(url.value.pathname);
    const localPapers = yield* LocalPapersService;

    if (segments.length === 0) {
      const papers = yield* localPapers.list();
      const body: LocalPapersListResponse = { papers };
      return yield* HttpServerResponse.json(body);
    }

    // GET /api/papers/:id/files/<path>
    if (segments.length >= 3 && segments[1] === "files") {
      const paperIdSegment = segments[0];
      if (!paperIdSegment) {
        return HttpServerResponse.text("Not Found", { status: 404 });
      }
      const relativePath = segments.slice(2).join("/");
      const filePath = yield* localPapers.resolveFilePath(paperIdSegment, relativePath);
      if (!filePath) {
        return HttpServerResponse.text("Not Found", { status: 404 });
      }
      return yield* HttpServerResponse.file(filePath, {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      }).pipe(
        Effect.catch(() =>
          Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
        ),
      );
    }

    return HttpServerResponse.text("Not Found", { status: 404 });
  }),
);

export const localPapersPublishRouteLayer = HttpRouter.add(
  "POST",
  `${LOCAL_PAPERS_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const segments = decodeLocalPapersSegments(url.value.pathname);
    if (segments.length !== 2 || segments[1] !== "publish") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const paperIdSegment = segments[0];
    if (!paperIdSegment) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const localPapers = yield* LocalPapersService;
    return yield* localPapers.publish(paperIdSegment).pipe(
      Effect.matchEffect({
        onFailure: (error) => {
          const status = error.status;
          const message =
            error.message.trim().length > 0
              ? error.message
              : "Failed to publish the paper.";
          return HttpServerResponse.json(
            {
              error: message,
            },
            { status },
          );
        },
        onSuccess: (published) => {
          const body: LocalPaperPublishResponse = {
            paper: published,
          };
          return HttpServerResponse.json(body);
        },
      }),
    );
  }),
);

export const staticAndDevRouteLayer = HttpRouter.add(
  "GET",
  "*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig;
    if (config.devUrl) {
      return HttpServerResponse.redirect(config.devUrl.href, { status: 302 });
    }

    if (!config.staticDir) {
      return HttpServerResponse.text("No static directory configured and no dev URL set.", {
        status: 503,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const staticRoot = path.resolve(config.staticDir);
    const staticRequestPath = url.value.pathname === "/" ? "/index.html" : url.value.pathname;
    const rawStaticRelativePath = staticRequestPath.replace(/^[/\\]+/, "");
    const hasRawLeadingParentSegment = rawStaticRelativePath.startsWith("..");
    const staticRelativePath = path.normalize(rawStaticRelativePath).replace(/^[/\\]+/, "");
    const hasPathTraversalSegment = staticRelativePath.startsWith("..");
    if (
      staticRelativePath.length === 0 ||
      hasRawLeadingParentSegment ||
      hasPathTraversalSegment ||
      staticRelativePath.includes("\0")
    ) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }

    const isWithinStaticRoot = (candidate: string) =>
      candidate === staticRoot ||
      candidate.startsWith(staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`);

    let filePath = path.resolve(staticRoot, staticRelativePath);
    if (!isWithinStaticRoot(filePath)) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }

    const ext = path.extname(filePath);
    if (!ext) {
      filePath = path.resolve(filePath, "index.html");
      if (!isWithinStaticRoot(filePath)) {
        return HttpServerResponse.text("Invalid static file path", { status: 400 });
      }
    }

    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      const indexPath = path.resolve(staticRoot, "index.html");
      const indexData = yield* fileSystem
        .readFile(indexPath)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (!indexData) {
        return HttpServerResponse.text("Not Found", { status: 404 });
      }
      return HttpServerResponse.uint8Array(indexData, {
        status: 200,
        contentType: "text/html; charset=utf-8",
      });
    }

    const contentType = Mime.getType(filePath) ?? "application/octet-stream";
    const data = yield* fileSystem
      .readFile(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!data) {
      return HttpServerResponse.text("Internal Server Error", { status: 500 });
    }

    return HttpServerResponse.uint8Array(data, {
      status: 200,
      contentType,
    });
  }),
);
