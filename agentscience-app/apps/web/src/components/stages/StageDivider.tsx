/**
 * Centered small-caps divider used to mark a stage transition in the chat
 * thread. Visually identical to the existing "Response · 4.2s" divider in
 * MessagesTimeline so transitions feel native to the chat.
 */

import {
  type ResearchWorkflowMode,
  type StageId,
  workflowStageDisplayName,
  workflowStageOrder,
} from "@agentscience/contracts";
import { memo } from "react";

interface StageDividerProps {
  stageId: StageId;
  workflowMode: ResearchWorkflowMode;
  /** Optional suffix (e.g. "approved", "auto-approved · 0.92"). */
  suffix?: string;
}

export const StageDivider = memo(function StageDivider({
  stageId,
  workflowMode,
  suffix,
}: StageDividerProps) {
  const number = workflowStageOrder(workflowMode).indexOf(stageId) + 1;
  const name = workflowStageDisplayName(workflowMode, stageId);
  const label = suffix
    ? `Stage ${number} · ${name} · ${suffix}`
    : `Stage ${number} · ${name}`;
  return (
    <div className="my-3 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">
        {label}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
});
