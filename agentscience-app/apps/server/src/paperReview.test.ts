import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { paperReviewFileRoutePath, ThreadId } from "@agentscience/contracts";

const TEST_THREAD_ID = ThreadId.makeUnsafe("thread-review-test");

async function importPaperReviewModule() {
  return import("./paperReview");
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
    const { OrchestrationEngineService } = await import("./orchestration/Services/OrchestrationEngine");

    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentscience-paper-review-"));
    await fs.writeFile(path.join(workspaceRoot, "paper.tex"), "\\section{Intro}\n", "utf8");
    await fs.writeFile(path.join(workspaceRoot, "figure-descriptions.md"), "Figure 1 notes\n", "utf8");

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
    }).pipe(
      Effect.provide(PaperReviewServiceLive.pipe(Layer.provide(OrchestrationEngineTest))),
    );

    const snapshot = await Effect.runPromise(program);
    expect(snapshot.source?.relativePath).toBe("paper.tex");
    expect(snapshot.notes?.relativePath).toBe("figure-descriptions.md");
    expect(snapshot.reviewRecommended).toBe(true);

    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });
});
