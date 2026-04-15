import type { ServerProvider } from "@agentscience/contracts";

import { BrandMark } from "./BrandMark";
import { isMacPlatform } from "../lib/utils";
import { CodexAuthControls } from "./settings/CodexAuthControls";
import { isElectron } from "../env";

interface DesktopConnectionPortalProps {
  readonly provider: ServerProvider | undefined;
  readonly onOpenAdvanced: () => void;
}

export function DesktopConnectionPortal({
  provider,
  onOpenAdvanced,
}: DesktopConnectionPortalProps) {
  const useMacTitlebarInset = isElectron && isMacPlatform(navigator.platform);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div
        className={[
          "drag-region flex h-[52px] shrink-0 items-center border-b border-rule pr-6",
          useMacTitlebarInset ? "pl-[104px]" : "pl-6",
        ].join(" ")}
      >
        <BrandMark
          size={24}
          className="text-ink"
          iconClassName="size-6"
          wordmarkClassName="text-[1.125rem] text-ink"
        />
      </div>

      <main className="flex flex-1 items-center px-8 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-[760px]">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-faint">
            Welcome
          </p>
          <div className="mt-6 max-w-[560px] space-y-4">
            <h1 className="font-display text-[3rem] leading-[1.04] text-ink sm:text-[3.5rem]">
              Get started.
            </h1>
            <p className="text-[0.9375rem] leading-relaxed text-ink-light">
              Continue with ChatGPT or an OpenAI API key. AgentScience handles the rest.
            </p>
          </div>

          <CodexAuthControls
            provider={provider}
            appearance="portal"
            onOpenAdvanced={onOpenAdvanced}
          />
        </div>
      </main>
    </div>
  );
}
