import { describe, expect, it } from "vitest";
import { ThreadId } from "@agentscience/contracts";

import { buildCodexModeDeveloperInstructions } from "./codexAppServerManager";
import { buildGeminiInstructionEnvelope } from "./provider/Layers/GeminiAdapter";

function extractSharedPersonalityBlock(input: string): string {
  const match = input.match(
    /<agentscience_personality>[\s\S]*<\/agentscience_methodology>/,
  );
  if (!match) {
    throw new Error("Missing AgentScience personality block.");
  }
  return match[0];
}

function extractSharedDesktopInstructionStack(input: string): string {
  const start = input.indexOf("<agentscience_personality>");
  const endTag = input.includes("</agentscience_max_mode>")
    ? "</agentscience_max_mode>"
    : "</agentscience_paper_presentation>";
  const end = input.indexOf(endTag);
  if (start < 0 || end < 0) {
    throw new Error("Missing shared AgentScience desktop instruction stack.");
  }
  return input.slice(start, end + endTag.length);
}

describe("desktop AgentScience personality", () => {
  it("uses the same desktop-adapted personality for ChatGPT/Codex and Gemini", () => {
    const codexInstructions = buildCodexModeDeveloperInstructions("default");
    const geminiInstructions = buildGeminiInstructionEnvelope({
      threadId: ThreadId.makeUnsafe("thread-desktop-personality"),
      input: "hello",
      interactionMode: "default",
    });

    expect(extractSharedPersonalityBlock(geminiInstructions)).toBe(
      extractSharedPersonalityBlock(codexInstructions),
    );
  });

  it("uses the same shared desktop instruction stack for ChatGPT/Codex and Gemini", () => {
    for (const mode of ["default", "plan"] as const) {
      const codexInstructions = buildCodexModeDeveloperInstructions(mode);
      const geminiInstructions = buildGeminiInstructionEnvelope({
        threadId: ThreadId.makeUnsafe(`thread-desktop-shared-${mode}`),
        input: "hello",
        interactionMode: mode,
      });

      expect(extractSharedDesktopInstructionStack(geminiInstructions)).toBe(
        extractSharedDesktopInstructionStack(codexInstructions),
      );
    }
  });
});
