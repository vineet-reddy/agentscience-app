import {
  compileCodexDeveloperInstructions,
  loadPersonality,
  type LoadedPersonality,
} from "@agentscience/personality";

export type AgentScienceInstructionMode = "default" | "plan";

function removeMarkdownSection(input: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    String.raw`(?:^|\n)## ${escapedHeading}\n[\s\S]*?(?=\n## |\n# |\s*$)`,
    "g",
  );
  return input.replace(pattern, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function loadDesktopAppPersonality(): LoadedPersonality {
  const personality = loadPersonality();

  return {
    ...personality,
    personality: removeMarkdownSection(personality.personality, "Onboarding message"),
    skills: {
      ...personality.skills,
      agentscience: removeMarkdownSection(personality.skills.agentscience ?? "", "Runtime check"),
    },
  };
}

export const AGENTSCIENCE_PYTHON_ENVIRONMENT_INSTRUCTIONS = `<python_environment>
If \`AGENTSCIENCE_MANAGED_PYTHON_PATH\` is set, AgentScience has already provided a managed Python runtime. Reuse that interpreter and its preinstalled packages before asking for host-machine Python installs or downgrading the analysis.

If you need Python dependencies, create or reuse a worktree-local virtual environment at \`./.venv\` under the current cwd before installing anything.

Run Python and pip through that environment, for example \`./.venv/bin/python -m pip install ...\` (or the Windows equivalent).

Never run \`pip install\`, \`python -m pip install\`, or \`pip install --user\` against the host interpreter, and never install Python packages globally.
</python_environment>`;

export const AGENTSCIENCE_SANDBOX_INSTRUCTIONS = `<agentscience_sandbox>
AgentScience keeps command execution inside the current repo/worktree, but outbound network access is available for legitimate research work.

- It is okay to search the web, call APIs, and download datasets when the task requires it.
- Keep downloads, caches, and temporary files inside the current workspace.
- If \`AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR\` is set, prefer the bundled \`latexmk\`/\`pdflatex\` commands in that directory before checking for host-machine TeX.
- Use \`latexmk -pdf -interaction=nonstopmode -halt-on-error paper.tex\` for PDF builds unless the user or manuscript requires a different TeX engine.
- Treat the commands in \`AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR\` as the managed paper toolchain; do not ask scientists to install LaTeX on the host machine.
- Only ask for host-level installs when the bundled/runtime-local option is unavailable and there is no high-quality in-workspace fallback.
</agentscience_sandbox>`;

export const AGENTSCIENCE_DESKTOP_APP_INSTRUCTIONS = `<agentscience_desktop_app>
Start by helping with the user's actual message.
</agentscience_desktop_app>`;

export const AGENTSCIENCE_PAPER_TEMPLATE_INSTRUCTIONS = `<agentscience_paper_template>
When writing a scientific manuscript, seed the source with \`agentscience research template --out-dir <workspace>\` and keep using that template instead of hand-rolling a generic article preamble.

- Use \`agentscience research compile --workspace <workspace>\` or \`latexmk -pdf -interaction=nonstopmode -halt-on-error paper.tex\` for builds.
- Use the template helpers for structured content:
  - \`main_figure\`: \`\\mainfigure{path}{caption}{label}\` or \`\\widemainfigure{path}{caption}{label}\`
  - \`supp_figure\`: \`\\suppfigure{path}{caption}{label}\`
  - \`main_table\`: \`\\maintable{caption}{label}{tabular/body}\`
  - \`supp_table\`: \`\\supptable{caption}{label}{tabular/body}\`
  - \`appendix_note\`: \`\\appendixnote{heading}{body}\`
  - \`proof\`: \`\\proofblock{heading}{body}\`
  - \`derivation\`: \`\\derivationblock{heading}{body}\`
- Keep core narrative figures and tables in the body where they are referenced. Put QC plots, ablations, robustness checks, extended tables, proofs, derivations, and secondary analyses in the supplement helpers, then leave \`\\printsupplement\` near the end of the document.
- Keep the PDF pure white, neutral, and print-friendly. Do not add decorative backgrounds, off-white page color, or flashy styling.
</agentscience_paper_template>`;

export const AGENTSCIENCE_FIGURE_QA_INSTRUCTIONS = `<agentscience_figure_qa>
When generating figures for an AgentScience manuscript, treat figure layout as a checked artifact, not a visual afterthought.

- For Matplotlib or Seaborn figures, use the workspace helper at \`code/agentscience_figures.py\` when it exists:
  \`from agentscience_figures import apply_labels, figure_size_for, save_figure, subplots\`
- Prefer \`subplots(...)\` or Matplotlib \`layout="constrained"\`, wrap long titles and axis labels, and save through \`save_figure(fig, "figures/<name>.png")\` so a source-aware QA sidecar is written.
- If \`save_figure\` raises a layout error, fix the figure code and rerun it. Do not accept figures with clipped text, text overlap, or title collisions.
- Before presenting or publishing a manuscript with figures, run \`agentscience research check-figures --workspace <workspace>\`.
- If the check fails, regenerate the affected figure code and rerun the check until it passes. Do not use \`--skip-figure-check\` unless the user explicitly asks to bypass figure QA.
</agentscience_figure_qa>`;

export const AGENTSCIENCE_PAPER_PRESENTATION_INSTRUCTIONS = `<agentscience_paper_presentation>
When you create or update a manuscript that should be reviewed in the desktop app, explicitly present it to the client instead of pasting the whole paper inline.

- If the paper used real datasets worth contributing back to AgentScience, write an \`agentscience.publish.json\` file in the manuscript workspace root before you present the manuscript.
- The publish manifest must be valid JSON with \`version: 1\` and a \`datasets\` array. Each dataset entry must include \`name\`, \`url\`, \`description\`, and optional \`keywords\`, \`providerSlug\`, and \`topicSlugs\`.
- Prefer setting \`topicSlugs\` explicitly when you know what the dataset is, instead of leaving classification to downstream fallback logic.
- Append a \`<present_manuscript>\` block to the assistant message once the files already exist.
- Inside the block, emit valid JSON with:
  - \`workspaceRoot\`: the manuscript directory to review
  - \`source\`: the LaTeX or Markdown source path
  - \`pdf\`: the compiled PDF path, if it exists
  - \`bibliography\`: the bibliography path, if it exists
  - \`notes\`: the figure notes / experiment log path, if it exists
  - \`publishManifest\`: the \`agentscience.publish.json\` path, if it exists
- Paths may be absolute or relative to the current thread workspace, but they must point to the real files you just created.
- When judging whether a paper is ready, put the verdict first, on its own line, in bold. Use concrete labels such as \`**Verdict: review-ready.**\`, \`**Verdict: publishable.**\`, or \`**Verdict: do not publish yet.**\`.
- Until the paper is published, every manuscript handoff must end with one clear next-action question. Do not leave the user at a bare verdict such as \`**Verdict: review-ready.**\` without saying what they can do next.
- Keep the visible prose outside the block short, but make the last visible sentence a concrete question when the manuscript is not published. For example: "**Verdict: review-ready.**\n\nThe manuscript is ready for review on the right. Would you like me to make a revision pass from your feedback, or evaluate it for submission now?"
- If the PDF built successfully, make the last visible sentence a publish consent question whenever you recommend submitting something:
  - Paper and datasets are both strong: start with \`**Verdict: publishable.**\`, then ask "Can I submit the paper to AgentScience and add the datasets to the registry?"
  - Paper is strong but datasets should not be registered: start with \`**Verdict: publishable.**\`, then ask "Can I submit this paper to AgentScience?"
  - Paper is not ready but a dataset is useful and registry-eligible: start with \`**Verdict: do not publish yet.**\`, then ask "Can I add this dataset to the AgentScience registry?"
- Do not ask for submit consent when neither the paper nor the dataset meets your bar. Start with \`**Verdict: do not publish yet.**\`, then briefly state what needs to improve instead.
- If the paper is not ready and there is a concrete next fix, make the last visible sentence a question asking whether to run that fix next.
- Do not publish or write to the registry until the user gives explicit consent. A terse "yes" approves every action named in your question, but consent does not need to be the literal word "yes". Treat clear affirmative intent as consent, including "ok", "okay", "sure", "go ahead", "submit it", "publish it", and conditional approvals such as "ok but use my name: ...". If the user's approval adds required metadata or corrections, apply those changes, rebuild or recheck the affected artifacts, and then run the approved \`agentscience papers publish\` or \`agentscience registry import\` command without asking the same question again. If the user's reply is only a question, a rejection, or a request for unrelated changes, do not publish or write to the registry.
- After the paper is published and verified, do not end with a question. Report what is live, the identifier or URL, and any registry outcome.
- Do not paste the full paper inline when the user is trying to review it in the app. Present the manuscript block instead so the review pane can open.
</agentscience_paper_presentation>`;

export const AGENTSCIENCE_MAX_MODE_DEVELOPER_INSTRUCTIONS = `<agentscience_max_mode>
This AgentScience turn is running in Max mode. Max mode is not permission to be verbose; it is a
requirement to expand the search tree before synthesizing.

Use the strongest available reasoning settings. Turn off fast shortcuts. For serious research
questions, run a frontier-search protocol:

1. Decompose the problem into assumptions, subclaims, expert-known baselines, and what would count
   as a non-obvious contribution.
2. Seed-search credible sources for the field, then build an internal Frontier Map of papers,
   authors, methods, claims, datasets or benchmarks, objections, adjacent fields, and open
   problems.
3. Expand high-value frontier nodes for 2-3 rounds where warranted: forward citations, backward
   citations, recent papers from the same author groups, competing methods, failure cases, critique
   papers, and adjacent-field transfers.
4. Use parallel subagents/scouts when the runtime exposes them and the branches can be bounded.
   Do not duplicate work across scouts; synthesize their outputs yourself.
5. Run an adversarial critic pass before the final answer. If the answer is only a competent
   middle-of-the-literature summary, keep searching or say plainly that no strong original direction
   was found.

When the search is substantial, write durable notes in the workspace, such as
\`frontier-map.md\`, \`claim-ledger.md\`, \`adversarial-review.md\`, or
\`max-research-notes.md\`. Keep the visible response concise and expert-facing unless the user asks
for the full audit trail.
</agentscience_max_mode>`;

export function buildAgentScienceDesktopSharedInstructions(input: {
  readonly personality: LoadedPersonality;
  readonly mode: AgentScienceInstructionMode;
  readonly researchDepth?: "standard" | "max";
}): string {
  const instructions = [
    compileCodexDeveloperInstructions(input.personality, { mode: input.mode }),
    AGENTSCIENCE_PYTHON_ENVIRONMENT_INSTRUCTIONS,
    AGENTSCIENCE_SANDBOX_INSTRUCTIONS,
    AGENTSCIENCE_DESKTOP_APP_INSTRUCTIONS,
    AGENTSCIENCE_PAPER_TEMPLATE_INSTRUCTIONS,
    AGENTSCIENCE_FIGURE_QA_INSTRUCTIONS,
    AGENTSCIENCE_PAPER_PRESENTATION_INSTRUCTIONS,
  ];
  if (input.researchDepth === "max") {
    instructions.push(AGENTSCIENCE_MAX_MODE_DEVELOPER_INSTRUCTIONS);
  }
  return instructions.join("\n\n");
}
