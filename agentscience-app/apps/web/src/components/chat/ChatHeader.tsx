import {
  type EditorId,
  type ProjectScript,
  type ProjectStageState,
  type StageId,
  type ThreadId,
} from "@agentscience/contracts";
import { memo } from "react";
import GitActionsControl from "../GitActionsControl";
import { BookOpenTextIcon, DiffIcon, TerminalSquareIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { SidebarReopenTrigger } from "../SidebarReopenTrigger";
import { OpenInPicker } from "./OpenInPicker";
import { StageBreadcrumb } from "../stages/StepperBar";

interface ChatHeaderProps {
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  paperReviewAvailable: boolean;
  paperReviewOpen: boolean;
  stageState?: ProjectStageState | null | undefined;
  focusedStageId?: StageId | undefined;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
  onTogglePaperReview: () => void;
  onFocusStage?: ((stageId: StageId) => void) | undefined;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  paperReviewAvailable,
  paperReviewOpen,
  stageState,
  focusedStageId,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleTerminal,
  onToggleDiff,
  onTogglePaperReview,
  onFocusStage,
}: ChatHeaderProps) {
  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <SidebarReopenTrigger className="hidden md:inline-flex" />
        <h2
          className="min-w-0 shrink truncate text-sm font-medium text-foreground"
          title={activeThreadTitle}
        >
          {activeThreadTitle}
        </h2>
        {activeProjectName && (
          <Badge variant="outline" className="min-w-0 shrink overflow-hidden">
            <span className="min-w-0 truncate">{activeProjectName}</span>
          </Badge>
        )}
        {stageState && onFocusStage ? (
          <StageBreadcrumb
            className="ml-1 hidden flex-1 @2xl/header-actions:flex"
            state={stageState}
            focusedStageId={focusedStageId}
            onFocusStage={onFocusStage}
          />
        ) : null}
        {/* {activeProjectName && !isGitRepo && (
          <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700">
            No Git
          </Badge>
        )} */}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3">
        {/* {activeProjectScripts && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        )} */}
        {activeProjectName && (
          <OpenInPicker
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {/* {activeProjectName && <GitActionsControl gitCwd={gitCwd} activeThreadId={activeThreadId} />} */}
        {terminalAvailable && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  className="shrink-0"
                  pressed={terminalOpen}
                  onPressedChange={onToggleTerminal}
                  aria-label="Toggle terminal drawer"
                  variant="outline"
                  size="xs"
                >
                  <TerminalSquareIcon className="size-3" />
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">
              {terminalToggleShortcutLabel
                ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
                : "Toggle terminal drawer"}
            </TooltipPopup>
          </Tooltip>
        )}
        {paperReviewAvailable && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  className="shrink-0"
                  pressed={paperReviewOpen}
                  onPressedChange={onTogglePaperReview}
                  aria-label="Toggle paper review"
                  variant="outline"
                  size="xs"
                >
                  <BookOpenTextIcon className="size-3" />
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">
              {paperReviewOpen ? "Hide paper review" : "Show paper review"}
            </TooltipPopup>
          </Tooltip>
        )}
        {/* <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={diffOpen}
                onPressedChange={onToggleDiff}
                aria-label="Toggle diff panel"
                variant="outline"
                size="xs"
                disabled={!isGitRepo}
              >
                <DiffIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!isGitRepo
              ? "Diff panel is unavailable because this project is not a git repository."
              : diffToggleShortcutLabel
                ? `Toggle diff panel (${diffToggleShortcutLabel})`
                : "Toggle diff panel"}
          </TooltipPopup>
        </Tooltip> */}
      </div>
    </div>
  );
});
