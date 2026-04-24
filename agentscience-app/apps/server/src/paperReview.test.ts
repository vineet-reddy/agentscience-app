import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EventId, paperReviewFileRoutePath, ThreadId } from "@agentscience/contracts";

const TEST_THREAD_ID = ThreadId.makeUnsafe("thread-review-test");

async function importPaperReviewModule() {
  return import("./paperReview");
}

async function installFakeManagedLatexmkToolchain(input: {
  readonly toolchainRoot: string;
  readonly invocationLogPath: string;
}): Promise<string> {
  const toolchainBinDir = path.join(input.toolchainRoot, "bin");
  const latexmkPath = path.join(
    toolchainBinDir,
    process.platform === "win32" ? "latexmk.exe" : "latexmk",
  );
  const pdflatexPath = path.join(
    toolchainBinDir,
    process.platform === "win32" ? "pdflatex.exe" : "pdflatex",
  );
  await fs.mkdir(toolchainBinDir, { recursive: true });
  await fs.writeFile(
    latexmkPath,
    [
      "#!/bin/sh",
      'if [ "${1:-}" = "-v" ] || [ "${1:-}" = "--version" ]; then',
      "  echo 'Latexmk test build'",
      "  exit 0",
      "fi",
      `printf '%s\\n' "$@" >> ${JSON.stringify(input.invocationLogPath)}`,
      "echo 'latexmk ok'",
    ].join("\n"),
    { mode: 0o755 },
  );
  await fs.writeFile(pdflatexPath, "#!/bin/sh\necho 'pdfTeX test build'\n", {
    mode: 0o755,
  });
  return toolchainBinDir;
}

async function setFileMtime(absolutePath: string, mtimeMs: number): Promise<void> {
  const date = new Date(mtimeMs);
  await fs.utimes(absolutePath, date, date);
}

describe("paper review helpers", () => {
  it("builds stable file URLs for thread artifacts", () => {
    expect(paperReviewFileRoutePath(TEST_THREAD_ID, "figures/plot 1.png")).toBe(
      "/api/paper-review/thread-review-test/files/figures/plot%201.png",
    );
  });

  it("finds markdown notes in a workspace", async () => {
    const { PaperReviewServiceLive, PaperReviewService } = await importPaperReviewModule();
    const { Effect, Layer, Stream } = await import("effect");
    const { OrchestrationEngineService } =
      await import("./orchestration/Services/OrchestrationEngine");

    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentscience-paper-review-"));
    await fs.writeFile(path.join(workspaceRoot, "paper.tex"), "\\section{Intro}\n", "utf8");
    await fs.writeFile(
      path.join(workspaceRoot, "figure-descriptions.md"),
      "Figure 1 notes\n",
      "utf8",
    );

    const OrchestrationEngineTest = Layer.succeed(
      OrchestrationEngineService,
      OrchestrationEngineService.of({
        getReadModel: () =>
          Effect.succeed({
            snapshotSequence: 0,
            projects: [],
            threads: [
              {
                id: TEST_THREAD_ID,
                projectId: null,
                folderSlug: "thread-review-test",
                resolvedWorkspacePath: workspaceRoot,
                title: "Review draft",
                modelSelection: { provider: "codex", model: "gpt-5.4" },
                runtimeMode: "full-access",
                interactionMode: "default",
                branch: null,
                worktreePath: null,
                latestTurn: null,
                createdAt: "2026-04-15T12:00:00.000Z",
                updatedAt: "2026-04-15T12:00:00.000Z",
                archivedAt: null,
                deletedAt: null,
                messages: [],
                proposedPlans: [],
                activities: [],
                checkpoints: [],
                session: null,
              },
            ],
            updatedAt: "2026-04-15T12:00:00.000Z",
          }),
        dispatch: () => Effect.die("not implemented"),
        readEvents: () => Stream.empty,
        streamDomainEvents: Stream.empty,
      }),
    );

    const program = Effect.gen(function* () {
      const service = yield* PaperReviewService;
      return yield* service.getSnapshot(TEST_THREAD_ID);
    }).pipe(Effect.provide(PaperReviewServiceLive.pipe(Layer.provide(OrchestrationEngineTest))));

    const snapshot = await Effect.runPromise(program);
    expect(snapshot.source?.relativePath).toBe("paper.tex");
    expect(snapshot.notes?.relativePath).toBe("figure-descriptions.md");
    expect(snapshot.reviewRecommended).toBe(true);

    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it("does not rebuild when only review notes are newer than a compiled PDF", async () => {
    const { PaperReviewServiceLive, PaperReviewService } = await importPaperReviewModule();
    const { Effect, Layer, Stream } = await import("effect");
    const { OrchestrationEngineService } =
      await import("./orchestration/Services/OrchestrationEngine");

    const previousPaperToolchainBinDir = process.env.AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR;
    const workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscience-paper-review-notes-"),
    );
    const toolchainRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentscience-paper-toolchain-"));
    const invocationLogPath = path.join(workspaceRoot, "latexmk-args.txt");

    try {
      process.env.AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR = await installFakeManagedLatexmkToolchain({
        toolchainRoot,
        invocationLogPath,
      });

      const sourcePath = path.join(workspaceRoot, "paper.tex");
      const pdfPath = path.join(workspaceRoot, "paper.pdf");
      const notesPath = path.join(workspaceRoot, "figure-descriptions.md");
      const now = Date.now();
      await fs.writeFile(sourcePath, "\\section{Intro}\n", "utf8");
      await fs.writeFile(pdfPath, "pdf", "utf8");
      await fs.writeFile(notesPath, "Figure 1 notes\n", "utf8");
      await setFileMtime(sourcePath, now - 30_000);
      await setFileMtime(pdfPath, now - 20_000);
      await setFileMtime(notesPath, now - 10_000);

      const OrchestrationEngineTest = Layer.succeed(
        OrchestrationEngineService,
        OrchestrationEngineService.of({
          getReadModel: () =>
            Effect.succeed({
              snapshotSequence: 0,
              projects: [],
              threads: [
                {
                  id: TEST_THREAD_ID,
                  projectId: null,
                  folderSlug: "thread-review-test",
                  resolvedWorkspacePath: workspaceRoot,
                  title: "Review draft",
                  modelSelection: { provider: "codex", model: "gpt-5.4" },
                  runtimeMode: "full-access",
                  interactionMode: "default",
                  branch: null,
                  worktreePath: null,
                  latestTurn: null,
                  createdAt: "2026-04-15T12:00:00.000Z",
                  updatedAt: "2026-04-15T12:00:00.000Z",
                  archivedAt: null,
                  deletedAt: null,
                  messages: [],
                  proposedPlans: [],
                  activities: [],
                  checkpoints: [],
                  session: null,
                },
              ],
              updatedAt: "2026-04-15T12:00:00.000Z",
            }),
          dispatch: () => Effect.die("not implemented"),
          readEvents: () => Stream.empty,
          streamDomainEvents: Stream.empty,
        }),
      );

      const program = Effect.gen(function* () {
        const service = yield* PaperReviewService;
        return yield* service.getSnapshot(TEST_THREAD_ID);
      }).pipe(Effect.provide(PaperReviewServiceLive.pipe(Layer.provide(OrchestrationEngineTest))));

      const snapshot = await Effect.runPromise(program);
      expect(snapshot.notes?.relativePath).toBe("figure-descriptions.md");
      expect(snapshot.compile.status).toBe("ready");
      expect(snapshot.compile.needsBuild).toBe(false);
      await expect(fs.access(invocationLogPath)).rejects.toThrow();
    } finally {
      if (previousPaperToolchainBinDir === undefined) {
        delete process.env.AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR;
      } else {
        process.env.AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR = previousPaperToolchainBinDir;
      }
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(toolchainRoot, { recursive: true, force: true });
    }
  });

  it("finds manuscripts in nested research workspaces", async () => {
    const { PaperReviewServiceLive, PaperReviewService } = await importPaperReviewModule();
    const { Effect, Layer, Stream } = await import("effect");
    const { OrchestrationEngineService } =
      await import("./orchestration/Services/OrchestrationEngine");

    const threadWorkspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscience-paper-review-thread-"),
    );
    const manuscriptWorkspaceRoot = path.join(threadWorkspaceRoot, "workspace");
    await fs.mkdir(manuscriptWorkspaceRoot, { recursive: true });
    await fs.writeFile(
      path.join(manuscriptWorkspaceRoot, "paper.tex"),
      "\\section{Intro}\n",
      "utf8",
    );
    await fs.writeFile(path.join(manuscriptWorkspaceRoot, "paper.pdf"), "pdf", "utf8");
    await fs.writeFile(
      path.join(manuscriptWorkspaceRoot, "figure-descriptions.md"),
      "Figure 1 notes\n",
      "utf8",
    );

    const OrchestrationEngineTest = Layer.succeed(
      OrchestrationEngineService,
      OrchestrationEngineService.of({
        getReadModel: () =>
          Effect.succeed({
            snapshotSequence: 0,
            projects: [],
            threads: [
              {
                id: TEST_THREAD_ID,
                projectId: null,
                folderSlug: "thread-review-test",
                resolvedWorkspacePath: threadWorkspaceRoot,
                title: "Nested review draft",
                modelSelection: { provider: "codex", model: "gpt-5.4" },
                runtimeMode: "full-access",
                interactionMode: "default",
                branch: null,
                worktreePath: null,
                latestTurn: null,
                createdAt: "2026-04-15T12:00:00.000Z",
                updatedAt: "2026-04-15T12:00:00.000Z",
                archivedAt: null,
                deletedAt: null,
                messages: [],
                proposedPlans: [],
                activities: [],
                checkpoints: [],
                session: null,
              },
            ],
            updatedAt: "2026-04-15T12:00:00.000Z",
          }),
        dispatch: () => Effect.die("not implemented"),
        readEvents: () => Stream.empty,
        streamDomainEvents: Stream.empty,
      }),
    );

    const program = Effect.gen(function* () {
      const service = yield* PaperReviewService;
      const snapshot = yield* service.getSnapshot(TEST_THREAD_ID);
      const resolvedSourcePath = yield* service.resolveFilePath(TEST_THREAD_ID, "paper.tex");
      return {
        snapshot,
        resolvedSourcePath,
      };
    }).pipe(Effect.provide(PaperReviewServiceLive.pipe(Layer.provide(OrchestrationEngineTest))));

    const result = await Effect.runPromise(program);
    expect(result.snapshot.workspaceRoot).toBe(manuscriptWorkspaceRoot);
    expect(result.snapshot.source?.relativePath).toBe("paper.tex");
    expect(result.snapshot.pdf?.relativePath).toBe("paper.pdf");
    expect(result.snapshot.notes?.relativePath).toBe("figure-descriptions.md");
    expect(result.snapshot.reviewRecommended).toBe(true);
    expect(result.resolvedSourcePath).toBe(path.join(manuscriptWorkspaceRoot, "paper.tex"));

    await fs.rm(threadWorkspaceRoot, { recursive: true, force: true });
  });

  it("finds manuscripts in nested manuscript directories", async () => {
    const { PaperReviewServiceLive, PaperReviewService } = await importPaperReviewModule();
    const { Effect, Layer, Stream } = await import("effect");
    const { OrchestrationEngineService } =
      await import("./orchestration/Services/OrchestrationEngine");

    const threadWorkspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscience-paper-review-thread-manuscript-"),
    );
    const manuscriptWorkspaceRoot = path.join(threadWorkspaceRoot, "manuscript");
    await fs.mkdir(manuscriptWorkspaceRoot, { recursive: true });
    await fs.writeFile(
      path.join(manuscriptWorkspaceRoot, "paper.tex"),
      "\\section{Intro}\n",
      "utf8",
    );
    await fs.writeFile(path.join(manuscriptWorkspaceRoot, "paper.pdf"), "pdf", "utf8");
    await fs.writeFile(
      path.join(manuscriptWorkspaceRoot, "references.bib"),
      "@article{demo}\n",
      "utf8",
    );

    const OrchestrationEngineTest = Layer.succeed(
      OrchestrationEngineService,
      OrchestrationEngineService.of({
        getReadModel: () =>
          Effect.succeed({
            snapshotSequence: 0,
            projects: [],
            threads: [
              {
                id: TEST_THREAD_ID,
                projectId: null,
                folderSlug: "thread-review-test",
                resolvedWorkspacePath: threadWorkspaceRoot,
                title: "Nested manuscript draft",
                modelSelection: { provider: "codex", model: "gpt-5.4" },
                runtimeMode: "full-access",
                interactionMode: "default",
                branch: null,
                worktreePath: null,
                latestTurn: null,
                createdAt: "2026-04-15T12:00:00.000Z",
                updatedAt: "2026-04-15T12:00:00.000Z",
                archivedAt: null,
                deletedAt: null,
                messages: [],
                proposedPlans: [],
                activities: [],
                checkpoints: [],
                session: null,
              },
            ],
            updatedAt: "2026-04-15T12:00:00.000Z",
          }),
        dispatch: () => Effect.die("not implemented"),
        readEvents: () => Stream.empty,
        streamDomainEvents: Stream.empty,
      }),
    );

    const program = Effect.gen(function* () {
      const service = yield* PaperReviewService;
      const snapshot = yield* service.getSnapshot(TEST_THREAD_ID);
      const resolvedPdfPath = yield* service.resolveFilePath(TEST_THREAD_ID, "paper.pdf");
      return {
        snapshot,
        resolvedPdfPath,
      };
    }).pipe(Effect.provide(PaperReviewServiceLive.pipe(Layer.provide(OrchestrationEngineTest))));

    const result = await Effect.runPromise(program);
    expect(result.snapshot.workspaceRoot).toBe(manuscriptWorkspaceRoot);
    expect(result.snapshot.source?.relativePath).toBe("paper.tex");
    expect(result.snapshot.pdf?.relativePath).toBe("paper.pdf");
    expect(result.snapshot.bibliography?.relativePath).toBe("references.bib");
    expect(result.snapshot.reviewRecommended).toBe(true);
    expect(result.resolvedPdfPath).toBe(path.join(manuscriptWorkspaceRoot, "paper.pdf"));

    await fs.rm(threadWorkspaceRoot, { recursive: true, force: true });
  });

  it("prefers explicit manuscript presentation activities over directory heuristics", async () => {
    const { PaperReviewServiceLive, PaperReviewService } = await importPaperReviewModule();
    const { Effect, Layer, Stream } = await import("effect");
    const { OrchestrationEngineService } =
      await import("./orchestration/Services/OrchestrationEngine");

    const threadWorkspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscience-paper-review-thread-linked-"),
    );
    const deepManuscriptWorkspaceRoot = path.join(
      threadWorkspaceRoot,
      "runs",
      "2026",
      "04",
      "16",
      "bundle",
      "manuscript",
    );
    await fs.mkdir(deepManuscriptWorkspaceRoot, { recursive: true });
    await fs.writeFile(
      path.join(deepManuscriptWorkspaceRoot, "paper.tex"),
      "\\section{Intro}\n",
      "utf8",
    );
    await fs.writeFile(path.join(deepManuscriptWorkspaceRoot, "paper.pdf"), "pdf", "utf8");

    const OrchestrationEngineTest = Layer.succeed(
      OrchestrationEngineService,
      OrchestrationEngineService.of({
        getReadModel: () =>
          Effect.succeed({
            snapshotSequence: 0,
            projects: [],
            threads: [
              {
                id: TEST_THREAD_ID,
                projectId: null,
                folderSlug: "thread-review-test",
                resolvedWorkspacePath: threadWorkspaceRoot,
                title: "Linked manuscript draft",
                modelSelection: { provider: "codex", model: "gpt-5.4" },
                runtimeMode: "full-access",
                interactionMode: "default",
                branch: null,
                worktreePath: null,
                latestTurn: null,
                createdAt: "2026-04-15T12:00:00.000Z",
                updatedAt: "2026-04-15T12:00:00.000Z",
                archivedAt: null,
                deletedAt: null,
                messages: [],
                proposedPlans: [],
                activities: [
                  {
                    id: EventId.makeUnsafe("activity-paper-presented-test"),
                    tone: "info",
                    kind: "paper.presented",
                    summary: "Paper ready to review",
                    payload: {
                      workspaceRoot: deepManuscriptWorkspaceRoot,
                      source: "paper.tex",
                      pdf: "paper.pdf",
                    },
                    turnId: null,
                    createdAt: "2026-04-15T12:00:00.000Z",
                  },
                ],
                checkpoints: [],
                session: null,
              },
            ],
            updatedAt: "2026-04-15T12:00:00.000Z",
          }),
        dispatch: () => Effect.die("not implemented"),
        readEvents: () => Stream.empty,
        streamDomainEvents: Stream.empty,
      }),
    );

    const program = Effect.gen(function* () {
      const service = yield* PaperReviewService;
      const snapshot = yield* service.getSnapshot(TEST_THREAD_ID);
      const resolvedTexPath = yield* service.resolveFilePath(TEST_THREAD_ID, "paper.tex");
      return {
        snapshot,
        resolvedTexPath,
      };
    }).pipe(Effect.provide(PaperReviewServiceLive.pipe(Layer.provide(OrchestrationEngineTest))));

    const result = await Effect.runPromise(program);
    expect(result.snapshot.workspaceRoot).toBe(deepManuscriptWorkspaceRoot);
    expect(result.snapshot.source?.relativePath).toBe("paper.tex");
    expect(result.snapshot.pdf?.relativePath).toBe("paper.pdf");
    expect(result.snapshot.reviewRecommended).toBe(true);
    expect(result.resolvedTexPath).toBe(path.join(deepManuscriptWorkspaceRoot, "paper.tex"));

    await fs.rm(threadWorkspaceRoot, { recursive: true, force: true });
  });

  it("compiles with the bundled TinyTeX latexmk toolchain", async () => {
    const { PaperReviewServiceLive, PaperReviewService } = await importPaperReviewModule();
    const { Effect, Layer, Stream } = await import("effect");
    const { OrchestrationEngineService } =
      await import("./orchestration/Services/OrchestrationEngine");

    const previousPaperToolchainBinDir = process.env.AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR;
    const workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscience-paper-review-tinytex-"),
    );
    const toolchainRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentscience-paper-toolchain-"));

    try {
      const toolchainBinDir = path.join(toolchainRoot, "bin");
      const invocationLogPath = path.join(workspaceRoot, "latexmk-args.txt");
      const latexmkPath = path.join(
        toolchainBinDir,
        process.platform === "win32" ? "latexmk.exe" : "latexmk",
      );
      const pdflatexPath = path.join(
        toolchainBinDir,
        process.platform === "win32" ? "pdflatex.exe" : "pdflatex",
      );
      await fs.mkdir(toolchainBinDir, { recursive: true });
      await fs.writeFile(
        latexmkPath,
        [
          "#!/bin/sh",
          'if [ "${1:-}" = "-v" ] || [ "${1:-}" = "--version" ]; then',
          "  echo 'Latexmk test build'",
          "  exit 0",
          "fi",
          `printf '%s\\n' "$@" > ${JSON.stringify(invocationLogPath)}`,
          "echo 'latexmk ok'",
        ].join("\n"),
        { mode: 0o755 },
      );
      await fs.writeFile(pdflatexPath, "#!/bin/sh\necho 'pdfTeX test build'\n", {
        mode: 0o755,
      });
      process.env.AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR = toolchainBinDir;

      await fs.writeFile(path.join(workspaceRoot, "paper.tex"), "\\section{Intro}\n", "utf8");

      const OrchestrationEngineTest = Layer.succeed(
        OrchestrationEngineService,
        OrchestrationEngineService.of({
          getReadModel: () =>
            Effect.succeed({
              snapshotSequence: 0,
              projects: [],
              threads: [
                {
                  id: TEST_THREAD_ID,
                  projectId: null,
                  folderSlug: "thread-review-test",
                  resolvedWorkspacePath: workspaceRoot,
                  title: "TinyTeX draft",
                  modelSelection: { provider: "codex", model: "gpt-5.4" },
                  runtimeMode: "full-access",
                  interactionMode: "default",
                  branch: null,
                  worktreePath: null,
                  latestTurn: null,
                  createdAt: "2026-04-15T12:00:00.000Z",
                  updatedAt: "2026-04-15T12:05:00.000Z",
                  archivedAt: null,
                  deletedAt: null,
                  messages: [],
                  proposedPlans: [],
                  activities: [],
                  checkpoints: [],
                  session: null,
                },
              ],
              updatedAt: "2026-04-15T12:05:00.000Z",
            }),
          dispatch: () => Effect.die("not implemented"),
          readEvents: () => Stream.empty,
          streamDomainEvents: Stream.empty,
        }),
      );

      const program = Effect.gen(function* () {
        const service = yield* PaperReviewService;
        return yield* service.compile(TEST_THREAD_ID);
      }).pipe(Effect.provide(PaperReviewServiceLive.pipe(Layer.provide(OrchestrationEngineTest))));

      const snapshot = await Effect.runPromise(program);
      const invocationArgs = await fs.readFile(invocationLogPath, "utf8");

      expect(snapshot.compile.compiler).toBe("managed-latexmk");
      expect(snapshot.compile.compilerLabel).toBe("Bundled paper engine");
      expect(snapshot.compile.outputExcerpt).toContain("latexmk ok");
      expect(invocationArgs.split("\n").filter(Boolean).slice(0, 3)).toEqual([
        "-pdf",
        "-interaction=nonstopmode",
        "-halt-on-error",
      ]);
    } finally {
      if (previousPaperToolchainBinDir === undefined) {
        delete process.env.AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR;
      } else {
        process.env.AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR = previousPaperToolchainBinDir;
      }
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(toolchainRoot, { recursive: true, force: true });
    }
  });

  it("does not leave a successful no-op latexmk build stuck in compiling state", async () => {
    const { PaperReviewServiceLive, PaperReviewService } = await importPaperReviewModule();
    const { Effect, Layer, Stream } = await import("effect");
    const { OrchestrationEngineService } =
      await import("./orchestration/Services/OrchestrationEngine");

    const previousPaperToolchainBinDir = process.env.AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR;
    const workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentscience-paper-review-noop-"),
    );
    const toolchainRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentscience-paper-toolchain-"));
    const invocationLogPath = path.join(workspaceRoot, "latexmk-args.txt");

    try {
      process.env.AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR = await installFakeManagedLatexmkToolchain({
        toolchainRoot,
        invocationLogPath,
      });

      const sourcePath = path.join(workspaceRoot, "paper.tex");
      const pdfPath = path.join(workspaceRoot, "paper.pdf");
      const now = Date.now();
      await fs.writeFile(sourcePath, "\\section{Intro}\n", "utf8");
      await fs.writeFile(pdfPath, "pdf", "utf8");
      await setFileMtime(pdfPath, now - 20_000);
      await setFileMtime(sourcePath, now - 10_000);

      const OrchestrationEngineTest = Layer.succeed(
        OrchestrationEngineService,
        OrchestrationEngineService.of({
          getReadModel: () =>
            Effect.succeed({
              snapshotSequence: 0,
              projects: [],
              threads: [
                {
                  id: TEST_THREAD_ID,
                  projectId: null,
                  folderSlug: "thread-review-test",
                  resolvedWorkspacePath: workspaceRoot,
                  title: "Review draft",
                  modelSelection: { provider: "codex", model: "gpt-5.4" },
                  runtimeMode: "full-access",
                  interactionMode: "default",
                  branch: null,
                  worktreePath: null,
                  latestTurn: null,
                  createdAt: "2026-04-15T12:00:00.000Z",
                  updatedAt: "2026-04-15T12:00:00.000Z",
                  archivedAt: null,
                  deletedAt: null,
                  messages: [],
                  proposedPlans: [],
                  activities: [],
                  checkpoints: [],
                  session: null,
                },
              ],
              updatedAt: "2026-04-15T12:00:00.000Z",
            }),
          dispatch: () => Effect.die("not implemented"),
          readEvents: () => Stream.empty,
          streamDomainEvents: Stream.empty,
        }),
      );

      const program = Effect.gen(function* () {
        const service = yield* PaperReviewService;
        return yield* service.compile(TEST_THREAD_ID);
      }).pipe(Effect.provide(PaperReviewServiceLive.pipe(Layer.provide(OrchestrationEngineTest))));

      const snapshot = await Effect.runPromise(program);
      const invocationArgs = await fs.readFile(invocationLogPath, "utf8");
      expect(invocationArgs).toContain("-recorder");
      expect(snapshot.compile.outputExcerpt).toContain("latexmk ok");
      expect(snapshot.compile.status).toBe("ready");
      expect(snapshot.compile.needsBuild).toBe(false);
    } finally {
      if (previousPaperToolchainBinDir === undefined) {
        delete process.env.AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR;
      } else {
        process.env.AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR = previousPaperToolchainBinDir;
      }
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(toolchainRoot, { recursive: true, force: true });
    }
  });
});
