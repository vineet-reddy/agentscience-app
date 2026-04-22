import { AlertTriangle, CloudOff, LoaderCircle, RotateCw } from "lucide-react";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import { APP_DISPLAY_NAME } from "../branding";
import { type SlowRpcAckRequest, useSlowRpcAckRequests } from "../rpc/requestLatencyState";
import { useServerConfig } from "../rpc/serverState";
import {
  exhaustWsReconnectIfStillWaiting,
  getWsConnectionStatus,
  getWsConnectionUiState,
  setBrowserOnlineStatus,
  type WsConnectionStatus,
  type WsConnectionUiState,
  useWsConnectionStatus,
  WS_RECONNECT_MAX_ATTEMPTS,
} from "../rpc/wsConnectionState";
import { Button } from "./ui/button";
import { toastManager } from "./ui/toast";
import { getWsRpcClient } from "~/wsRpcClient";

const FORCED_WS_RECONNECT_DEBOUNCE_MS = 5_000;
type WsAutoReconnectTrigger = "focus" | "online";

const connectionTimeFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  second: "2-digit",
});

function formatConnectionMoment(isoDate: string | null): string | null {
  if (!isoDate) {
    return null;
  }

  return connectionTimeFormatter.format(new Date(isoDate));
}

function formatRetryCountdown(nextRetryAt: string, nowMs: number): string {
  const remainingMs = Math.max(0, new Date(nextRetryAt).getTime() - nowMs);
  return `${Math.max(1, Math.ceil(remainingMs / 1000))}s`;
}

function describeOfflineToast(): string {
  return "AgentScience is waiting for an internet connection.";
}

function formatReconnectAttemptLabel(status: WsConnectionStatus): string {
  const reconnectAttempt = Math.max(
    1,
    Math.min(status.reconnectAttemptCount, WS_RECONNECT_MAX_ATTEMPTS),
  );
  return `Attempt ${reconnectAttempt}/${status.reconnectMaxAttempts}`;
}

function describeExhaustedToast(): string {
  return "AgentScience is still trying to reconnect.";
}

function buildReconnectTitle(status: WsConnectionStatus): string {
  if (!status.hasConnected) {
    return `Starting ${APP_DISPLAY_NAME}`;
  }

  return `Reconnecting ${APP_DISPLAY_NAME}`;
}

function describeRecoveredToast(
  previousDisconnectedAt: string | null,
  connectedAt: string | null,
): string {
  const reconnectedAtLabel = formatConnectionMoment(connectedAt);
  const disconnectedAtLabel = formatConnectionMoment(previousDisconnectedAt);

  if (disconnectedAtLabel && reconnectedAtLabel) {
    return `Disconnected at ${disconnectedAtLabel} and reconnected at ${reconnectedAtLabel}.`;
  }

  if (reconnectedAtLabel) {
    return `Connection restored at ${reconnectedAtLabel}.`;
  }

  return "Connection restored.";
}

function describeSlowRpcAckToast(requests: ReadonlyArray<SlowRpcAckRequest>): ReactNode {
  const count = requests.length;
  const thresholdSeconds = Math.round((requests[0]?.thresholdMs ?? 0) / 1000);

  return `${count} request${count === 1 ? "" : "s"} waiting longer than ${thresholdSeconds}s.`;
}

export function shouldAutoReconnect(
  status: WsConnectionStatus,
  trigger: WsAutoReconnectTrigger,
): boolean {
  const uiState = getWsConnectionUiState(status);

  if (trigger === "online") {
    return (
      uiState === "offline" ||
      uiState === "reconnecting" ||
      uiState === "error" ||
      status.reconnectPhase === "exhausted"
    );
  }

  return (
    status.online &&
    status.hasConnected &&
    (uiState === "reconnecting" || status.reconnectPhase === "exhausted")
  );
}

function buildBlockingCopy(
  uiState: WsConnectionUiState,
  status: WsConnectionStatus,
): {
  readonly description: string;
  readonly eyebrow: string;
  readonly title: string;
} {
  if (uiState === "connecting") {
    return {
      description: `${APP_DISPLAY_NAME} is preparing your workspace and local tools. This usually takes a few seconds.`,
      eyebrow: `Starting ${APP_DISPLAY_NAME}`,
      title: "Opening your workspace",
    };
  }

  if (uiState === "offline") {
    return {
      description:
        `${APP_DISPLAY_NAME} is open, but this window cannot finish reconnecting while your Mac is offline. Reconnect to the internet and the app will recover automatically.`,
      eyebrow: "Offline",
      title: "Waiting for an internet connection",
    };
  }

  if (status.lastError?.trim()) {
    return {
      description: status.hasConnected
        ? `${APP_DISPLAY_NAME} lost its connection to the local app service and is retrying automatically. Reload the app if this keeps happening.`
        : `${APP_DISPLAY_NAME} is still starting its local app service. Reload the app if this keeps happening.`,
      eyebrow: status.hasConnected ? "Reconnecting" : "Still starting",
      title: status.hasConnected
        ? `${APP_DISPLAY_NAME} is reconnecting`
        : `${APP_DISPLAY_NAME} is taking longer than expected`,
    };
  }

  return {
    description:
      `${APP_DISPLAY_NAME} has not finished connecting to its local app service yet. It will keep retrying in the background.`,
    eyebrow: "Still starting",
    title: `${APP_DISPLAY_NAME} is taking longer than expected`,
  };
}

function buildConnectionDetails(status: WsConnectionStatus, uiState: WsConnectionUiState): string {
  const details = [
    `state: ${uiState}`,
    `online: ${status.online ? "yes" : "no"}`,
    `attempts: ${status.attemptCount}`,
  ];

  if (status.socketUrl) {
    details.push(`socket: ${status.socketUrl}`);
  }
  if (status.connectedAt) {
    details.push(`connectedAt: ${status.connectedAt}`);
  }
  if (status.disconnectedAt) {
    details.push(`disconnectedAt: ${status.disconnectedAt}`);
  }
  if (status.lastErrorAt) {
    details.push(`lastErrorAt: ${status.lastErrorAt}`);
  }
  if (status.lastError) {
    details.push(`lastError: ${status.lastError}`);
  }
  if (status.closeCode !== null) {
    details.push(`closeCode: ${status.closeCode}`);
  }
  if (status.closeReason) {
    details.push(`closeReason: ${status.closeReason}`);
  }

  return details.join("\n");
}

function WebSocketBlockingState({
  status,
  uiState,
}: {
  readonly status: WsConnectionStatus;
  readonly uiState: WsConnectionUiState;
}) {
  const copy = buildBlockingCopy(uiState, status);
  const disconnectedAt = formatConnectionMoment(status.disconnectedAt ?? status.lastErrorAt);
  const Icon =
    uiState === "connecting" ? LoaderCircle : uiState === "offline" ? CloudOff : AlertTriangle;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-90">
        <div className="absolute inset-x-0 top-0 h-56 bg-[radial-gradient(48rem_18rem_at_top,color-mix(in_srgb,var(--color-amber-500)_16%,transparent),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_92%,var(--color-black))_0%,var(--background)_56%)]" />
      </div>

      <section className="relative w-full max-w-xl rounded-[1.75rem] border border-border/80 bg-card/92 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              {copy.eyebrow}
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{copy.title}</h1>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/80 p-3 text-foreground shadow-sm">
            <Icon className={uiState === "connecting" ? "size-5 animate-spin" : "size-5"} />
          </div>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{copy.description}</p>

        <div className="mt-5 grid gap-3 rounded-2xl border border-border/70 bg-background/60 p-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Connection
            </p>
            <p className="mt-1 font-medium text-foreground">
              {uiState === "connecting"
                ? "Preparing the app"
                : uiState === "offline"
                  ? "Waiting for network"
                  : status.hasConnected
                    ? "Reconnecting in the background"
                    : "Starting local services"}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Latest Event
            </p>
            <p className="mt-1 font-medium text-foreground">{disconnectedAt ?? "Pending"}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => window.location.reload()}>
            <RotateCw />
            Reload AgentScience
          </Button>
        </div>

        <details className="group mt-5 overflow-hidden rounded-lg border border-border/70 bg-background/55">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground">
            <span className="group-open:hidden">Show troubleshooting details</span>
            <span className="hidden group-open:inline">Hide troubleshooting details</span>
          </summary>
          <pre className="max-h-56 overflow-auto border-t border-border/70 bg-background/80 px-3 py-2 text-xs text-foreground/85">
            {buildConnectionDetails(status, uiState)}
          </pre>
        </details>
      </section>
    </div>
  );
}

export function WebSocketConnectionCoordinator() {
  const status = useWsConnectionStatus();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const lastForcedReconnectAtRef = useRef(0);
  const toastIdRef = useRef<ReturnType<typeof toastManager.add> | null>(null);
  const toastResetTimerRef = useRef<number | null>(null);
  const previousUiStateRef = useRef<WsConnectionUiState>(getWsConnectionUiState(status));
  const previousDisconnectedAtRef = useRef<string | null>(status.disconnectedAt);

  const runReconnect = useEffectEvent((showFailureToast: boolean) => {
    if (toastResetTimerRef.current !== null) {
      window.clearTimeout(toastResetTimerRef.current);
      toastResetTimerRef.current = null;
    }
    lastForcedReconnectAtRef.current = Date.now();
    void getWsRpcClient()
      .reconnect()
      .catch((error) => {
        if (!showFailureToast) {
          console.warn("Automatic WebSocket reconnect failed", { error });
          return;
        }
        toastManager.add({
          type: "error",
          title: "Reconnect failed",
          description: error instanceof Error ? error.message : "Unable to restart the connection.",
          data: {
            dismissAfterVisibleMs: 8_000,
            hideCopyButton: true,
          },
        });
      });
  });
  const syncBrowserOnlineStatus = useEffectEvent(() => {
    setBrowserOnlineStatus(navigator.onLine !== false);
  });
  const triggerManualReconnect = useEffectEvent(() => {
    runReconnect(true);
  });
  const triggerAutoReconnect = useEffectEvent((trigger: WsAutoReconnectTrigger) => {
    const currentStatus =
      trigger === "online" ? setBrowserOnlineStatus(true) : getWsConnectionStatus();

    if (!shouldAutoReconnect(currentStatus, trigger)) {
      return;
    }
    if (Date.now() - lastForcedReconnectAtRef.current < FORCED_WS_RECONNECT_DEBOUNCE_MS) {
      return;
    }

    runReconnect(false);
  });

  useEffect(() => {
    const handleOnline = () => {
      triggerAutoReconnect("online");
    };
    const handleFocus = () => {
      triggerAutoReconnect("focus");
    };

    syncBrowserOnlineStatus();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", syncBrowserOnlineStatus);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", syncBrowserOnlineStatus);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  useEffect(() => {
    if (status.reconnectPhase !== "waiting" || status.nextRetryAt === null) {
      return;
    }

    setNowMs(Date.now());
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [status.nextRetryAt, status.reconnectPhase]);

  useEffect(() => {
    if (
      status.reconnectPhase !== "waiting" ||
      status.nextRetryAt === null ||
      !status.online ||
      !status.hasConnected
    ) {
      return;
    }

    const nextRetryAt = status.nextRetryAt;
    const timeoutMs = Math.max(0, new Date(nextRetryAt).getTime() - Date.now()) + 1_500;
    const timeoutId = window.setTimeout(() => {
      exhaustWsReconnectIfStillWaiting(nextRetryAt);
    }, timeoutMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    status.hasConnected,
    status.nextRetryAt,
    status.online,
    status.reconnectAttemptCount,
    status.reconnectPhase,
  ]);

  useEffect(() => {
    const uiState = getWsConnectionUiState(status);
    const previousUiState = previousUiStateRef.current;
    const previousDisconnectedAt = previousDisconnectedAtRef.current;
    const shouldShowReconnectToast = status.hasConnected && uiState === "reconnecting";
    const shouldShowOfflineToast = uiState === "offline" && status.disconnectedAt !== null;
    const shouldShowExhaustedToast = status.hasConnected && status.reconnectPhase === "exhausted";

    if (
      toastResetTimerRef.current !== null &&
      (shouldShowReconnectToast || shouldShowOfflineToast || shouldShowExhaustedToast)
    ) {
      window.clearTimeout(toastResetTimerRef.current);
      toastResetTimerRef.current = null;
    }

    if (shouldShowReconnectToast || shouldShowOfflineToast || shouldShowExhaustedToast) {
      const toastPayload = shouldShowOfflineToast
        ? {
            description: describeOfflineToast(),
            timeout: 0,
            title: "Offline",
            type: "warning" as const,
            data: {
              hideCopyButton: true,
            },
          }
          : shouldShowExhaustedToast
          ? {
              actionProps: {
                children: "Retry",
                onClick: triggerManualReconnect,
              },
              description: describeExhaustedToast(),
              timeout: 0,
              title: `${APP_DISPLAY_NAME} needs attention`,
              type: "error" as const,
              data: {
                hideCopyButton: true,
              },
            }
          : {
              actionProps: {
                children: "Retry now",
                onClick: triggerManualReconnect,
              },
              description:
                status.nextRetryAt === null
                  ? `Reconnecting... ${formatReconnectAttemptLabel(status)}`
                  : `Reconnecting in ${formatRetryCountdown(status.nextRetryAt, nowMs)}... ${formatReconnectAttemptLabel(status)}`,
              timeout: 0,
              title: buildReconnectTitle(status),
              type: "loading" as const,
              data: {
                hideCopyButton: true,
              },
            };

      if (toastIdRef.current) {
        toastManager.update(toastIdRef.current, toastPayload);
      } else {
        toastIdRef.current = toastManager.add(toastPayload);
      }
    } else if (toastIdRef.current) {
      toastManager.close(toastIdRef.current);
      toastIdRef.current = null;
    }

    if (
      uiState === "connected" &&
      (previousUiState === "offline" || previousUiState === "reconnecting") &&
      previousDisconnectedAt !== null
    ) {
        const successToast = {
          description: describeRecoveredToast(previousDisconnectedAt, status.connectedAt),
          title: `${APP_DISPLAY_NAME} reconnected`,
          type: "success" as const,
          timeout: 0,
          data: {
          dismissAfterVisibleMs: 8_000,
          hideCopyButton: true,
        },
      };

      if (toastIdRef.current) {
        toastManager.update(toastIdRef.current, successToast);
      } else {
        toastIdRef.current = toastManager.add(successToast);
      }

      toastResetTimerRef.current = window.setTimeout(() => {
        toastIdRef.current = null;
        toastResetTimerRef.current = null;
      }, 8_250);
    }

    previousUiStateRef.current = uiState;
    previousDisconnectedAtRef.current = status.disconnectedAt;
  }, [nowMs, status]);

  useEffect(() => {
    return () => {
      if (toastResetTimerRef.current !== null) {
        window.clearTimeout(toastResetTimerRef.current);
      }
    };
  }, []);

  return null;
}

export function SlowRpcAckToastCoordinator() {
  const slowRequests = useSlowRpcAckRequests();
  const status = useWsConnectionStatus();
  const toastIdRef = useRef<ReturnType<typeof toastManager.add> | null>(null);

  useEffect(() => {
    if (getWsConnectionUiState(status) !== "connected") {
      if (toastIdRef.current) {
        toastManager.close(toastIdRef.current);
        toastIdRef.current = null;
      }
      return;
    }

    if (slowRequests.length === 0) {
      if (toastIdRef.current) {
        toastManager.close(toastIdRef.current);
        toastIdRef.current = null;
      }
      return;
    }

    const nextToast = {
      description: describeSlowRpcAckToast(slowRequests),
      timeout: 0,
      title: "Some requests are slow",
      type: "warning" as const,
    };

    if (toastIdRef.current) {
      toastManager.update(toastIdRef.current, nextToast);
    } else {
      toastIdRef.current = toastManager.add(nextToast);
    }
  }, [slowRequests, status]);

  return null;
}

export function WebSocketConnectionSurface({ children }: { readonly children: ReactNode }) {
  const serverConfig = useServerConfig();
  const status = useWsConnectionStatus();

  if (serverConfig === null) {
    const uiState = getWsConnectionUiState(status);
    return (
      <WebSocketBlockingState
        status={status}
        uiState={uiState === "connected" ? "connecting" : uiState}
      />
    );
  }

  return children;
}
