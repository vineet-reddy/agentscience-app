import {
  CommandId,
  MessageId,
  ThreadId,
  type Concern,
  type Confidence,
  type HypothesisArtifact,
  type AnalysisResultArtifact,
  type ProjectStageState,
  type StageArtifact,
  type StageArtifactProposedCommand,
  type StageApproveCommand,
  type StageDiscussCommand,
  type StageId,
  type StageReviseCommand,
  type StageSkipCommand,
  type StageStartCommand,
  type ProjectModeSetCommand,
  type ProjectRecomputeCommand,
  type ProjectWorkflowModeSetCommand,
} from "@agentscience/contracts";
import { describe, expect, it } from "vitest";

import {
  applyStageCommand,
  createInitialStageState,
  getCompletedStageIds,
  getDownstreamStages,
  getStaleStageIds,
  isProjectComplete,
  shouldAutoApprove,
  STAGE_DEPENDS_ON,
} from "./stageMachine";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const THREAD = ThreadId.makeUnsafe("thread-test");

let counter = 0;
const cmdId = (label: string): typeof CommandId.Type =>
  CommandId.makeUnsafe(`cmd-${label}-${++counter}`);
const msgId = (label: string): typeof MessageId.Type =>
  MessageId.makeUnsafe(`msg-${label}-${++counter}`);

const T0 = "2026-05-01T00:00:00.000Z";
const T1 = "2026-05-01T00:01:00.000Z";
const T2 = "2026-05-01T00:02:00.000Z";

function tick(n: number): string {
  return `2026-05-01T00:${String(n).padStart(2, "0")}:00.000Z`;
}

function hypothesis(): HypothesisArtifact {
  return {
    stageId: "question",
    kind: "hypothesis",
    titleMd: "Aged EAE Oprm1 hypothesis",
    statementMd: "Oprm1 expression diverges with age in EAE microglia.",
    assumptions: ["Sex distribution is balanced enough."],
  };
}

function analysisArtifact(): AnalysisResultArtifact {
  return {
    stageId: "analysis",
    kind: "analysis_result",
    figureRef: {
      id: "fig-1",
      mime: "image/png",
      url: "/figures/fig-1.png",
      alt: "Volcano plot",
    },
    captionMd: "Volcano plot, aged vs young EAE.",
  };
}

function fakeArtifactFor(stageId: StageId): StageArtifact {
  switch (stageId) {
    case "question":
      return hypothesis();
    case "novelty":
      return {
        stageId: "novelty",
        kind: "novelty_assessment",
        priorWork: [],
        summaryMd: "No prior work directly addresses this.",
      };
    case "data":
      return {
        stageId: "data",
        kind: "dataset_set",
        datasets: [],
      };
    case "method":
      return {
        stageId: "method",
        kind: "method_draft",
        methodMd: "Pseudobulk DE with limma-voom.",
        requiredTools: ["run_python"],
      };
    case "analysis":
      return analysisArtifact();
    case "figures":
      return {
        stageId: "figures",
        kind: "figure_set",
        figures: [],
      };
    case "draft":
      return {
        stageId: "draft",
        kind: "section_drafts",
        sections: [],
      };
    case "review":
      return {
        stageId: "review",
        kind: "manuscript",
        paperReviewThreadId: THREAD,
      };
  }
}

function propose(input: {
  stageId: StageId;
  confidence: Confidence;
  concerns?: Concern[];
  at: string;
}): StageArtifactProposedCommand {
  return {
    type: "stage.artifact.proposed",
    commandId: cmdId(`propose-${input.stageId}`),
    threadId: THREAD,
    stageId: input.stageId,
    artifact: fakeArtifactFor(input.stageId),
    concerns: input.concerns ?? [],
    confidence: input.confidence,
    createdAt: input.at,
  };
}

function approve(input: {
  stageId: StageId;
  auto?: boolean;
  at: string;
}): StageApproveCommand {
  return {
    type: "stage.approve",
    commandId: cmdId(`approve-${input.stageId}`),
    threadId: THREAD,
    stageId: input.stageId,
    auto: input.auto ?? false,
    createdAt: input.at,
  };
}

function start(input: { stageId: StageId; at: string }): StageStartCommand {
  return {
    type: "stage.start",
    commandId: cmdId(`start-${input.stageId}`),
    threadId: THREAD,
    stageId: input.stageId,
    createdAt: input.at,
  };
}

function revise(input: {
  stageId: StageId;
  at: string;
  instructionsMd?: string;
}): StageReviseCommand {
  return {
    type: "stage.revise",
    commandId: cmdId(`revise-${input.stageId}`),
    threadId: THREAD,
    stageId: input.stageId,
    instructionsMd: input.instructionsMd ?? "Tighten the analysis.",
    createdAt: input.at,
  };
}

function discuss(input: { stageId: StageId; at: string }): StageDiscussCommand {
  return {
    type: "stage.discuss",
    commandId: cmdId(`discuss-${input.stageId}`),
    threadId: THREAD,
    stageId: input.stageId,
    messageId: msgId(`discuss-${input.stageId}`),
    createdAt: input.at,
  };
}

function skip(input: { stageId: StageId; at: string }): StageSkipCommand {
  return {
    type: "stage.skip",
    commandId: cmdId(`skip-${input.stageId}`),
    threadId: THREAD,
    stageId: input.stageId,
    createdAt: input.at,
  };
}

function setMode(input: {
  mode: "manual" | "auto";
  at: string;
}): ProjectModeSetCommand {
  return {
    type: "project.mode.set",
    commandId: cmdId(`mode-${input.mode}`),
    threadId: THREAD,
    mode: input.mode,
    createdAt: input.at,
  };
}

function setWorkflowMode(input: {
  workflowMode: "literature-review" | "experimental-design" | "data-analysis" | "open";
  at: string;
}): ProjectWorkflowModeSetCommand {
  return {
    type: "project.workflow.set",
    commandId: cmdId(`workflow-${input.workflowMode}`),
    threadId: THREAD,
    workflowMode: input.workflowMode,
    createdAt: input.at,
  };
}

function recompute(input: {
  stageIds: StageId[];
  at: string;
}): ProjectRecomputeCommand {
  return {
    type: "project.recompute",
    commandId: cmdId(`recompute`),
    threadId: THREAD,
    stageIds: input.stageIds,
    createdAt: input.at,
  };
}

function expectOk(
  result: ReturnType<typeof applyStageCommand>,
): ProjectStageState {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected ok");
  return result.state;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("createInitialStageState", () => {
  it("seeds question as active and the rest pending in manual mode by default", () => {
    const state = createInitialStageState({ now: T0 });
    expect(state.mode).toBe("manual");
    expect(state.currentStageId).toBe("question");
    expect(state.stages.question?.status).toBe("active");
    expect(state.stages.question?.enteredAt).toBe(T0);
    expect(state.stages.novelty?.status).toBe("pending");
    expect(state.stages.review?.status).toBe("pending");
  });

  it("respects an explicit auto-mode and confidence threshold", () => {
    const state = createInitialStageState({
      now: T0,
      mode: "auto",
      autoConfidenceThreshold: 0.92,
    });
    expect(state.mode).toBe("auto");
    expect(state.autoConfidenceThreshold).toBe(0.92);
  });

  it("seeds a mode-specific workflow profile", () => {
    const state = createInitialStageState({
      now: T0,
      workflowMode: "literature-review",
    });

    expect(state.workflowMode).toBe("literature-review");
    expect(state.currentStageId).toBe("question");
    expect(state.stages.question?.status).toBe("active");
    expect(state.stages.data?.status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// Linear progression (manual)
// ---------------------------------------------------------------------------

describe("manual mode happy path", () => {
  it("propose lands the first stage in awaiting_approval; approve advances", () => {
    let state = createInitialStageState({ now: T0 });
    state = expectOk(
      applyStageCommand(state, propose({ stageId: "question", confidence: 0.9, at: T1 })),
    );
    expect(state.stages.question?.status).toBe("awaiting_approval");
    expect(state.stages.question?.artifact?.kind).toBe("hypothesis");
    expect(state.stages.question?.confidence).toBe(0.9);
    // Manual mode does not auto-advance even with high confidence.
    expect(state.currentStageId).toBe("question");

    state = expectOk(applyStageCommand(state, approve({ stageId: "question", at: T2 })));
    expect(state.stages.question?.status).toBe("approved");
    expect(state.stages.question?.approvedAt).toBe(T2);
    expect(state.currentStageId).toBe("novelty");
    expect(state.stages.novelty?.status).toBe("active");
    expect(state.stages.novelty?.enteredAt).toBe(T2);
  });

  it("walks all 8 stages via propose+approve and ends with review approved, currentStageId stays at review", () => {
    let state = createInitialStageState({ now: tick(0) });
    const order: StageId[] = [
      "question",
      "novelty",
      "data",
      "method",
      "analysis",
      "figures",
      "draft",
      "review",
    ];
    let t = 1;
    for (const stageId of order) {
      state = expectOk(
        applyStageCommand(
          state,
          propose({ stageId, confidence: 0.8, at: tick(t++) }),
        ),
      );
      state = expectOk(
        applyStageCommand(state, approve({ stageId, at: tick(t++) })),
      );
    }
    expect(state.stages.review?.status).toBe("approved");
    // Approving the terminal stage does not move currentStageId past it.
    expect(state.currentStageId).toBe("review");
    expect(isProjectComplete(state)).toBe(true);
    expect(getCompletedStageIds(state)).toEqual(order);
  });

  it("advances through only the selected workflow's stages", () => {
    let state = createInitialStageState({
      now: tick(0),
      workflowMode: "literature-review",
    });
    const order: StageId[] = ["question", "novelty", "draft", "review"];
    let t = 1;

    for (const stageId of order) {
      state = expectOk(
        applyStageCommand(
          state,
          propose({ stageId, confidence: 0.8, at: tick(t++) }),
        ),
      );
      state = expectOk(
        applyStageCommand(state, approve({ stageId, at: tick(t++) })),
      );
    }

    expect(state.currentStageId).toBe("review");
    expect(state.stages.data?.status).toBe("pending");
    expect(state.stages.method?.status).toBe("pending");
    expect(isProjectComplete(state)).toBe(true);
    expect(getCompletedStageIds(state)).toEqual(order);
  });

  it("uses the data-analysis profile order instead of forcing novelty first", () => {
    let state = createInitialStageState({
      now: T0,
      workflowMode: "data-analysis",
    });

    state = expectOk(
      applyStageCommand(state, propose({ stageId: "question", confidence: 0.8, at: T1 })),
    );
    state = expectOk(applyStageCommand(state, approve({ stageId: "question", at: T2 })));

    expect(state.currentStageId).toBe("data");
    expect(state.stages.novelty?.status).toBe("pending");
    expect(state.stages.data?.status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// Auto-mode reactor helper
// ---------------------------------------------------------------------------

describe("shouldAutoApprove", () => {
  it("returns false in manual mode regardless of confidence", () => {
    let state = createInitialStageState({ now: T0, mode: "manual" });
    state = expectOk(
      applyStageCommand(state, propose({ stageId: "question", confidence: 0.99, at: T1 })),
    );
    expect(
      shouldAutoApprove({ state, stageId: "question", confidence: 0.99 }),
    ).toBe(false);
  });

  it("returns true in auto mode when confidence clears the threshold", () => {
    let state = createInitialStageState({
      now: T0,
      mode: "auto",
      autoConfidenceThreshold: 0.85,
    });
    state = expectOk(
      applyStageCommand(state, propose({ stageId: "question", confidence: 0.9, at: T1 })),
    );
    expect(
      shouldAutoApprove({ state, stageId: "question", confidence: 0.9 }),
    ).toBe(true);
  });

  it("returns false when below the threshold even in auto mode", () => {
    let state = createInitialStageState({
      now: T0,
      mode: "auto",
      autoConfidenceThreshold: 0.85,
    });
    state = expectOk(
      applyStageCommand(state, propose({ stageId: "question", confidence: 0.7, at: T1 })),
    );
    expect(
      shouldAutoApprove({ state, stageId: "question", confidence: 0.7 }),
    ).toBe(false);
  });

  it("returns false when the stage is not awaiting_approval", () => {
    const state = createInitialStageState({ now: T0, mode: "auto" });
    expect(
      shouldAutoApprove({ state, stageId: "question", confidence: 1 }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Revision: stale propagation
// ---------------------------------------------------------------------------

describe("stage.revise", () => {
  function advanceThrough(stageIds: readonly StageId[]): ProjectStageState {
    let state = createInitialStageState({ now: tick(0) });
    let t = 1;
    for (const stageId of stageIds) {
      state = expectOk(
        applyStageCommand(
          state,
          propose({ stageId, confidence: 0.9, at: tick(t++) }),
        ),
      );
      state = expectOk(
        applyStageCommand(state, approve({ stageId, at: tick(t++) })),
      );
    }
    return state;
  }

  it("revising an approved upstream stage marks all downstream content stale and rewinds currentStageId", () => {
    let state = advanceThrough([
      "question",
      "novelty",
      "data",
      "method",
      "analysis",
    ]);
    expect(state.currentStageId).toBe("figures");

    state = expectOk(applyStageCommand(state, revise({ stageId: "data", at: tick(99) })));

    expect(state.currentStageId).toBe("data");
    expect(state.stages.data?.status).toBe("active");
    expect(state.stages.data?.revisedAt).toBe(tick(99));
    // Data's existing artifact is preserved as agent context until a new one
    // is proposed; only the status changes back to active.
    expect(state.stages.data?.artifact).not.toBe(null);

    // Downstream of data: method, analysis, figures, draft, review.
    // method and analysis were approved -> stale=true.
    expect(state.stages.method?.stale).toBe(true);
    expect(state.stages.analysis?.stale).toBe(true);
    // figures was seeded active when analysis approved, but has no artifact
    // yet, so there is nothing to mark stale.
    expect(state.stages.figures?.status).toBe("active");
    expect(state.stages.figures?.artifact).toBe(null);
    expect(state.stages.figures?.stale).toBe(false);
    // draft and review never reached active -> still pending, no stale flag.
    expect(state.stages.draft?.status).toBe("pending");
    expect(state.stages.draft?.stale).toBe(false);
    expect(state.stages.review?.status).toBe("pending");
    expect(state.stages.review?.stale).toBe(false);

    // novelty and question are NOT downstream of data (per dep graph).
    expect(state.stages.novelty?.stale).toBe(false);
    expect(state.stages.question?.stale).toBe(false);
  });

  it("preserves downstream artifacts (does not wipe them) when marking stale", () => {
    let state = advanceThrough(["question", "novelty", "data", "method", "analysis"]);
    const analysisArtifactBefore = state.stages.analysis?.artifact;
    state = expectOk(applyStageCommand(state, revise({ stageId: "data", at: tick(99) })));
    expect(state.stages.analysis?.artifact).toEqual(analysisArtifactBefore);
    expect(state.stages.analysis?.stale).toBe(true);
  });

  it("rejects revise on a stage with no content (pending status)", () => {
    const state = createInitialStageState({ now: T0 });
    const result = applyStageCommand(state, revise({ stageId: "data", at: T1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_status");
  });
});

// ---------------------------------------------------------------------------
// project.recompute
// ---------------------------------------------------------------------------

describe("project.recompute", () => {
  it("resets selected stale stages back to active and clears their artifacts; earliest becomes current", () => {
    let state = createInitialStageState({ now: tick(0) });
    let t = 1;
    for (const stageId of [
      "question",
      "novelty",
      "data",
      "method",
      "analysis",
      "figures",
    ] as StageId[]) {
      state = expectOk(
        applyStageCommand(
          state,
          propose({ stageId, confidence: 0.9, at: tick(t++) }),
        ),
      );
      state = expectOk(
        applyStageCommand(state, approve({ stageId, at: tick(t++) })),
      );
    }
    state = expectOk(applyStageCommand(state, revise({ stageId: "data", at: tick(99) })));
    expect(getStaleStageIds(state)).toEqual(["method", "analysis", "figures"]);

    state = expectOk(
      applyStageCommand(
        state,
        recompute({ stageIds: ["method", "analysis"], at: tick(100) }),
      ),
    );
    expect(state.currentStageId).toBe("method");
    expect(state.stages.method?.status).toBe("active");
    expect(state.stages.method?.artifact).toBe(null);
    expect(state.stages.method?.stale).toBe(false);
    expect(state.stages.analysis?.status).toBe("active");
    expect(state.stages.analysis?.artifact).toBe(null);
    // figures was not selected: still stale, artifact preserved.
    expect(state.stages.figures?.stale).toBe(true);
    expect(state.stages.figures?.artifact).not.toBe(null);
  });

  it("rejects recompute with an empty stage list", () => {
    const state = createInitialStageState({ now: T0 });
    const result = applyStageCommand(state, recompute({ stageIds: [], at: T1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("no_stages_to_recompute");
  });
});

// ---------------------------------------------------------------------------
// Skip / Discuss / Mode flip
// ---------------------------------------------------------------------------

describe("stage.skip", () => {
  it("marks the stage skipped and advances currentStageId", () => {
    let state = createInitialStageState({ now: T0 });
    state = expectOk(applyStageCommand(state, skip({ stageId: "question", at: T1 })));
    expect(state.stages.question?.status).toBe("skipped");
    expect(state.currentStageId).toBe("novelty");
    expect(state.stages.novelty?.status).toBe("active");
  });
});

describe("stage.discuss", () => {
  it("does not change stage status", () => {
    let state = createInitialStageState({ now: T0 });
    state = expectOk(
      applyStageCommand(state, propose({ stageId: "question", confidence: 0.6, at: T1 })),
    );
    const before = JSON.stringify(state.stages);
    state = expectOk(applyStageCommand(state, discuss({ stageId: "question", at: T2 })));
    expect(JSON.stringify(state.stages)).toBe(before);
    expect(state.updatedAt).toBe(T2);
  });
});

describe("project.mode.set", () => {
  it("flips mode mid-run without disturbing in-flight gates", () => {
    let state = createInitialStageState({ now: T0, mode: "manual" });
    state = expectOk(
      applyStageCommand(state, propose({ stageId: "question", confidence: 0.7, at: T1 })),
    );
    expect(state.stages.question?.status).toBe("awaiting_approval");
    state = expectOk(applyStageCommand(state, setMode({ mode: "auto", at: T2 })));
    expect(state.mode).toBe("auto");
    // Already-pending gate is preserved; auto does not retroactively approve.
    expect(state.stages.question?.status).toBe("awaiting_approval");
  });
});

describe("project.workflow.set", () => {
  it("switches profiles and points at the first unfinished stage in the new profile", () => {
    let state = createInitialStageState({ now: T0 });
    state = expectOk(
      applyStageCommand(state, propose({ stageId: "question", confidence: 0.8, at: T1 })),
    );
    state = expectOk(applyStageCommand(state, approve({ stageId: "question", at: T2 })));

    state = expectOk(
      applyStageCommand(
        state,
        setWorkflowMode({ workflowMode: "data-analysis", at: tick(3) }),
      ),
    );

    expect(state.workflowMode).toBe("data-analysis");
    expect(state.currentStageId).toBe("data");
    expect(state.stages.novelty?.status).toBe("pending");
    expect(state.stages.data?.status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe("error paths", () => {
  it("rejects approve when stage is not awaiting_approval", () => {
    const state = createInitialStageState({ now: T0 });
    const result = applyStageCommand(state, approve({ stageId: "question", at: T1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_status");
  });

  it("rejects propose with a mismatched artifact stageId", () => {
    const state = createInitialStageState({ now: T0 });
    const cmd: StageArtifactProposedCommand = {
      type: "stage.artifact.proposed",
      commandId: cmdId("mismatch"),
      threadId: THREAD,
      stageId: "question",
      // Wrong stage's artifact
      artifact: analysisArtifact(),
      concerns: [],
      confidence: 0.5,
      createdAt: T1,
    };
    const result = applyStageCommand(state, cmd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("artifact_stage_mismatch");
  });

  it("rejects start on a stage other than the current one", () => {
    const state = createInitialStageState({ now: T0 });
    const result = applyStageCommand(state, start({ stageId: "data", at: T1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("wrong_current_stage");
  });
});

// ---------------------------------------------------------------------------
// Dependency graph
// ---------------------------------------------------------------------------

describe("dependency graph", () => {
  it("returns canonical-order downstream stages for question (everything except question)", () => {
    expect(getDownstreamStages("question")).toEqual([
      "novelty",
      "data",
      "method",
      "analysis",
      "figures",
      "draft",
      "review",
    ]);
  });

  it("returns canonical-order downstream stages for data", () => {
    expect(getDownstreamStages("data")).toEqual([
      "method",
      "analysis",
      "figures",
      "draft",
      "review",
    ]);
  });

  it("returns canonical-order downstream stages for analysis", () => {
    expect(getDownstreamStages("analysis")).toEqual([
      "figures",
      "draft",
      "review",
    ]);
  });

  it("review has no downstream", () => {
    expect(getDownstreamStages("review")).toEqual([]);
  });

  it("dependency table is consistent with order: a stage only depends on earlier stages", () => {
    const order: StageId[] = [
      "question",
      "novelty",
      "data",
      "method",
      "analysis",
      "figures",
      "draft",
      "review",
    ];
    for (const stageId of order) {
      const idx = order.indexOf(stageId);
      for (const dep of STAGE_DEPENDS_ON[stageId]) {
        expect(order.indexOf(dep)).toBeLessThan(idx);
      }
    }
  });
});
