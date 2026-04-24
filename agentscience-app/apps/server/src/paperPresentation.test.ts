import { describe, expect, it } from "vitest";

import {
  extractPresentedManuscriptFromText,
  parsePresentedManuscriptPayload,
} from "./paperPresentation.ts";

describe("paperPresentation", () => {
  it("parses a valid manuscript presentation payload", () => {
    expect(
      parsePresentedManuscriptPayload({
        workspaceRoot: "/tmp/manuscript",
        source: "paper.tex",
        pdf: "paper.pdf",
        publishManifest: "agentscience.publish.json",
      }),
    ).toEqual({
      workspaceRoot: "/tmp/manuscript",
      source: "paper.tex",
      pdf: "paper.pdf",
      publishManifest: "agentscience.publish.json",
    });
  });

  it("returns null for payloads without a presentable manuscript", () => {
    expect(parsePresentedManuscriptPayload({ notes: "figure-descriptions.md" })).toBeNull();
    expect(parsePresentedManuscriptPayload("{not json}")).toBeNull();
  });

  it("accepts source-only manuscript presentations before a PDF exists", () => {
    expect(
      parsePresentedManuscriptPayload({
        workspaceRoot: "/tmp/manuscript",
        source: "paper.tex",
        bibliography: "references.bib",
      }),
    ).toEqual({
      workspaceRoot: "/tmp/manuscript",
      source: "paper.tex",
      bibliography: "references.bib",
    });
  });

  it("extracts and strips the presentation block from assistant text", () => {
    const result = extractPresentedManuscriptFromText({
      text: [
        "The manuscript is ready for review on the right.",
        "",
        "<present_manuscript>",
        JSON.stringify({
          workspaceRoot: "/tmp/manuscript",
          source: "paper.tex",
          pdf: "paper.pdf",
          bibliography: "references.bib",
          publishManifest: "agentscience.publish.json",
        }),
        "</present_manuscript>",
      ].join("\n"),
    });

    expect(result.sanitizedText).toBe("The manuscript is ready for review on the right.");
    expect(result.presentation).toEqual({
      workspaceRoot: "/tmp/manuscript",
      source: "paper.tex",
      pdf: "paper.pdf",
      bibliography: "references.bib",
      publishManifest: "agentscience.publish.json",
    });
  });
});
