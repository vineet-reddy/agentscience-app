import type { StageId } from "@agentscience/contracts";
import { describe, expect, it } from "vitest";

import { buildStageAgentInputs, gateToolForStage } from "./stagePromptBuilder";
import { STAGE_PROMPTS } from "./stagePrompts";

const ALL_STAGES: StageId[] = [
  "question",
  "novelty",
  "data",
  "method",
  "analysis",
  "figures",
  "draft",
  "review",
];

describe("buildStageAgentInputs", () => {
  it("includes the stage label and tool list in the system message", () => {
    const inputs = buildStageAgentInputs("analysis");
    expect(inputs.systemMessage).toMatch(/stage 5\/8 · ANALYSIS/i);
    for (const tool of STAGE_PROMPTS.analysis.toolAllowlist) {
      expect(inputs.systemMessage).toContain(tool);
    }
    expect(inputs.allowedTools).toEqual(STAGE_PROMPTS.analysis.toolAllowlist);
  });

  it("renders a non-empty system message for every stage", () => {
    for (const stageId of ALL_STAGES) {
      const inputs = buildStageAgentInputs(stageId);
      expect(inputs.systemMessage.length).toBeGreaterThan(50);
      expect(inputs.allowedTools.length).toBeGreaterThan(0);
    }
  });

  it("injects only the selected workflow profile", () => {
    const inputs = buildStageAgentInputs({
      workflowMode: "literature-review",
      stageId: "novelty",
    });

    expect(inputs.systemMessage).toMatch(/Literature review · stage 2\/4 · EVIDENCE MAP/i);
    expect(inputs.systemMessage).toContain("running in Literature review mode");
    expect(inputs.systemMessage).not.toContain("running in Experimental design mode");
    expect(inputs.systemMessage).not.toContain("running in Data analysis mode");
    expect(inputs.systemMessage).not.toContain("Question, Novelty, Data, Method, Analysis");
  });
});

describe("gateToolForStage", () => {
  it("permits an allowlisted tool", () => {
    expect(gateToolForStage("analysis", "run_python")).toEqual({ allowed: true });
    expect(gateToolForStage("question", "literature_search")).toEqual({ allowed: true });
    expect(gateToolForStage("question", "think")).toEqual({ allowed: true });
  });

  it("rejects a tool not on the stage's allowlist", () => {
    const result = gateToolForStage("question", "run_python");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("question");
    expect(result.reason).toContain("run_python");
  });

  it("rejects build_pdf at every stage except review", () => {
    for (const stageId of ALL_STAGES) {
      const result = gateToolForStage(stageId, "build_pdf");
      if (stageId === "review") {
        expect(result.allowed).toBe(true);
      } else {
        expect(result.allowed).toBe(false);
      }
    }
  });

  it("rejects compile_latex outside draft and review", () => {
    for (const stageId of ALL_STAGES) {
      const result = gateToolForStage(stageId, "compile_latex");
      if (stageId === "draft" || stageId === "review") {
        expect(result.allowed).toBe(true);
      } else {
        expect(result.allowed).toBe(false);
      }
    }
  });
});
