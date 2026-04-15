import type { CodexAuthApiKeyLoginInput, CodexAuthState } from "@agentscience/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { ensureNativeApi } from "../nativeApi";

const AUTH_POLL_INTERVAL_MS = 2_000;

export function useCodexAuth() {
  const [state, setState] = useState<CodexAuthState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const previousStatusRef = useRef<CodexAuthState["status"] | null>(null);

  const refreshState = useCallback(async () => {
    const nextState = await ensureNativeApi().server.getCodexAuthState();
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

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = state?.status ?? null;

    if (previousStatus === "pending" && state && state.status !== "pending") {
      void ensureNativeApi()
        .server.refreshProviders()
        .catch(() => undefined);
    }
  }, [state]);

  const startChatgptLogin = useCallback(async () => {
    const nextState = await ensureNativeApi().server.startCodexChatgptLogin();
    setState(nextState);
    return nextState;
  }, []);

  const loginWithApiKey = useCallback(async (input: CodexAuthApiKeyLoginInput) => {
    const nextState = await ensureNativeApi().server.loginCodexWithApiKey(input);
    setState(nextState);
    await ensureNativeApi().server.refreshProviders();
    return nextState;
  }, []);

  const cancelChatgptLogin = useCallback(async (loginId?: string) => {
    const nextState = await ensureNativeApi().server.cancelCodexChatgptLogin(
      loginId ? { loginId } : undefined,
    );
    setState(nextState);
    await ensureNativeApi().server.refreshProviders();
    return nextState;
  }, []);

  const logoutCodex = useCallback(async () => {
    const nextState = await ensureNativeApi().server.logoutCodex();
    setState(nextState);
    await ensureNativeApi().server.refreshProviders();
    return nextState;
  }, []);

  return {
    state,
    isLoading,
    refreshState,
    startChatgptLogin,
    loginWithApiKey,
    cancelChatgptLogin,
    logoutCodex,
  };
}
