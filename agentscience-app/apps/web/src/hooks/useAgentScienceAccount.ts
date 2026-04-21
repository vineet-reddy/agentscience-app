import type { AgentScienceAuthState } from "@agentscience/contracts";
import { useCallback, useEffect, useState } from "react";

import { ensureNativeApi } from "../nativeApi";

const AUTH_POLL_INTERVAL_MS = 2_000;

/**
 * Observes the AgentScience account connection that the local server holds
 * on behalf of the user. The hook mirrors `useCodexAuth` - it reads the
 * current state on mount, polls while a login is pending, and exposes the
 * three actions wired through the WebSocket RPC layer.
 */
export function useAgentScienceAccount() {
  const [state, setState] = useState<AgentScienceAuthState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshState = useCallback(async () => {
    const nextState = await ensureNativeApi().server.getAgentScienceAuthState();
    setState(nextState);
    return nextState;
  }, []);

  useEffect(() => {
    let cancelled = false;

    void refreshState()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshState]);

  useEffect(() => {
    if (state?.status !== "pending") {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshState().catch(() => undefined);
    }, AUTH_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshState, state?.status]);

  const startLogin = useCallback(async () => {
    const nextState = await ensureNativeApi().server.startAgentScienceLogin();
    setState(nextState);
    return nextState;
  }, []);

  const cancelLogin = useCallback(async () => {
    const nextState = await ensureNativeApi().server.cancelAgentScienceLogin();
    setState(nextState);
    return nextState;
  }, []);

  const signOut = useCallback(async () => {
    const nextState = await ensureNativeApi().server.signOutAgentScience();
    setState(nextState);
    return nextState;
  }, []);

  return {
    state,
    isLoading,
    refreshState,
    startLogin,
    cancelLogin,
    signOut,
  };
}
