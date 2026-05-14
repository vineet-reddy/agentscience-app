import { LoaderIcon } from "lucide-react";
import { useState } from "react";
import type { ServerProvider } from "@agentscience/contracts";

import { ensureNativeApi } from "../../nativeApi";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

type GeminiAuthControlsAppearance = "settings" | "portal";

interface GeminiAuthControlsProps {
  readonly provider: ServerProvider | undefined;
  readonly appearance?: GeminiAuthControlsAppearance;
}

function resolveHeadline(provider: ServerProvider | undefined): string {
  if (!provider) return "Checking Gemini.";
  if (provider.enabled === false) return "Gemini is turned off.";
  if (provider.installed === false) return "AgentScience could not start Gemini.";
  if (provider.status === "error") return "Gemini is unavailable.";
  if (provider.auth.status === "authenticated") {
    return provider.auth.label ? `Connected with ${provider.auth.label}.` : "Gemini is connected.";
  }
  return "Continue with Gemini.";
}

function resolveCopy(provider: ServerProvider | undefined): string {
  if (!provider) return "Waiting for AgentScience to check Gemini.";
  if (provider.enabled === false) {
    return "Open advanced setup if you need to turn Gemini back on.";
  }
  if (provider.installed === false) {
    return "Reinstall AgentScience or open advanced setup.";
  }
  if (provider.status === "error") {
    return provider.message ?? "Gemini is not available.";
  }
  if (provider.auth.status === "authenticated") {
    return "AgentScience will use Gemini automatically.";
  }
  return "Sign in with your Google account in the browser.";
}

export function GeminiAuthControls({
  provider,
  appearance = "settings",
}: GeminiAuthControlsProps) {
  const [isContinuing, setIsContinuing] = useState(false);
  const isPortal = appearance === "portal";
  const isAuthenticated = provider?.auth.status === "authenticated";
  const isAvailable =
    provider?.enabled !== false &&
    provider?.installed !== false &&
    provider?.status !== "error";

  const handleContinue = async () => {
    setIsContinuing(true);
    try {
      await ensureNativeApi().server.loginGeminiWithGoogle();
      await ensureNativeApi().server.refreshProviders();
      toastManager.add({
        type: "success",
        title: "Gemini connected",
        description: "AgentScience will use Gemini automatically.",
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to connect Gemini",
        description: error instanceof Error ? error.message : "An unknown error occurred.",
      });
    } finally {
      setIsContinuing(false);
    }
  };

  return (
    <div className={isPortal ? "mt-12 border-y border-rule" : "border-t border-rule px-4 py-4 sm:px-5"}>
      <div
        className={
          isPortal
            ? "grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
            : "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        }
      >
        <div className="max-w-[38rem]">
          <p className="text-sm font-medium text-foreground">{resolveHeadline(provider)}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {resolveCopy(provider)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!isAvailable || isContinuing || isAuthenticated}
            onClick={() => void handleContinue()}
          >
            {isContinuing ? <LoaderIcon className="size-3 animate-spin" /> : null}
            {isAuthenticated ? "Connected" : "Continue with Gemini"}
          </Button>
        </div>
      </div>
    </div>
  );
}
