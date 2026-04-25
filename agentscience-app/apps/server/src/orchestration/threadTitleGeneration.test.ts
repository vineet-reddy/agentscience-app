import { describe, expect, it } from "vitest";

import {
  extractGeneratedThreadTitleFromProviderItems,
  selectThreadTitleModelSelection,
} from "./threadTitleGeneration.ts";

describe("extractGeneratedThreadTitleFromProviderItems", () => {
  it("ignores Codex user and generic message items when polling for generated titles", () => {
    const title = extractGeneratedThreadTitleFromProviderItems([
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({ title: "Wrong User Prompt Title" }),
          },
        ],
      },
      {
        type: "message",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({ title: "Wrong Generic Message Title" }),
          },
        ],
      },
      {
        type: "reasoning",
        text: JSON.stringify({ title: "Wrong Reasoning Title" }),
      },
      {
        type: "function_call_output",
        content: JSON.stringify({ title: "Wrong Tool Output Title" }),
      },
      {
        type: "assistant_status",
        message: JSON.stringify({ title: "Wrong Assistant Status Title" }),
      },
      {
        type: "function_call_output",
        role: "assistant",
        content: JSON.stringify({ title: "Wrong Assistant Tool Title" }),
      },
    ]);

    expect(title).toBeNull();
  });

  it("extracts generated titles from live Codex assistant message snapshots", () => {
    const title = extractGeneratedThreadTitleFromProviderItems([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Rename this chat" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({ title: "Fix Sidebar Titles" }),
          },
        ],
      },
    ]);

    expect(title).toBe("Fix Sidebar Titles");
  });

  it("keeps supporting test adapter agentMessage snapshots", () => {
    const title = extractGeneratedThreadTitleFromProviderItems([
      {
        type: "agentMessage",
        text: JSON.stringify({ title: "Generate Thread Titles" }),
      },
    ]);

    expect(title).toBe("Generate Thread Titles");
  });
});

describe("selectThreadTitleModelSelection", () => {
  it("uses a mini model with low effort for title generation", () => {
    expect(
      selectThreadTitleModelSelection({
        provider: "codex",
        model: "gpt-5.5",
        options: {
          reasoningEffort: "medium",
          fastMode: false,
        },
      }),
    ).toEqual({
      provider: "codex",
      model: "gpt-5.4-mini",
      options: {
        reasoningEffort: "low",
        fastMode: true,
      },
    });
  });

  it("preserves explicit nano or mini model choices while forcing cheap options", () => {
    expect(
      selectThreadTitleModelSelection({
        provider: "codex",
        model: "gpt-5.4-nano",
        options: {
          reasoningEffort: "high",
        },
      }),
    ).toEqual({
      provider: "codex",
      model: "gpt-5.4-nano",
      options: {
        reasoningEffort: "low",
        fastMode: true,
      },
    });
  });
});
