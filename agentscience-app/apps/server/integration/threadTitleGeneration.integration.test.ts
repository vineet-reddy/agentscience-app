import { randomUUID } from "node:crypto";

import { CommandId, EventId, MessageId, ProjectId, ThreadId } from "@agentscience/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, assert } from "@effect/vitest";
import { Effect } from "effect";

import { makeOrchestrationIntegrationHarness } from "./OrchestrationEngineHarness.integration.ts";
it.live("renames first-turn placeholder titles with generated sidebar titles", () =>
  Effect.gen(function* () {
    const generatedTitle = "Fix Sidebar Thread Titles";
    const firstLineTitle = "can you add some way that a nano or a mini model renames the chat";
    const threadId = ThreadId.makeUnsafe("thread-auto-title");
    const projectId = ProjectId.makeUnsafe("project-auto-title");
    const createdAt = new Date().toISOString();

    const harness = yield* makeOrchestrationIntegrationHarness();

    yield* Effect.acquireUseRelease(
      Effect.succeed(harness),
      (activeHarness) =>
        Effect.gen(function* () {
          yield* activeHarness.engine.dispatch({
            type: "project.create",
            commandId: CommandId.makeUnsafe(`cmd-project-auto-title-${randomUUID()}`),
            projectId,
            title: "Auto Title Project",
            folderSlug: "auto-title-project",
            createdAt,
          });

          yield* activeHarness.engine.dispatch({
            type: "thread.create",
            commandId: CommandId.makeUnsafe(`cmd-thread-auto-title-${randomUUID()}`),
            threadId,
            projectId,
            folderSlug: "auto-title-thread",
            title: firstLineTitle,
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4",
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt,
          });

          const titleResponse = {
            events: [
              {
                type: "message.delta",
                eventId: EventId.makeUnsafe(`evt-title-${randomUUID()}`),
                provider: "codex" as const,
                createdAt: new Date().toISOString(),
                threadId: String(threadId),
                delta: JSON.stringify({ title: generatedTitle }),
              },
            ],
            snapshotItems: [
              {
                type: "message",
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: JSON.stringify({ title: "Wrong User Prompt Title" }),
                  },
                ],
              },
              {
                type: "message",
                content: [
                  {
                    type: "input_text",
                    text: JSON.stringify({ title: "Wrong Generic Message Title" }),
                  },
                ],
              },
              {
                type: "message",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({ title: generatedTitle }),
                  },
                ],
              },
            ],
          };
          yield* activeHarness.adapterHarness!.queueTurnResponseForNextSession(titleResponse);
          yield* activeHarness.adapterHarness!.queueTurnResponseForNextSession(titleResponse);

          yield* activeHarness.engine.dispatch({
            type: "thread.turn.start",
            commandId: CommandId.makeUnsafe(`cmd-turn-auto-title-${randomUUID()}`),
            threadId,
            message: {
              messageId: MessageId.makeUnsafe(`msg-auto-title-${randomUUID()}`),
              role: "user",
              text: firstLineTitle,
              attachments: [],
            },
            titleSeed: firstLineTitle,
            runtimeMode: "full-access",
            interactionMode: "default",
            createdAt: new Date().toISOString(),
          });

          const renamedThread = yield* activeHarness.waitForThread(
            String(threadId),
            (thread) => thread.title === generatedTitle,
          );
          assert.equal(renamedThread.title, generatedTitle);

          const events = yield* activeHarness.waitForDomainEvent(
            (event) =>
              event.type === "thread.meta-updated" &&
              event.payload.threadId === threadId &&
              event.payload.title === generatedTitle,
          );
          assert.equal(
            events.some((event) => event.type === "thread.meta-updated"),
            true,
          );

          const titleSession = activeHarness
            .adapterHarness!.getStartedSessions()
            .find((session) => String(session.threadId).startsWith("thread-title-"));
          assert.equal(titleSession?.modelSelection?.model, "gpt-5.4-mini");
          assert.equal(titleSession?.modelSelection?.options?.reasoningEffort, "low");
          assert.equal(titleSession?.modelSelection?.options?.fastMode, true);
          assert.equal(titleSession?.runtimeMode, "approval-required");
          assert.equal(
            activeHarness
              .adapterHarness!.listActiveSessionIds()
              .some((sessionId) => String(sessionId).startsWith("thread-title-")),
            false,
          );
        }),
      (activeHarness) => activeHarness.dispose,
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);
