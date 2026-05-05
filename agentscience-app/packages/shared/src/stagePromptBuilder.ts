/**
 * Helpers for assembling stage-aware agent input.
 *
 * Two consumers:
 *
 *   1. Server provider: given the project's current stage, produces the
 *      system-message text the agent runtime should prepend to its
 *      conversation history. Includes the stage scope, the tool
 *      allowlist, and the gate rubric. Static — does not depend on chat
 *      history.
 *
 *   2. Tool guidance: exposes the stage's intended tool set in a pure
 *      helper so runtime integrations can decide how strictly to gate tools.
 *
 * Pure: no I/O.
 */

import {
  DEFAULT_RESEARCH_WORKFLOW_MODE,
  DEFAULT_RESEARCH_DEPTH,
  RESEARCH_WORKFLOW_DISPLAY_NAME,
  type ResearchDepth,
  workflowStageDisplayName,
  workflowStageOrder,
  type ProjectStageState,
  type ResearchWorkflowMode,
  type StageId,
} from "@agentscience/contracts";

import {
  isToolAllowedAtStage,
  stagePromptForWorkflow,
  stageToolAllowlist,
  workflowCharter,
  type StageTool,
} from "./stagePrompts";

export interface StageAgentInputs {
  /** System-message text the runtime should put in front of the conversation. */
  readonly systemMessage: string;
  /** Tools the agent is allowed to call at this stage. */
  readonly allowedTools: readonly StageTool[];
}

export interface WorkflowAgentInput {
  /** System-message text the runtime should put in front of this turn. */
  readonly systemMessage: string;
}

export type WorkflowAutonomyMode = "manual" | "auto";

const MAX_RESEARCH_DEPTH_INSTRUCTIONS = `Research depth: Max.

This turn must run a branching frontier-search protocol before answering. Do not treat Max as
"spend more time"; treat it as a larger, explicitly expanded search space.

Required protocol:
1. Decompose the request into subquestions, assumptions, expert-known baselines, and what would
   count as a non-obvious answer.
2. Run seed search across the most credible sources available for the field.
3. Build an internal Frontier Map covering papers, authors, methods, claims, datasets or
   benchmarks, objections, adjacent fields, and open problems.
4. Expand the best frontier nodes for 2-3 rounds where warranted: forward citations, backward
   citations, recent work by the same author groups, competing methods, failure or critique papers,
   and adjacent-field uses.
5. Use parallel scouts/subagents when the runtime exposes them and the branches are separable.
   Keep each scout bounded and synthesize their outputs yourself.
6. Run an adversarial critic pass before the final answer: ask whether the answer is just a
   competent summary, whether an expert would find it shallow, whether citations support the
   claims, and what the sharpest original direction is.

Depth budget, adaptively applied:
- Simple factual questions do not need an enormous run; answer them directly.
- Frontier research questions should usually inspect 30-100 high-signal sources when available.
- Always include contradiction/negative-evidence search for scientific or mathematical claims.

Write substantial intermediate notes to workspace files when the search is large, using names like
\`frontier-map.md\`, \`claim-ledger.md\`, \`adversarial-review.md\`, or \`max-research-notes.md\`.
The visible answer should stay concise and expert-facing unless the user asks for the audit trail.`;

const STANDARD_RESEARCH_DEPTH_INSTRUCTIONS = `Research depth: Standard.

Use normal adaptive rigor. Search when freshness, novelty, or citation accuracy matters, but do not
run the full Max frontier expansion unless the user asks for it.`;

const WORKFLOW_AUTONOMY_INSTRUCTIONS: Readonly<Record<WorkflowAutonomyMode, string>> = {
  manual: `Collaboration style: Manual.

Treat Manual as a hands-on research partnership for a non-technical scientist. Do not run far
ahead on major scientific assumptions. Ask focused questions before committing to high-impact
choices such as the central claim, dataset fit, inclusion/exclusion criteria, experimental
controls, statistical approach, or publication framing. Do not ask about routine implementation
details the user would not care about. Use your judgment, keep momentum, and make reasonable
low-risk decisions yourself.`,

  auto: `Collaboration style: Auto.

Take the lead and make reasonable scientific decisions without stopping for every ambiguity.
Still pause for the user when a missing detail would materially change the science, the claims,
the selected dataset, the analysis plan, or publication/submission decisions. Be explicit about
important assumptions you made and keep the work moving.`,
};

const WORKFLOW_MODE_INSTRUCTIONS: Readonly<Record<ResearchWorkflowMode, string>> = {
  open: `You are AgentScience running the end-to-end paper workflow.

Your job is to help a working scientist turn a rough idea into a real research paper:
1. sharpen the user's input into a novel, testable research question;
2. check novelty against existing literature and push back if the claim is not new;
3. find and lock down appropriate data from the AgentScience registry or credible open sources;
4. analyze the data with reproducible code;
5. create publication-quality figures and tables;
6. write, compile, and present the paper for review.

Keep visible chat prose concise. Use it to say what you are doing, raise serious concerns,
ask necessary questions, and state rigorous conclusions. Do not paste long manuscript text
into chat. When you produce a figure, table, data summary, source file, or compiled paper,
write it to the thread workspace and present the reviewable result through the workspace
canvas whenever possible.`,

  "literature-review": `You are AgentScience running a literature review workflow.

Your job is to help a working scientist decide whether a review is worth writing, then
produce a rigorous source-grounded synthesis when it is. Search first. If an existing
review already answers the user's request, say so plainly, link or cite it, and suggest a
more novel angle instead of recreating stale work. Keep chat concise and use the workspace
for the source map, tables, and finished review material whenever possible.`,

  "experimental-design": `You are AgentScience running an experimental design workflow.

Your job is to turn a research idea into a defensible experimental protocol for real
scientists. Optimize for hypotheses, controls, measurement validity, feasibility,
analysis plans, preregistration readiness, and failure modes. Push back on weak designs.
Do not frame this as coursework or educational help. Keep chat concise and put protocols, tables,
and reviewable materials in the workspace whenever possible.`,

  "data-analysis": `You are AgentScience running a data analysis workflow.

Your job is to work from real data toward credible results. Verify dataset fit and
provenance, write reproducible analysis code, report uncertainty, create figures and
tables, and push back when the data cannot support the claim. Keep chat concise and
show figures, tables, code, and outputs through the workspace whenever possible.`,

  "grant-writing": `You are AgentScience running a grant writing workflow.

Your job is to help a scientist shape specific aims, significance, innovation, approach,
milestones, risk, and reviewer-facing narrative. Ground claims in evidence and call out
weaknesses. Keep chat concise and put grant drafts, aims pages, evidence tables, and
reviewable materials in the workspace whenever possible.`,

  "general-agent": `You are AgentScience running an open research-agent workflow.

Your job is to help with the user's scientific task without forcing it into the full paper
pipeline. Clarify scope only when needed, stay rigorous, push back on unsupported claims,
and keep chat concise. Put substantial outputs in the workspace whenever possible instead
of pasting long markdown into chat.`,
};

export function buildWorkflowAgentInput(
  workflowMode: ResearchWorkflowMode | null | undefined,
  options: {
    readonly autonomyMode?: WorkflowAutonomyMode;
    readonly researchDepth?: ResearchDepth;
  } = {},
): WorkflowAgentInput {
  const mode = workflowMode ?? DEFAULT_RESEARCH_WORKFLOW_MODE;
  const autonomyMode = options.autonomyMode ?? "manual";
  const researchDepth = options.researchDepth ?? DEFAULT_RESEARCH_DEPTH;
  return {
    systemMessage: [
      `# AgentScience workflow profile: ${RESEARCH_WORKFLOW_DISPLAY_NAME[mode]}`,
      "",
      WORKFLOW_MODE_INSTRUCTIONS[mode].trim(),
      "",
      WORKFLOW_AUTONOMY_INSTRUCTIONS[autonomyMode].trim(),
      "",
      researchDepth === "max"
        ? MAX_RESEARCH_DEPTH_INSTRUCTIONS.trim()
        : STANDARD_RESEARCH_DEPTH_INSTRUCTIONS.trim(),
      "",
      "Do not mention workflow internals, stages, or gates to the user.",
      "Do not include hidden JSON control blocks for workflow state.",
    ].join("\n"),
  };
}

export function buildStageAgentInputs(
  input:
    | StageId
    | {
        readonly stageId: StageId;
        readonly workflowMode?: ResearchWorkflowMode | undefined;
      }
    | ProjectStageState,
): StageAgentInputs {
  const stageId =
    typeof input === "string"
      ? input
      : "currentStageId" in input
        ? input.currentStageId
        : input.stageId;
  const workflowMode: ResearchWorkflowMode =
    typeof input === "string"
      ? DEFAULT_RESEARCH_WORKFLOW_MODE
      : "workflowMode" in input
        ? (input.workflowMode ?? DEFAULT_RESEARCH_WORKFLOW_MODE)
        : (input.workflowMode ?? DEFAULT_RESEARCH_WORKFLOW_MODE);
  const order = workflowStageOrder(workflowMode);
  const number = order.indexOf(stageId) + 1;
  const name = workflowStageDisplayName(workflowMode, stageId);
  const prompt = stagePromptForWorkflow(workflowMode, stageId);
  const tools = stageToolAllowlist(stageId, workflowMode);
  const rubric = prompt.gateRubric.map((line) => `  - ${line}`).join("\n");
  const systemMessage = [
    `# AgentScience — ${RESEARCH_WORKFLOW_DISPLAY_NAME[workflowMode]} · stage ${number}/${order.length} · ${name.toUpperCase()}`,
    "",
    workflowCharter(workflowMode).trim(),
    "",
    prompt.systemInstructions.trim(),
    "",
    `## Tools available at this stage`,
    `Only the following tools are allowed: ${tools.join(", ")}.`,
    `Do not call tools outside this list for this stage.`,
    "",
    `## Quality checklist`,
    rubric,
    "",
    `## Output expectation`,
    `Keep the visible response concise. State what you did, what is uncertain,`,
    `and what should happen next. Put substantial outputs in real workspace files`,
    `instead of pasting long Markdown into chat.`,
  ].join("\n");
  return { systemMessage, allowedTools: tools };
}

export interface ToolGateResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

/**
 * Validate that `toolName` is permitted at `stageId`. Returned as a plain
 * value rather than thrown so call sites can decide how to surface it
 * (drop-and-log vs surface-as-concern).
 */
export function gateToolForStage(
  stageId: StageId,
  toolName: string,
  workflowMode: ResearchWorkflowMode = DEFAULT_RESEARCH_WORKFLOW_MODE,
): ToolGateResult {
  if (isToolAllowedAtStage(stageId, toolName, workflowMode)) return { allowed: true };
  const allowed = stageToolAllowlist(stageId, workflowMode);
  return {
    allowed: false,
    reason: `Tool "${toolName}" is not permitted at stage ${stageId} in ${RESEARCH_WORKFLOW_DISPLAY_NAME[workflowMode]} mode. Allowed tools: ${allowed.join(", ")}.`,
  };
}
