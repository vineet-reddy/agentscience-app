/**
 * Banner shown above the active gate when revising the current stage marked
 * downstream stages stale. Lets the user pick which stales to recompute (or
 * keep) explicitly. Lives in the stage rail, just below the divider.
 *
 *   ⚠  3 downstream stages need recomputing after this revision.
 *   [ ] Method  [ ] Analysis  [ ] Figures
 *   [ Recompute selected ]   [ Keep current ]
 *
 * The reducer never wipes stale artifacts on its own — only `project.recompute`
 * does, and only for the stages the user opts in to.
 */

import {
  type ResearchWorkflowMode,
  type StageId,
  workflowStageDisplayName,
  workflowStageOrder,
} from "@agentscience/contracts";
import { AlertTriangleIcon } from "lucide-react";
import { memo, useEffect, useState } from "react";

import { Button } from "../ui/button";
import { cn } from "~/lib/utils";

interface StaleRecomputeBannerProps {
  staleStageIds: readonly StageId[];
  workflowMode: ResearchWorkflowMode;
  onRecompute: (stageIds: readonly StageId[]) => void;
  onDismiss: () => void;
}

export const StaleRecomputeBanner = memo(function StaleRecomputeBanner({
  staleStageIds,
  workflowMode,
  onRecompute,
  onDismiss,
}: StaleRecomputeBannerProps) {
  const [selected, setSelected] = useState<Set<StageId>>(
    () => new Set(staleStageIds),
  );

  // Reset selection whenever the stale set changes (e.g. another revise).
  useEffect(() => {
    setSelected(new Set(staleStageIds));
  }, [staleStageIds]);

  const toggle = (stageId: StageId) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(stageId)) {
        next.delete(stageId);
      } else {
        next.add(stageId);
      }
      return next;
    });
  };

  const orderedSelection = workflowStageOrder(workflowMode).filter((stageId) =>
    selected.has(stageId),
  );

  return (
    <div className="rounded-xl border border-amber-500/35 bg-amber-500/[0.04] px-3 py-2.5">
      <div className="mb-2 flex items-center gap-1.5 px-0.5 text-[10px] uppercase tracking-[0.16em] text-amber-700 dark:text-amber-400">
        <AlertTriangleIcon className="size-3.5" />
        <span>
          {staleStageIds.length} downstream{" "}
          {staleStageIds.length === 1 ? "stage is" : "stages are"} stale
        </span>
      </div>
      <p className="px-0.5 pb-2 text-xs text-muted-foreground">
        The revision changed an upstream artifact. Pick which downstream
        stages should be recomputed; unselected stages keep their existing
        artifacts (still flagged stale until they are explicitly redone).
      </p>
      <div className="flex flex-wrap gap-1.5 pb-2">
        {staleStageIds.map((stageId) => {
          const checked = selected.has(stageId);
          return (
            <button
              key={stageId}
              type="button"
              onClick={() => toggle(stageId)}
              aria-pressed={checked}
              className={cn(
                "rounded-md border px-2 py-1 text-[11px] transition-colors",
                checked
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              {workflowStageDisplayName(workflowMode, stageId)}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <Button type="button" size="xs" variant="ghost" onClick={onDismiss}>
          Keep current
        </Button>
        <Button
          type="button"
          size="xs"
          variant="default"
          disabled={orderedSelection.length === 0}
          onClick={() => onRecompute(orderedSelection)}
        >
          Recompute {orderedSelection.length === 0 ? "" : `(${orderedSelection.length})`}
        </Button>
      </div>
    </div>
  );
});
