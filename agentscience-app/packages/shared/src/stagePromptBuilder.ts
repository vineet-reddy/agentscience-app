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
  RESEARCH_WORKFLOW_DISPLAY_NAME,
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
    `## Approval rubric (the user will see this on the gate card)`,
    rubric,
    "",
    `## Output expectation`,
    `Produce ONE artifact for this stage and stop. Score your own confidence`,
    `in [0, 1] honestly; in auto mode the user has set a confidence threshold`,
    `and you will be auto-approved at or above it.`,
    "",
    `At the end of your response, include exactly one fenced JSON block tagged`,
    `\`agentscience-stage-artifact\`. This block is parsed by the app and is`,
    `not shown to the user. The \`stageId\` and \`artifact.stageId\` must both`,
    `be \`${stageId}\`; the artifact kind must be \`${prompt.artifactKind}\`.`,
    `Use only real outputs from this project: real cited papers, real datasets,`,
    `real generated figures, real section text, and real file or preview URLs.`,
    "",
    "```agentscience-stage-artifact",
    JSON.stringify(
      {
        stageId,
        confidence: 0.0,
        concerns: [
          {
            id: "concern-real-issue-id",
            severity: "warning",
            lead: "Short issue title",
            bodyMd: "One or two sentences explaining the concrete issue.",
            relatedRefs: [],
            surfacedAt: "ISO-8601 timestamp",
          },
        ],
        artifact: {
          stageId,
          kind: prompt.artifactKind,
        },
      },
      null,
      2,
    ),
    "```",
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
