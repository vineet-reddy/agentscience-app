import { describe, expect, it } from "vitest";

import { extractSuggestedActionsFromText } from "./suggestedActions";

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
});
