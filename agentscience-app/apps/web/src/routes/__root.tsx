import {
  OrchestrationEvent,
  type ServerLifecycleWelcomePayload,
  type ThreadId,
} from "@agentscience/contracts";
import {
  Outlet,
  createRootRouteWithContext,
  type ErrorComponentProps,
  useNavigate,
  useLocation,
} from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { Throttler } from "@tanstack/react-pacer";

import { APP_DISPLAY_NAME } from "../branding";
import { AgentScienceConnectionPortal } from "../components/AgentScienceConnectionPortal";
import { AppSidebarLayout } from "../components/AppSidebarLayout";
import { DesktopConnectionPortal } from "../components/DesktopConnectionPortal";
import { OnboardingPortal } from "../components/OnboardingPortal";
import { useOnboardingStore } from "../onboardingStore";
import {
  SlowRpcAckToastCoordinator,
  WebSocketConnectionCoordinator,
  WebSocketConnectionSurface,
} from "../components/WebSocketConnectionSurface";
import { Button } from "../components/ui/button";
import {
  AnchoredToastProvider,
  ToastProvider,
} from "../components/ui/toast";
import { ensureNativeApi, readNativeApi } from "../nativeApi";
import {
  startServerStateSync,
  useServerConfig,
  useServerProviders,
  useServerWelcomeSubscription,
} from "../rpc/serverState";
import {
  clearPromotedDraftThread,
  clearPromotedDraftThreads,
  useComposerDraftStore,
} from "../composerDraftStore";
import { useStore } from "../store";
import { useUiStateStore } from "../uiStateStore";
import { useTerminalStateStore } from "../terminalStateStore";
import { migrateLocalSettingsToServer } from "../hooks/useSettings";
import { useAgentScienceAccount } from "../hooks/useAgentScienceAccount";
import { providerQueryKeys } from "../lib/providerReactQuery";
import { projectQueryKeys } from "../lib/projectReactQuery";
import { collectActiveTerminalThreadIds } from "../lib/terminalStateCleanup";
import {
  describeAgentScienceRuntimeStatus,
  shouldShowAgentScienceRuntimeNotice,
} from "../lib/agentScienceRuntimeStatus";
import { deriveOrchestrationBatchEffects } from "../orchestrationEventEffects";
import { createOrchestrationRecoveryCoordinator } from "../orchestrationRecovery";
import { deriveReplayRetryDecision } from "../orchestrationRecovery";
import { getWsRpcClient } from "~/wsRpcClient";
import { isElectron } from "../env";
import { toastManager } from "../components/ui/toast";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: RootRouteView,
  errorComponent: RootRouteErrorView,
  head: () => ({
    meta: [{ name: "title", content: APP_DISPLAY_NAME }],
  }),
});

function RootRouteView() {
  const navigate = useNavigate();
  const serverConfig = useServerConfig();
  const serverProviders = useServerProviders();
  const agentScienceAccount = useAgentScienceAccount();
  const pathname = useLocation({ select: (loc) => loc.pathname });

  if (!readNativeApi()) {
    return (
      <div className="flex h-screen flex-col bg-background text-foreground">
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <p className="font-display text-[1.5rem] text-ink">AgentScience</p>
            <p className="text-[0.8125rem] text-ink-light">
              Connecting to server…
            </p>
          </div>
        </div>
      </div>
    );
  }

  const codexProvider = serverProviders.find((provider) => provider.provider === "codex");
  const agentScienceStatus = agentScienceAccount.state?.status ?? "signed-out";
  const isSettingsRoute = pathname.startsWith("/settings");
  const shouldShowAgentScienceConnectionPortal =
    isElectron && serverConfig !== null && agentScienceStatus !== "signed-in";
  const shouldShowDesktopConnectionPortal =
    isElectron &&
    serverConfig !== null &&
    !agentScienceAccount.isLoading &&
    agentScienceStatus === "signed-in" &&
    !isSettingsRoute &&
    codexProvider?.auth.status !== "authenticated";

  // Onboarding sits between model-access connect and the workspace: the user
  // is fully connected but hasn't yet told us which field / data they care
  // about. Gate on client-only state so skipping never re-triggers the screen.
  const onboardingAccountKey = agentScienceStatus === "signed-in"
    ? (agentScienceAccount.state?.user?.id ?? null)
    : null;
  const onboardingStoreAccountKey = useOnboardingStore((state) => state.accountKey);
  const onboardingSeenRaw = useOnboardingStore((state) => state.completed || state.skipped);
  const syncOnboardingAccount = useOnboardingStore((state) => state.syncAccount);
  const onboardingSeen =
    onboardingStoreAccountKey === onboardingAccountKey && onboardingSeenRaw;
  useEffect(() => {
    if (agentScienceStatus === "signed-in" && onboardingAccountKey === null) {
      return;
    }
    syncOnboardingAccount(onboardingAccountKey);
  }, [agentScienceStatus, onboardingAccountKey, syncOnboardingAccount]);
  const shouldShowOnboardingPortal =
    !shouldShowAgentScienceConnectionPortal &&
    !shouldShowDesktopConnectionPortal &&
    !onboardingSeen &&
    !isSettingsRoute &&
    (!isElectron ||
      (serverConfig !== null && codexProvider?.auth.status === "authenticated"));

  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <ServerStateBootstrap />
        <EventRouter />
        <WebSocketConnectionCoordinator />
        <SlowRpcAckToastCoordinator />
        <AgentScienceRuntimeNoticeCoordinator />
        <WebSocketConnectionSurface>
          {shouldShowDesktopConnectionPortal ? (
            <DesktopConnectionPortal
              provider={codexProvider}
              onOpenAdvanced={() => {
                void navigate({ to: "/settings/general" });
              }}
            />
          ) : shouldShowAgentScienceConnectionPortal ? (
            <AgentScienceConnectionPortal
              isLoading={agentScienceAccount.isLoading}
              state={agentScienceAccount.state}
              onStart={agentScienceAccount.startLogin}
              onCancel={agentScienceAccount.cancelLogin}
              onOpenBrowser={ensureNativeApi().shell.openExternal}
            />
          ) : shouldShowOnboardingPortal ? (
            <OnboardingPortal
              onComplete={() => {
                void navigate({ to: "/", replace: true });
              }}
            />
          ) : (
            <AppSidebarLayout>
              <Outlet />
            </AppSidebarLayout>
          )}
        </WebSocketConnectionSurface>
      </AnchoredToastProvider>
    </ToastProvider>
  );
}

function AgentScienceRuntimeNoticeCoordinator() {
  const navigate = useNavigate();
  const serverConfig = useServerConfig();
  const lastNoticeKeyRef = useRef<string | null>(null);
  const status = serverConfig?.runtime.agentScience ?? null;

  useEffect(() => {
    if (!status || !shouldShowAgentScienceRuntimeNotice(status)) {
      return;
    }

    const descriptor = describeAgentScienceRuntimeStatus(status);
    if (!descriptor.noticeTitle || !descriptor.noticeDescription) {
      return;
    }

    const noticeKey = `${status.checkedAt}:${status.updateAvailable ? "update" : "no-update"}:${status.refreshRecommended ? "refresh" : "no-refresh"}`;
    if (lastNoticeKeyRef.current === noticeKey) {
      return;
    }
    lastNoticeKeyRef.current = noticeKey;

    toastManager.add({
      type: "warning",
      title: descriptor.noticeTitle,
      description: descriptor.noticeDescription,
      timeout: 0,
      actionProps: {
        children: "Open Settings",
        onClick: () => {
          void navigate({ to: "/settings/general" });
        },
      },
      data: {
        dismissAfterVisibleMs: 12_000,
        hideCopyButton: true,
      },
    });
  }, [navigate, status]);

  return null;
}

function RootRouteErrorView({ error, reset }: ErrorComponentProps) {
  const message = errorMessage(error);
  const details = errorDetails(error);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
      <section className="w-full max-w-[560px]">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-faint">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-4 font-display text-[2rem] leading-[1.15] text-ink sm:text-[2.25rem]">
          Something went wrong.
        </h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-light">
          {message}
        </p>

        <div className="mt-6 h-px w-full bg-rule" />

        <div className="mt-6 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => reset()}>
            Try again
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.location.reload()}
          >
            Reload app
          </Button>
        </div>

        <details className="mt-8 border-t border-rule pt-4">
          <summary className="cursor-pointer list-none text-[0.8125rem] text-ink-light">
            <span className="group-open:hidden">Show error details</span>
            <span className="hidden group-open:inline">Hide error details</span>
          </summary>
          <pre className="mt-3 max-h-56 overflow-auto rounded-md border border-rule bg-[var(--code-bg)] p-3 font-mono text-[0.75rem] leading-relaxed text-ink">
            {details}
          </pre>
        </details>
      </section>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "An unexpected router error occurred.";
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return "No additional error details are available.";
  }
}

function coalesceOrchestrationUiEvents(
  events: ReadonlyArray<OrchestrationEvent>,
): OrchestrationEvent[] {
  if (events.length < 2) {
    return [...events];
  }

  const coalesced: OrchestrationEvent[] = [];
  for (const event of events) {
    const previous = coalesced.at(-1);
    if (
      previous?.type === "thread.message-sent" &&
      event.type === "thread.message-sent" &&
      previous.payload.threadId === event.payload.threadId &&
      previous.payload.messageId === event.payload.messageId
    ) {
      coalesced[coalesced.length - 1] = {
        ...event,
        payload: {
          ...event.payload,
          attachments:
            event.payload.attachments ?? previous.payload.attachments,
          createdAt: previous.payload.createdAt,
          text:
            !event.payload.streaming && event.payload.text.length > 0
              ? event.payload.text
              : previous.payload.text + event.payload.text,
        },
      };
      continue;
    }

    coalesced.push(event);
  }

  return coalesced;
}

const REPLAY_RECOVERY_RETRY_DELAY_MS = 100;
const MAX_NO_PROGRESS_REPLAY_RETRIES = 3;

function ServerStateBootstrap() {
  useEffect(() => startServerStateSync(getWsRpcClient().server), []);

  return null;
}

function EventRouter() {
  const applyOrchestrationEvents = useStore(
    (store) => store.applyOrchestrationEvents,
  );
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);
  const setProjectExpanded = useUiStateStore(
    (store) => store.setProjectExpanded,
  );
  const syncProjects = useUiStateStore((store) => store.syncProjects);
  const syncThreads = useUiStateStore((store) => store.syncThreads);
  const clearThreadUi = useUiStateStore((store) => store.clearThreadUi);
  const removeTerminalState = useTerminalStateStore(
    (store) => store.removeTerminalState,
  );
  const removeOrphanedTerminalStates = useTerminalStateStore(
    (store) => store.removeOrphanedTerminalStates,
  );
  const applyTerminalEvent = useTerminalStateStore(
    (store) => store.applyTerminalEvent,
  );
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (loc) => loc.pathname });
  const readPathname = useEffectEvent(() => pathname);
  const handledBootstrapThreadIdRef = useRef<string | null>(null);
  const disposedRef = useRef(false);
  const bootstrapFromSnapshotRef = useRef<() => Promise<void>>(
    async () => undefined,
  );

  const handleWelcome = useEffectEvent(
    (payload: ServerLifecycleWelcomePayload | null) => {
      if (!payload) return;

      migrateLocalSettingsToServer();
      void (async () => {
        await bootstrapFromSnapshotRef.current();
        if (disposedRef.current) {
          return;
        }

        if (!payload.bootstrapProjectId || !payload.bootstrapThreadId) {
          return;
        }
        setProjectExpanded(payload.bootstrapProjectId, true);

        if (readPathname() !== "/") {
          return;
        }
        if (handledBootstrapThreadIdRef.current === payload.bootstrapThreadId) {
          return;
        }
        await navigate({
          to: "/$threadId",
          params: { threadId: payload.bootstrapThreadId },
          replace: true,
        });
        handledBootstrapThreadIdRef.current = payload.bootstrapThreadId;
      })().catch(() => undefined);
    },
  );

  useEffect(() => {
    const api = readNativeApi();
    if (!api) return;
    let disposed = false;
    disposedRef.current = false;
    const recovery = createOrchestrationRecoveryCoordinator();
    let replayRetryTracker:
      | import("../orchestrationRecovery").ReplayRetryTracker
      | null = null;
    let needsProviderInvalidation = false;
    const pendingDomainEvents: OrchestrationEvent[] = [];
    let flushPendingDomainEventsScheduled = false;

    const reconcileSnapshotDerivedState = () => {
      const threads = useStore.getState().threads;
      const projects = useStore.getState().projects;
      syncProjects(
        projects.map((project) => ({
          id: project.id,
          folderSlug: project.folderSlug,
        })),
      );
      syncThreads(
        threads.map((thread) => ({
          id: thread.id,
          seedVisitedAt: thread.updatedAt ?? thread.createdAt,
        })),
      );
      clearPromotedDraftThreads(threads.map((thread) => thread.id));
      const draftThreadIds = Object.keys(
        useComposerDraftStore.getState().draftThreadsByThreadId,
      ) as ThreadId[];
      const activeThreadIds = collectActiveTerminalThreadIds({
        snapshotThreads: threads.map((thread) => ({
          id: thread.id,
          deletedAt: null,
          archivedAt: thread.archivedAt,
        })),
        draftThreadIds,
      });
      removeOrphanedTerminalStates(activeThreadIds);
    };

    const queryInvalidationThrottler = new Throttler(
      () => {
        if (!needsProviderInvalidation) {
          return;
        }
        needsProviderInvalidation = false;
        void queryClient.invalidateQueries({ queryKey: providerQueryKeys.all });
        // Invalidate workspace entry queries so the @-mention file picker
        // reflects files created, deleted, or restored during this turn.
        void queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
      },
      {
        wait: 100,
        leading: false,
        trailing: true,
      },
    );

    const applyEventBatch = (events: ReadonlyArray<OrchestrationEvent>) => {
      const nextEvents = recovery.markEventBatchApplied(events);
      if (nextEvents.length === 0) {
        return;
      }

      const batchEffects = deriveOrchestrationBatchEffects(nextEvents);
      const uiEvents = coalesceOrchestrationUiEvents(nextEvents);
      const needsWorkspaceSnapshotRefresh = nextEvents.some(
        (event) => event.type === "workspace.root-changed",
      );
      const needsProjectUiSync = nextEvents.some(
        (event) =>
          event.type === "project.created" ||
          event.type === "project.meta-updated" ||
          event.type === "project.deleted",
      );

      if (batchEffects.needsProviderInvalidation) {
        needsProviderInvalidation = true;
        void queryInvalidationThrottler.maybeExecute();
      }

      applyOrchestrationEvents(uiEvents);
      if (needsProjectUiSync) {
        const projects = useStore.getState().projects;
        syncProjects(
          projects.map((project) => ({
            id: project.id,
            folderSlug: project.folderSlug,
          })),
        );
      }
      const needsThreadUiSync = nextEvents.some(
        (event) =>
          event.type === "thread.created" || event.type === "thread.deleted",
      );
      if (needsThreadUiSync) {
        const threads = useStore.getState().threads;
        syncThreads(
          threads.map((thread) => ({
            id: thread.id,
            seedVisitedAt: thread.updatedAt ?? thread.createdAt,
          })),
        );
      }
      const draftStore = useComposerDraftStore.getState();
      for (const threadId of batchEffects.clearPromotedDraftThreadIds) {
        clearPromotedDraftThread(threadId);
      }
      for (const threadId of batchEffects.clearDeletedThreadIds) {
        draftStore.clearDraftThread(threadId);
        clearThreadUi(threadId);
      }
      for (const threadId of batchEffects.removeTerminalStateThreadIds) {
        removeTerminalState(threadId);
      }
      if (needsWorkspaceSnapshotRefresh) {
        void runSnapshotRecovery("workspace-root-changed");
      }
    };
    const flushPendingDomainEvents = () => {
      flushPendingDomainEventsScheduled = false;
      if (disposed || pendingDomainEvents.length === 0) {
        return;
      }

      const events = pendingDomainEvents.splice(0, pendingDomainEvents.length);
      applyEventBatch(events);
    };
    const schedulePendingDomainEventFlush = () => {
      if (flushPendingDomainEventsScheduled) {
        return;
      }

      flushPendingDomainEventsScheduled = true;
      queueMicrotask(flushPendingDomainEvents);
    };

    const runReplayRecovery = async (
      reason: "sequence-gap" | "resubscribe",
    ): Promise<void> => {
      if (!recovery.beginReplayRecovery(reason)) {
        return;
      }

      const fromSequenceExclusive = recovery.getState().latestSequence;
      try {
        const events = await api.orchestration.replayEvents(
          fromSequenceExclusive,
        );
        if (!disposed) {
          applyEventBatch(events);
        }
      } catch {
        replayRetryTracker = null;
        recovery.failReplayRecovery();
        void fallbackToSnapshotRecovery();
        return;
      }

      if (!disposed) {
        const replayCompletion = recovery.completeReplayRecovery();
        const retryDecision = deriveReplayRetryDecision({
          previousTracker: replayRetryTracker,
          completion: replayCompletion,
          recoveryState: recovery.getState(),
          baseDelayMs: REPLAY_RECOVERY_RETRY_DELAY_MS,
          maxNoProgressRetries: MAX_NO_PROGRESS_REPLAY_RETRIES,
        });
        replayRetryTracker = retryDecision.tracker;

        if (retryDecision.shouldRetry) {
          if (retryDecision.delayMs > 0) {
            await new Promise<void>((resolve) => {
              setTimeout(resolve, retryDecision.delayMs);
            });
            if (disposed) {
              return;
            }
          }
          void runReplayRecovery(reason);
        } else if (
          replayCompletion.shouldReplay &&
          import.meta.env.MODE !== "test"
        ) {
          console.warn(
            "[orchestration-recovery]",
            "Stopping replay recovery after no-progress retries.",
            {
              state: recovery.getState(),
            },
          );
        }
      }
    };

    const runSnapshotRecovery = async (
      reason: "bootstrap" | "replay-failed" | "workspace-root-changed",
    ): Promise<void> => {
      const started = recovery.beginSnapshotRecovery(reason);
      if (import.meta.env.MODE !== "test") {
        const state = recovery.getState();
        console.info(
          "[orchestration-recovery]",
          "Snapshot recovery requested.",
          {
            reason,
            skipped: !started,
            ...(started
              ? {}
              : {
                  blockedBy: state.inFlight?.kind ?? null,
                  blockedByReason: state.inFlight?.reason ?? null,
                }),
            state,
          },
        );
      }
      if (!started) {
        return;
      }

      try {
        const snapshot = await api.orchestration.getSnapshot();
        if (!disposed) {
          syncServerReadModel(snapshot);
          reconcileSnapshotDerivedState();
          if (recovery.completeSnapshotRecovery(snapshot.snapshotSequence)) {
            void runReplayRecovery("sequence-gap");
          }
        }
      } catch {
        // Keep prior state and wait for welcome or a later replay attempt.
        recovery.failSnapshotRecovery();
      }
    };

    const bootstrapFromSnapshot = async (): Promise<void> => {
      await runSnapshotRecovery("bootstrap");
    };
    bootstrapFromSnapshotRef.current = bootstrapFromSnapshot;

    const fallbackToSnapshotRecovery = async (): Promise<void> => {
      await runSnapshotRecovery("replay-failed");
    };
    const unsubDomainEvent = api.orchestration.onDomainEvent(
      (event) => {
        const action = recovery.classifyDomainEvent(event.sequence);
        if (action === "apply") {
          pendingDomainEvents.push(event);
          schedulePendingDomainEventFlush();
          return;
        }
        if (action === "recover") {
          flushPendingDomainEvents();
          void runReplayRecovery("sequence-gap");
        }
      },
      {
        onResubscribe: () => {
          if (disposed) {
            return;
          }
          flushPendingDomainEvents();
          void runReplayRecovery("resubscribe");
        },
      },
    );
    const unsubTerminalEvent = api.terminal.onEvent((event) => {
      const thread = useStore
        .getState()
        .threads.find((entry) => entry.id === event.threadId);
      if (thread && thread.archivedAt !== null) {
        return;
      }
      applyTerminalEvent(event);
    });
    return () => {
      disposed = true;
      disposedRef.current = true;
      needsProviderInvalidation = false;
      flushPendingDomainEventsScheduled = false;
      pendingDomainEvents.length = 0;
      queryInvalidationThrottler.cancel();
      unsubDomainEvent();
      unsubTerminalEvent();
    };
  }, [
    applyOrchestrationEvents,
    navigate,
    queryClient,
    removeTerminalState,
    removeOrphanedTerminalStates,
    applyTerminalEvent,
    clearThreadUi,
    setProjectExpanded,
    syncProjects,
    syncServerReadModel,
    syncThreads,
  ]);

  useServerWelcomeSubscription(handleWelcome);

  return null;
}
