import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";

import { WorkspaceLayout } from "../Services/WorkspaceLayout.ts";
import { WorkspaceLayoutLive } from "./WorkspaceLayout.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(WorkspaceLayoutLive),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.fn("makeTempDir")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "agentscience-workspace-layout-",
  });
});

it.layer(TestLayer)("WorkspaceLayoutLive", (it) => {
  describe("ensureRoot", () => {
    it.effect("creates the workspace root and its Papers and Projects directories", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspaceLayout = yield* WorkspaceLayout;
        const tempDir = yield* makeTempDir();
        const workspaceRoot = path.join(tempDir, "AgentScience");

        yield* workspaceLayout.ensureRoot(workspaceRoot);

        for (const directoryPath of [
          workspaceRoot,
          path.join(workspaceRoot, "Papers"),
          path.join(workspaceRoot, "Projects"),
        ]) {
          const stat = yield* fileSystem.stat(directoryPath);
          expect(stat.type).toBe("Directory");
        }
      }),
    );
  });
});
