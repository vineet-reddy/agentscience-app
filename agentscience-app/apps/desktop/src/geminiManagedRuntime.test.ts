import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveManagedGeminiRuntime } from "./geminiManagedRuntime";

function createTempRoot(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("resolveManagedGeminiRuntime", () => {
  it("prefers the packaged Gemini CLI bundle", () => {
    const resourcesRoot = createTempRoot("agentscience-gemini-resources-");
    const repoRoot = createTempRoot("agentscience-gemini-repo-");

    try {
      const packagedCli = path.join(
        resourcesRoot,
        "managed-resources",
        "gemini-runtime",
        "gemini.js",
      );
      mkdirSync(path.dirname(packagedCli), { recursive: true });
      writeFileSync(packagedCli, "#!/usr/bin/env node\n");

      const resolved = resolveManagedGeminiRuntime({
        resourcesPath: resourcesRoot,
        repoRoot,
        nodePath: "/Applications/AgentScience.app/Contents/MacOS/AgentScience",
      });

      expect(resolved).toEqual({
        cliPath: packagedCli,
        nodePath: "/Applications/AgentScience.app/Contents/MacOS/AgentScience",
      });
    } finally {
      rmSync(resourcesRoot, { recursive: true, force: true });
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("falls back to repo-managed resources during development", () => {
    const resourcesRoot = createTempRoot("agentscience-gemini-resources-");
    const repoRoot = createTempRoot("agentscience-gemini-repo-");

    try {
      const repoCli = path.join(
        repoRoot,
        "apps",
        "desktop",
        "managed-resources",
        "gemini-runtime",
        "gemini.js",
      );
      mkdirSync(path.dirname(repoCli), { recursive: true });
      writeFileSync(repoCli, "#!/usr/bin/env node\n");

      const resolved = resolveManagedGeminiRuntime({
        resourcesPath: resourcesRoot,
        repoRoot,
        nodePath: "/usr/bin/node",
      });

      expect(resolved).toEqual({
        cliPath: repoCli,
        nodePath: "/usr/bin/node",
      });
    } finally {
      rmSync(resourcesRoot, { recursive: true, force: true });
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
