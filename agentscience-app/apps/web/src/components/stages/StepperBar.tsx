/**
 * Stage navigation controls for the research workflow. The breadcrumb variant
 * is used in the chat header; the dot strip remains available for compact
 * secondary surfaces such as the stage panel.
 */

import {
  type ProjectMode,
  type ProjectStageState,
  type StageId,
  workflowStageDisplayName,
  workflowStageOrder,
} from "@agentscience/contracts";
import { memo } from "react";

import { cn } from "~/lib/utils";

interface StepperBarProps {
  state: ProjectStageState;
  /** Optional override of which stage to highlight. Defaults to current. */
  focusedStageId?: StageId | undefined;
  onFocusStage: (stageId: StageId) => void;
}

export const StepperBar = memo(function StepperBar({
  state,
  focusedStageId,
  onFocusStage,
}: StepperBarProps) {
  const focused = focusedStageId ?? state.currentStageId;
  const stageOrder = workflowStageOrder(state.workflowMode);
  const focusedIndex = stageOrder.indexOf(focused);
  const focusedNumber = focusedIndex + 1;
  const focusedLabel = workflowStageDisplayName(state.workflowMode, focused);

  return (
    <div className="@container/stepper border-b border-border/65 bg-background">
      <div className="flex h-9 items-center gap-3 px-3 sm:px-5">
        {/* Stage label: hidden when the column is too narrow (canvas open).
            The canvas header surfaces the same label in that case, so we
            avoid the duplication and free space for the dot strip. */}
        <div className="hidden min-w-0 shrink-0 items-center gap-2 @[30rem]/stepper:flex">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/85">
            Stage {focusedNumber} · {focusedLabel}
          </span>
        </div>
        <StepperDots
          state={state}
          focusedStageId={focused}
          onFocusStage={onFocusStage}
        />
      </div>
    </div>
  );
});

interface StageBreadcrumbProps {
  className?: string;
  state: ProjectStageState;
  focusedStageId?: StageId | undefined;
  onFocusStage: (stageId: StageId) => void;
}

export function StageBreadcrumb({
  className,
  focusedStageId,
  onFocusStage,
  state,
}: StageBreadcrumbProps) {
  const focused = focusedStageId ?? state.currentStageId;
  const stageOrder = workflowStageOrder(state.workflowMode);
  const currentIndex = stageOrder.indexOf(state.currentStageId);

  return (
    <nav
      aria-label="Research stages"
      className={cn(
        "flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {stageOrder.map((stageId, index) => {
        const stage = state.stages[stageId];
        const status = stage?.status ?? "pending";
        const isFocused = stageId === focused;
        const isCurrent = stageId === state.currentStageId;
        const isComplete = status === "approved" || status === "skipped";
        const isPast = index < currentIndex;
        const navigable = isPast || isCurrent;

        return (
          <div key={stageId} className="flex min-w-max items-center gap-1">
            <button
              type="button"
              aria-current={isCurrent ? "step" : undefined}
              disabled={!navigable}
              onClick={() => {
                if (navigable) {
                  onFocusStage(stageId);
                }
              }}
              className={cn(
                "h-7 rounded-full px-2.5 text-[0.8125rem] leading-none transition-colors duration-150",
                isCurrent
                  ? "bg-ink text-snow-white"
                  : isFocused
                    ? "text-ink ring-1 ring-rule"
                    : isComplete || isPast
                      ? "text-ink-light hover:text-ink"
                      : "text-ink-faint",
                navigable ? "cursor-pointer" : "cursor-default",
              )}
            >
              {workflowStageDisplayName(state.workflowMode, stageId)}
            </button>
            {index < stageOrder.length - 1 ? (
              <span aria-hidden className="text-[0.75rem] text-ink-faint/70">
                /
              </span>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

interface StepperDotsProps {
  className?: string;
  justify?: "center" | "end";
  state: ProjectStageState;
  focusedStageId: StageId;
  onFocusStage: (stageId: StageId) => void;
}

export function StepperDots({
  className,
  focusedStageId,
  justify = "center",
  onFocusStage,
  state,
}: StepperDotsProps) {
  const stageOrder = workflowStageOrder(state.workflowMode);
  const currentIndex = stageOrder.indexOf(state.currentStageId);

  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center",
        justify === "end" ? "justify-end" : "justify-center",
        className,
      )}
    >
      <div className="flex items-center">
        {stageOrder.map((stageId, index) => {
          const stage = state.stages[stageId];
          const status = stage?.status ?? "pending";
          const stale = stage?.stale === true;
          const isFocused = stageId === focusedStageId;
          const isCurrent = stageId === state.currentStageId;
          const isDone = status === "approved" || status === "skipped";
          const isPast = index < currentIndex;
          const navigable = isPast || isCurrent;

          return (
            <div key={stageId} className="flex items-center">
              <button
                type="button"
                aria-label={`Stage ${index + 1} · ${workflowStageDisplayName(state.workflowMode, stageId)} · ${status}${stale ? " · stale" : ""}`}
                aria-current={isCurrent ? "step" : undefined}
                disabled={!navigable}
                onClick={() => navigable && onFocusStage(stageId)}
                className={cn(
                  "relative grid place-items-center transition-all duration-150",
                  navigable ? "cursor-pointer" : "cursor-default",
                  isCurrent ? "size-4" : "size-3",
                )}
              >
                {isCurrent && (
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-full ring-2 ring-foreground/30"
                  />
                )}
                <span
                  aria-hidden
                  className={cn(
                    "size-2 rounded-full border transition-colors duration-150",
                    isDone
                      ? stale
                        ? "border-foreground/50 bg-foreground/50"
                        : "border-foreground bg-foreground"
                      : isCurrent
                        ? "border-foreground bg-foreground"
                        : "border-ink-faint bg-background",
                    status === "skipped" ? "border-dashed bg-background" : null,
                    isFocused && !isCurrent ? "ring-1 ring-foreground/30" : null,
                  )}
                />
              </button>
              {index < stageOrder.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "h-px transition-colors duration-150",
                    "w-3 @[24rem]/stepper:w-4 @[32rem]/stepper:w-5 @[40rem]/stepper:w-6",
                    index < currentIndex ? "bg-foreground" : "bg-ink-faint/70",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ModeToggleProps {
  className?: string;
  mode: ProjectMode;
  onChangeMode: (mode: ProjectMode) => void;
  size?: "default" | "compact";
}

export function ModeToggle({ className, mode, onChangeMode, size = "default" }: ModeToggleProps) {
  return (
    <div
      role="group"
      aria-label="Workflow mode"
      className={cn("inline-flex rounded-full border border-border/70 p-0.5", className)}
    >
      <ModeButton
        label="Manual"
        active={mode === "manual"}
        onClick={() => onChangeMode("manual")}
        size={size}
      />
      <ModeButton
        label="Auto"
        active={mode === "auto"}
        onClick={() => onChangeMode("auto")}
        size={size}
      />
    </div>
  );
}

function ModeButton({
  label,
  active,
  onClick,
  size,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  size: "default" | "compact";
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full py-1 text-[0.8125rem] transition-colors",
        size === "compact" ? "px-2.5" : "px-3",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground/80 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
