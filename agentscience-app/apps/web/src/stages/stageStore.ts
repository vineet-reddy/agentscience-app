import {
  type AnalysisResultArtifact,
  type DatasetSetArtifact,
  type FigureSetArtifact,
  type HypothesisArtifact,
  type ManuscriptArtifact,
  type MethodDraftArtifact,
  type NoveltyAssessmentArtifact,
  type ProjectStageState,
  type SectionDraftsArtifact,
  type StageArtifact,
  type StageId,
  type ThreadId,
} from "@agentscience/contracts";

import { useStore } from "../store";

/**
 * Subscribe to one thread's server-projected stage state. Returns null for
 * legacy threads or local drafts that have not been created on the server yet.
 */
export function useThreadStageState(threadId: ThreadId | null): ProjectStageState | null {
  return useStore((store) => (threadId ? store.threadsById[threadId]?.stageState ?? null : null));
}

/**
 * Return the artifact for a stage, narrowed to the correct discriminated
 * variant. Returns null if absent or if the stage has not proposed anything.
 */
export function getStageArtifact<S extends StageId>(
  state: ProjectStageState | null,
  stageId: S,
): StageArtifactByStageNarrowed[S] | null {
  if (!state) return null;
  const stage = state.stages[stageId];
  if (!stage || !stage.artifact) return null;
  if (stage.artifact.stageId !== stageId) return null;
  return stage.artifact as StageArtifactByStageNarrowed[S];
}

type StageArtifactByStageNarrowed = {
  question: HypothesisArtifact;
  novelty: NoveltyAssessmentArtifact;
  data: DatasetSetArtifact;
  method: MethodDraftArtifact;
  analysis: AnalysisResultArtifact;
  figures: FigureSetArtifact;
  draft: SectionDraftsArtifact;
  review: ManuscriptArtifact;
};

export type { StageArtifact };
