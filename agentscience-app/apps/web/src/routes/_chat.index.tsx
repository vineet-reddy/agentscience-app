import { createFileRoute } from "@tanstack/react-router";

import { Button } from "../components/ui/button";
import { isElectron } from "../env";
import { SidebarTrigger } from "../components/ui/sidebar";
import { useHandleNewThread } from "../hooks/useHandleNewThread";

function ChatIndexRouteView() {
  const { activeDraftThread, activeThread, defaultProjectId, handleNewThread } =
    useHandleNewThread();
  const activeProjectId =
    activeThread?.projectId ?? activeDraftThread?.projectId ?? defaultProjectId;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-muted-foreground/40">
      {!isElectron && (
        <header className="border-b border-border px-3 py-2 md:hidden">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="size-7 shrink-0" />
            <span className="text-sm font-medium text-foreground">Research Sessions</span>
          </div>
        </header>
      )}

      {isElectron && (
        <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
          <span className="text-xs text-muted-foreground/50">No active research session</span>
        </div>
      )}

      <div className="flex flex-1 items-center justify-center">
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 text-center">
          <p className="text-sm text-muted-foreground">
            Start a new research session to begin. Type your research idea and Agent Science will
            find data, run experiments, and write your paper.
          </p>
          <Button
            disabled={activeProjectId === null}
            onClick={() => {
              if (!activeProjectId) {
                return;
              }
              void handleNewThread(activeProjectId);
            }}
          >
            New Research
          </Button>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
