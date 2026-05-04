/**
 * Interactive card rendered in the chat flow when the agent has proposed an
 * artifact for a stage and is waiting for user approval (manual mode, or
 * auto mode with confidence below the threshold).
 *
 * Visual rules (matched to existing WORK LOG card):
 *   - rounded-xl, border-border (slightly heavier than work log because it
 *     is interactive)
 *   - same internal padding rhythm
 *   - small-caps header "N CONSIDERATIONS BEFORE APPROVING" with monochrome
 *     triangle warning icon — no color tint, no semantic background.
 *
 * Body:
 *   - For each concern: bold lead, followed by secondary-color body.
 *
 * Action row:
 *   - Approve →  (primary, filled foreground)
 *   - Revise   (outlined)
 *   - Discuss  (lighter outlined)
 */

import {
  type Concern,
  type Confidence,
  type ResearchWorkflowMode,
  type StageId,
  workflowStageDisplayName,
  workflowStageOrder,
} from "@agentscience/contracts";
import { ArrowRightIcon, AlertTriangleIcon } from "lucide-react";
import { memo, useState } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import ChatMarkdown from "../ChatMarkdown";

interface GateCardProps {
  stageId: StageId;
  workflowMode: ResearchWorkflowMode;
  concerns: readonly Concern[];
  confidence: Confidence | null;
  /** True when revision turned this gate stale (still actionable, but flagged). */
  stale?: boolean | undefined;
  onApprove: () => void;
  onRevise: (instructionsMd: string) => void;
  onDiscuss: () => void;
  onSkip?: (() => void) | undefined;
}

export const GateCard = memo(function GateCard({
  stageId,
  workflowMode,
  concerns,
  confidence,
  stale,
  onApprove,
  onRevise,
  onDiscuss,
  onSkip,
}: GateCardProps) {
  const stageNumber = workflowStageOrder(workflowMode).indexOf(stageId) + 1;
  const stageName = workflowStageDisplayName(workflowMode, stageId);
  const concernCount = concerns.length;
  const [revising, setRevising] = useState(false);
  const [reviseDraft, setReviseDraft] = useState("");
  const headerLabel =
    concernCount === 0
      ? "Ready for approval"
      : `${concernCount} ${concernCount === 1 ? "consideration" : "considerations"} before approving`;

  return (
    <div
      role="region"
      aria-label={`Approval gate for stage ${stageNumber} · ${stageName}`}
      className={cn(
        "rounded-xl border border-border bg-card/40 px-3 py-2.5",
        stale ? "opacity-90 ring-1 ring-amber-500/15" : null,
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
        <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/85">
          <AlertTriangleIcon className="size-3.5 text-muted-foreground/65" />
          {headerLabel}
        </p>
        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/55">
          Stage {stageNumber} · {stageName}
          {confidence !== null ? ` · ${confidence.toFixed(2)}` : ""}
        </p>
      </div>

      {concernCount > 0 && (
        <ul className="space-y-2 pb-2">
          {concerns.map((concern) => (
            <li key={concern.id} className="px-0.5">
              <p className="text-sm leading-relaxed text-foreground">
                <span className="font-medium">{concern.lead}.</span>{" "}
                <span className="text-muted-foreground">
                  <InlineMarkdown text={concern.bodyMd} />
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}

      {revising ? (
        <ReviseForm
          value={reviseDraft}
          onChange={setReviseDraft}
          onCancel={() => {
            setRevising(false);
            setReviseDraft("");
          }}
          onSubmit={() => {
            const trimmed = reviseDraft.trim();
            if (trimmed.length === 0) return;
            onRevise(trimmed);
            setRevising(false);
            setReviseDraft("");
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <Button
            type="button"
            size="xs"
            variant="default"
            onClick={onApprove}
            aria-label={`Approve stage ${stageNumber} · ${stageName}`}
          >
            Approve
            <ArrowRightIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => setRevising(true)}
          >
            Revise
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="text-muted-foreground/85 hover:text-foreground"
            onClick={onDiscuss}
          >
            Discuss
          </Button>
          {onSkip && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="ml-auto text-muted-foreground/65 hover:text-foreground"
              onClick={onSkip}
            >
              Skip
            </Button>
          )}
        </div>
      )}
    </div>
  );
});

interface ReviseFormProps {
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function ReviseForm({ value, onChange, onCancel, onSubmit }: ReviseFormProps) {
  return (
    <div className="flex flex-col gap-2 pt-1">
      <textarea
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        placeholder="What should the agent change? (e.g. tighten the hypothesis to a directional claim)"
        className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/55 focus:border-ring/45"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="flex items-center justify-end gap-1.5">
        <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="xs" variant="default" onClick={onSubmit}>
          Send revision
        </Button>
      </div>
    </div>
  );
}

/**
 * Minimal inline markdown for concern bodies. We delegate to ChatMarkdown
 * so KaTeX, code, and links render the same as elsewhere.
 */
function InlineMarkdown({ text }: { text: string }) {
  return <ChatMarkdown text={text} cwd={undefined} isStreaming={false} />;
}
