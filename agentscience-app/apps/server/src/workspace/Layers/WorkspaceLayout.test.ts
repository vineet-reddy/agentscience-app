import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";

import { WorkspaceLayout } from "../Services/WorkspaceLayout.ts";
import { WorkspaceLayoutLive } from "./WorkspaceLayout.ts";
import { WorkspacePathsLive } from "./WorkspacePaths.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(WorkspaceLayoutLive),
  Layer.provideMerge(WorkspacePathsLive),
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
    it.effect(
      "creates the workspace root and its Papers and Projects directories",
      () =>
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

  describe("createProjectFolder", () => {
    it.effect("creates the project folder and papers subdirectory", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspaceLayout = yield* WorkspaceLayout;
        const tempDir = yield* makeTempDir();
        const workspaceRoot = path.join(tempDir, "AgentScience");

        yield* workspaceLayout.ensureRoot(workspaceRoot);
        yield* workspaceLayout.createProjectFolder({
          workspaceRoot,
          folderSlug: "demo-project",
        });

        for (const directoryPath of [
          path.join(workspaceRoot, "Projects", "demo-project"),
          path.join(workspaceRoot, "Projects", "demo-project", "papers"),
        ]) {
          const stat = yield* fileSystem.stat(directoryPath);
          expect(stat.type).toBe("Directory");
        }
      }),
    );
  });

  describe("createPaperFolder", () => {
    it.effect("creates an unassigned paper folder beneath Papers", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspaceLayout = yield* WorkspaceLayout;
        const tempDir = yield* makeTempDir();
        const workspaceRoot = path.join(tempDir, "AgentScience");

        yield* workspaceLayout.ensureRoot(workspaceRoot);
        yield* workspaceLayout.createPaperFolder({
          workspaceRoot,
          projectFolderSlug: null,
          folderSlug: "demo-paper",
        });

        const stat = yield* fileSystem.stat(
          path.join(workspaceRoot, "Papers", "demo-paper"),
        );
        expect(stat.type).toBe("Directory");
      }),
    );

    it.effect(
      "creates a project paper folder beneath the project papers directory",
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const workspaceLayout = yield* WorkspaceLayout;
          const tempDir = yield* makeTempDir();
          const workspaceRoot = path.join(tempDir, "AgentScience");

          yield* workspaceLayout.ensureRoot(workspaceRoot);
          yield* workspaceLayout.createProjectFolder({
            workspaceRoot,
            folderSlug: "demo-project",
          });
          yield* workspaceLayout.createPaperFolder({
            workspaceRoot,
            projectFolderSlug: "demo-project",
            folderSlug: "demo-paper",
          });

          const stat = yield* fileSystem.stat(
            path.join(
              workspaceRoot,
              "Projects",
              "demo-project",
              "papers",
              "demo-paper",
            ),
          );
          expect(stat.type).toBe("Directory");
        }),
    );
  });

  describe("movePaperFolder", () => {
    it.effect(
      "moves a paper between the root Papers directory and a project papers directory",
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const workspaceLayout = yield* WorkspaceLayout;
          const tempDir = yield* makeTempDir();
          const workspaceRoot = path.join(tempDir, "AgentScience");

          yield* workspaceLayout.ensureRoot(workspaceRoot);
          yield* workspaceLayout.createProjectFolder({
            workspaceRoot,
            folderSlug: "demo-project",
          });
          yield* workspaceLayout.createPaperFolder({
            workspaceRoot,
            projectFolderSlug: null,
            folderSlug: "demo-paper",
          });
          yield* workspaceLayout.movePaperFolder({
            workspaceRoot,
            fromProjectFolderSlug: null,
            toProjectFolderSlug: "demo-project",
            folderSlug: "demo-paper",
          });

          const movedStat = yield* fileSystem.stat(
            path.join(
              workspaceRoot,
              "Projects",
              "demo-project",
              "papers",
              "demo-paper",
            ),
          );
          expect(movedStat.type).toBe("Directory");
          const missing = yield* fileSystem
            .stat(path.join(workspaceRoot, "Papers", "demo-paper"))
            .pipe(Effect.catch(() => Effect.succeed(null)));
          expect(missing).toBeNull();
        }),
    );
  });
});
