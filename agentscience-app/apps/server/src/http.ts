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
import { PAPER_REVIEW_ROUTE_PREFIX, ThreadId } from "@agentscience/contracts";
import { PaperReviewService } from "./paperReview.ts";
import { ProjectFaviconResolver } from "./project/Services/ProjectFaviconResolver.ts";

const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";
const FALLBACK_PROJECT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;
const OTLP_TRACES_PROXY_PATH = "/api/observability/v1/traces";
const DATASET_REGISTRY_PROXY_PATH = "/api/datasets/registry";
const DATASET_REGISTRY_PROVIDERS_PROXY_PATH = "/api/datasets/registry/providers";
const DATASET_REGISTRY_DEFAULT_LIMIT = 500;
const DATASET_REGISTRY_MAX_LIMIT = 500;
const DATASET_PROVIDERS_DEFAULT_LIMIT = 100;
const DATASET_PROVIDERS_MAX_LIMIT = 200;

class DecodeOtlpTraceRecordsError extends Data.TaggedError("DecodeOtlpTraceRecordsError")<{
  readonly cause: unknown;
  readonly bodyJson: OtlpTracer.TraceData;
}> {}

class DatasetRegistryProxyError extends Data.TaggedError("DatasetRegistryProxyError")<{
  readonly cause: unknown;
  readonly upstreamUrl: string;
}> {}

class DatasetProvidersProxyError extends Data.TaggedError("DatasetProvidersProxyError")<{
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
}): Promise<unknown> {
  const registryUrl = new URL("/api/v1/registry", input.baseUrl);
  if (input.query) {
    registryUrl.searchParams.set("q", input.query);
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
}): Promise<unknown> {
  const providersUrl = new URL("/api/v1/registry/providers", input.baseUrl);
  if (input.query) {
    providersUrl.searchParams.set("q", input.query);
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
    const limit = parsePositiveInt(
      url.value.searchParams.get("limit"),
      DATASET_PROVIDERS_DEFAULT_LIMIT,
      DATASET_PROVIDERS_MAX_LIMIT,
    );

    if (query) {
      upstreamUrl.searchParams.set("q", query);
    }
    upstreamUrl.searchParams.set("limit", String(limit));

    return yield* Effect.tryPromise({
      try: () =>
        loadDatasetProvidersPayload({
          baseUrl: config.agentScienceBaseUrl,
          query: query || undefined,
          limit,
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
    const limit = parsePositiveInt(
      url.value.searchParams.get("limit"),
      DATASET_REGISTRY_DEFAULT_LIMIT,
    );

    if (query) {
      upstreamUrl.searchParams.set("q", query);
    }
    upstreamUrl.searchParams.set("limit", String(limit));

    return yield* Effect.tryPromise({
      try: () =>
        loadDatasetRegistryPayload({
          baseUrl: config.agentScienceBaseUrl,
          query: query || undefined,
          limit,
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
