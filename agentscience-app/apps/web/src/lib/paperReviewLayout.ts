export const PAPER_REVIEW_INLINE_DEFAULT_WIDTH = "min(44rem, max(22rem, 45vw))";
export const PAPER_REVIEW_INLINE_SIDEBAR_MIN_WIDTH = 22 * 16;

const PAPER_REVIEW_INLINE_MAX_VIEWPORT_RATIO = 0.5;

export function resolvePaperReviewInlineSidebarMaxWidth(viewportWidth: number): number {
  return Math.max(
    PAPER_REVIEW_INLINE_SIDEBAR_MIN_WIDTH,
    Math.floor(viewportWidth * PAPER_REVIEW_INLINE_MAX_VIEWPORT_RATIO),
  );
}
