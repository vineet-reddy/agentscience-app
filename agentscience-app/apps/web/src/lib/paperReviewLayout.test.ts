import { describe, expect, it } from "vitest";

import {
  PAPER_REVIEW_INLINE_SIDEBAR_MIN_WIDTH,
  resolvePaperReviewInlineSidebarMaxWidth,
} from "./paperReviewLayout";

describe("paperReviewLayout", () => {
  it("caps the paper review sidebar to about half the viewport", () => {
    expect(resolvePaperReviewInlineSidebarMaxWidth(1_200)).toBe(600);
    expect(resolvePaperReviewInlineSidebarMaxWidth(900)).toBe(450);
  });

  it("never caps below the usable PDF sidebar minimum", () => {
    expect(resolvePaperReviewInlineSidebarMaxWidth(640)).toBe(
      PAPER_REVIEW_INLINE_SIDEBAR_MIN_WIDTH,
    );
  });
});
