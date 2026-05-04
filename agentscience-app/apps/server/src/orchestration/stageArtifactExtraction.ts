import {
  Concern,
  Confidence,
  StageArtifact,
  StageId,
  type Confidence as ConfidenceType,
  type StageArtifactProposedCommand,
} from "@agentscience/contracts";
import { Schema } from "effect";

const STAGE_ARTIFACT_BLOCK_RE =
  /```(?:agentscience-stage-artifact|stage-artifact)\s*([\s\S]*?)```/gi;

const StageArtifactEnvelope = Schema.Struct({
  stageId: StageId,
  artifact: StageArtifact,
  concerns: Schema.Array(Concern).pipe(Schema.withDecodingDefault(() => [])),
  confidence: Confidence,
});

export interface ExtractedStageArtifact {
  readonly command: Pick<
    StageArtifactProposedCommand,
    "type" | "threadId" | "stageId" | "artifact" | "concerns" | "confidence" | "createdAt"
  >;
  readonly sanitizedText: string;
}

export function extractStageArtifactFromText(input: {
  readonly text: string;
  readonly threadId: StageArtifactProposedCommand["threadId"];
  readonly currentStageId: StageId;
  readonly createdAt: string;
}): ExtractedStageArtifact | null {
  let selected:
    | {
        readonly stageId: StageId;
        readonly artifact: StageArtifact;
        readonly concerns: readonly Concern[];
        readonly confidence: ConfidenceType;
      }
    | null = null;
  let sanitizedText = "";
  let lastIndex = 0;

  for (const match of input.text.matchAll(STAGE_ARTIFACT_BLOCK_RE)) {
    const fullMatch = match[0] ?? "";
    const jsonText = match[1]?.trim() ?? "";
    const index = match.index ?? 0;
    sanitizedText += input.text.slice(lastIndex, index);
    lastIndex = index + fullMatch.length;

    if (selected !== null || jsonText.length === 0) {
      continue;
    }

    try {
      const decoded = Schema.decodeUnknownSync(StageArtifactEnvelope)(JSON.parse(jsonText));
      if (
        decoded.stageId !== input.currentStageId ||
        decoded.artifact.stageId !== decoded.stageId
      ) {
        continue;
      }
      selected = decoded;
    } catch {
      continue;
    }
  }

  if (lastIndex === 0 || selected === null) {
    return null;
  }

  sanitizedText = `${sanitizedText}${input.text.slice(lastIndex)}`.trim();
  return {
    sanitizedText,
    command: {
      type: "stage.artifact.proposed",
      threadId: input.threadId,
      stageId: selected.stageId,
      artifact: selected.artifact,
      concerns: [...selected.concerns],
      confidence: selected.confidence,
      createdAt: input.createdAt,
    },
  };
}
