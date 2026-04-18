import { useCallback, useSyncExternalStore } from "react";

import { isElectron } from "../env";

function subscribe(callback: () => void): () => void {
  if (!isElectron || typeof window === "undefined") return () => {};
  const bridge = window.desktopBridge;
  if (!bridge?.onFullScreenChange) return () => {};
  return bridge.onFullScreenChange(() => callback());
}

function getSnapshot(): boolean {
  if (!isElectron || typeof window === "undefined") return false;
  const bridge = window.desktopBridge;
  if (!bridge?.isFullScreen) return false;
  try {
    return bridge.isFullScreen();
  } catch {
    return false;
  }
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Tracks whether the Electron window is in native fullscreen. On macOS this
 * means the traffic lights are hidden and we should not reserve the titlebar
 * inset. Returns `false` in any non-Electron environment.
 */
export function useDesktopFullScreen(): boolean {
  const subscribeFn = useCallback(subscribe, []);
  const snapshotFn = useCallback(getSnapshot, []);
  return useSyncExternalStore(subscribeFn, snapshotFn, getServerSnapshot);
}
