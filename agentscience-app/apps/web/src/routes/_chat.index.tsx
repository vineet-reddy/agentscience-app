import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpIcon } from "lucide-react";
import { useState } from "react";

import { useComposerAutoSubmitStore } from "../composerAutoSubmitStore";
import { useComposerDraftStore } from "../composerDraftStore";
import { useComposerFocusStore } from "../composerFocusStore";
import { isElectron } from "../env";
import { type PaperWorkflowMode } from "../paperWorkflowModes";
import { SidebarTrigger } from "../components/ui/sidebar";
import { MacTitlebarDragRow } from "../components/MacTitlebarDragRow";
import { SidebarReopenTrigger } from "../components/SidebarReopenTrigger";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useUiStateStore } from "../uiStateStore";
import { AGENT_CONFIGS, AgentGlyph } from "../agentRegistry";

function ChatIndexRouteView() {
  const { handleNewThread } = useHandleNewThread();
  const [prompt, setPromptValue] = useState("");
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const requestComposerFocus = useComposerFocusStore((store) => store.requestFocus);
  const requestComposerAutoSubmit = useComposerAutoSubmitStore((store) => store.requestSubmit);
  const setPaperWorkflowMode = useUiStateStore((store) => store.setPaperWorkflowMode);

  const startPaper = async (options?: { submitPrompt?: boolean }) => {
    const threadId = await handleNewThread(null, { kind: "paper" });
    setPaperWorkflowMode(threadId, null);
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt) {
      setPrompt(threadId, trimmedPrompt);
    }
    requestComposerFocus({
      threadId,
      ...(trimmedPrompt ? { seedPrompt: trimmedPrompt } : {}),
    });
    if (options?.submitPrompt && trimmedPrompt) {
      requestComposerAutoSubmit({ threadId });
    }
  };

  const startAgent = async (
    workflowMode: PaperWorkflowMode | null,
    options?: { submitPrompt?: boolean },
  ) => {
    const threadId = await handleNewThread(null, { kind: "agent" });
    setPaperWorkflowMode(threadId, workflowMode);
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt) {
      setPrompt(threadId, trimmedPrompt);
    }
    requestComposerFocus({
      threadId,
      ...(trimmedPrompt ? { seedPrompt: trimmedPrompt } : {}),
    });
    if (options?.submitPrompt && trimmedPrompt) {
      requestComposerAutoSubmit({ threadId });
    }
  };

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

      <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-12 sm:px-10">
        <div className="mx-auto flex w-full max-w-[820px] flex-col items-center text-center">
          <h1 className="font-display text-[3rem] leading-[1.05] text-ink sm:text-[3.25rem]">
            Science, amplified.
          </h1>
          <p className="mt-4 max-w-[560px] text-[1rem] leading-relaxed text-ink-light sm:text-[1.0625rem]">
            Create a research paper, explore a scientific idea, or start with a specialist agent.
          </p>

          <form
            className="mt-10 w-full border-y border-rule py-7"
            onSubmit={(event) => {
              event.preventDefault();
              void startPaper({ submitPrompt: true });
            }}
          >
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(event) => setPromptValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey) return;
                  event.preventDefault();
                  void startPaper({ submitPrompt: true });
                }}
                rows={4}
                placeholder="Describe the paper you want to create"
                className="min-h-[118px] w-full resize-none rounded-[4px] border border-rule bg-snow-white px-5 py-4 pr-16 text-left text-[1rem] leading-relaxed text-ink outline-none transition-colors duration-150 ease-linear placeholder:text-ink-faint focus:border-brand"
              />
              <button
                type="submit"
                aria-label="Create paper"
                className="absolute bottom-3.5 right-3.5 inline-flex size-9 items-center justify-center rounded-full bg-ink text-snow-white transition-colors duration-150 ease-linear hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <ArrowUpIcon className="size-4" />
              </button>
            </div>

            <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <span className="text-[0.9375rem] text-ink-light">Or start with</span>
              <div className="flex flex-wrap justify-center gap-2">
                {AGENT_CONFIGS.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => {
                      void startAgent(agent.id, { submitPrompt: true });
                    }}
                    className="group inline-flex items-center gap-2 rounded-[4px] border border-rule bg-background px-3.5 py-2 text-[0.875rem] font-medium text-ink transition-colors duration-150 ease-linear hover:bg-snow-white-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    <AgentGlyph agent={agent} className="size-4" />
                    {agent.name}
                  </button>
                ))}
              </div>
            </div>
          </form>

          <div className="mt-6">
            <button
              type="button"
              onClick={() => {
                void startAgent(null, { submitPrompt: true });
              }}
              className="text-[0.9375rem] text-ink-faint transition-colors duration-150 ease-linear hover:text-ink-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Chat about anything else
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
