import { LoaderIcon } from "lucide-react";
import type { AgentScienceAuthState } from "@agentscience/contracts";
import { useState } from "react";

import { BrandMark } from "./BrandMark";
import { isMacPlatform } from "../lib/utils";
import { useDesktopFullScreen } from "../hooks/useDesktopFullScreen";
import { Button } from "./ui/button";
import { isElectron } from "../env";
import { toastManager } from "./ui/toast";

interface AgentScienceConnectionPortalProps {
  readonly isLoading: boolean;
  readonly onCancel: () => Promise<AgentScienceAuthState>;
  readonly onOpenAdvanced: () => void;
  readonly onOpenBrowser: (url: string) => Promise<void>;
  readonly onSkip: () => void;
  readonly onStart: () => Promise<AgentScienceAuthState>;
  readonly state: AgentScienceAuthState | null;
}

type Action = "cancel" | "open-browser" | "sign-in" | null;

export function AgentScienceConnectionPortal({
  isLoading,
  onCancel,
  onOpenAdvanced,
  onOpenBrowser,
  onSkip,
  onStart,
  state,
}: AgentScienceConnectionPortalProps) {
  const isMacElectron = isElectron && isMacPlatform(navigator.platform);
  const isFullScreen = useDesktopFullScreen();
  const showTitlebarInset = isMacElectron && !isFullScreen;
  const [action, setAction] = useState<Action>(null);

  const status = state?.status ?? "signed-out";
  const isPending = status === "pending";

  const title = isPending ? "Finish in your browser." : "Connect AgentScience.";
  const description = isPending
    ? "Approve this Mac in your browser and AgentScience will connect automatically."
    : "Link this Mac to your AgentScience account so local papers can publish from the app. You can skip for now and connect later in Settings.";
  const detail =
    status === "failed"
      ? state?.message ?? "AgentScience accepted the device token, but the account could not be read."
      : isPending
        ? state?.verificationUrl ?? "agentscience.app"
        : "You can disconnect or switch accounts later in Settings.";

  const handleStart = async () => {
    setAction("sign-in");
    try {
      const nextState = await onStart();
      if (nextState.status === "pending" && nextState.verificationUrl) {
        await onOpenBrowser(nextState.verificationUrl);
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
      await onCancel();
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

  const handleOpenBrowser = async (url: string) => {
    setAction("open-browser");
    try {
      await onOpenBrowser(url);
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
            AgentScience account
          </p>
          <div className="mt-6 max-w-[620px] space-y-4">
            <h1 className="font-display text-[3rem] leading-[1.04] text-ink sm:text-[3.5rem]">
              {title}
            </h1>
            <p className="max-w-[38rem] text-[0.9375rem] leading-relaxed text-ink-light">
              {description}
            </p>
            <p
              className={`max-w-[38rem] text-[0.875rem] leading-relaxed ${
                status === "failed" ? "text-destructive" : "text-ink-light"
              }`}
            >
              {isPending ? (
                <>
                  Approve this device on{" "}
                  <span className="font-mono text-[0.8125rem] text-foreground">{detail}</span>
                  {state?.code ? (
                    <>
                      {" "}
                      with code{" "}
                      <span className="font-mono text-[0.8125rem] text-foreground">{state.code}</span>.
                    </>
                  ) : (
                    "."
                  )}
                </>
              ) : (
                detail
              )}
            </p>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-2">
            {isPending ? (
              <>
                <Button
                  size="sm"
                  disabled={action !== null || !state?.verificationUrl}
                  onClick={() =>
                    state?.verificationUrl ? void handleOpenBrowser(state.verificationUrl) : undefined
                  }
                >
                  {action === "open-browser" ? <LoaderIcon className="size-3 animate-spin" /> : null}
                  Open browser
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={action !== null}
                  onClick={() => void handleCancel()}
                >
                  {action === "cancel" ? <LoaderIcon className="size-3 animate-spin" /> : null}
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" disabled={action !== null || isLoading} onClick={() => void handleStart()}>
                  {action === "sign-in" ? <LoaderIcon className="size-3 animate-spin" /> : null}
                  Sign in
                </Button>
                <Button size="sm" variant="outline" disabled={action !== null} onClick={onSkip}>
                  Skip for now
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={onOpenAdvanced}>
              Settings
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
