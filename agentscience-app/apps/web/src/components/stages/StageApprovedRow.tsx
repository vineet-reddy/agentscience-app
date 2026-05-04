/**
 * One-line collapsed row shown after a stage has been approved (or skipped /
 * auto-approved). Keeps the scrollback clean while still leaving an audit
 * trail in the chat flow.
 *
 *   ✓  Stage 5 · Analysis · approved
 *   ✓  Stage 5 · Analysis · auto-approved · 0.92
 *   ⤺  Stage 5 · Analysis · revising
 *   ⏭  Stage 5 · Analysis · skipped
 */

import { CheckIcon, RotateCcwIcon, SkipForwardIcon } from "lucide-react";
import { memo } from "react";

import {
  type ResearchWorkflowMode,
  type StageId,
  type StageStatus,
  workflowStageDisplayName,
  workflowStageOrder,
} from "@agentscience/contracts";
import { cn } from "~/lib/utils";

interface StageApprovedRowProps {
  stageId: StageId;
  workflowMode: ResearchWorkflowMode;
  status: Exclude<StageStatus, "active" | "awaiting_approval" | "pending">;
  /** True when an upstream revise marked this stage stale. */
  stale?: boolean;
  /** When auto-approved, render the confidence value alongside. */
  autoConfidence?: number | null;
}

export const StageApprovedRow = memo(function StageApprovedRow({
  stageId,
  workflowMode,
  status,
  stale,
  autoConfidence,
}: StageApprovedRowProps) {
  const number = workflowStageOrder(workflowMode).indexOf(stageId) + 1;
  const name = workflowStageDisplayName(workflowMode, stageId);
  const Icon =
    status === "skipped"
      ? SkipForwardIcon
      : status === "revised"
        ? RotateCcwIcon
        : CheckIcon;
  const verb =
    status === "skipped"
      ? "skipped"
      : status === "revised"
        ? "revising"
        : autoConfidence !== null && autoConfidence !== undefined
          ? `auto-approved · ${autoConfidence.toFixed(2)}`
          : "approved";
  return (
    <div
      className={cn(
        "my-2 flex items-center gap-2 px-1 text-[11px] text-muted-foreground/85",
        stale ? "opacity-60" : null,
      )}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground/65" />
      <span className="truncate uppercase tracking-[0.14em]">
        Stage {number} · {name} · {verb}
        {stale ? " · stale" : ""}
      </span>
    </div>
  );
});
