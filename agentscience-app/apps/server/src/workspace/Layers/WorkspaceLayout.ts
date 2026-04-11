import * as OS from "node:os";
import { Effect, FileSystem, Layer, Path } from "effect";

import {
  WorkspaceLayout,
  WorkspaceLayoutError,
  type WorkspaceLayoutShape,
} from "../Services/WorkspaceLayout.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";

function expandHomePath(input: string, path: Path.Path): string {
  if (input === "~") {
    return OS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(OS.homedir(), input.slice(2));
  }
  return input;
}

export const makeWorkspaceLayout = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;

  const ensureDirectory = Effect.fn("WorkspaceLayout.ensureDirectory")(
    function* (
      workspaceRoot: string,
      directoryPath: string,
      operation: WorkspaceLayoutError["operation"],
    ) {
      yield* fileSystem.makeDirectory(directoryPath, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceLayoutError({
              workspaceRoot,
              operation,
              detail: cause.message,
              cause,
            }),
        ),
      );
    },
  );

  const ensureRoot: WorkspaceLayoutShape["ensureRoot"] = Effect.fn(
    "WorkspaceLayout.ensureRoot",
  )(function* (workspaceRoot) {
    const normalizedWorkspaceRoot = path.resolve(
      expandHomePath(workspaceRoot.trim(), path),
    );

    for (const directoryPath of [
      normalizedWorkspaceRoot,
      path.join(normalizedWorkspaceRoot, "Papers"),
      path.join(normalizedWorkspaceRoot, "Projects"),
    ]) {
      yield* ensureDirectory(
        workspaceRoot,
        directoryPath,
        "workspaceLayout.ensureRoot",
      );
    }
  });

  const createProjectFolder: WorkspaceLayoutShape["createProjectFolder"] =
    Effect.fn("WorkspaceLayout.createProjectFolder")(function* (input) {
      const normalizedWorkspaceRoot = path.resolve(
        expandHomePath(input.workspaceRoot.trim(), path),
      );
      const projectPath = workspacePaths.resolveProjectPath({
        workspaceRoot: normalizedWorkspaceRoot,
        folderSlug: input.folderSlug,
      });

      yield* ensureDirectory(
        input.workspaceRoot,
        path.join(projectPath, "papers"),
        "workspaceLayout.createProjectFolder",
      );
    });

  const createPaperFolder: WorkspaceLayoutShape["createPaperFolder"] =
    Effect.fn("WorkspaceLayout.createPaperFolder")(function* (input) {
      const normalizedWorkspaceRoot = path.resolve(
        expandHomePath(input.workspaceRoot.trim(), path),
      );
      const paperPath = workspacePaths.resolvePaperPath({
        workspaceRoot: normalizedWorkspaceRoot,
        projectFolderSlug: input.projectFolderSlug,
        folderSlug: input.folderSlug,
      });

      yield* ensureDirectory(
        input.workspaceRoot,
        paperPath,
        "workspaceLayout.createPaperFolder",
      );
    });

  const movePaperFolder: WorkspaceLayoutShape["movePaperFolder"] = Effect.fn(
    "WorkspaceLayout.movePaperFolder",
  )(function* (input) {
    const normalizedWorkspaceRoot = path.resolve(
      expandHomePath(input.workspaceRoot.trim(), path),
    );
    const nextPaperParentPath =
      input.toProjectFolderSlug === null
        ? path.join(normalizedWorkspaceRoot, "Papers")
        : path.join(
            workspacePaths.resolveProjectPath({
              workspaceRoot: normalizedWorkspaceRoot,
              folderSlug: input.toProjectFolderSlug,
            }),
            "papers",
          );
    const fromPath = workspacePaths.resolvePaperPath({
      workspaceRoot: normalizedWorkspaceRoot,
      projectFolderSlug: input.fromProjectFolderSlug,
      folderSlug: input.folderSlug,
    });
    const toPath = workspacePaths.resolvePaperPath({
      workspaceRoot: normalizedWorkspaceRoot,
      projectFolderSlug: input.toProjectFolderSlug,
      folderSlug: input.folderSlug,
    });

    yield* ensureDirectory(
      input.workspaceRoot,
      nextPaperParentPath,
      "workspaceLayout.movePaperFolder.ensureDestination",
    );
    yield* fileSystem.rename(fromPath, toPath).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceLayoutError({
            workspaceRoot: input.workspaceRoot,
            operation: "workspaceLayout.movePaperFolder",
            detail: cause.message,
            cause,
          }),
      ),
    );
  });

  const moveWorkspaceRoot: WorkspaceLayoutShape["moveWorkspaceRoot"] =
    Effect.fn("WorkspaceLayout.moveWorkspaceRoot")(function* (input) {
      const fromWorkspaceRoot = path.resolve(
        expandHomePath(input.fromWorkspaceRoot.trim(), path),
      );
      const toWorkspaceRoot = path.resolve(
        expandHomePath(input.toWorkspaceRoot.trim(), path),
      );

      if (fromWorkspaceRoot === toWorkspaceRoot) {
        return yield* Effect.void;
      }

      yield* fileSystem
        .makeDirectory(path.dirname(toWorkspaceRoot), {
          recursive: true,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceLayoutError({
                workspaceRoot: input.toWorkspaceRoot,
                operation:
                  "workspaceLayout.moveWorkspaceRoot.prepareDestination",
                detail: cause.message,
                cause,
              }),
          ),
        );

      const destinationExists = yield* fileSystem.exists(toWorkspaceRoot).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceLayoutError({
              workspaceRoot: input.toWorkspaceRoot,
              operation: "workspaceLayout.moveWorkspaceRoot.inspectDestination",
              detail: cause.message,
              cause,
            }),
        ),
      );

      if (destinationExists) {
        const destinationEntries = yield* fileSystem
          .readDirectory(toWorkspaceRoot, { recursive: false })
          .pipe(
            Effect.mapError(
              (cause) =>
                new WorkspaceLayoutError({
                  workspaceRoot: input.toWorkspaceRoot,
                  operation:
                    "workspaceLayout.moveWorkspaceRoot.inspectDestination",
                  detail: cause.message,
                  cause,
                }),
            ),
          );
        if (destinationEntries.length > 0) {
          return yield* new WorkspaceLayoutError({
            workspaceRoot: input.toWorkspaceRoot,
            operation: "workspaceLayout.moveWorkspaceRoot",
            detail: "Target workspace root must be empty.",
          });
        }
        yield* fileSystem.remove(toWorkspaceRoot, { recursive: true }).pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceLayoutError({
                workspaceRoot: input.toWorkspaceRoot,
                operation: "workspaceLayout.moveWorkspaceRoot.clearDestination",
                detail: cause.message,
                cause,
              }),
          ),
        );
      }

      yield* fileSystem.rename(fromWorkspaceRoot, toWorkspaceRoot).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceLayoutError({
              workspaceRoot: input.fromWorkspaceRoot,
              operation: "workspaceLayout.moveWorkspaceRoot",
              detail: cause.message,
              cause,
            }),
        ),
      );
    });

  return {
    ensureRoot,
    createProjectFolder,
    createPaperFolder,
    movePaperFolder,
    moveWorkspaceRoot,
  } satisfies WorkspaceLayoutShape;
});

export const WorkspaceLayoutLive = Layer.effect(
  WorkspaceLayout,
  makeWorkspaceLayout,
);
