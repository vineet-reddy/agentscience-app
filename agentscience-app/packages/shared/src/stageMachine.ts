/**
 * Pure stage machine reducer for the AgentScience research workflow.
 *
 * No I/O. No persistence. Given a `ProjectStageState` and a `StageCommand`,
 * returns the next state or a typed error.
 *
 * The reducer is the single source of truth for stage transitions. Both the
 * server-side projector and the client-side optimistic store run this same
 * code. Auto-mode is handled outside the reducer: a reactor inspects each
 * `stage.artifact.proposed` event and dispatches a follow-up `stage.approve`
 * with `auto: true` when confidence clears the threshold. Keeping that
 * separate keeps the reducer deterministic and easy to test.
 */

import {
  DEFAULT_AUTO_CONFIDENCE_THRESHOLD,
  DEFAULT_PROJECT_MODE,
  DEFAULT_RESEARCH_WORKFLOW_MODE,
  STAGE_ORDER,
  workflowStageOrder,
  type Concern,
  type Confidence,
  type IsoDateTime,
  type ProjectMode,
  type ProjectModeSetCommand,
  type ProjectRecomputeCommand,
  type ProjectStage,
  type ProjectStageState,
  type ProjectWorkflowModeSetCommand,
  type StageApproveCommand,
  type StageArtifact,
  type StageArtifactProposedCommand,
  type StageCommand,
  type StageDiscussCommand,
  type StageId,
  type StageReviseCommand,
  type StageSkipCommand,
  type StageStartCommand,
  type StageStatus,
  type ResearchWorkflowMode,
} from "@agentscience/contracts";

// ---------------------------------------------------------------------------
// Dependency graph
// ---------------------------------------------------------------------------

/**
 * Direct dependencies. Reading `STAGE_DEPENDS_ON[s]` gives the set of stages
 * whose artifacts `s` consumes. The transitive closure of "what becomes stale
 * if I revise stage `s`" is computed from the inverse via
 * {@link getDownstreamStages}.
 */
export const STAGE_DEPENDS_ON: Readonly<Record<StageId, readonly StageId[]>> = {
  question: [],
  novelty: ["question"],
  data: ["question"],
  method: ["question", "data"],
  analysis: ["data", "method"],
  figures: ["analysis"],
  draft: ["question", "novelty", "method", "analysis", "figures"],
  review: ["draft"],
} as const;

/**
 * All stages that transitively depend on `stageId`, in canonical display order.
 * `stageId` itself is NOT included.
 */
export function getDownstreamStages(
  stageId: StageId,
  workflowMode: ResearchWorkflowMode = DEFAULT_RESEARCH_WORKFLOW_MODE,
): StageId[] {
  const order = workflowStageOrder(workflowMode);
  const downstream = new Set<StageId>();
  const visit = (s: StageId): void => {
    for (const candidate of order) {
      if (downstream.has(candidate)) continue;
      const deps = STAGE_DEPENDS_ON[candidate];
      if (deps.includes(s)) {
        downstream.add(candidate);
        visit(candidate);
      }
    }
  };
  visit(stageId);
  return order.filter((s) => downstream.has(s));
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export type StageMachineError =
  | { code: "no_stage_state" }
  | { code: "stage_not_found"; stageId: StageId }
  | {
      code: "invalid_status";
      stageId: StageId;
      current: StageStatus;
      expected: readonly StageStatus[];
    }
  | { code: "wrong_current_stage"; given: StageId; current: StageId }
  | {
      code: "artifact_stage_mismatch";
      commandStageId: StageId;
      artifactStageId: StageId;
    }
  | { code: "stage_already_terminal"; stageId: StageId }
  | { code: "no_stages_to_recompute" };

export type StageMachineResult =
  | { ok: true; state: ProjectStageState }
  | { ok: false; error: StageMachineError };

const ok = (state: ProjectStageState): StageMachineResult => ({
  ok: true,
  state,
});
const err = (error: StageMachineError): StageMachineResult => ({
  ok: false,
  error,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stageOrderForState(state: ProjectStageState): readonly StageId[] {
  return workflowStageOrder(state.workflowMode);
}

function nextStageId(state: ProjectStageState, stageId: StageId): StageId | null {
  const order = stageOrderForState(state);
  const idx = order.indexOf(stageId);
  if (idx < 0 || idx === order.length - 1) return null;
  return order[idx + 1]!;
}

function makePendingStage(stageId: StageId): ProjectStage {
  return {
    stageId,
    status: "pending",
    artifact: null,
    concerns: [],
    confidence: null,
    stale: false,
    enteredAt: null,
    proposedAt: null,
    approvedAt: null,
    revisedAt: null,
  };
}

function withStage(
  state: ProjectStageState,
  stageId: StageId,
  patch: Partial<ProjectStage>,
  updatedAt: IsoDateTime,
): ProjectStageState {
  const current = state.stages[stageId];
  if (!current) return state;
  return {
    ...state,
    stages: {
      ...state.stages,
      [stageId]: { ...current, ...patch, stageId },
    },
    updatedAt,
  };
}

function expectStatus(
  state: ProjectStageState,
  stageId: StageId,
  expected: readonly StageStatus[],
): ProjectStage | StageMachineError {
  const stage = state.stages[stageId];
  if (!stage) return { code: "stage_not_found", stageId };
  if (!expected.includes(stage.status)) {
    return {
      code: "invalid_status",
      stageId,
      current: stage.status,
      expected,
    };
  }
  return stage;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

/**
 * Seed a brand-new project at the first stage in `active` status.
 * Use this when creating a new thread.
 */
export function createInitialStageState(input: {
  now: IsoDateTime;
  workflowMode?: ResearchWorkflowMode;
  mode?: ProjectMode;
  autoConfidenceThreshold?: Confidence;
}): ProjectStageState {
  const workflowMode = input.workflowMode ?? DEFAULT_RESEARCH_WORKFLOW_MODE;
  const firstStageId = workflowStageOrder(workflowMode)[0]!;
  const stages = {} as Record<StageId, ProjectStage>;
  for (const stageId of STAGE_ORDER) {
    stages[stageId] = makePendingStage(stageId);
  }
  stages[firstStageId] = {
    ...stages[firstStageId]!,
    status: "active",
    enteredAt: input.now,
  };
  return {
    workflowMode,
    mode: input.mode ?? DEFAULT_PROJECT_MODE,
    currentStageId: firstStageId,
    autoConfidenceThreshold:
      input.autoConfidenceThreshold ?? DEFAULT_AUTO_CONFIDENCE_THRESHOLD,
    stages,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function applyStageCommand(
  state: ProjectStageState,
  command: StageCommand,
): StageMachineResult {
  switch (command.type) {
    case "stage.start":
      return applyStageStart(state, command);
    case "stage.artifact.proposed":
      return applyArtifactProposed(state, command);
    case "stage.approve":
      return applyApprove(state, command);
    case "stage.revise":
      return applyRevise(state, command);
    case "stage.discuss":
      return applyDiscuss(state, command);
    case "stage.skip":
      return applySkip(state, command);
    case "project.mode.set":
      return applyModeSet(state, command);
    case "project.workflow.set":
      return applyWorkflowModeSet(state, command);
    case "project.recompute":
      return applyRecompute(state, command);
  }
}

// stage.start: pending -> active. Only valid on the current stage.
function applyStageStart(
  state: ProjectStageState,
  cmd: StageStartCommand,
): StageMachineResult {
  if (cmd.stageId !== state.currentStageId) {
    return err({
      code: "wrong_current_stage",
      given: cmd.stageId,
      current: state.currentStageId,
    });
  }
  const stage = expectStatus(state, cmd.stageId, ["pending", "revised"]);
  if (!("status" in stage)) return err(stage);
  return ok(
    withStage(
      state,
      cmd.stageId,
      { status: "active", enteredAt: cmd.createdAt },
      cmd.createdAt,
    ),
  );
}

// stage.artifact.proposed: active -> awaiting_approval. Lands the artifact
// and concerns. Auto-approval is the reactor's job (see `shouldAutoApprove`).
function applyArtifactProposed(
  state: ProjectStageState,
  cmd: StageArtifactProposedCommand,
): StageMachineResult {
  if (cmd.artifact.stageId !== cmd.stageId) {
    return err({
      code: "artifact_stage_mismatch",
      commandStageId: cmd.stageId,
      artifactStageId: cmd.artifact.stageId,
    });
  }
  const stage = expectStatus(state, cmd.stageId, ["active"]);
  if (!("status" in stage)) return err(stage);
  return ok(
    withStage(
      state,
      cmd.stageId,
      {
        status: "awaiting_approval",
        artifact: cmd.artifact,
        concerns: [...cmd.concerns],
        confidence: cmd.confidence,
        proposedAt: cmd.createdAt,
        stale: false,
      },
      cmd.createdAt,
    ),
  );
}

// stage.approve: awaiting_approval -> approved. Advances currentStageId and
// seeds the next stage as active. If approving the terminal stage (review),
// currentStageId stays put.
function applyApprove(
  state: ProjectStageState,
  cmd: StageApproveCommand,
): StageMachineResult {
  const stage = expectStatus(state, cmd.stageId, ["awaiting_approval"]);
  if (!("status" in stage)) return err(stage);
  const approvedAt = cmd.createdAt;
  const upcomingId = nextStageId(state, cmd.stageId);
  const baseNext = withStage(
    state,
    cmd.stageId,
    { status: "approved", approvedAt },
    approvedAt,
  );
  if (!upcomingId) {
    // Terminal stage approved; project is fully complete.
    return ok(baseNext);
  }
  const nextStage = baseNext.stages[upcomingId];
  if (!nextStage) {
    return err({ code: "stage_not_found", stageId: upcomingId });
  }
  return ok({
    ...baseNext,
    currentStageId: upcomingId,
    stages: {
      ...baseNext.stages,
      [upcomingId]: {
        ...nextStage,
        status: "active",
        enteredAt: approvedAt,
      },
    },
    updatedAt: approvedAt,
  });
}

// stage.revise: any non-terminal status with content -> revised, then active.
// Marks all downstream stages stale (without wiping their artifacts).
// Rewinds currentStageId to the revised stage.
function applyRevise(
  state: ProjectStageState,
  cmd: StageReviseCommand,
): StageMachineResult {
  const stage = expectStatus(state, cmd.stageId, [
    "awaiting_approval",
    "approved",
    "active",
    "revised",
  ]);
  if (!("status" in stage)) return err(stage);
  const downstream = getDownstreamStages(cmd.stageId, state.workflowMode);
  const updatedAt = cmd.createdAt;
  const stagesNext: Record<StageId, ProjectStage> = { ...state.stages };
  stagesNext[cmd.stageId] = {
    ...stage,
    status: "active",
    revisedAt: updatedAt,
    // Keep the existing artifact and concerns visible so the agent has context
    // for what to change. The next `stage.artifact.proposed` will replace them.
    stale: false,
  };
  for (const dependentId of downstream) {
    const dependent = stagesNext[dependentId];
    if (!dependent) continue;
    // Only mark stages stale if they have a concrete artifact to invalidate.
    // Pending stages and freshly-active-but-empty stages have nothing to
    // invalidate, so they keep `stale = false`.
    if (dependent.artifact === null) continue;
    stagesNext[dependentId] = {
      ...dependent,
      stale: true,
    };
  }
  return ok({
    ...state,
    currentStageId: cmd.stageId,
    stages: stagesNext,
    updatedAt,
  });
}

// stage.discuss: no state change. The activity log records the discussion
// turn; the reducer treats it as an audit-only event.
function applyDiscuss(
  state: ProjectStageState,
  cmd: StageDiscussCommand,
): StageMachineResult {
  const stage = state.stages[cmd.stageId];
  if (!stage) return err({ code: "stage_not_found", stageId: cmd.stageId });
  return ok({ ...state, updatedAt: cmd.createdAt });
}

// stage.skip: marks the stage skipped and advances. Escape hatch.
function applySkip(
  state: ProjectStageState,
  cmd: StageSkipCommand,
): StageMachineResult {
  const stage = expectStatus(state, cmd.stageId, [
    "active",
    "awaiting_approval",
    "revised",
  ]);
  if (!("status" in stage)) return err(stage);
  const updatedAt = cmd.createdAt;
  const upcomingId = nextStageId(state, cmd.stageId);
  const baseNext = withStage(
    state,
    cmd.stageId,
    { status: "skipped" },
    updatedAt,
  );
  if (!upcomingId) {
    return ok(baseNext);
  }
  const nextStage = baseNext.stages[upcomingId];
  if (!nextStage) {
    return err({ code: "stage_not_found", stageId: upcomingId });
  }
  return ok({
    ...baseNext,
    currentStageId: upcomingId,
    stages: {
      ...baseNext.stages,
      [upcomingId]: {
        ...nextStage,
        status: "active",
        enteredAt: updatedAt,
      },
    },
    updatedAt,
  });
}

function applyModeSet(
  state: ProjectStageState,
  cmd: ProjectModeSetCommand,
): StageMachineResult {
  if (state.mode === cmd.mode) {
    return ok({ ...state, updatedAt: cmd.createdAt });
  }
  return ok({ ...state, mode: cmd.mode, updatedAt: cmd.createdAt });
}

function applyWorkflowModeSet(
  state: ProjectStageState,
  cmd: ProjectWorkflowModeSetCommand,
): StageMachineResult {
  if (state.workflowMode === cmd.workflowMode) {
    return ok({ ...state, updatedAt: cmd.createdAt });
  }

  const nextOrder = workflowStageOrder(cmd.workflowMode);
  const nextOrderSet = new Set<StageId>(nextOrder);
  const activeInNewOrder = nextOrder.find((stageId) => {
    const status = state.stages[stageId]?.status;
    return status === "active" || status === "awaiting_approval" || status === "revised";
  });
  const firstOpen =
    activeInNewOrder ??
    nextOrder.find((stageId) => {
      const status = state.stages[stageId]?.status;
      return status !== "approved" && status !== "skipped";
    }) ??
    nextOrder[nextOrder.length - 1]!;
  const currentIndex = nextOrder.indexOf(firstOpen);

  const stagesNext: Record<StageId, ProjectStage> = { ...state.stages };
  for (const stageId of STAGE_ORDER) {
    const stage = stagesNext[stageId];
    if (!stage) continue;
    const inWorkflow = nextOrderSet.has(stageId);
    const isCurrent = stageId === firstOpen;
    const status = stage.status;

    if (!inWorkflow) {
      stagesNext[stageId] =
        status === "active" || status === "awaiting_approval" || status === "revised"
          ? {
              ...stage,
              status: "pending",
              enteredAt: null,
              proposedAt: null,
              confidence: null,
              concerns: [],
            }
          : stage;
      continue;
    }

    if (isCurrent) {
      stagesNext[stageId] = {
        ...stage,
        status:
          status === "approved" || status === "skipped" || status === "awaiting_approval"
            ? status
            : "active",
        enteredAt: stage.enteredAt ?? cmd.createdAt,
        stale: false,
      };
      continue;
    }

    const stageIndex = nextOrder.indexOf(stageId);
    const isDownstream = currentIndex >= 0 && stageIndex > currentIndex;
    stagesNext[stageId] = {
      ...stage,
      status:
        status === "active" || status === "awaiting_approval" || status === "revised"
          ? "pending"
          : status,
      stale: isDownstream && stage.artifact !== null ? true : stage.stale,
    };
  }

  return ok({
    ...state,
    workflowMode: cmd.workflowMode,
    currentStageId: firstOpen,
    stages: stagesNext,
    updatedAt: cmd.createdAt,
  });
}

// project.recompute: resets the chosen stale stages back to active so the
// agent can regenerate them. The earliest such stage becomes currentStageId.
function applyRecompute(
  state: ProjectStageState,
  cmd: ProjectRecomputeCommand,
): StageMachineResult {
  if (cmd.stageIds.length === 0) {
    return err({ code: "no_stages_to_recompute" });
  }
  const updatedAt = cmd.createdAt;
  const stagesNext: Record<StageId, ProjectStage> = { ...state.stages };
  for (const stageId of cmd.stageIds) {
    const stage = stagesNext[stageId];
    if (!stage) {
      return err({ code: "stage_not_found", stageId });
    }
    stagesNext[stageId] = {
      ...stage,
      status: "active",
      artifact: null,
      concerns: [],
      confidence: null,
      stale: false,
      enteredAt: updatedAt,
      proposedAt: null,
      approvedAt: null,
    };
  }
  // Earliest selected stage becomes the current focus.
  const earliest =
    stageOrderForState(state).find((s) => cmd.stageIds.includes(s)) ?? state.currentStageId;
  return ok({
    ...state,
    currentStageId: earliest,
    stages: stagesNext,
    updatedAt,
  });
}

// ---------------------------------------------------------------------------
// Auto-mode helper
// ---------------------------------------------------------------------------

/**
 * Returns true when the auto-mode reactor should immediately follow a
 * `stage.artifact.proposed` event with a `stage.approve { auto: true }`.
 * Pure: no I/O, no time. The caller is responsible for running it against the
 * post-proposal state and dispatching the follow-up command.
 */
export function shouldAutoApprove(input: {
  state: ProjectStageState;
  stageId: StageId;
  confidence: Confidence;
}): boolean {
  if (input.state.mode !== "auto") return false;
  const stage = input.state.stages[input.stageId];
  if (!stage || stage.status !== "awaiting_approval") return false;
  return input.confidence >= input.state.autoConfidenceThreshold;
}

// ---------------------------------------------------------------------------
// Selectors (pure, side-effect-free helpers used by the UI and the reactor)
// ---------------------------------------------------------------------------

export function getStaleStageIds(state: ProjectStageState): StageId[] {
  return stageOrderForState(state).filter((s) => state.stages[s]?.stale === true);
}

export function getCompletedStageIds(state: ProjectStageState): StageId[] {
  return stageOrderForState(state).filter((s) => {
    const stage = state.stages[s];
    return stage?.status === "approved" || stage?.status === "skipped";
  });
}

export function isProjectComplete(state: ProjectStageState): boolean {
  return stageOrderForState(state).every((s) => {
    const status = state.stages[s]?.status;
    return status === "approved" || status === "skipped";
  });
}

/** Re-export the canonical concern type for ergonomic imports. */
export type { Concern, ProjectStage, ProjectStageState, StageArtifact };
