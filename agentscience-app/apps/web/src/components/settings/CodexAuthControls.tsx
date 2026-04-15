import { LoaderIcon } from "lucide-react";
import { useState } from "react";
import type { ServerProvider } from "@agentscience/contracts";

import { useCodexAuth } from "../../hooks/useCodexAuth";
import { ensureNativeApi } from "../../nativeApi";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";

type AuthAction = "chatgpt" | "apiKey" | "openBrowser" | "cancel" | "logout" | null;
type CodexAuthControlsAppearance = "settings" | "portal";

interface CodexAuthControlsProps {
  readonly provider: ServerProvider | undefined;
  readonly appearance?: CodexAuthControlsAppearance;
  readonly onOpenAdvanced?: () => void;
}

function toFriendlyChatgptErrorMessage(message: string | null | undefined): string | null {
  const normalizedMessage = message?.trim();
  if (!normalizedMessage) {
    return null;
  }

  const lowerMessage = normalizedMessage.toLowerCase();
  if (
    lowerMessage.includes("codex app-server exited before auth completed") ||
    lowerMessage.includes("failed to start chatgpt login") ||
    lowerMessage.includes("failed to start codex auth client") ||
    lowerMessage.includes("received invalid json from codex app-server") ||
    lowerMessage.includes("initialize failed") ||
    lowerMessage.includes("cannot write to codex app-server stdin")
  ) {
    return "We couldn't open the ChatGPT sign-in page. Please try again.";
  }

  return normalizedMessage;
}

function resolveConnectionHeadline(input: {
  readonly isAuthenticated: boolean;
  readonly isPending: boolean;
  readonly authLabel: string | null;
  readonly provider: ServerProvider | undefined;
  readonly authErrorMessage: string | null;
}): string {
  if (input.isPending) {
    return "Finish sign-in in your browser.";
  }

  if (input.isAuthenticated) {
    return input.authLabel ? `Connected with ${input.authLabel}.` : "Codex is connected.";
  }

  if (input.provider?.enabled === false) {
    return "Codex is turned off.";
  }

  if (input.provider?.installed === false) {
    return "AgentScience could not start Codex.";
  }

  if (input.authErrorMessage) {
    return "We couldn't start ChatGPT sign-in.";
  }

  return "Choose how you want to continue.";
}

function resolveConnectionCopy(input: {
  readonly isAuthenticated: boolean;
  readonly isPending: boolean;
  readonly provider: ServerProvider | undefined;
  readonly authErrorMessage: string | null;
}): string {
  if (input.isPending) {
    return "AgentScience will connect automatically as soon as the browser step completes.";
  }

  if (input.isAuthenticated) {
    return "AgentScience will use this connection for model browsing and new papers.";
  }

  if (input.provider?.enabled === false) {
    return "Open advanced setup if you need to turn Codex back on or change runtime settings.";
  }

  if (input.provider?.installed === false) {
    return "Open advanced setup if you need to point AgentScience at a custom Codex runtime.";
  }

  if (input.authErrorMessage) {
    return toFriendlyChatgptErrorMessage(input.authErrorMessage) ?? "Please try again.";
  }

  return "Continue with ChatGPT or use an OpenAI API key.";
}

export function CodexAuthControls({
  provider,
  appearance = "settings",
  onOpenAdvanced,
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
  const isInstalled = provider?.installed !== false;
  const isEnabled = provider?.enabled !== false;
  const authErrorMessage =
    state?.status === "failed" ? toFriendlyChatgptErrorMessage(state.message ?? null) : null;
  const headline = resolveConnectionHeadline({
    isAuthenticated,
    isPending,
    authLabel,
    provider,
    authErrorMessage,
  });
  const copy = resolveConnectionCopy({
    isAuthenticated,
    isPending,
    provider,
    authErrorMessage,
  });

  const handleOpenExternal = async (
    url: string,
    action: Extract<AuthAction, "chatgpt" | "openBrowser">,
  ) => {
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
        description: "Finish signing in to ChatGPT. AgentScience will connect automatically.",
      });
    } catch (error) {
      const description =
        toFriendlyChatgptErrorMessage(error instanceof Error ? error.message : null) ??
        "We couldn't open the ChatGPT sign-in page. Please try again.";
      toastManager.add({
        type: "error",
        title: "We couldn't start sign-in",
        description,
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
        title: "Connected",
        description: "AgentScience is now using your OpenAI API key.",
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
        title: "Unable to cancel sign-in",
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
        title: "Disconnected",
        description: "This device has been signed out.",
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to disconnect Codex",
        description:
          error instanceof Error ? error.message : "An unknown error occurred.",
      });
    } finally {
      setActiveAction(null);
    }
  };

  const renderAdvancedAction = () =>
    onOpenAdvanced ? (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="px-0 text-xs text-muted-foreground hover:text-foreground"
        onClick={onOpenAdvanced}
      >
        Advanced
      </Button>
    ) : null;

  const renderApiKeyForm = (withTopBorder: boolean) =>
    showApiKeyForm ? (
      <div className={withTopBorder ? "border-t border-rule pt-4" : ""}>
        <div className="max-w-[460px] space-y-3">
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
              This key will only be used inside AgentScience.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={activeAction !== null}
              onClick={() => void handleSubmitApiKey()}
            >
              {activeAction === "apiKey" ? <LoaderIcon className="size-3 animate-spin" /> : null}
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
      </div>
    ) : null;

  const renderPendingContent = (isPortal: boolean) => (
    <div className={isPortal ? "border-y border-rule" : "border-t border-rule"}>
      <div className="space-y-3 py-5">
        <div>
          <p className="text-sm font-medium text-foreground">Finish in your browser</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Keep this window open. AgentScience will connect automatically when sign-in finishes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={activeAction !== null || !state?.authUrl}
            onClick={() => state?.authUrl && void handleOpenExternal(state.authUrl, "openBrowser")}
          >
            {activeAction === "openBrowser" ? (
              <LoaderIcon className="size-3 animate-spin" />
            ) : null}
            Open browser again
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={activeAction !== null}
            onClick={() => void handleCancelChatgptLogin()}
          >
            {activeAction === "cancel" ? <LoaderIcon className="size-3 animate-spin" /> : null}
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );

  const renderAuthenticatedContent = (isPortal: boolean) => (
    <div className={isPortal ? "border-y border-rule" : "border-t border-rule"}>
      <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">
            {authLabel ? `Connected with ${authLabel}.` : "You're connected."}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            AgentScience is ready to use.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={activeAction !== null || isLoading}
            onClick={() => void handleLogout()}
          >
            {activeAction === "logout" ? <LoaderIcon className="size-3 animate-spin" /> : null}
            Disconnect
          </Button>
        </div>
      </div>
    </div>
  );

  const renderUnauthenticatedContent = (isPortal: boolean) => (
    <div className={isPortal ? "divide-y divide-rule border-y border-rule" : "space-y-0 border-t border-rule"}>
      <div className={isPortal ? "grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center" : "flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between"}>
        <div className="max-w-[38rem]">
          <p className="text-sm font-medium text-foreground">Continue with ChatGPT</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Best for most people. Use your ChatGPT account.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={activeAction !== null || !isInstalled || !isEnabled || isLoading}
            onClick={() => void handleStartChatgptLogin()}
          >
            {activeAction === "chatgpt" ? <LoaderIcon className="size-3 animate-spin" /> : null}
            Continue with ChatGPT
          </Button>
        </div>
      </div>

      <div className={isPortal ? "space-y-4 py-5" : "space-y-4 py-5"}>
        <div className={isPortal ? "grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start" : "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"}>
          <div className="max-w-[38rem]">
            <p className="text-sm font-medium text-foreground">Use an API key</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Use your OpenAI API key instead.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={activeAction !== null || !isInstalled || !isEnabled}
              onClick={() => {
                setShowApiKeyForm((current) => !current);
                setApiKeyError(null);
              }}
            >
              Use API key
            </Button>
          </div>
        </div>
        {renderApiKeyForm(false)}
      </div>
    </div>
  );

  const isPortal = appearance === "portal";
  const shellClassName = isPortal ? "mt-12" : "border-t border-border/60 px-4 py-4 sm:px-5";
  const shouldShowSummary =
    !isPortal ||
    isPending ||
    isAuthenticated ||
    authErrorMessage !== null ||
    !isInstalled ||
    !isEnabled;
  const shouldShowAdvancedAction =
    !isPortal || authErrorMessage !== null || !isInstalled || !isEnabled;

  return (
    <div className={shellClassName}>
      <div className="space-y-4">
        {shouldShowSummary ? (
          <div className="flex flex-col gap-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Connection
            </div>
            <p className={isPortal ? "text-[1rem] font-medium text-foreground" : "text-sm font-medium text-foreground"}>
              {headline}
            </p>
            <p className={isPortal ? "max-w-[42rem] text-[0.9375rem] leading-relaxed text-muted-foreground" : "max-w-[42rem] text-xs leading-relaxed text-muted-foreground"}>
              {copy}
            </p>
          </div>
        ) : null}

        {isPending
          ? renderPendingContent(isPortal)
          : isAuthenticated
            ? renderAuthenticatedContent(isPortal)
            : renderUnauthenticatedContent(isPortal)}

        {shouldShowAdvancedAction ? renderAdvancedAction() : null}
      </div>
    </div>
  );
}
