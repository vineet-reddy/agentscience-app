import type { ServerProvider } from "@agentscience/contracts";
import { useEffect, useMemo } from "react";

import { BrandMark } from "./BrandMark";
import { isMacPlatform } from "../lib/utils";
import { useDesktopFullScreen } from "../hooks/useDesktopFullScreen";
import { CodexAuthControls } from "./settings/CodexAuthControls";
import { GeminiAuthControls } from "./settings/GeminiAuthControls";
import { isElectron } from "../env";
import { Button } from "./ui/button";
import { hasProviderModelAccess } from "../providerModels";

export type DesktopConnectionTarget = "codex" | "gemini" | "both";

interface DesktopConnectionPortalProps {
  readonly codexProvider: ServerProvider | undefined;
  readonly geminiProvider: ServerProvider | undefined;
  readonly target: DesktopConnectionTarget | null;
  readonly onTargetChange: (target: DesktopConnectionTarget | null) => void;
  readonly onOpenAdvanced: () => void;
}

export function DesktopConnectionPortal({
  codexProvider,
  geminiProvider,
  target,
  onTargetChange,
  onOpenAdvanced,
}: DesktopConnectionPortalProps) {
  const isMacElectron = isElectron && isMacPlatform(navigator.platform);
  const isFullScreen = useDesktopFullScreen();
  const showTitlebarInset = isMacElectron && !isFullScreen;
  const codexConnected = hasProviderModelAccess(codexProvider);
  const geminiConnected = hasProviderModelAccess(geminiProvider);

  useEffect(() => {
    if (target === "codex" && codexConnected) {
      onTargetChange(null);
    }
    if (target === "gemini" && geminiConnected) {
      onTargetChange(null);
    }
    if (target === "both" && codexConnected && geminiConnected) {
      onTargetChange(null);
    }
  }, [codexConnected, geminiConnected, onTargetChange, target]);

  const activeTarget = target;
  const targetTitle = useMemo(() => {
    if (activeTarget === "codex") return "Sign in with ChatGPT.";
    if (activeTarget === "gemini") return "Sign in with Gemini.";
    if (activeTarget === "both") return "Sign in with both.";
    return "Choose model access.";
  }, [activeTarget]);
  const targetCopy = useMemo(() => {
    if (activeTarget === "codex") {
      return "You will see GPT models after ChatGPT is connected.";
    }
    if (activeTarget === "gemini") {
      return "You will see Gemini models after Gemini is connected.";
    }
    if (activeTarget === "both") {
      return "Connect both accounts to see all available GPT and Gemini models.";
    }
    return "Pick one provider, or connect both if you want access to every model family.";
  }, [activeTarget]);

  const showCodexControls =
    activeTarget === "codex" ||
    (activeTarget === "both" && !codexConnected);
  const showGeminiControls =
    activeTarget === "gemini" ||
    (activeTarget === "both" && codexConnected && !geminiConnected);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {showTitlebarInset ? <div className="drag-region h-9 shrink-0" /> : null}
      <div
        className={[
          "flex h-[52px] shrink-0 items-center border-b border-rule px-6",
          isElectron ? "drag-region" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <BrandMark size={28} className="text-ink" wordmarkClassName="text-lg text-ink" />
      </div>

      <main className="flex flex-1 items-center px-8 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-[760px]">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-faint">
            Step 2 of 2
          </p>
          <div className="mt-6 max-w-[560px] space-y-4">
            <h1 className="font-display text-[3rem] leading-[1.04] text-ink sm:text-[3.5rem]">
              {targetTitle}
            </h1>
            <p className="text-[0.9375rem] leading-relaxed text-ink-light">
              {targetCopy}
            </p>
          </div>

          {activeTarget === null ? (
            <div className="mt-10 grid gap-3 sm:grid-cols-3">
              <ConnectionChoice
                title="Sign in with ChatGPT"
                description="Show GPT models."
                connected={codexConnected}
                onClick={() => onTargetChange("codex")}
              />
              <ConnectionChoice
                title="Sign in with Gemini"
                description="Show Gemini models."
                connected={geminiConnected}
                onClick={() => onTargetChange("gemini")}
              />
              <ConnectionChoice
                title="Sign in with both"
                description="Show all models."
                connected={codexConnected && geminiConnected}
                onClick={() => onTargetChange("both")}
              />
            </div>
          ) : (
            <div className="mt-10">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  {activeTarget === "both" ? (
                    <>
                      {codexConnected ? "ChatGPT connected" : "First, connect ChatGPT"}
                      {" · "}
                      {geminiConnected ? "Gemini connected" : "then connect Gemini"}
                    </>
                  ) : null}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onTargetChange(null)}
                >
                  Change choice
                </Button>
              </div>

              {showCodexControls ? (
                <CodexAuthControls
                  provider={codexProvider}
                  appearance="portal"
                  onOpenAdvanced={onOpenAdvanced}
                  showApiKeyOption={false}
                />
              ) : null}
              {showGeminiControls ? (
                <GeminiAuthControls provider={geminiProvider} appearance="portal" />
              ) : null}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function ConnectionChoice({
  title,
  description,
  connected,
  onClick,
}: {
  readonly title: string;
  readonly description: string;
  readonly connected: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="rounded-lg border border-rule bg-card px-4 py-4 text-left shadow-sm transition-colors hover:border-foreground/20 hover:bg-accent/35"
      onClick={onClick}
    >
      <span className="block text-sm font-medium text-foreground">{title}</span>
      <span className="mt-1 block text-sm text-muted-foreground">
        {connected ? "Already connected." : description}
      </span>
    </button>
  );
}
