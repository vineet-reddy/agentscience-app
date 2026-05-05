import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { PaperReviewSnapshot } from "./paperReview";

describe("PaperReviewSnapshot", () => {
  it("accepts a compiled paper snapshot", () => {
    const decode = Schema.decodeSync(PaperReviewSnapshot);
    const decoded = decode({
      threadId: "thread-1",
      threadTitle: "Test paper",
      workspaceRoot: "/tmp/paper",
      source: {
        kind: "latex",
        label: "Manuscript",
        relativePath: "paper.tex",
        url: "/api/paper-review/thread-1/files/paper.tex",
        sizeBytes: 128,
        updatedAt: "2026-04-15T12:00:00.000Z",
        contentType: "application/x-latex",
      },
      pdf: {
        kind: "pdf",
        label: "Preview",
        relativePath: "paper.pdf",
        url: "/api/paper-review/thread-1/files/paper.pdf",
        sizeBytes: 256,
        updatedAt: "2026-04-15T12:00:10.000Z",
        contentType: "application/pdf",
      },
      figure: null,
      bibliography: null,
      notes: null,
      preview: {
        kind: "pdf",
        relativePath: "paper.pdf",
        url: "/api/paper-review/thread-1/files/paper.pdf",
        updatedAt: "2026-04-15T12:00:10.000Z",
      },
      compile: {
        status: "ready",
        compiler: "managed-latexmk",
        compilerLabel: "Bundled paper engine",
        canCompile: true,
        needsBuild: false,
        lastBuiltAt: "2026-04-15T12:00:10.000Z",
        lastError: null,
        outputExcerpt: null,
      },
      reviewRecommended: true,
    });

    expect(decoded.preview.kind).toBe("pdf");
    expect(decoded.compile.compiler).toBe("managed-latexmk");
  });
});
