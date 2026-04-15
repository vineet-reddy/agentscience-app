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

  describe("ensureProjectWorkspace", () => {
    it.effect("creates the project workspace and papers subdirectory", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspaceLayout = yield* WorkspaceLayout;
        const tempDir = yield* makeTempDir();
        const containerRoot = path.join(tempDir, "AgentScience");
        const projectWorkspaceRoot = path.join(
          containerRoot,
          "Projects",
          "demo-project",
        );

        yield* workspaceLayout.ensureRoot(containerRoot);
        yield* workspaceLayout.ensureProjectWorkspace({
          containerRoot,
          projectWorkspaceRoot,
        });

        for (const directoryPath of [
          projectWorkspaceRoot,
          path.join(projectWorkspaceRoot, "papers"),
        ]) {
          const stat = yield* fileSystem.stat(directoryPath);
          expect(stat.type).toBe("Directory");
        }
      }),
    );

    it.effect("rejects using the container root as the project workspace", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const workspaceLayout = yield* WorkspaceLayout;
        const tempDir = yield* makeTempDir();
        const containerRoot = path.join(tempDir, "AgentScience");

        yield* workspaceLayout.ensureRoot(containerRoot);

        const exit = yield* workspaceLayout
          .ensureProjectWorkspace({
            containerRoot,
            projectWorkspaceRoot: containerRoot,
          })
          .pipe(Effect.exit);

        expect(exit._tag).toBe("Failure");
      }),
    );

    it.effect("rejects project workspaces outside the managed Projects container", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const workspaceLayout = yield* WorkspaceLayout;
        const tempDir = yield* makeTempDir();
        const containerRoot = path.join(tempDir, "AgentScience");
        const rogueProjectRoot = path.join(tempDir, "rogue-project");

        yield* workspaceLayout.ensureRoot(containerRoot);

        const exit = yield* workspaceLayout
          .ensureProjectWorkspace({
            containerRoot,
            projectWorkspaceRoot: rogueProjectRoot,
          })
          .pipe(Effect.exit);

        expect(exit._tag).toBe("Failure");
      }),
    );
  });

  describe("ensurePaperWorkspace", () => {
    it.effect("creates an unassigned paper workspace beneath Papers", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspaceLayout = yield* WorkspaceLayout;
        const tempDir = yield* makeTempDir();
        const containerRoot = path.join(tempDir, "AgentScience");
        const paperWorkspaceRoot = path.join(containerRoot, "Papers", "demo-paper");

        yield* workspaceLayout.ensureRoot(containerRoot);
        yield* workspaceLayout.ensurePaperWorkspace({
          containerRoot,
          paperWorkspaceRoot,
        });

        const stat = yield* fileSystem.stat(paperWorkspaceRoot);
        expect(stat.type).toBe("Directory");
      }),
    );

    it.effect(
      "creates a project paper workspace beneath the project papers directory",
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const workspaceLayout = yield* WorkspaceLayout;
          const tempDir = yield* makeTempDir();
          const containerRoot = path.join(tempDir, "AgentScience");
          const projectWorkspaceRoot = path.join(
            containerRoot,
            "Projects",
            "demo-project",
          );
          const paperWorkspaceRoot = path.join(
            projectWorkspaceRoot,
            "papers",
            "demo-paper",
          );

          yield* workspaceLayout.ensureRoot(containerRoot);
          yield* workspaceLayout.ensureProjectWorkspace({
            containerRoot,
            projectWorkspaceRoot,
          });
          yield* workspaceLayout.ensurePaperWorkspace({
            containerRoot,
            paperWorkspaceRoot,
            projectWorkspaceRoot,
          });

          const stat = yield* fileSystem.stat(paperWorkspaceRoot);
          expect(stat.type).toBe("Directory");
        }),
    );

    it.effect("rejects using the container root as the paper workspace", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const workspaceLayout = yield* WorkspaceLayout;
        const tempDir = yield* makeTempDir();
        const containerRoot = path.join(tempDir, "AgentScience");

        yield* workspaceLayout.ensureRoot(containerRoot);

        const exit = yield* workspaceLayout
          .ensurePaperWorkspace({
            containerRoot,
            paperWorkspaceRoot: containerRoot,
          })
          .pipe(Effect.exit);

        expect(exit._tag).toBe("Failure");
      }),
    );

    it.effect("rejects paper workspaces outside the managed Papers container", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const workspaceLayout = yield* WorkspaceLayout;
        const tempDir = yield* makeTempDir();
        const containerRoot = path.join(tempDir, "AgentScience");
        const roguePaperRoot = path.join(tempDir, "rogue-paper");

        yield* workspaceLayout.ensureRoot(containerRoot);

        const exit = yield* workspaceLayout
          .ensurePaperWorkspace({
            containerRoot,
            paperWorkspaceRoot: roguePaperRoot,
          })
          .pipe(Effect.exit);

        expect(exit._tag).toBe("Failure");
      }),
    );

    it.effect("rejects project paper workspaces when the parent project root is not canonical", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const workspaceLayout = yield* WorkspaceLayout;
        const tempDir = yield* makeTempDir();
        const containerRoot = path.join(tempDir, "AgentScience");
        const rogueProjectRoot = path.join(tempDir, "rogue-project");
        const roguePaperRoot = path.join(rogueProjectRoot, "papers", "demo-paper");

        yield* workspaceLayout.ensureRoot(containerRoot);

        const exit = yield* workspaceLayout
          .ensurePaperWorkspace({
            containerRoot,
            projectWorkspaceRoot: rogueProjectRoot,
            paperWorkspaceRoot: roguePaperRoot,
          })
          .pipe(Effect.exit);

        expect(exit._tag).toBe("Failure");
      }),
    );
  });

  describe("movePaperWorkspace", () => {
    it.effect(
      "moves a paper between the root Papers directory and a project papers directory",
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const workspaceLayout = yield* WorkspaceLayout;
          const tempDir = yield* makeTempDir();
          const containerRoot = path.join(tempDir, "AgentScience");
          const projectWorkspaceRoot = path.join(
            containerRoot,
            "Projects",
            "demo-project",
          );
          const fromPaperWorkspaceRoot = path.join(
            containerRoot,
            "Papers",
            "demo-paper",
          );
          const toPaperWorkspaceRoot = path.join(
            projectWorkspaceRoot,
            "papers",
            "demo-paper",
          );

          yield* workspaceLayout.ensureRoot(containerRoot);
          yield* workspaceLayout.ensureProjectWorkspace({
            containerRoot,
            projectWorkspaceRoot,
          });
          yield* workspaceLayout.ensurePaperWorkspace({
            containerRoot,
            paperWorkspaceRoot: fromPaperWorkspaceRoot,
          });
          yield* workspaceLayout.movePaperWorkspace({
            containerRoot,
            fromPaperWorkspaceRoot,
            toPaperWorkspaceRoot,
            toProjectWorkspaceRoot: projectWorkspaceRoot,
          });

          const movedStat = yield* fileSystem.stat(toPaperWorkspaceRoot);
          expect(movedStat.type).toBe("Directory");
          const missing = yield* fileSystem.stat(fromPaperWorkspaceRoot).pipe(
            Effect.catch(() => Effect.succeed(null)),
          );
          expect(missing).toBeNull();
        }),
    );
  });

  describe("moveWorkspaceRoot", () => {
    it.effect("moves the workspace tree into an empty destination root", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspaceLayout = yield* WorkspaceLayout;
        const tempDir = yield* makeTempDir();
        const fromWorkspaceRoot = path.join(tempDir, "AgentScience");
        const toWorkspaceRoot = path.join(tempDir, "MovedAgentScience");

        yield* workspaceLayout.ensureRoot(fromWorkspaceRoot);
        yield* workspaceLayout.ensurePaperWorkspace({
          containerRoot: fromWorkspaceRoot,
          paperWorkspaceRoot: path.join(fromWorkspaceRoot, "Papers", "demo-paper"),
        });

        yield* workspaceLayout.moveWorkspaceRoot({
          fromWorkspaceRoot,
          toWorkspaceRoot,
        });

        const movedStat = yield* fileSystem.stat(
          path.join(toWorkspaceRoot, "Papers", "demo-paper"),
        );
        expect(movedStat.type).toBe("Directory");
        const previousRoot = yield* fileSystem
          .stat(fromWorkspaceRoot)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        expect(previousRoot).toBeNull();
      }),
    );

    it.effect("refuses to move into a non-empty destination root", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspaceLayout = yield* WorkspaceLayout;
        const tempDir = yield* makeTempDir();
        const fromWorkspaceRoot = path.join(tempDir, "AgentScience");
        const toWorkspaceRoot = path.join(tempDir, "MovedAgentScience");

        yield* workspaceLayout.ensureRoot(fromWorkspaceRoot);
        yield* fileSystem.makeDirectory(toWorkspaceRoot, { recursive: true });
        yield* fileSystem.writeFileString(
          path.join(toWorkspaceRoot, "keep.txt"),
          "occupied",
        );

        const exit = yield* workspaceLayout
          .moveWorkspaceRoot({
            fromWorkspaceRoot,
            toWorkspaceRoot,
          })
          .pipe(Effect.exit);

        expect(exit._tag).toBe("Failure");
      }),
    );
  });
});
