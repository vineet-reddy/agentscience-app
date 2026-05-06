import { describe, expect, it } from "vitest";

import {
  appendAgentIntakeContextToPrompt,
  useAgentIntakeStore,
} from "./agentIntakeStore";
import type { ThreadId } from "@agentscience/contracts";

describe("agentIntakeStore", () => {
  it("stores per-thread agent intake and appends it to the dispatched prompt", () => {
    const threadId = "thread-intake-test" as ThreadId;

    useAgentIntakeStore.getState().clearContext(threadId);
    useAgentIntakeStore.getState().upsertEntry(threadId, "literature-review", {
      id: "sources",
      label: "Seed papers and sources",
      value: "30415628\nhttps://pubmed.ncbi.nlm.nih.gov/29306863/",
    });

    const prompt = appendAgentIntakeContextToPrompt(
      "Tell me about this stuff.",
      useAgentIntakeStore.getState().contextsByThreadId[threadId],
    );

    expect(prompt).toContain("Tell me about this stuff.");
    expect(prompt).toContain("Agent intake context (Literature review):");
    expect(prompt).toContain("Seed papers and sources:");
    expect(prompt).toContain("30415628");
    expect(prompt).toContain("https://pubmed.ncbi.nlm.nih.gov/29306863/");
  });

  it("uses intake context as the task body when a surface submits without typed composer text", () => {
    const prompt = appendAgentIntakeContextToPrompt("", {
      mode: "data-analysis",
      updatedAt: "2026-05-06T00:00:00.000Z",
      entries: [
        {
          id: "dataset",
          label: "Dataset or data source",
          value: "NHANES 2017-2018",
        },
      ],
    });

    expect(prompt).toContain("Start this agent task from the intake context.");
    expect(prompt).toContain("Agent intake context (Data analysis):");
    expect(prompt).toContain("NHANES 2017-2018");
  });
});
