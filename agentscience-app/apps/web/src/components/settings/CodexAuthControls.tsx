import { LoaderIcon } from "lucide-react";
import { useState } from "react";
import type { ServerProvider } from "@agentscience/contracts";

import { useCodexAuth } from "../../hooks/useCodexAuth";
import { ensureNativeApi } from "../../nativeApi";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";

type AuthAction =
  | "chatgpt"
  | "apiKey"
  | "openBrowser"
  | "cancel"
  | "logout"
  | "switchProfile"
  | null;

interface CodexAuthControlsProps {
  readonly provider: ServerProvider | undefined;
  readonly codexHomePath: string;
  readonly onUseStandaloneProfile: (path: string) => void;
  readonly onUseSharedProfile: () => void;
}

export function CodexAuthControls({
  provider,
  codexHomePath,
  onUseSharedProfile,
  onUseStandaloneProfile,
}: CodexAuthControlsProps) {
  const {
    state,
    isLoading,
    startChatgptLogin,
    loginWithApiKey,
    cancelChatgptLogin,
    logoutCodex,
  } = useCodexAuth();
  const [activeAction, setActiveAction] = useState<AuthAction>(null);
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);

  const authLabel =
    provider?.auth.label ??
    (provider?.auth.type === "apiKey" ? "OpenAI API key" : null);
  const isAuthenticated = provider?.auth.status === "authenticated";
  const isPending = state?.status === "pending";
  const isUsingStandaloneProfile = codexHomePath.trim().length > 0;
  const defaultStandaloneHomePath = state?.defaultHomePath ?? null;
  const isInstalled = provider?.installed !== false;
  const disableProfileActions = isPending || activeAction !== null;

  const handleOpenExternal = async (url: string, action: Extract<AuthAction, "chatgpt" | "openBrowser">) => {
    setActiveAction(action);
    try {
      await ensureNativeApi().shell.openExternal(url);
    } finally {
      setActiveAction(null);
    }
  };

  const handleStartChatgptLogin = async () => {
    setActiveAction("chatgpt");
    try {
      const nextState = await startChatgptLogin();
      if (!nextState.authUrl) {
        throw new Error("Codex did not provide a browser login URL.");
      }
      await ensureNativeApi().shell.openExternal(nextState.authUrl);
      toastManager.add({
        type: "success",
        title: "Continue in your browser",
        description: "Finish the ChatGPT login to connect Codex to AgentScience.",
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to start ChatGPT login",
        description:
          error instanceof Error ? error.message : "An unknown error occurred.",
      });
    } finally {
      setActiveAction(null);
    }
  };

  const handleSubmitApiKey = async () => {
    const normalizedApiKey = apiKey.trim();
    if (!normalizedApiKey) {
      setApiKeyError("Enter an OpenAI API key.");
      return;
    }

    setApiKeyError(null);
    setActiveAction("apiKey");
    try {
      await loginWithApiKey({ apiKey: normalizedApiKey });
      setApiKey("");
      setShowApiKeyForm(false);
      toastManager.add({
        type: "success",
        title: "Codex connected",
        description: "AgentScience is now using your OpenAI API key for Codex.",
      });
    } catch (error) {
      setApiKeyError(error instanceof Error ? error.message : "Unable to connect Codex.");
    } finally {
      setActiveAction(null);
    }
  };

  const handleCancelChatgptLogin = async () => {
    setActiveAction("cancel");
    try {
      await cancelChatgptLogin(state?.loginId);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to cancel login",
        description:
          error instanceof Error ? error.message : "An unknown error occurred.",
      });
    } finally {
      setActiveAction(null);
    }
  };

  const handleLogout = async () => {
    setActiveAction("logout");
    try {
      await logoutCodex();
      toastManager.add({
        type: "success",
        title: "Codex disconnected",
        description: "The selected Codex profile has been signed out.",
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to log out",
        description:
          error instanceof Error ? error.message : "An unknown error occurred.",
      });
    } finally {
      setActiveAction(null);
    }
  };

  const handleUseStandaloneProfile = () => {
    if (!defaultStandaloneHomePath) {
      return;
    }
    setActiveAction("switchProfile");
    try {
      onUseStandaloneProfile(defaultStandaloneHomePath);
      setShowApiKeyForm(false);
      setApiKeyError(null);
    } finally {
      setActiveAction(null);
    }
  };

  const handleUseSharedProfile = () => {
    setActiveAction("switchProfile");
    try {
      onUseSharedProfile();
      setShowApiKeyForm(false);
      setApiKeyError(null);
    } finally {
      setActiveAction(null);
    }
  };

  const authDescription = (() => {
    if (!isInstalled) {
      return "Install Codex or set the correct binary path before connecting an account.";
    }
    if (isPending) {
      return "Finish the ChatGPT login in your browser, then return to AgentScience.";
    }
    if (isAuthenticated) {
      return authLabel
        ? `Connected with ${authLabel}.`
        : "Codex is connected for this profile.";
    }
    if (state?.status === "failed" && state.message) {
      return state.message;
    }
    return "Choose whether this app should use ChatGPT or an OpenAI API key for Codex.";
  })();

  return (
    <div className="border-t border-border/60 px-4 py-3 sm:px-5">
      <div className="space-y-3">
        <div className="flex flex-col gap-1">
          <div className="text-xs font-medium text-foreground">Authentication</div>
          <p className="text-xs text-muted-foreground">{authDescription}</p>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-background/60 p-3">
          <div className="flex flex-col gap-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Credential profile
            </div>
            <div className="text-sm text-foreground">
              {isUsingStandaloneProfile
                ? "Standalone AgentScience profile"
                : "Shared with desktop Codex"}
            </div>
            <p className="text-xs text-muted-foreground">
              {isUsingStandaloneProfile
                ? codexHomePath
                : "Uses the same CODEX_HOME and login that your terminal uses by default."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={isUsingStandaloneProfile ? "outline" : "secondary"}
              disabled={
                disableProfileActions || !defaultStandaloneHomePath || isUsingStandaloneProfile
              }
              onClick={handleUseStandaloneProfile}
            >
              {activeAction === "switchProfile" && !isUsingStandaloneProfile ? (
                <LoaderIcon className="size-3 animate-spin" />
              ) : null}
              Use standalone profile
            </Button>
            <Button
              type="button"
              size="sm"
              variant={isUsingStandaloneProfile ? "secondary" : "outline"}
              disabled={disableProfileActions || !isUsingStandaloneProfile}
              onClick={handleUseSharedProfile}
            >
              {activeAction === "switchProfile" && isUsingStandaloneProfile ? (
                <LoaderIcon className="size-3 animate-spin" />
              ) : null}
              Use desktop profile
            </Button>
          </div>
        </div>

        {isPending && state?.authUrl ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={activeAction !== null}
              onClick={() => void handleOpenExternal(state.authUrl!, "openBrowser")}
            >
              {activeAction === "openBrowser" ? (
                <LoaderIcon className="size-3 animate-spin" />
              ) : null}
              Open login page
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={activeAction !== null}
              onClick={() => void handleCancelChatgptLogin()}
            >
              {activeAction === "cancel" ? (
                <LoaderIcon className="size-3 animate-spin" />
              ) : null}
              Cancel
            </Button>
          </div>
        ) : isAuthenticated ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={activeAction !== null || isLoading}
              onClick={() => void handleLogout()}
            >
              {activeAction === "logout" ? (
                <LoaderIcon className="size-3 animate-spin" />
              ) : null}
              Log out
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={activeAction !== null || !isInstalled || isLoading}
                onClick={() => void handleStartChatgptLogin()}
              >
                {activeAction === "chatgpt" ? (
                  <LoaderIcon className="size-3 animate-spin" />
                ) : null}
                Continue with ChatGPT
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={activeAction !== null || !isInstalled}
                onClick={() => {
                  setShowApiKeyForm((current) => !current);
                  setApiKeyError(null);
                }}
              >
                Use API key
              </Button>
            </div>

            {showApiKeyForm ? (
              <div className="space-y-2 rounded-xl border border-border/70 bg-background/60 p-3">
                <label className="block">
                  <span className="text-xs font-medium text-foreground">OpenAI API key</span>
                  <Input
                    className="mt-1.5"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={apiKey}
                    onChange={(event) => {
                      setApiKey(event.target.value);
                      if (apiKeyError) {
                        setApiKeyError(null);
                      }
                    }}
                    placeholder="sk-..."
                  />
                </label>
                {apiKeyError ? (
                  <p className="text-xs text-destructive">{apiKeyError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Stored in the currently selected Codex profile.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={activeAction !== null}
                    onClick={() => void handleSubmitApiKey()}
                  >
                    {activeAction === "apiKey" ? (
                      <LoaderIcon className="size-3 animate-spin" />
                    ) : null}
                    Save API key
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={activeAction !== null}
                    onClick={() => {
                      setShowApiKeyForm(false);
                      setApiKey("");
                      setApiKeyError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
