import * as OS from "node:os";
import nodePath from "node:path";
import { Effect, FileSystem, Layer, Path } from "effect";

import {
  WorkspaceLayout,
  WorkspaceLayoutError,
  type WorkspaceLayoutShape,
} from "../Services/WorkspaceLayout.ts";
import {
  PROJECT_PAPERS_DIRNAME,
  validatePaperWorkspaceRoot,
  validateProjectWorkspaceRoot,
} from "../roots.ts";

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

  const ensureProjectWorkspace: WorkspaceLayoutShape["ensureProjectWorkspace"] =
    Effect.fn("WorkspaceLayout.ensureProjectWorkspace")(function* (input) {
      const normalizedContainerRoot = path.resolve(
        expandHomePath(input.containerRoot.trim(), path),
      );
      const normalizedProjectWorkspaceRoot = path.resolve(
        expandHomePath(input.projectWorkspaceRoot.trim(), path),
      );
      const validation = validateProjectWorkspaceRoot({
        containerRoot: normalizedContainerRoot,
        projectWorkspaceRoot: normalizedProjectWorkspaceRoot,
      });
      if (!validation.ok) {
        return yield* new WorkspaceLayoutError({
          workspaceRoot: normalizedProjectWorkspaceRoot,
          operation: "workspaceLayout.ensureProjectWorkspace",
          detail: validation.detail,
        });
      }

      yield* ensureDirectory(
        normalizedProjectWorkspaceRoot,
        nodePath.join(normalizedProjectWorkspaceRoot, PROJECT_PAPERS_DIRNAME),
        "workspaceLayout.ensureProjectWorkspace",
      );
    });

  const ensurePaperWorkspace: WorkspaceLayoutShape["ensurePaperWorkspace"] = Effect.fn(
    "WorkspaceLayout.ensurePaperWorkspace",
  )(function* (input) {
    const normalizedContainerRoot = path.resolve(
      expandHomePath(input.containerRoot.trim(), path),
    );
    const normalizedPaperWorkspaceRoot = path.resolve(
      expandHomePath(input.paperWorkspaceRoot.trim(), path),
    );
    const normalizedProjectWorkspaceRoot =
      input.projectWorkspaceRoot === undefined ||
      input.projectWorkspaceRoot === null
        ? input.projectWorkspaceRoot
        : path.resolve(expandHomePath(input.projectWorkspaceRoot.trim(), path));
    const validation = validatePaperWorkspaceRoot({
      containerRoot: normalizedContainerRoot,
      paperWorkspaceRoot: normalizedPaperWorkspaceRoot,
      ...(normalizedProjectWorkspaceRoot !== undefined
        ? { projectWorkspaceRoot: normalizedProjectWorkspaceRoot }
        : {}),
    });
    if (!validation.ok) {
      return yield* new WorkspaceLayoutError({
        workspaceRoot: normalizedPaperWorkspaceRoot,
        operation: "workspaceLayout.ensurePaperWorkspace",
        detail: validation.detail,
      });
    }

    yield* ensureDirectory(
      normalizedPaperWorkspaceRoot,
      normalizedPaperWorkspaceRoot,
      "workspaceLayout.ensurePaperWorkspace",
    );
  });

  const movePaperWorkspace: WorkspaceLayoutShape["movePaperWorkspace"] = Effect.fn(
    "WorkspaceLayout.movePaperWorkspace",
  )(function* (input) {
    const normalizedContainerRoot = path.resolve(
      expandHomePath(input.containerRoot.trim(), path),
    );
    const normalizedFromPaperWorkspaceRoot = path.resolve(
      expandHomePath(input.fromPaperWorkspaceRoot.trim(), path),
    );
    const normalizedFromProjectWorkspaceRoot =
      input.fromProjectWorkspaceRoot === undefined ||
      input.fromProjectWorkspaceRoot === null
        ? input.fromProjectWorkspaceRoot
        : path.resolve(expandHomePath(input.fromProjectWorkspaceRoot.trim(), path));
    const normalizedToPaperWorkspaceRoot = path.resolve(
      expandHomePath(input.toPaperWorkspaceRoot.trim(), path),
    );
    const normalizedToProjectWorkspaceRoot =
      input.toProjectWorkspaceRoot === undefined ||
      input.toProjectWorkspaceRoot === null
        ? input.toProjectWorkspaceRoot
        : path.resolve(expandHomePath(input.toProjectWorkspaceRoot.trim(), path));
    const fromValidation = validatePaperWorkspaceRoot({
      containerRoot: normalizedContainerRoot,
      paperWorkspaceRoot: normalizedFromPaperWorkspaceRoot,
      ...(normalizedFromProjectWorkspaceRoot !== undefined
        ? { projectWorkspaceRoot: normalizedFromProjectWorkspaceRoot }
        : {}),
    });
    if (!fromValidation.ok) {
      return yield* new WorkspaceLayoutError({
        workspaceRoot: normalizedFromPaperWorkspaceRoot,
        operation: "workspaceLayout.movePaperWorkspace",
        detail: fromValidation.detail,
      });
    }
    const toValidation = validatePaperWorkspaceRoot({
      containerRoot: normalizedContainerRoot,
      paperWorkspaceRoot: normalizedToPaperWorkspaceRoot,
      ...(normalizedToProjectWorkspaceRoot !== undefined
        ? { projectWorkspaceRoot: normalizedToProjectWorkspaceRoot }
        : {}),
    });
    if (!toValidation.ok) {
      return yield* new WorkspaceLayoutError({
        workspaceRoot: normalizedToPaperWorkspaceRoot,
        operation: "workspaceLayout.movePaperWorkspace",
        detail: toValidation.detail,
      });
    }

    yield* ensureDirectory(
      normalizedToPaperWorkspaceRoot,
      nodePath.dirname(normalizedToPaperWorkspaceRoot),
      "workspaceLayout.movePaperWorkspace.ensureDestination",
    );
    yield* fileSystem.rename(normalizedFromPaperWorkspaceRoot, normalizedToPaperWorkspaceRoot).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceLayoutError({
            workspaceRoot: normalizedFromPaperWorkspaceRoot,
            operation: "workspaceLayout.movePaperWorkspace",
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
    ensureProjectWorkspace,
    ensurePaperWorkspace,
    movePaperWorkspace,
    moveWorkspaceRoot,
  } satisfies WorkspaceLayoutShape;
});

export const WorkspaceLayoutLive = Layer.effect(
  WorkspaceLayout,
  makeWorkspaceLayout,
);
