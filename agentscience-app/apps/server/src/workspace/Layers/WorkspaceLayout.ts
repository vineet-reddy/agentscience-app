import nodeFs from "node:fs/promises";
import * as OS from "node:os";
import nodePath from "node:path";
import { Effect, FileSystem, Layer, Path } from "effect";

import {
  WorkspaceLayout,
  WorkspaceLayoutError,
  type WorkspaceLayoutShape,
} from "../Services/WorkspaceLayout.ts";
import {
  PROJECT_AGENTS_DIRNAME,
  PROJECT_PAPERS_DIRNAME,
  validateAgentWorkspaceRoot,
  validatePaperWorkspaceRoot,
  validateProjectWorkspaceRoot,
} from "../roots.ts";

const AGENTSCIENCE_IGNORE_FILENAME = ".agentscienceignore";
const DEFAULT_AGENTSCIENCE_IGNORE = [
  "# AgentScience-managed internal files. These are never published unless promoted intentionally.",
  ".agentscience-review/",
  ".agentscience-cache/",
  ".agentscience-temp/",
  ".agentscience-published.json",
  "*.aux",
  "*.bbl",
  "*.bcf",
  "*.blg",
  "*.fdb_latexmk",
  "*.fls",
  "*.log",
  "*.out",
  "*.run.xml",
  "*.synctex.gz",
  "*.toc",
  "",
].join("\n");

function expandHomePath(input: string, path: Path.Path): string {
  if (input === "~") {
    return OS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(OS.homedir(), input.slice(2));
  }
  return input;
}

function causeMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim().length > 0 ? cause.message : fallback;
}

export const makeWorkspaceLayout = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const ensureDirectory = Effect.fn("WorkspaceLayout.ensureDirectory")(function* (
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
  });

  const ensureAgentScienceIgnore = Effect.fn("WorkspaceLayout.ensureAgentScienceIgnore")(function* (
    workspaceRoot: string,
    operation: WorkspaceLayoutError["operation"],
  ) {
    const ignorePath = nodePath.join(workspaceRoot, AGENTSCIENCE_IGNORE_FILENAME);
    const exists = yield* Effect.tryPromise({
      try: async () => {
        try {
          await nodeFs.stat(ignorePath);
          return true;
        } catch {
          return false;
        }
      },
      catch: (cause) =>
        new WorkspaceLayoutError({
          workspaceRoot,
          operation,
          detail: causeMessage(cause, "Unable to inspect .agentscienceignore."),
          cause,
        }),
    });
    if (exists) {
      return;
    }
    yield* Effect.tryPromise({
      try: () => nodeFs.writeFile(ignorePath, DEFAULT_AGENTSCIENCE_IGNORE, "utf8"),
      catch: (cause) =>
        new WorkspaceLayoutError({
          workspaceRoot,
          operation,
          detail: causeMessage(cause, "Unable to write .agentscienceignore."),
          cause,
        }),
    });
  });

  const ensureRoot: WorkspaceLayoutShape["ensureRoot"] = Effect.fn("WorkspaceLayout.ensureRoot")(
    function* (workspaceRoot) {
      const normalizedWorkspaceRoot = path.resolve(expandHomePath(workspaceRoot.trim(), path));

      for (const directoryPath of [
        normalizedWorkspaceRoot,
        path.join(normalizedWorkspaceRoot, "Papers"),
        path.join(normalizedWorkspaceRoot, "Agents"),
        path.join(normalizedWorkspaceRoot, "Projects"),
      ]) {
        yield* ensureDirectory(workspaceRoot, directoryPath, "workspaceLayout.ensureRoot");
      }
    },
  );

  const ensureProjectWorkspace: WorkspaceLayoutShape["ensureProjectWorkspace"] = Effect.fn(
    "WorkspaceLayout.ensureProjectWorkspace",
  )(function* (input) {
    const normalizedContainerRoot = path.resolve(expandHomePath(input.containerRoot.trim(), path));
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
    yield* ensureDirectory(
      normalizedProjectWorkspaceRoot,
      nodePath.join(normalizedProjectWorkspaceRoot, PROJECT_AGENTS_DIRNAME),
      "workspaceLayout.ensureProjectWorkspace",
    );
    yield* ensureAgentScienceIgnore(
      normalizedProjectWorkspaceRoot,
      "workspaceLayout.ensureProjectWorkspace",
    );
  });

  const ensurePaperWorkspace: WorkspaceLayoutShape["ensurePaperWorkspace"] = Effect.fn(
    "WorkspaceLayout.ensurePaperWorkspace",
  )(function* (input) {
    const normalizedContainerRoot = path.resolve(expandHomePath(input.containerRoot.trim(), path));
    const normalizedPaperWorkspaceRoot = path.resolve(
      expandHomePath(input.paperWorkspaceRoot.trim(), path),
    );
    const normalizedProjectWorkspaceRoot =
      input.projectWorkspaceRoot === undefined || input.projectWorkspaceRoot === null
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
    yield* ensureAgentScienceIgnore(
      normalizedPaperWorkspaceRoot,
      "workspaceLayout.ensurePaperWorkspace",
    );
  });

  const ensureAgentWorkspace: WorkspaceLayoutShape["ensureAgentWorkspace"] = Effect.fn(
    "WorkspaceLayout.ensureAgentWorkspace",
  )(function* (input) {
    const normalizedContainerRoot = path.resolve(expandHomePath(input.containerRoot.trim(), path));
    const normalizedAgentWorkspaceRoot = path.resolve(
      expandHomePath(input.agentWorkspaceRoot.trim(), path),
    );
    const normalizedProjectWorkspaceRoot =
      input.projectWorkspaceRoot === undefined || input.projectWorkspaceRoot === null
        ? input.projectWorkspaceRoot
        : path.resolve(expandHomePath(input.projectWorkspaceRoot.trim(), path));
    const validation = validateAgentWorkspaceRoot({
      containerRoot: normalizedContainerRoot,
      agentWorkspaceRoot: normalizedAgentWorkspaceRoot,
      ...(normalizedProjectWorkspaceRoot !== undefined
        ? { projectWorkspaceRoot: normalizedProjectWorkspaceRoot }
        : {}),
    });
    if (!validation.ok) {
      return yield* new WorkspaceLayoutError({
        workspaceRoot: normalizedAgentWorkspaceRoot,
        operation: "workspaceLayout.ensureAgentWorkspace",
        detail: validation.detail,
      });
    }

    yield* ensureDirectory(
      normalizedAgentWorkspaceRoot,
      normalizedAgentWorkspaceRoot,
      "workspaceLayout.ensureAgentWorkspace",
    );
    yield* ensureAgentScienceIgnore(
      normalizedAgentWorkspaceRoot,
      "workspaceLayout.ensureAgentWorkspace",
    );
  });

  const movePaperWorkspace: WorkspaceLayoutShape["movePaperWorkspace"] = Effect.fn(
    "WorkspaceLayout.movePaperWorkspace",
  )(function* (input) {
    const normalizedContainerRoot = path.resolve(expandHomePath(input.containerRoot.trim(), path));
    const normalizedFromPaperWorkspaceRoot = path.resolve(
      expandHomePath(input.fromPaperWorkspaceRoot.trim(), path),
    );
    const normalizedFromProjectWorkspaceRoot =
      input.fromProjectWorkspaceRoot === undefined || input.fromProjectWorkspaceRoot === null
        ? input.fromProjectWorkspaceRoot
        : path.resolve(expandHomePath(input.fromProjectWorkspaceRoot.trim(), path));
    const normalizedToPaperWorkspaceRoot = path.resolve(
      expandHomePath(input.toPaperWorkspaceRoot.trim(), path),
    );
    const normalizedToProjectWorkspaceRoot =
      input.toProjectWorkspaceRoot === undefined || input.toProjectWorkspaceRoot === null
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
    yield* ensureAgentScienceIgnore(
      normalizedToPaperWorkspaceRoot,
      "workspaceLayout.movePaperWorkspace",
    );
  });

  const moveAgentWorkspace: WorkspaceLayoutShape["moveAgentWorkspace"] = Effect.fn(
    "WorkspaceLayout.moveAgentWorkspace",
  )(function* (input) {
    const normalizedContainerRoot = path.resolve(expandHomePath(input.containerRoot.trim(), path));
    const normalizedFromAgentWorkspaceRoot = path.resolve(
      expandHomePath(input.fromAgentWorkspaceRoot.trim(), path),
    );
    const normalizedFromProjectWorkspaceRoot =
      input.fromProjectWorkspaceRoot === undefined || input.fromProjectWorkspaceRoot === null
        ? input.fromProjectWorkspaceRoot
        : path.resolve(expandHomePath(input.fromProjectWorkspaceRoot.trim(), path));
    const normalizedToAgentWorkspaceRoot = path.resolve(
      expandHomePath(input.toAgentWorkspaceRoot.trim(), path),
    );
    const normalizedToProjectWorkspaceRoot =
      input.toProjectWorkspaceRoot === undefined || input.toProjectWorkspaceRoot === null
        ? input.toProjectWorkspaceRoot
        : path.resolve(expandHomePath(input.toProjectWorkspaceRoot.trim(), path));
    const fromValidation = validateAgentWorkspaceRoot({
      containerRoot: normalizedContainerRoot,
      agentWorkspaceRoot: normalizedFromAgentWorkspaceRoot,
      ...(normalizedFromProjectWorkspaceRoot !== undefined
        ? { projectWorkspaceRoot: normalizedFromProjectWorkspaceRoot }
        : {}),
    });
    if (!fromValidation.ok) {
      return yield* new WorkspaceLayoutError({
        workspaceRoot: normalizedFromAgentWorkspaceRoot,
        operation: "workspaceLayout.moveAgentWorkspace",
        detail: fromValidation.detail,
      });
    }
    const toValidation = validateAgentWorkspaceRoot({
      containerRoot: normalizedContainerRoot,
      agentWorkspaceRoot: normalizedToAgentWorkspaceRoot,
      ...(normalizedToProjectWorkspaceRoot !== undefined
        ? { projectWorkspaceRoot: normalizedToProjectWorkspaceRoot }
        : {}),
    });
    if (!toValidation.ok) {
      return yield* new WorkspaceLayoutError({
        workspaceRoot: normalizedToAgentWorkspaceRoot,
        operation: "workspaceLayout.moveAgentWorkspace",
        detail: toValidation.detail,
      });
    }

    yield* ensureDirectory(
      normalizedToAgentWorkspaceRoot,
      nodePath.dirname(normalizedToAgentWorkspaceRoot),
      "workspaceLayout.moveAgentWorkspace.ensureDestination",
    );
    yield* fileSystem.rename(normalizedFromAgentWorkspaceRoot, normalizedToAgentWorkspaceRoot).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceLayoutError({
            workspaceRoot: normalizedFromAgentWorkspaceRoot,
            operation: "workspaceLayout.moveAgentWorkspace",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* ensureAgentScienceIgnore(
      normalizedToAgentWorkspaceRoot,
      "workspaceLayout.moveAgentWorkspace",
    );
  });

  const moveWorkspaceRoot: WorkspaceLayoutShape["moveWorkspaceRoot"] = Effect.fn(
    "WorkspaceLayout.moveWorkspaceRoot",
  )(function* (input) {
    const fromWorkspaceRoot = path.resolve(expandHomePath(input.fromWorkspaceRoot.trim(), path));
    const toWorkspaceRoot = path.resolve(expandHomePath(input.toWorkspaceRoot.trim(), path));

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
              operation: "workspaceLayout.moveWorkspaceRoot.prepareDestination",
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
                operation: "workspaceLayout.moveWorkspaceRoot.inspectDestination",
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
    ensureAgentWorkspace,
    movePaperWorkspace,
    moveAgentWorkspace,
    moveWorkspaceRoot,
  } satisfies WorkspaceLayoutShape;
});

export const WorkspaceLayoutLive = Layer.effect(WorkspaceLayout, makeWorkspaceLayout);
