/**
 * Right-side canvas. Replaces PaperReviewPanel for stage-aware threads.
 *
 * Behavior:
 *   - Header has a Preview / Source pill toggle (matching PaperReviewPanel).
 *   - Body content is determined by the focused stage.
 *   - The Review stage delegates to PaperReviewPanel as today (the PDF
 *     pipeline is unchanged).
 *
 * Source view is a power-user affordance; the user should never *have* to
 * read raw Markdown or LaTeX to operate the app.
 */

import { type ThreadId, type StageId } from "@agentscience/contracts";
import { lazy, memo, Suspense, useEffect, useState } from "react";

import { useThreadStageState } from "../../stages/stageStore";
import { cn } from "~/lib/utils";
import { workflowStageDisplayName } from "@agentscience/contracts";
import { StepperDots } from "./StepperBar";

import {
  AnalysisStagePanel,
  DataStagePanel,
  DraftStagePanel,
  FiguresStagePanel,
  MethodStagePanel,
  NoveltyStagePanel,
  QuestionStagePanel,
} from "./panels";

const PaperReviewPanel = lazy(() => import("../PaperReviewPanel"));

type CanvasView = "preview" | "source";

interface StagePanelProps {
  threadId: ThreadId;
  /** Optional stage override (e.g. user clicks a past dot in stepper). */
  focusedStageId?: StageId;
  /** Set to true when the right canvas is also serving the existing PDF preview. */
  paperReviewAvailable?: boolean;
}

export const StagePanel = memo(function StagePanel({
  threadId,
  focusedStageId,
  paperReviewAvailable,
}: StagePanelProps) {
  const state = useThreadStageState(threadId);
  const [view, setView] = useState<CanvasView>("preview");
  const [localFocusedStageId, setLocalFocusedStageId] = useState<StageId | null>(null);
  const currentStageId = state?.currentStageId ?? null;

  useEffect(() => {
    if (!currentStageId) {
      setLocalFocusedStageId(null);
      return;
    }
    setLocalFocusedStageId(currentStageId);
  }, [currentStageId]);

  // Threads without stage state fall back to the legacy paper review panel.
  if (!state) {
    return paperReviewAvailable ? (
      <Suspense fallback={<LoadingFallback />}>
        <PaperReviewPanel threadId={threadId} />
      </Suspense>
    ) : (
      <EmptyCanvas />
    );
  }

  const stageId = focusedStageId ?? localFocusedStageId ?? state.currentStageId;
  const stage = state.stages[stageId];
  const name = workflowStageDisplayName(state.workflowMode, stageId);
  const focusStage = (nextStageId: StageId) => {
    setLocalFocusedStageId(nextStageId);
  };

  // Review delegates to the existing PDF panel (same component as before).
  if (stageId === "review") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
        <Suspense fallback={<LoadingFallback />}>
          <PaperReviewPanel threadId={threadId} />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="@container/stepper h-[52px] shrink-0 border-b border-border/80 px-5">
        <div className="flex h-full min-w-0 items-center gap-4">
          <div className="inline-flex shrink-0 rounded-full border border-border/70 p-0.5">
            <ViewButton
              label="Preview"
              active={view === "preview"}
              onClick={() => setView("preview")}
            />
            <ViewButton
              label="Source"
              active={view === "source"}
              onClick={() => setView("source")}
            />
          </div>
          <StepperDots
            className="ml-auto"
            justify="end"
            state={state}
            focusedStageId={stageId}
            onFocusStage={focusStage}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <StageBody stageId={stageId} state={state} view={view} />
        {!stage?.artifact && (
          <div className="mx-auto max-w-3xl px-5 py-12 text-center">
            <p className="font-display text-[1.4rem] text-foreground">
              {name} stage in progress
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The agent is preparing the artifact for this stage. Once it
              proposes one, you'll see it here in preview.
            </p>
          </div>
        )}
      </div>
    </div>
  );
});

function ViewButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground/80 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

interface StageBodyProps {
  stageId: StageId;
  state: NonNullable<ReturnType<typeof useThreadStageState>>;
  view: CanvasView;
}

function StageBody({ stageId, state, view }: StageBodyProps) {
  switch (stageId) {
    case "question":
      return <QuestionStagePanel state={state} view={view} />;
    case "novelty":
      return <NoveltyStagePanel state={state} view={view} />;
    case "data":
      return <DataStagePanel state={state} view={view} />;
    case "method":
      return <MethodStagePanel state={state} view={view} />;
    case "analysis":
      return <AnalysisStagePanel state={state} view={view} />;
    case "figures":
      return <FiguresStagePanel state={state} view={view} />;
    case "draft":
      return <DraftStagePanel state={state} view={view} />;
    case "review":
      // handled above
      return null;
  }
}

function LoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

function EmptyCanvas() {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div>
        <p className="font-display text-[1.65rem] text-foreground">No artifact yet</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The right canvas surfaces stage-by-stage artifacts. Start a new
          research project to see them here.
        </p>
      </div>
    </div>
  );
}
