import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cleanLocalArtifacts, collectLocalArtifactPaths } from "./clean-local-artifacts.mjs";

function touch(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, "fixture\n");
}

describe("cleanLocalArtifacts", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const tempRoot of tempRoots.splice(0)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("removes generated storage-heavy artifacts while preserving source and managed-resource docs", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "agentscience-clean-artifacts-"));
    tempRoots.push(repoRoot);

    touch(join(repoRoot, "apps/web/src/App.tsx"));
    touch(join(repoRoot, "apps/web/dist/assets/index.js"));
    touch(join(repoRoot, "apps/web/tsconfig.tsbuildinfo"));
    touch(join(repoRoot, "apps/desktop/dist-electron/main.js"));
    touch(join(repoRoot, "packages/shared/src/index.ts"));
    touch(join(repoRoot, "packages/shared/dist/index.mjs"));
    touch(join(repoRoot, "release/Agent-Science.dmg"));
    touch(join(repoRoot, ".turbo/cache.bin"));
    touch(join(repoRoot, "node_modules/example/package.json"));
    touch(join(repoRoot, "apps/desktop/managed-resources/.manifest.json"));
    touch(join(repoRoot, "apps/desktop/managed-resources/science-runtime/README.md"));
    touch(join(repoRoot, "apps/desktop/managed-resources/science-runtime/darwin-arm64/bin/python3"));
    touch(join(repoRoot, "apps/desktop/managed-resources/paper-toolchain/README.md"));
    touch(join(repoRoot, "apps/desktop/managed-resources/paper-toolchain/darwin-universal/TinyTeX.tar.gz"));
    touch(join(repoRoot, ".DS_Store"));

    expect(collectLocalArtifactPaths(repoRoot)).toEqual(
      expect.arrayContaining([
        "apps/web/dist",
        "apps/desktop/dist-electron",
        "packages/shared/dist",
        "release",
        ".turbo",
        "node_modules",
        "apps/desktop/managed-resources/.manifest.json",
        "apps/desktop/managed-resources/science-runtime/darwin-arm64",
        "apps/desktop/managed-resources/paper-toolchain/darwin-universal",
      ]),
    );

    cleanLocalArtifacts(repoRoot);

    expect(existsSync(join(repoRoot, "apps/web/src/App.tsx"))).toBe(true);
    expect(existsSync(join(repoRoot, "packages/shared/src/index.ts"))).toBe(true);
    expect(
      existsSync(join(repoRoot, "apps/desktop/managed-resources/science-runtime/README.md")),
    ).toBe(true);
    expect(
      existsSync(join(repoRoot, "apps/desktop/managed-resources/paper-toolchain/README.md")),
    ).toBe(true);

    expect(existsSync(join(repoRoot, "apps/web/dist"))).toBe(false);
    expect(existsSync(join(repoRoot, "apps/web/tsconfig.tsbuildinfo"))).toBe(false);
    expect(existsSync(join(repoRoot, "apps/desktop/dist-electron"))).toBe(false);
    expect(existsSync(join(repoRoot, "packages/shared/dist"))).toBe(false);
    expect(existsSync(join(repoRoot, "release"))).toBe(false);
    expect(existsSync(join(repoRoot, ".turbo"))).toBe(false);
    expect(existsSync(join(repoRoot, "node_modules"))).toBe(false);
    expect(existsSync(join(repoRoot, ".DS_Store"))).toBe(false);
    expect(existsSync(join(repoRoot, "apps/desktop/managed-resources/.manifest.json"))).toBe(false);
    expect(
      existsSync(join(repoRoot, "apps/desktop/managed-resources/science-runtime/darwin-arm64")),
    ).toBe(false);
    expect(
      existsSync(join(repoRoot, "apps/desktop/managed-resources/paper-toolchain/darwin-universal")),
    ).toBe(false);
  });
});
