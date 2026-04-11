import * as OS from "node:os";
import { Effect, FileSystem, Layer, Path } from "effect";

import {
  WorkspaceLayout,
  WorkspaceLayoutError,
  type WorkspaceLayoutShape,
} from "../Services/WorkspaceLayout.ts";

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

  const ensureRoot: WorkspaceLayoutShape["ensureRoot"] = Effect.fn(
    "WorkspaceLayout.ensureRoot",
  )(function* (workspaceRoot) {
    const normalizedWorkspaceRoot = path.resolve(expandHomePath(workspaceRoot.trim(), path));

    for (const directoryPath of [
      normalizedWorkspaceRoot,
      path.join(normalizedWorkspaceRoot, "Papers"),
      path.join(normalizedWorkspaceRoot, "Projects"),
    ]) {
      yield* fileSystem.makeDirectory(directoryPath, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceLayoutError({
              workspaceRoot,
              operation: "workspaceLayout.ensureRoot",
              detail: cause.message,
              cause,
            }),
        ),
      );
    }
  });

  return {
    ensureRoot,
  } satisfies WorkspaceLayoutShape;
});

export const WorkspaceLayoutLive = Layer.effect(WorkspaceLayout, makeWorkspaceLayout);
