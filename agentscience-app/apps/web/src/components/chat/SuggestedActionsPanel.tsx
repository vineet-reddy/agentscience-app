import type { SuggestedAction } from "@agentscience/contracts";
import { CornerDownLeftIcon, PencilLineIcon } from "lucide-react";
import { memo, useEffect, useMemo } from "react";
import { cn } from "~/lib/utils";

interface SuggestedActionsPanelProps {
  actions: readonly SuggestedAction[];
  disabled?: boolean;
  onSelect: (action: SuggestedAction) => void;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']"));
}

export const SuggestedActionsPanel = memo(function SuggestedActionsPanel({
  actions,
  disabled = false,
  onSelect,
}: SuggestedActionsPanelProps) {
  const visibleActions = useMemo(() => actions.slice(0, 3), [actions]);

  useEffect(() => {
    if (disabled || visibleActions.length === 0) {
      return;
    }
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) {
        return;
      }
      if (isTextEntryTarget(event.target)) {
        return;
      }
      const shortcut = Number.parseInt(event.key, 10);
      if (Number.isNaN(shortcut) || shortcut < 1 || shortcut > visibleActions.length) {
        return;
      }
      const action = visibleActions[shortcut - 1];
      if (!action) {
        return;
      }
      event.preventDefault();
      onSelect(action);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [disabled, onSelect, visibleActions]);

  if (visibleActions.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Suggested next steps"
      className="mx-auto w-full max-w-208 border-t border-rule"
      data-testid="suggested-actions-panel"
    >
      <div className="flex items-center justify-between gap-3 py-2 text-[0.75rem] text-ink-faint">
        <span>Suggested next steps</span>
        <span className="hidden font-mono sm:inline">press 1-3 or click</span>
      </div>
      <div className="border-t border-rule">
        {visibleActions.map((action, index) => {
          const Icon = action.kind === "compose" ? PencilLineIcon : CornerDownLeftIcon;
          return (
            <button
              key={action.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(action)}
              className={cn(
                "group flex w-full items-center gap-3 border-b border-rule px-0 py-2.5 text-left outline-none transition-colors duration-150 ease-linear focus-visible:bg-snow-white-dark/50 disabled:cursor-not-allowed disabled:opacity-60",
                "hover:bg-snow-white",
              )}
            >
              <kbd className="flex size-8 shrink-0 items-center justify-center rounded-[4px] border border-rule bg-snow-white font-mono text-[0.875rem] font-normal text-ink-light transition-colors duration-150 ease-linear group-hover:border-brand group-focus-visible:border-brand">
                {index + 1}
              </kbd>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.9375rem] font-medium leading-5 text-ink">
                  {action.label}
                </span>
                <span className="block truncate text-[0.875rem] leading-5 text-ink-light">
                  {action.description}
                </span>
              </span>
              <Icon
                aria-hidden="true"
                className="size-4 shrink-0 text-ink-faint transition-colors duration-150 ease-linear group-hover:text-brand group-focus-visible:text-brand"
              />
            </button>
          );
        })}
      </div>
    </section>
  );
});
