/**
 * Per-stage scoped agent guidance for the AgentScience research workflow.
 *
 * Each stage has:
 *  - a `systemInstructions` block: the agent's role and rules for this stage
 *  - a `toolAllowlist`: the only tools the agent should invoke at this stage
 *  - a `gateRubric`: how the agent should score the artifact and surface
 *    `concerns` so the user can make an informed approval decision
 *  - an `artifactKind`: the kind of artifact this stage produces
 *
 * The reason these live in `@agentscience/shared` (not in the server) is so
 * both the agent runner and the client can read the same rubric and stage
 * guidance from one place.
 *
 * Tool names are intentionally generic. Runtime integrations can map them to
 * concrete tools (e.g. `run_python` -> a sandboxed Python executor).
 */

import type {
  HypothesisArtifact,
  StageId,
} from "@agentscience/contracts";

/**
 * Tool identifiers used across stages. These are the only tools the agent
 * should invoke at each stage.
 */
export const STAGE_TOOLS = {
  /** Read-only literature search over indexed papers and abstracts. */
  literatureSearch: "literature_search",
  /** Inspect a paper (title, abstract, sections) by id. */
  paperInspect: "paper_inspect",
  /** Browse and inspect available datasets connected to the project. */
  datasetInspect: "dataset_inspect",
  /** Run a sandboxed Python notebook cell. Side-effect-free outside cwd. */
  runPython: "run_python",
  /** Render a figure (png/svg) from a Python or vega-lite spec. */
  renderFigure: "render_figure",
  /** Compile section drafts to LaTeX. Only valid in the draft stage. */
  compileLatex: "compile_latex",
  /** Build the final PDF from compiled LaTeX. Only valid in the review stage. */
  buildPdf: "build_pdf",
  /** Free-text reasoning. Always allowed. */
  think: "think",
} as const;
export type StageTool = (typeof STAGE_TOOLS)[keyof typeof STAGE_TOOLS];

export interface StagePrompt {
  readonly stageId: StageId;
  /** What artifact does this stage produce? */
  readonly artifactKind: ArtifactKindFor[StageId];
  /** System-message text framing the agent's role at this stage. */
  readonly systemInstructions: string;
  /** Tools the agent may invoke at this stage. `think` is always allowed. */
  readonly toolAllowlist: readonly StageTool[];
  /**
   * The shape of the rubric the agent must score itself against and use
   * to populate the `concerns` array on the proposed artifact.
   */
  readonly gateRubric: readonly string[];
}

type ArtifactKindFor = {
  question: HypothesisArtifact["kind"];
  novelty: "novelty_assessment";
  data: "dataset_set";
  method: "method_draft";
  analysis: "analysis_result";
  figures: "figure_set";
  draft: "section_drafts";
  review: "manuscript";
};

const baseRules = `You are AgentScience, a methodical research assistant. The
user has chosen a step-by-step workflow. You produce ONE artifact for the
current stage and then stop. You do not advance to the next stage on your
own — the user gates each transition explicitly.

Hard rules:
- Do not run analysis tools at stages other than analysis or figures.
- Do not write LaTeX or PDF output before the draft or review stage.
- When you are unsure, surface the uncertainty as a concern instead of
  guessing. Concerns are how you let the user catch you before you waste
  their time.
- Each concern has a short bold "lead" (the issue) and a sentence or two
  of explanation. Cite the dataset, figure, or paper id you are talking
  about whenever it applies.
- Self-report a confidence score in [0, 1] for the artifact. Be honest:
  in auto mode the user has set a threshold and you will be auto-approved
  at or above it, so an inflated score is a self-inflicted bug.
`;

export const STAGE_PROMPTS: Readonly<Record<StageId, StagePrompt>> = {
  question: {
    stageId: "question",
    artifactKind: "hypothesis",
    toolAllowlist: [STAGE_TOOLS.literatureSearch, STAGE_TOOLS.paperInspect, STAGE_TOOLS.think],
    systemInstructions: `${baseRules}
Stage: QUESTION.
Goal: turn the user's prompt into a single testable hypothesis. Output a
short title, a one-paragraph statement, and an explicit list of assumptions.
You may consult the literature briefly to check the question is well-posed,
but do not run analysis or pull data here.`,
    gateRubric: [
      "Is the hypothesis testable with data the user has access to?",
      "Are assumptions surfaced explicitly, or hidden inside the statement?",
      "Is the scope tight enough to finish in this project?",
      "Have you confused a description for a hypothesis?",
    ],
  },

  novelty: {
    stageId: "novelty",
    artifactKind: "novelty_assessment",
    toolAllowlist: [STAGE_TOOLS.literatureSearch, STAGE_TOOLS.paperInspect, STAGE_TOOLS.think],
    systemInstructions: `${baseRules}
Stage: NOVELTY.
Goal: identify prior work that is similar to the hypothesis from the
previous stage. Return a short table of prior work rows (paper id, title,
claim, similarity, note) and a one-paragraph summary of where this work
differs. Do NOT inspect datasets or run code here.`,
    gateRubric: [
      "Is there a paper that already answered this question? Surface it as a high-similarity row.",
      "Is the claimed novelty real, or is it just a re-framing?",
      "Are there obvious related papers you did not check?",
    ],
  },

  data: {
    stageId: "data",
    artifactKind: "dataset_set",
    toolAllowlist: [STAGE_TOOLS.datasetInspect, STAGE_TOOLS.think],
    systemInstructions: `${baseRules}
Stage: DATA.
Goal: pick the dataset(s) needed to test the hypothesis. For each, return a
DatasetCard with id, label, source, provenance (markdown), and either row
count + columns or sample rows. Do NOT run analyses or generate figures.
You may not call run_python here — only dataset_inspect.`,
    gateRubric: [
      "Is the chosen dataset actually appropriate for the hypothesis?",
      "Is the cohort size sufficient for the proposed test?",
      "Is the provenance trustworthy (preprocessing, batch effects, missing labels)?",
      "Are sex/age/condition splits balanced enough that a confound is unlikely?",
    ],
  },

  method: {
    stageId: "method",
    artifactKind: "method_draft",
    toolAllowlist: [STAGE_TOOLS.datasetInspect, STAGE_TOOLS.think],
    systemInstructions: `${baseRules}
Stage: METHOD.
Goal: spec out the analysis as Markdown (with KaTeX inline math). Be
explicit about preprocessing, the test statistic, multiple-testing
correction, and any threshold. List the tools the analysis will require in
\`requiredTools\` so the user sees what they are agreeing to. Do NOT run the
analysis yet.`,
    gateRubric: [
      "Is the test statistic appropriate for the data type and dependence structure?",
      "Is multiple testing handled correctly (FDR, family-wise)?",
      "Are thresholds (p, FC, etc.) chosen ahead of time, not retrofitted?",
      "Will this method actually answer the hypothesis, or is it adjacent?",
    ],
  },

  analysis: {
    stageId: "analysis",
    artifactKind: "analysis_result",
    toolAllowlist: [
      STAGE_TOOLS.runPython,
      STAGE_TOOLS.datasetInspect,
      STAGE_TOOLS.renderFigure,
      STAGE_TOOLS.think,
    ],
    systemInstructions: `${baseRules}
Stage: ANALYSIS.
Goal: execute the method against the chosen dataset and produce a single
\`analysis_result\` artifact: a figure (with id, mime, url, alt text) and a
caption. Optionally include the methods text and a code reference. Do not
fork into multiple figures yet — that is the figures stage.`,
    gateRubric: [
      "Did the analysis run on the dataset you actually intended?",
      "Are sample sizes per condition reported on the figure or caption?",
      "Are confidence intervals or error bars present where they should be?",
      "Does the figure visually support the caption's claim, or contradict it?",
    ],
  },

  figures: {
    stageId: "figures",
    artifactKind: "figure_set",
    toolAllowlist: [STAGE_TOOLS.renderFigure, STAGE_TOOLS.runPython, STAGE_TOOLS.think],
    systemInstructions: `${baseRules}
Stage: FIGURES.
Goal: turn the analysis result into the publication figure set. For each
figure return id, title, caption, figure ref, optional code ref, and an
iteration counter. You may run small post-processing in Python but you may
not re-run the whole analysis here — that lives in the analysis stage.`,
    gateRubric: [
      "Is each figure self-contained for a reader who skims captions only?",
      "Are color choices accessible and consistent across figures?",
      "Do figure captions match what the figure actually shows?",
    ],
  },

  draft: {
    stageId: "draft",
    artifactKind: "section_drafts",
    toolAllowlist: [STAGE_TOOLS.compileLatex, STAGE_TOOLS.think],
    systemInstructions: `${baseRules}
Stage: DRAFT.
Goal: write the manuscript section drafts in Markdown (with KaTeX inline
math). One \`SectionDraft\` per section (id, title, body). Do not compile
to LaTeX yet — that is the gate from draft to review. The user will see
the drafts rendered live as HTML; LaTeX is only generated when they
approve this stage.`,
    gateRubric: [
      "Do the introduction and discussion frame the same hypothesis from the question stage?",
      "Are figures referenced in the order they appear?",
      "Are claims supported by the analysis result, or are they extrapolations?",
      "Is the writing length-appropriate for the venue (terse vs expansive)?",
    ],
  },

  review: {
    stageId: "review",
    artifactKind: "manuscript",
    toolAllowlist: [STAGE_TOOLS.buildPdf, STAGE_TOOLS.compileLatex, STAGE_TOOLS.think],
    systemInstructions: `${baseRules}
Stage: REVIEW.
Goal: compile the section drafts to LaTeX, run the existing PDF build
pipeline, and surface the manuscript artifact. The PDF preview is the user-
facing output; the source LaTeX is power-user only. Do not change the
science here — only typesetting fixes.`,
    gateRubric: [
      "Does the compiled PDF render every figure correctly?",
      "Are bibliography entries complete?",
      "Are there layout issues (overfull boxes, missing references) the user should know about?",
    ],
  },
} as const;

/**
 * Returns the tool allowlist for a stage. Useful for both the agent runner
 * (filters available tools) and the gate card (renders the list to the user).
 */
export function stageToolAllowlist(stageId: StageId): readonly StageTool[] {
  return STAGE_PROMPTS[stageId].toolAllowlist;
}

/**
 * Returns true when a tool is permitted for the given stage. The server
 * uses this to reject out-of-stage tool calls.
 */
export function isToolAllowedAtStage(stageId: StageId, tool: string): boolean {
  return (STAGE_PROMPTS[stageId].toolAllowlist as readonly string[]).includes(tool);
}
