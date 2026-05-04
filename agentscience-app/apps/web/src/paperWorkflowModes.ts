import type { ResearchWorkflowMode } from "@agentscience/contracts";

export type PaperWorkflowMode = ResearchWorkflowMode;

export interface PaperWorkflowModeOption {
  id: PaperWorkflowMode;
  label: string;
  description: string;
  dotClassName: string;
}

export const PAPER_WORKFLOW_MODES: readonly PaperWorkflowModeOption[] = [
  {
    id: "literature-review",
    label: "Literature review",
    description: "Survey sources and synthesize what is known.",
    dotClassName: "bg-brand",
  },
  {
    id: "experimental-design",
    label: "Experimental design",
    description: "Develop hypotheses, controls, and a preregistration-ready protocol.",
    dotClassName: "bg-violet-500",
  },
  {
    id: "data-analysis",
    label: "Data analysis",
    description: "Work from a dataset toward results.",
    dotClassName: "bg-emerald-600",
  },
  {
    id: "grant-writing",
    label: "Grant writer",
    description: "Shape aims, evidence, milestones, and reviewer-facing narrative.",
    dotClassName: "bg-stone-800",
  },
  {
    id: "open",
    label: "Open",
    description: "Create a full research paper from question to final draft.",
    dotClassName: "bg-ink",
  },
] as const;

export const AGENT_WORKFLOW_MODES: readonly PaperWorkflowModeOption[] =
  PAPER_WORKFLOW_MODES.filter((mode) => mode.id !== "open");

export const PAPER_WORKFLOW_MODE_BY_ID = Object.fromEntries(
  PAPER_WORKFLOW_MODES.map((mode) => [mode.id, mode]),
) as Partial<Record<PaperWorkflowMode, PaperWorkflowModeOption>>;

export function isPaperWorkflowMode(value: unknown): value is PaperWorkflowMode {
  return (
    value === "literature-review" ||
    value === "experimental-design" ||
    value === "data-analysis" ||
    value === "grant-writing" ||
    value === "general-agent" ||
    value === "open"
  );
}
