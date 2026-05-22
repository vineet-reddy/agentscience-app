import { describe, expect, it } from "vitest";

import { CANVAS_BROWSER_REGRESSION_SITES } from "./canvasBrowserRegressionSuite.ts";

describe("CANVAS_BROWSER_REGRESSION_SITES", () => {
  it("contains 100 unique public HTTP(S) sites with representative tasks", () => {
    expect(CANVAS_BROWSER_REGRESSION_SITES).toHaveLength(100);

    const ids = new Set<number>();
    const sites = new Set<string>();
    for (const entry of CANVAS_BROWSER_REGRESSION_SITES) {
      expect(entry.id).toBeGreaterThan(0);
      expect(entry.category.trim()).not.toEqual("");
      expect(entry.representativeTask.trim()).not.toEqual("");
      expect(entry.site).toMatch(/^https:\/\//);
      expect(ids.has(entry.id)).toBe(false);
      expect(sites.has(entry.site)).toBe(false);
      ids.add(entry.id);
      sites.add(entry.site);
    }

    expect([...ids]).toEqual(Array.from({ length: 100 }, (_unused, index) => index + 1));
  });
});
