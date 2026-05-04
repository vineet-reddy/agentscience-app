import { ThreadId, TrimmedNonEmptyString } from "@agentscience/contracts";
import { describe, expect, it } from "vitest";

import { extractStageArtifactFromText } from "./stageArtifactExtraction.ts";

const nonEmpty = (value: string): typeof TrimmedNonEmptyString.Type =>
  TrimmedNonEmptyString.makeUnsafe(value);

describe("stageArtifactExtraction", () => {
  it("extracts a valid current-stage artifact and removes the machine block", () => {
    const createdAt = "2026-05-03T00:00:00.000Z";
    const result = extractStageArtifactFromText({
      text: [
        "I narrowed the question.",
        "",
        "```agentscience-stage-artifact",
        JSON.stringify({
          stageId: "question",
          confidence: 0.91,
          concerns: [
            {
              id: "scope",
              severity: "info",
              lead: "Scope is tight",
              bodyMd: "The hypothesis is limited to one measurable endpoint.",
              relatedRefs: [],
              surfacedAt: createdAt,
            },
          ],
          artifact: {
            stageId: "question",
            kind: "hypothesis",
            titleMd: nonEmpty("Directional endpoint hypothesis"),
            statementMd: "Treatment changes the measured endpoint against control.",
            assumptions: ["The endpoint is available in the selected data."],
          },
        }),
        "```",
      ].join("\n"),
      threadId: ThreadId.makeUnsafe("thread-1"),
      currentStageId: "question",
      createdAt,
    });

    expect(result?.sanitizedText).toBe("I narrowed the question.");
    expect(result?.command.type).toBe("stage.artifact.proposed");
    expect(result?.command.stageId).toBe("question");
    expect(result?.command.artifact.kind).toBe("hypothesis");
    expect(result?.command.concerns).toHaveLength(1);
  });

  it("ignores blocks for another stage", () => {
    const result = extractStageArtifactFromText({
      text: [
        "```agentscience-stage-artifact",
        JSON.stringify({
          stageId: "novelty",
          confidence: 0.91,
          concerns: [],
          artifact: {
            stageId: "novelty",
            kind: "novelty_assessment",
            priorWork: [],
            summaryMd: "No close prior work.",
          },
        }),
        "```",
      ].join("\n"),
      threadId: ThreadId.makeUnsafe("thread-1"),
      currentStageId: "question",
      createdAt: "2026-05-03T00:00:00.000Z",
    });

    expect(result).toBeNull();
  });
});
