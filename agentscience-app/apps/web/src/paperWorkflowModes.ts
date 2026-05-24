import type { ResearchWorkflowMode } from "@agentscience/contracts";

export type PaperWorkflowMode = ResearchWorkflowMode;

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
