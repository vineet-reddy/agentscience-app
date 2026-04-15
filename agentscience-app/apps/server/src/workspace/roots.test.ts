import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  normalizeWorkspacePath,
  resolveManagedPaperWorkspaceRoot,
  resolveManagedProjectWorkspaceRoot,
} from "./roots.ts";

describe("workspace roots", () => {
  it("expands a home-relative workspace root before normalizing", () => {
    expect(normalizeWorkspacePath("~/AgentScience")).toBe(
      path.join(os.homedir(), "AgentScience"),
    );
  });

  it("resolves managed project and paper roots from a home-relative container root", () => {
    const expectedContainerRoot = path.join(os.homedir(), "AgentScience");

    expect(resolveManagedProjectWorkspaceRoot("~/AgentScience", "demo-project")).toBe(
      path.join(expectedContainerRoot, "Projects", "demo-project"),
    );

    expect(
      resolveManagedPaperWorkspaceRoot({
        containerRoot: "~/AgentScience",
        projectWorkspaceRoot: null,
        folderSlug: "demo-paper",
      }),
    ).toBe(path.join(expectedContainerRoot, "Papers", "demo-paper"));
  });
});
