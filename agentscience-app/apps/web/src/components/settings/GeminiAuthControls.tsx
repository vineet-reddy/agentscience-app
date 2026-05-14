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
  readonly onContinue?: () => void;
  readonly onOpenAdvanced?: () => void;
}

function resolveHeadline(provider: ServerProvider | undefined): string {
  if (!provider) return "Checking Gemini CLI.";
  if (provider.enabled === false) return "Gemini is turned off.";
  if (provider.installed === false) return "AgentScience could not find Gemini CLI.";
  if (provider.status === "error") return "Gemini is unavailable.";
  return provider.auth.label ? `Continue with ${provider.auth.label}.` : "Continue with Gemini.";
}

function resolveCopy(provider: ServerProvider | undefined): string {
  if (!provider) return "Waiting for AgentScience to confirm the Gemini runtime.";
  if (provider.enabled === false) {
    return "Open advanced setup if you need to turn Gemini back on.";
  }
  if (provider.installed === false) {
    return "Reinstall AgentScience or point it at a custom Gemini binary.";
  }
  if (provider.status === "error") {
    return provider.message ?? "Gemini failed its startup checks.";
  }
  if (provider.auth.status === "authenticated") {
    return "AgentScience will use this Gemini connection automatically.";
  }
  return "Gemini CLI handles Google sign-in in the browser when the first Gemini session starts.";
}

export function GeminiAuthControls({
  provider,
  appearance = "settings",
  onContinue,
  onOpenAdvanced,
}: GeminiAuthControlsProps) {
  const [isContinuing, setIsContinuing] = useState(false);
  const isPortal = appearance === "portal";
  const isAvailable =
    provider?.enabled !== false &&
    provider?.installed !== false &&
    provider?.status !== "error";

  const handleContinue = async () => {
    setIsContinuing(true);
    try {
      onContinue?.();
      await ensureNativeApi().server.refreshProviders();
      toastManager.add({
        type: "success",
        title: "Gemini selected",
        description: "Google sign-in will complete through Gemini CLI when needed.",
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to select Gemini",
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
            disabled={!isAvailable || isContinuing}
            onClick={() => void handleContinue()}
          >
            {isContinuing ? <LoaderIcon className="size-3 animate-spin" /> : null}
            Continue with Gemini
          </Button>
          {onOpenAdvanced ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isContinuing}
              onClick={onOpenAdvanced}
            >
              Advanced
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
