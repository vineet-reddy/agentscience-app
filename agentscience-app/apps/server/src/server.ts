import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http";

import { ServerConfig } from "./config";
import {
  attachmentsRouteLayer,
  desktopReadyRouteLayer,
  datasetProvidersRouteLayer,
  datasetRegistryRouteLayer,
  datasetTopicsRouteLayer,
  localPapersPublishRouteLayer,
  localPapersRouteLayer,
  otlpTracesProxyRouteLayer,
  paperReviewCompileRouteLayer,
  paperReviewSnapshotRouteLayer,
  projectFaviconRouteLayer,
  staticAndDevRouteLayer,
} from "./http";
import { fixPath } from "./os-jank";
import { websocketRpcRouteLayer } from "./ws";
import { OpenLive } from "./open";
import { layerConfig as SqlitePersistenceLayerLive } from "./persistence/Layers/Sqlite";
import { ServerLifecycleEventsLive } from "./serverLifecycleEvents";
import { AnalyticsServiceLayerLive } from "./telemetry/Layers/AnalyticsService";
import { makeEventNdjsonLogger } from "./provider/Layers/EventNdjsonLogger";
import { ProviderSessionDirectoryLive } from "./provider/Layers/ProviderSessionDirectory";
import { ProviderSessionRuntimeRepositoryLive } from "./persistence/Layers/ProviderSessionRuntime";
import { makeCodexAdapterLive } from "./provider/Layers/CodexAdapter";
import { ProviderAdapterRegistryLive } from "./provider/Layers/ProviderAdapterRegistry";
import { makeProviderServiceLive } from "./provider/Layers/ProviderService";
import { OrchestrationEngineLive } from "./orchestration/Layers/OrchestrationEngine";
import { OrchestrationProjectionPipelineLive } from "./orchestration/Layers/ProjectionPipeline";
import { OrchestrationEventStoreLive } from "./persistence/Layers/OrchestrationEventStore";
import { OrchestrationCommandReceiptRepositoryLive } from "./persistence/Layers/OrchestrationCommandReceipts";
import { CheckpointDiffQueryLive } from "./checkpointing/Layers/CheckpointDiffQuery";
import { OrchestrationProjectionSnapshotQueryLive } from "./orchestration/Layers/ProjectionSnapshotQuery";
import { CheckpointStoreLive } from "./checkpointing/Layers/CheckpointStore";
import { GitCoreLive } from "./git/Layers/GitCore";
import { GitHubCliLive } from "./git/Layers/GitHubCli";
import { GitStatusBroadcasterLive } from "./git/Layers/GitStatusBroadcaster";
import { RoutingTextGenerationLive } from "./git/Layers/RoutingTextGeneration";
import { TerminalManagerLive } from "./terminal/Layers/Manager";
import { GitManagerLive } from "./git/Layers/GitManager";
import {
  ServerRuntimeStartup,
  ServerRuntimeStartupLive,
} from "./serverRuntimeStartup";
import { OrchestrationReactorLive } from "./orchestration/Layers/OrchestrationReactor";
import { RuntimeReceiptBusLive } from "./orchestration/Layers/RuntimeReceiptBus";
import { ProviderRuntimeIngestionLive } from "./orchestration/Layers/ProviderRuntimeIngestion";
import { ProviderCommandReactorLive } from "./orchestration/Layers/ProviderCommandReactor";
import { CheckpointReactorLive } from "./orchestration/Layers/CheckpointReactor";
import { AgentScienceAuthLive } from "./agentScienceAuth";
import { CodexAuthLive } from "./provider/Layers/CodexAuth";
import { CodexProviderLive } from "./provider/Layers/CodexProvider";
import { ProviderRegistryLive } from "./provider/Layers/ProviderRegistry";
import { ServerSettingsLive } from "./serverSettings";
import { ProjectFaviconResolverLive } from "./project/Layers/ProjectFaviconResolver";
import { WorkspaceEntriesLive } from "./workspace/Layers/WorkspaceEntries";
import { WorkspaceFileSystemLive } from "./workspace/Layers/WorkspaceFileSystem";
import { WorkspaceLayoutLive } from "./workspace/Layers/WorkspaceLayout";
import { WorkspacePathsLive } from "./workspace/Layers/WorkspacePaths";
import { ProjectSetupScriptRunnerLive } from "./project/Layers/ProjectSetupScriptRunner";
import { ObservabilityLive } from "./observability/Layers/Observability";
import { AgentScienceRuntimeStatusLive } from "./agentScienceRuntimeStatus";
import { LocalPapersServiceLive } from "./localPapers";
import { PaperReviewServiceLive } from "./paperReview";

const PtyAdapterLive = Layer.unwrap(
  Effect.gen(function* () {
    if (typeof Bun !== "undefined") {
      const BunPTY = yield* Effect.promise(
        () => import("./terminal/Layers/BunPTY"),
      );
      return BunPTY.layer;
    } else {
      const NodePTY = yield* Effect.promise(
        () => import("./terminal/Layers/NodePTY"),
      );
      return NodePTY.layer;
    }
  }),
);

const HttpServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    if (typeof Bun !== "undefined") {
      const BunHttpServer = yield* Effect.promise(
        () => import("@effect/platform-bun/BunHttpServer"),
      );
      return BunHttpServer.layer({
        port: config.port,
        ...(config.host ? { hostname: config.host } : {}),
      });
    } else {
      const [NodeHttpServer, NodeHttp] = yield* Effect.all([
        Effect.promise(() => import("@effect/platform-node/NodeHttpServer")),
        Effect.promise(() => import("node:http")),
      ]);
      return NodeHttpServer.layer(NodeHttp.createServer, {
        host: config.host,
        port: config.port,
      });
    }
  }),
);

const PlatformServicesLive = Layer.unwrap(
  Effect.gen(function* () {
    if (typeof Bun !== "undefined") {
      const { layer } = yield* Effect.promise(
        () => import("@effect/platform-bun/BunServices"),
      );
      return layer;
    } else {
      const { layer } = yield* Effect.promise(
        () => import("@effect/platform-node/NodeServices"),
      );
      return layer;
    }
  }),
);

const ReactorLayerLive = Layer.empty.pipe(
  Layer.provideMerge(OrchestrationReactorLive),
  Layer.provideMerge(ProviderRuntimeIngestionLive),
  Layer.provideMerge(ProviderCommandReactorLive),
  Layer.provideMerge(CheckpointReactorLive),
  Layer.provideMerge(RuntimeReceiptBusLive),
);

const OrchestrationEventInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationEventStoreLive,
  OrchestrationCommandReceiptRepositoryLive,
);

const OrchestrationProjectionPipelineLayerLive =
  OrchestrationProjectionPipelineLive.pipe(
    Layer.provide(OrchestrationEventStoreLive),
  );

const OrchestrationInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationProjectionSnapshotQueryLive,
  OrchestrationEventInfrastructureLayerLive,
  OrchestrationProjectionPipelineLayerLive,
);

const OrchestrationLayerLive = Layer.mergeAll(
  OrchestrationInfrastructureLayerLive,
  OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationInfrastructureLayerLive),
  ),
);

const PaperReviewLayerLive = PaperReviewServiceLive.pipe(
  Layer.provide(OrchestrationLayerLive),
);

const LocalPapersLayerLive = LocalPapersServiceLive.pipe(
  Layer.provideMerge(AgentScienceAuthLive),
  Layer.provide(OrchestrationLayerLive),
);

const CheckpointingLayerLive = Layer.empty.pipe(
  Layer.provideMerge(CheckpointDiffQueryLive),
  Layer.provideMerge(CheckpointStoreLive),
);

const ProviderLayerLive = Layer.unwrap(
  Effect.gen(function* () {
    const { providerEventLogPath } = yield* ServerConfig;
    const nativeEventLogger = yield* makeEventNdjsonLogger(
      providerEventLogPath,
      {
        stream: "native",
      },
    );
    const canonicalEventLogger = yield* makeEventNdjsonLogger(
      providerEventLogPath,
      {
        stream: "canonical",
      },
    );
    const providerSessionDirectoryLayer = ProviderSessionDirectoryLive.pipe(
      Layer.provide(ProviderSessionRuntimeRepositoryLive),
    );
    const codexAdapterLayer = makeCodexAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const adapterRegistryLayer = ProviderAdapterRegistryLive.pipe(
      Layer.provide(codexAdapterLayer),
      Layer.provideMerge(providerSessionDirectoryLayer),
    );
    return makeProviderServiceLive(
      canonicalEventLogger ? { canonicalEventLogger } : undefined,
    ).pipe(
      Layer.provide(adapterRegistryLayer),
      Layer.provide(providerSessionDirectoryLayer),
    );
  }),
);

const PersistenceLayerLive = Layer.empty.pipe(
  Layer.provideMerge(SqlitePersistenceLayerLive),
);

const GitManagerLayerLive = GitManagerLive.pipe(
  Layer.provideMerge(ProjectSetupScriptRunnerLive),
  Layer.provideMerge(GitCoreLive),
  Layer.provideMerge(GitHubCliLive),
  Layer.provideMerge(RoutingTextGenerationLive),
);

const GitLayerLive = Layer.empty.pipe(
  Layer.provideMerge(GitManagerLayerLive),
  Layer.provideMerge(
    GitStatusBroadcasterLive.pipe(Layer.provide(GitManagerLayerLive)),
  ),
  Layer.provideMerge(GitCoreLive),
);

const TerminalLayerLive = TerminalManagerLive.pipe(
  Layer.provide(PtyAdapterLive),
);

const WorkspaceLayerLive = Layer.empty.pipe(
  Layer.provideMerge(WorkspacePathsLive),
  Layer.provideMerge(
    WorkspaceLayoutLive.pipe(Layer.provide(WorkspacePathsLive)),
  ),
  Layer.provideMerge(
    WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive)),
  ),
  Layer.provideMerge(
    WorkspaceFileSystemLive.pipe(
      Layer.provide(WorkspacePathsLive),
      Layer.provide(
        WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive)),
      ),
    ),
  ),
);

const RuntimeDependenciesLive = ReactorLayerLive.pipe(
  // Core Services
  Layer.provideMerge(CheckpointingLayerLive),
  Layer.provideMerge(GitLayerLive),
  Layer.provideMerge(OrchestrationLayerLive),
  Layer.provideMerge(ProviderLayerLive),
  Layer.provideMerge(TerminalLayerLive),
  Layer.provideMerge(ProviderRegistryLive),
  Layer.provideMerge(CodexAuthLive.pipe(Layer.provide(CodexProviderLive))),
  Layer.provideMerge(AgentScienceAuthLive),
  Layer.provideMerge(WorkspaceLayerLive),
  Layer.provideMerge(ProjectFaviconResolverLive),

  // Misc.
  Layer.provideMerge(AnalyticsServiceLayerLive),
  Layer.provideMerge(OpenLive),
  Layer.provideMerge(ServerLifecycleEventsLive),
  Layer.provideMerge(AgentScienceRuntimeStatusLive),
  Layer.provideMerge(PaperReviewLayerLive),
  Layer.provideMerge(LocalPapersLayerLive),
);

const RuntimeServicesLive = ServerRuntimeStartupLive.pipe(
  Layer.provideMerge(RuntimeDependenciesLive),
  Layer.provideMerge(PersistenceLayerLive),
  Layer.provideMerge(ServerSettingsLive),
);

export const makeRoutesLayer = Layer.mergeAll(
  desktopReadyRouteLayer,
  attachmentsRouteLayer,
  // Longer paths must be registered before shorter ones so exact-match routing
  // picks the more specific handler (e.g. /providers wins over /registry).
  datasetProvidersRouteLayer,
  datasetTopicsRouteLayer,
  datasetRegistryRouteLayer,
  otlpTracesProxyRouteLayer,
  paperReviewSnapshotRouteLayer,
  paperReviewCompileRouteLayer,
  localPapersRouteLayer,
  localPapersPublishRouteLayer,
  projectFaviconRouteLayer,
  staticAndDevRouteLayer,
  websocketRpcRouteLayer,
);

export const makeServerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;

    if (config.mode !== "desktop") {
      fixPath();
    }

    const httpListeningLayer = Layer.effectDiscard(
      Effect.gen(function* () {
        yield* HttpServer.HttpServer;
        const startup = yield* ServerRuntimeStartup;
        yield* startup.markHttpListening;
      }),
    );

    const serverApplicationLayer = Layer.mergeAll(
      HttpRouter.serve(makeRoutesLayer, {
        disableLogger: !config.logWebSocketEvents,
      }),
      httpListeningLayer,
    );

    return serverApplicationLayer.pipe(
      Layer.provideMerge(RuntimeServicesLive),
      Layer.provideMerge(AgentScienceAuthLive),
      Layer.provideMerge(HttpServerLive),
      Layer.provide(ObservabilityLive),
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provideMerge(PlatformServicesLive),
    );
  }),
);

// Important: Only `ServerConfig` should be provided by the CLI layer!!! Don't let other requirements leak into the launch layer.
export const runServer = Layer.launch(makeServerLayer) satisfies Effect.Effect<
  never,
  any,
  ServerConfig
>;
