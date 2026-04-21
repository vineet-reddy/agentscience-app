import { LoaderIcon } from "lucide-react";
import { useState } from "react";

import { useAgentScienceAccount } from "../../hooks/useAgentScienceAccount";
import { ensureNativeApi } from "../../nativeApi";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

type Action = "signIn" | "openBrowser" | "cancel" | "signOut" | null;

/**
 * Controls for the user's AgentScience account connection. Mirrors the style
 * of {@link ./CodexAuthControls.tsx} and is designed to sit inside a
 * SettingsSection card on the settings screen.
 */
export function AgentScienceAccountPanel() {
  const { state, isLoading, startLogin, cancelLogin, signOut } =
    useAgentScienceAccount();
  const [action, setAction] = useState<Action>(null);

  const status = state?.status ?? "signed-out";
  const isPending = status === "pending";
  const isSignedIn = status === "signed-in";
  const errorMessage = status === "failed" ? state?.message ?? null : null;

  const openVerificationUrl = async (url: string, kind: Extract<Action, "signIn" | "openBrowser">) => {
    setAction(kind);
    try {
      await ensureNativeApi().shell.openExternal(url);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Couldn't open browser",
        description: error instanceof Error ? error.message : "An unknown error occurred.",
      });
    } finally {
      setAction(null);
    }
  };

  const handleStart = async () => {
    setAction("signIn");
    try {
      const next = await startLogin();
      if (next.status === "pending" && next.verificationUrl) {
        await ensureNativeApi().shell.openExternal(next.verificationUrl);
        toastManager.add({
          type: "success",
          title: "Finish sign-in in your browser",
          description: "AgentScience will connect automatically once you approve.",
        });
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Couldn't start sign-in",
        description: error instanceof Error ? error.message : "An unknown error occurred.",
      });
    } finally {
      setAction(null);
    }
  };

  const handleCancel = async () => {
    setAction("cancel");
    try {
      await cancelLogin();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to cancel",
        description: error instanceof Error ? error.message : "An unknown error occurred.",
      });
    } finally {
      setAction(null);
    }
  };

  const handleSignOut = async () => {
    setAction("signOut");
    try {
      await signOut();
      toastManager.add({
        type: "success",
        title: "Signed out",
        description: "This device has been disconnected from AgentScience.",
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to sign out",
        description: error instanceof Error ? error.message : "An unknown error occurred.",
      });
    } finally {
      setAction(null);
    }
  };

  if (isPending && state) {
    return (
      <div className="px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Finish in your browser</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Approve this device on{" "}
              <span className="font-mono text-foreground">
                {state.verificationUrl ?? "agentscience.app"}
              </span>
              . AgentScience will connect automatically.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={action !== null || !state.verificationUrl}
              onClick={() =>
                state.verificationUrl &&
                void openVerificationUrl(state.verificationUrl, "openBrowser")
              }
            >
              {action === "openBrowser" ? <LoaderIcon className="size-3 animate-spin" /> : null}
              Open browser
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={action !== null}
              onClick={() => void handleCancel()}
            >
              {action === "cancel" ? <LoaderIcon className="size-3 animate-spin" /> : null}
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (isSignedIn && state?.user) {
    return (
      <div className="px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Signed in as {state.user.name}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              @{state.user.handle}
              {state.user.email ? ` · ${state.user.email}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={action !== null || isLoading}
              onClick={() => void handleSignOut()}
            >
              {action === "signOut" ? <LoaderIcon className="size-3 animate-spin" /> : null}
              Sign out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Sign in to publish papers to AgentScience.
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {errorMessage
              ? errorMessage
              : "You'll approve this device in your browser. No API keys to copy."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={action !== null || isLoading}
            onClick={() => void handleStart()}
          >
            {action === "signIn" ? <LoaderIcon className="size-3 animate-spin" /> : null}
            Sign in
          </Button>
        </div>
      </div>
    </div>
  );
}
