/**
 * "Stage rail" rendered below the existing MessagesTimeline and above the
 * composer. Holds the visible audit trail for stage transitions: past
 * approval rows in canonical order, plus the active stage row or gate card
 * for the current stage.
 *
 * Why outside MessagesTimeline:
 *   - MessagesTimeline is virtualized and tightly coupled to the row
 *     measurement model. Adding stage rows would require reworking the
 *     row union, height estimator, and a number of edge cases.
 *   - The stage rail naturally lives at the latest point of the chat — it
 *     is "what's next" — so visually rendering it after the timeline is
 *     correct.
 *
 * In manual mode:
 *   - active stage with no artifact yet  -> shows a thin "active" row
 *   - active stage awaiting_approval     -> shows the GateCard
 *   - past approved/skipped stages       -> shows the collapsed approved row
 *
 * In auto mode:
 *   - approved stages with auto=true     -> shows "auto-approved · 0.92"
 *   - the active stage's gate only renders if confidence is below threshold
 *     (the reducer keeps it in `awaiting_approval` until the user acts)
 */

import {
  STAGE_DISPLAY_NAME,
  STAGE_ORDER,
  type ProjectStageState,
  type StageId,
  type ThreadId,
} from "@agentscience/contracts";
import { getStaleStageIds } from "@agentscience/shared/stageMachine";
import { ZapIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { GateCard } from "./GateCard";
import { StageApprovedRow } from "./StageApprovedRow";
import { StageDivider } from "./StageDivider";
import { StaleRecomputeBanner } from "./StaleRecomputeBanner";

interface StageRailProps {
  threadId: ThreadId;
  state: ProjectStageState;
  onApproveStage: (stageId: StageId) => void;
  onReviseStage: (stageId: StageId, instructionsMd: string) => void;
  onDiscussStage: (stageId: StageId) => void;
  onSkipStage: (stageId: StageId) => void;
  onRecomputeStages: (stageIds: readonly StageId[]) => void;
}

export const StageRail = memo(function StageRail({
  onApproveStage,
  onDiscussStage,
  onRecomputeStages,
  onReviseStage,
  onSkipStage,
  state,
}: StageRailProps) {
  const staleStageIds = useMemo(() => getStaleStageIds(state), [state]);
  const [staleDismissed, setStaleDismissed] = useState(false);

  const items: { stageId: StageId; node: React.ReactNode }[] = [];

  if (staleStageIds.length > 0 && !staleDismissed) {
    items.push({
      stageId: state.currentStageId,
      node: (
        <StaleRecomputeBanner
          key="stale-banner"
          staleStageIds={staleStageIds}
          onDismiss={() => setStaleDismissed(true)}
          onRecompute={(stageIds) => {
            onRecomputeStages(stageIds);
            setStaleDismissed(false);
          }}
        />
      ),
    });
  }

  // Walk every stage in canonical order. Past stages get a collapsed row;
  // the current stage gets the gate card or active row.
  for (const stageId of STAGE_ORDER) {
    const stage = state.stages[stageId];
    if (!stage) continue;

    const isCurrent = stageId === state.currentStageId;
    const status = stage.status;

    if (status === "approved" || status === "skipped" || status === "revised") {
      items.push({
        stageId,
        node: (
          <StageApprovedRow
            key={`approved:${stageId}`}
            stageId={stageId}
            status={status}
            stale={stage.stale}
            // Auto-confidence is only shown when the stage was auto-approved.
            // We don't carry the auto flag in ProjectStage, so we infer:
            // a stage with confidence and approvedAt in auto mode rendered as auto.
            autoConfidence={
              status === "approved" && state.mode === "auto" && stage.confidence !== null
                ? stage.confidence
                : null
            }
          />
        ),
      });
      continue;
    }

    if (!isCurrent) {
      // Future / pending stages don't render in the rail.
      continue;
    }

    if (status === "active") {
      items.push({
        stageId,
        node: (
          <ActiveStageRow
            key={`active:${stageId}`}
            stageId={stageId}
          />
        ),
      });
      continue;
    }

    if (status === "awaiting_approval") {
      items.push({
        stageId,
        node: (
          <div key={`gate:${stageId}`} className="space-y-2">
            <StageDivider stageId={stageId} />
            <GateCard
              stageId={stageId}
              concerns={stage.concerns}
              confidence={stage.confidence}
              stale={stage.stale}
              onApprove={() => onApproveStage(stageId)}
              onRevise={(instructionsMd) => onReviseStage(stageId, instructionsMd)}
              onDiscuss={() => {
                onDiscussStage(stageId);
              }}
              onSkip={
                stageId !== "review" ? () => onSkipStage(stageId) : undefined
              }
            />
          </div>
        ),
      });
      continue;
    }
  }

  if (items.length === 0) return null;

  return (
    <div className="mx-auto w-full max-w-208 px-3 pb-3 sm:px-5">
      <div className="space-y-1">
        {items.map((item) => (
          <div key={`rail:${item.stageId}`}>{item.node}</div>
        ))}
      </div>
    </div>
  );
});

function ActiveStageRow({
  stageId,
}: {
  stageId: StageId;
}) {
  const number = STAGE_ORDER.indexOf(stageId) + 1;
  const name = STAGE_DISPLAY_NAME[stageId];
  return (
    <>
      <StageDivider stageId={stageId} />
      <div className="rounded-xl border border-dashed border-border/65 bg-card/20 px-3 py-2.5">
        <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground/80">
          <ZapIcon className="size-3.5 text-muted-foreground/55" />
          Stage {number} · {name} · in progress
        </p>
      </div>
    </>
  );
}
