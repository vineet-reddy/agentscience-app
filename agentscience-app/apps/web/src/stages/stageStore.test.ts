import {
  TrimmedNonEmptyString,
  type ProjectStageState,
  type StageArtifact,
  type StageId,
} from "@agentscience/contracts";
import { createInitialStageState } from "@agentscience/shared/stageMachine";
import { describe, expect, it } from "vitest";

import { getStageArtifact } from "./stageStore";

const nonEmpty = (value: string): typeof TrimmedNonEmptyString.Type =>
  TrimmedNonEmptyString.makeUnsafe(value);

function artifact(stageId: StageId): StageArtifact {
  switch (stageId) {
    case "question":
      return {
        stageId,
        kind: "hypothesis",
        titleMd: nonEmpty("Test hypothesis"),
        statementMd: "A concise, testable statement.",
        assumptions: [],
      };
    case "novelty":
      return {
        stageId,
        kind: "novelty_assessment",
        priorWork: [],
        summaryMd: "No blocking prior work found.",
      };
    case "data":
      return { stageId, kind: "dataset_set", datasets: [] };
    case "method":
      return {
        stageId,
        kind: "method_draft",
        methodMd: "Run the prespecified analysis.",
        requiredTools: [],
      };
    case "analysis":
      return {
        stageId,
        kind: "analysis_result",
        figureRef: {
          id: nonEmpty("figure-1"),
          mime: "image/png",
          url: nonEmpty("https://example.invalid/figure.png"),
          alt: "Analysis result figure",
        },
        captionMd: "Analysis result.",
      };
    case "figures":
      return { stageId, kind: "figure_set", figures: [] };
    case "draft":
      return { stageId, kind: "section_drafts", sections: [] };
    case "review":
      return {
        stageId,
        kind: "manuscript",
        paperReviewThreadId: "thread-stage-test" as never,
      };
  }
}

describe("stageStore selectors", () => {
  it("returns null when the thread has no stage state", () => {
    expect(getStageArtifact(null, "question")).toBeNull();
  });

  it("returns the artifact for the requested stage", () => {
    const state = createInitialStageState({
      now: "2026-05-03T00:00:00.000Z",
    }) as ProjectStageState;
    const question = artifact("question");
    const withArtifact: ProjectStageState = {
      ...state,
      stages: {
        ...state.stages,
        question: {
          ...state.stages.question,
          artifact: question,
        },
      },
    };

    expect(getStageArtifact(withArtifact, "question")).toBe(question);
    expect(getStageArtifact(withArtifact, "novelty")).toBeNull();
  });
});
