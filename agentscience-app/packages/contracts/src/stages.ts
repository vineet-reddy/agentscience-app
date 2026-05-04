/**
 * Stage machine for the AgentScience research workflow.
 *
 * A research project (one OrchestrationThread) progresses through 8 sequential
 * stages: Question, Novelty, Data, Method, Analysis, Figures, Draft, Review.
 *
 * The data model in this file is intentionally pure (no I/O, no UI) and is the
 * single source of truth for stage state shared between the contracts package,
 * the projector, and the web client.
 *
 * The companion pure reducer lives in `@agentscience/shared/stageMachine`.
 */

import { Schema } from "effect";

import {
  CommandId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";

// ---------------------------------------------------------------------------
// Stage identity
// ---------------------------------------------------------------------------

export const StageId = Schema.Literals([
  "question",
  "novelty",
  "data",
  "method",
  "analysis",
  "figures",
  "draft",
  "review",
]);
export type StageId = typeof StageId.Type;

/**
 * Canonical display order. Indexes are 1-based when shown to the user
 * (e.g. "STAGE 5 · ANALYSIS").
 */
export const STAGE_ORDER: readonly StageId[] = [
  "question",
  "novelty",
  "data",
  "method",
  "analysis",
  "figures",
  "draft",
  "review",
] as const;

export const FIRST_STAGE_ID: StageId = STAGE_ORDER[0]!;
export const LAST_STAGE_ID: StageId = STAGE_ORDER[STAGE_ORDER.length - 1]!;

export const STAGE_DISPLAY_NAME: Readonly<Record<StageId, string>> = {
  question: "Question",
  novelty: "Novelty",
  data: "Data",
  method: "Method",
  analysis: "Analysis",
  figures: "Figures",
  draft: "Draft",
  review: "Review",
} as const;

export function stageIndex(stageId: StageId): number {
  return STAGE_ORDER.indexOf(stageId);
}

// ---------------------------------------------------------------------------
// Stage status
// ---------------------------------------------------------------------------

export const StageStatus = Schema.Literals([
  "pending",
  "active",
  "awaiting_approval",
  "approved",
  "revised",
  "skipped",
]);
export type StageStatus = typeof StageStatus.Type;

// ---------------------------------------------------------------------------
// Project-level mode
// ---------------------------------------------------------------------------

export const ProjectMode = Schema.Literals(["manual", "auto"]);
export type ProjectMode = typeof ProjectMode.Type;

export const DEFAULT_PROJECT_MODE: ProjectMode = "manual";

/**
 * In auto mode, an artifact is auto-approved when its self-reported confidence
 * is at or above this threshold. Below threshold, the gate card is shown and
 * the user must approve manually.
 */
export const DEFAULT_AUTO_CONFIDENCE_THRESHOLD = 0.85;

// ---------------------------------------------------------------------------
// Concerns (gate card body)
// ---------------------------------------------------------------------------

export const ConcernSeverity = Schema.Literals(["info", "warning"]);
export type ConcernSeverity = typeof ConcernSeverity.Type;

const ConcernRelatedRefKind = Schema.Literals([
  "dataset",
  "figure",
  "section",
  "citation",
  "paper",
]);

export const ConcernRelatedRef = Schema.Struct({
  kind: ConcernRelatedRefKind,
  id: TrimmedNonEmptyString,
});
export type ConcernRelatedRef = typeof ConcernRelatedRef.Type;

export const Concern = Schema.Struct({
  id: TrimmedNonEmptyString,
  severity: ConcernSeverity,
  lead: TrimmedNonEmptyString,
  bodyMd: Schema.String,
  relatedRefs: Schema.Array(ConcernRelatedRef).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  surfacedAt: IsoDateTime,
});
export type Concern = typeof Concern.Type;

// ---------------------------------------------------------------------------
// Confidence (0..1)
// ---------------------------------------------------------------------------

export const Confidence = Schema.Number.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(1),
);
export type Confidence = typeof Confidence.Type;

// ---------------------------------------------------------------------------
// Per-stage artifact types
// ---------------------------------------------------------------------------

const FigureRefMime = Schema.Literals([
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp",
]);

export const FigureRef = Schema.Struct({
  id: TrimmedNonEmptyString,
  mime: FigureRefMime,
  url: TrimmedNonEmptyString,
  alt: Schema.String,
  width: Schema.optional(NonNegativeInt),
  height: Schema.optional(NonNegativeInt),
});
export type FigureRef = typeof FigureRef.Type;

export const CodeRef = Schema.Struct({
  language: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString,
});
export type CodeRef = typeof CodeRef.Type;

// --- Question ---------------------------------------------------------------

export const HypothesisArtifact = Schema.Struct({
  stageId: Schema.Literal("question"),
  kind: Schema.Literal("hypothesis"),
  titleMd: TrimmedNonEmptyString,
  statementMd: Schema.String,
  assumptions: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefault(() => []),
  ),
});
export type HypothesisArtifact = typeof HypothesisArtifact.Type;

// --- Novelty ----------------------------------------------------------------

const NoveltySimilarity = Schema.Literals(["low", "medium", "high"]);

const PriorWorkRow = Schema.Struct({
  paperId: Schema.optional(TrimmedNonEmptyString),
  title: TrimmedNonEmptyString,
  claim: Schema.String,
  similarity: NoveltySimilarity,
  noteMd: Schema.String,
});

export const NoveltyAssessmentArtifact = Schema.Struct({
  stageId: Schema.Literal("novelty"),
  kind: Schema.Literal("novelty_assessment"),
  priorWork: Schema.Array(PriorWorkRow).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  summaryMd: Schema.String,
});
export type NoveltyAssessmentArtifact = typeof NoveltyAssessmentArtifact.Type;

// --- Data -------------------------------------------------------------------

const DatasetCard = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  source: TrimmedNonEmptyString,
  provenanceMd: Schema.String,
  rowCount: Schema.optional(NonNegativeInt),
  columns: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  // Sample rows are intentionally unstructured; rendering decides the shape.
  sampleRows: Schema.optional(Schema.Array(Schema.Unknown)),
});
export type DatasetCard = typeof DatasetCard.Type;

export const DatasetSetArtifact = Schema.Struct({
  stageId: Schema.Literal("data"),
  kind: Schema.Literal("dataset_set"),
  datasets: Schema.Array(DatasetCard).pipe(
    Schema.withDecodingDefault(() => []),
  ),
});
export type DatasetSetArtifact = typeof DatasetSetArtifact.Type;

// --- Method -----------------------------------------------------------------

export const MethodDraftArtifact = Schema.Struct({
  stageId: Schema.Literal("method"),
  kind: Schema.Literal("method_draft"),
  /** Markdown with KaTeX inline math. Source of truth until Draft stage. */
  methodMd: Schema.String,
  requiredTools: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => []),
  ),
});
export type MethodDraftArtifact = typeof MethodDraftArtifact.Type;

// --- Analysis ---------------------------------------------------------------

export const AnalysisResultArtifact = Schema.Struct({
  stageId: Schema.Literal("analysis"),
  kind: Schema.Literal("analysis_result"),
  figureRef: FigureRef,
  captionMd: Schema.String,
  methodsTextMd: Schema.optional(Schema.String),
  codeRef: Schema.optional(CodeRef),
});
export type AnalysisResultArtifact = typeof AnalysisResultArtifact.Type;

// --- Figures ----------------------------------------------------------------

const FigureEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  titleMd: TrimmedNonEmptyString,
  captionMd: Schema.String,
  figureRef: FigureRef,
  codeRef: Schema.optional(CodeRef),
  iteration: NonNegativeInt,
});
export type FigureEntry = typeof FigureEntry.Type;

export const FigureSetArtifact = Schema.Struct({
  stageId: Schema.Literal("figures"),
  kind: Schema.Literal("figure_set"),
  figures: Schema.Array(FigureEntry).pipe(
    Schema.withDecodingDefault(() => []),
  ),
});
export type FigureSetArtifact = typeof FigureSetArtifact.Type;

// --- Draft ------------------------------------------------------------------

const SectionDraft = Schema.Struct({
  id: TrimmedNonEmptyString,
  titleMd: TrimmedNonEmptyString,
  /**
   * Markdown with KaTeX inline math.
   * Compiled to LaTeX only when transitioning into the Review stage.
   */
  bodyMd: Schema.String,
});
export type SectionDraft = typeof SectionDraft.Type;

export const SectionDraftsArtifact = Schema.Struct({
  stageId: Schema.Literal("draft"),
  kind: Schema.Literal("section_drafts"),
  sections: Schema.Array(SectionDraft).pipe(
    Schema.withDecodingDefault(() => []),
  ),
});
export type SectionDraftsArtifact = typeof SectionDraftsArtifact.Type;

// --- Review -----------------------------------------------------------------

export const ManuscriptArtifact = Schema.Struct({
  stageId: Schema.Literal("review"),
  kind: Schema.Literal("manuscript"),
  /**
   * The compiled manuscript. The actual artifacts (LaTeX source, PDF,
   * bibliography) are surfaced through the existing PaperReviewSnapshot
   * keyed by this thread id; we only carry the reference here.
   */
  paperReviewThreadId: ThreadId,
});
export type ManuscriptArtifact = typeof ManuscriptArtifact.Type;

// --- Discriminated union ----------------------------------------------------

export const StageArtifact = Schema.Union([
  HypothesisArtifact,
  NoveltyAssessmentArtifact,
  DatasetSetArtifact,
  MethodDraftArtifact,
  AnalysisResultArtifact,
  FigureSetArtifact,
  SectionDraftsArtifact,
  ManuscriptArtifact,
]);
export type StageArtifact = typeof StageArtifact.Type;

/**
 * Type-level mapping from StageId to its artifact variant.
 * Used by helpers that produce or consume artifacts in a stage-aware way.
 */
export type StageArtifactByStage = {
  question: HypothesisArtifact;
  novelty: NoveltyAssessmentArtifact;
  data: DatasetSetArtifact;
  method: MethodDraftArtifact;
  analysis: AnalysisResultArtifact;
  figures: FigureSetArtifact;
  draft: SectionDraftsArtifact;
  review: ManuscriptArtifact;
};

// ---------------------------------------------------------------------------
// Per-stage record + project-level state
// ---------------------------------------------------------------------------

export const ProjectStage = Schema.Struct({
  stageId: StageId,
  status: StageStatus,
  artifact: Schema.NullOr(StageArtifact),
  concerns: Schema.Array(Concern).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  confidence: Schema.NullOr(Confidence),
  /** True when an upstream stage was revised after this one was approved. */
  stale: Schema.Boolean,
  enteredAt: Schema.NullOr(IsoDateTime),
  proposedAt: Schema.NullOr(IsoDateTime),
  approvedAt: Schema.NullOr(IsoDateTime),
  revisedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectStage = typeof ProjectStage.Type;

/**
 * Project-level stage state. `null` on the OrchestrationThread means the
 * thread predates the stage machine (legacy thread, no stepper rendered).
 * New threads from this version forward always have a non-null state.
 */
export const ProjectStageState = Schema.Struct({
  mode: ProjectMode,
  currentStageId: StageId,
  autoConfidenceThreshold: Confidence,
  stages: Schema.Record(StageId, ProjectStage),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectStageState = typeof ProjectStageState.Type;

// ---------------------------------------------------------------------------
// Stage activity tagging
//
// Existing activities (OrchestrationThreadActivity) carry an unstructured
// `payload`. Activities scoped to a stage carry these fields in `payload` so
// the per-stage agent log can be reconstructed by filtering the activity
// stream. No schema change to the activity row itself is required.
// ---------------------------------------------------------------------------

export const StageActivityKind = Schema.Literals([
  "stage.entered",
  "stage.artifact.proposed",
  "stage.approved",
  "stage.auto_approved",
  "stage.revised",
  "stage.skipped",
  "stage.discuss.opened",
  "stage.staled_by_upstream",
]);
export type StageActivityKind = typeof StageActivityKind.Type;

export const StageActivityPayload = Schema.Struct({
  stageId: StageId,
  stageEvent: StageActivityKind,
  /** Optional confidence at the time of the event. */
  confidence: Schema.optional(Confidence),
  /** Optional concern ids surfaced or referenced by this event. */
  concernIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  /** Free-form note (used by skip/revise). */
  noteMd: Schema.optional(Schema.String),
});
export type StageActivityPayload = typeof StageActivityPayload.Type;

// ---------------------------------------------------------------------------
// Stage commands
//
// These are defined here so the reducer in @agentscience/shared and any
// stage-aware runtime integration share one typed command shape.
// ---------------------------------------------------------------------------

export const StageStartCommand = Schema.Struct({
  type: Schema.Literal("stage.start"),
  commandId: CommandId,
  threadId: ThreadId,
  stageId: StageId,
  createdAt: IsoDateTime,
});
export type StageStartCommand = typeof StageStartCommand.Type;

export const StageArtifactProposedCommand = Schema.Struct({
  type: Schema.Literal("stage.artifact.proposed"),
  commandId: CommandId,
  threadId: ThreadId,
  stageId: StageId,
  artifact: StageArtifact,
  concerns: Schema.Array(Concern),
  confidence: Confidence,
  createdAt: IsoDateTime,
});
export type StageArtifactProposedCommand =
  typeof StageArtifactProposedCommand.Type;

export const StageApproveCommand = Schema.Struct({
  type: Schema.Literal("stage.approve"),
  commandId: CommandId,
  threadId: ThreadId,
  stageId: StageId,
  /** True when emitted by the auto-mode reactor, false when by the user. */
  auto: Schema.Boolean,
  createdAt: IsoDateTime,
});
export type StageApproveCommand = typeof StageApproveCommand.Type;

export const StageReviseCommand = Schema.Struct({
  type: Schema.Literal("stage.revise"),
  commandId: CommandId,
  threadId: ThreadId,
  stageId: StageId,
  instructionsMd: Schema.String,
  createdAt: IsoDateTime,
});
export type StageReviseCommand = typeof StageReviseCommand.Type;

export const StageDiscussCommand = Schema.Struct({
  type: Schema.Literal("stage.discuss"),
  commandId: CommandId,
  threadId: ThreadId,
  stageId: StageId,
  /**
   * Discuss is a UX affordance: it scopes a chat turn to the gate's concerns.
   * It does not change stage status. The activity is logged so the agent
   * can read it back as context.
   */
  messageId: MessageId,
  createdAt: IsoDateTime,
});
export type StageDiscussCommand = typeof StageDiscussCommand.Type;

export const StageSkipCommand = Schema.Struct({
  type: Schema.Literal("stage.skip"),
  commandId: CommandId,
  threadId: ThreadId,
  stageId: StageId,
  reasonMd: Schema.optional(Schema.String),
  createdAt: IsoDateTime,
});
export type StageSkipCommand = typeof StageSkipCommand.Type;

export const ProjectModeSetCommand = Schema.Struct({
  type: Schema.Literal("project.mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  mode: ProjectMode,
  createdAt: IsoDateTime,
});
export type ProjectModeSetCommand = typeof ProjectModeSetCommand.Type;

export const ProjectRecomputeCommand = Schema.Struct({
  type: Schema.Literal("project.recompute"),
  commandId: CommandId,
  threadId: ThreadId,
  /**
   * Subset of stale stages that the user chose to recompute when revising
   * an upstream stage. Stages omitted here keep their existing artifacts
   * (still flagged `stale = true` until they are explicitly recomputed).
   */
  stageIds: Schema.Array(StageId),
  createdAt: IsoDateTime,
});
export type ProjectRecomputeCommand = typeof ProjectRecomputeCommand.Type;

export const StageCommand = Schema.Union([
  StageStartCommand,
  StageArtifactProposedCommand,
  StageApproveCommand,
  StageReviseCommand,
  StageDiscussCommand,
  StageSkipCommand,
  ProjectModeSetCommand,
  ProjectRecomputeCommand,
]);
export type StageCommand = typeof StageCommand.Type;
