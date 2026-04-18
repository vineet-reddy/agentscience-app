import { createFileRoute } from "@tanstack/react-router";

import { Button } from "../components/ui/button";
import { isElectron } from "../env";
import { SidebarTrigger } from "../components/ui/sidebar";
import { MacTitlebarDragRow } from "../components/MacTitlebarDragRow";
import { SidebarReopenTrigger } from "../components/SidebarReopenTrigger";
import { useHandleNewThread } from "../hooks/useHandleNewThread";

function ChatIndexRouteView() {
  const { handleNewThread } = useHandleNewThread();

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
      {!isElectron && (
        <header className="border-b border-border px-4 py-2 md:hidden">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="size-7 shrink-0" />
            <span className="text-sm font-medium text-foreground">Papers</span>
          </div>
        </header>
      )}

      {isElectron && (
        <>
          <MacTitlebarDragRow />
          <div className="drag-region flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-6">
            <SidebarReopenTrigger />
            <span className="text-[13px] text-ink-faint">No active paper</span>
          </div>
        </>
      )}

      <div className="flex flex-1 items-center justify-center px-6">
        <div className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-8 text-center">
          <h1 className="font-display text-[2.5rem] leading-[1.1] text-ink sm:text-[3rem]">
            Science, amplified.
          </h1>
          <p className="max-w-[480px] text-[0.9375rem] leading-relaxed text-ink-light">
            Draft a paper with an agent alongside you, review the full manuscript beside the chat,
            and iterate until it is ready to publish.
          </p>
          <div className="flex items-center gap-3">
            <Button
              onClick={() => {
                void handleNewThread(null);
              }}
            >
              New Paper
            </Button>
          </div>
          <div className="mt-4 h-px w-full max-w-[320px] bg-rule" />
          <p className="text-[0.75rem] uppercase tracking-[0.16em] text-ink-faint">
            AgentScience
          </p>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
