import { describe, expect, it } from "vitest";

import {
  emptySuggestedActionsTextStreamFilterState,
  extractSuggestedActionsFromText,
  filterSuggestedActionsStreamingText,
  flushSuggestedActionsStreamingText,
  parseSuggestedActionsPayload,
} from "./suggestedActions";

describe("suggestedActions", () => {
  it("extracts suggested action blocks and strips them from visible text", () => {
    const result = extractSuggestedActionsFromText({
      text: [
        "**Verdict: review-ready.**",
        "",
        "The manuscript is ready for review.",
        "",
        "<suggested_actions>",
        JSON.stringify({
          suggestedActions: [
            {
              id: "revise",
              label: "Make a revision pass",
              description: "Use my feedback to revise the manuscript",
              kind: "send",
            },
            {
              id: "other",
              label: "Ask about something else",
              description: "Switch to a different target, dataset, or question",
              kind: "compose",
            },
          ],
        }),
        "</suggested_actions>",
      ].join("\n"),
    });

    expect(result.sanitizedText).toBe(
      "**Verdict: review-ready.**\n\nThe manuscript is ready for review.",
    );
    expect(result.suggestedActions).toEqual([
      {
        id: "revise",
        label: "Make a revision pass",
        description: "Use my feedback to revise the manuscript",
        kind: "send",
      },
      {
        id: "other",
        label: "Ask about something else",
        description: "Switch to a different target, dataset, or question",
        kind: "compose",
      },
    ]);
  });

  it("strips invalid blocks without returning actions", () => {
    const result = extractSuggestedActionsFromText({
      text: "Done.\n\n<suggested_actions>{not-json}</suggested_actions>",
    });

    expect(result.sanitizedText).toBe("Done.");
    expect(result.suggestedActions).toBeNull();
  });

  it("filters suggested action blocks across streamed chunks", () => {
    let state = emptySuggestedActionsTextStreamFilterState;
    let visibleText = "";

    for (const delta of [
      "Verdict: done.\n\n<suggest",
      "ed_actions>",
      JSON.stringify({
        suggestedActions: [
          {
            id: "next",
            label: "Run the next check",
            description: "Continue with the recommended validation",
            kind: "send",
          },
        ],
      }),
      "</suggested_actions>",
      "\n",
    ]) {
      const result = filterSuggestedActionsStreamingText({ state, delta });
      state = result.state;
      visibleText += result.visibleDelta;
    }

    visibleText += flushSuggestedActionsStreamingText(state);

    expect(visibleText).toBe("Verdict: done.\n\n\n");
  });

  it("flushes normal text retained while checking for a streamed tag prefix", () => {
    const result = filterSuggestedActionsStreamingText({
      state: emptySuggestedActionsTextStreamFilterState,
      delta: "The answer ends with <suggest",
    });

    expect(result.visibleDelta).toBe("The answer ends with ");
    expect(flushSuggestedActionsStreamingText(result.state)).toBe("<suggest");
  });

  it("caps action field lengths", () => {
    const result = parseSuggestedActionsPayload([
      {
        id: "x".repeat(80),
        label: "l".repeat(120),
        description: "d".repeat(200),
        kind: "send",
      },
    ]);

    expect(result?.[0]?.id).toHaveLength(48);
    expect(result?.[0]?.label).toHaveLength(96);
    expect(result?.[0]?.description).toHaveLength(160);
  });
});
