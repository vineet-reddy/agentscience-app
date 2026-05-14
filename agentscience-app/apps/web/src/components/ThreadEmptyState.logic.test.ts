import { describe, it, expect } from "vitest";
import { ThreadId } from "@agentscience/contracts";
import {
  CASE_D_THREAD_COUNT_THRESHOLD,
  buildGreeting,
  pickEmptyStatePresentation,
  type DraftLikeSummary,
  type PickPrimaryListInput,
  type ThreadLikeSummary,
} from "./ThreadEmptyState.logic";

const thisThreadId = ThreadId.makeUnsafe("thread-self");

function baseThread(
  overrides: Partial<ThreadLikeSummary> & Pick<ThreadLikeSummary, "id">,
): ThreadLikeSummary {
  return {
    title: "Untitled",
    createdAt: "2026-04-23T10:00:00.000Z",
    updatedAt: "2026-04-23T10:00:00.000Z",
    hasAssistantReply: false,
    inFlight: false,
    archived: false,
    hasDraftArtifact: false,
    artifactOpened: false,
    ...overrides,
  };
}

function baseDraft(id: string, hasContent = true): DraftLikeSummary {
  return {
    threadId: ThreadId.makeUnsafe(id),
    title: "New thread",
    updatedAt: "2026-04-23T12:00:00.000Z",
    hasContent,
    promotedToServer: false,
  };
}

function baseInput(overrides: Partial<PickPrimaryListInput> = {}): PickPrimaryListInput {
  return {
    thisThreadId,
    threads: [baseThread({ id: thisThreadId })],
    drafts: [],
    projects: [],
    renderSalt: 0,
    manualDatasetConnections: false,
    ...overrides,
  };
}

describe("pickEmptyStatePresentation", () => {
  it("Case B: brand new users see the standard prompt", () => {
    const result = pickEmptyStatePresentation(baseInput());
    expect(result.emptyStateCase).toBe("B");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.length).toBeLessThanOrEqual(4);
    expect(buildGreeting("B").title).toBe("What will you investigate?");
  });

  it("Case C: user has completed a thread → shows own work with suggestion fill", () => {
    const completedThread = baseThread({
      id: ThreadId.makeUnsafe("thread-completed"),
      hasAssistantReply: true,
      updatedAt: "2026-04-23T13:00:00.000Z",
    });
    const result = pickEmptyStatePresentation(baseInput({
      threads: [baseThread({ id: thisThreadId }), completedThread],
    }));
    expect(result.emptyStateCase).toBe("C");
    expect(result.items.some((item) => item.kind === "thread")).toBe(true);
    expect(result.secondaryItems.length).toBeGreaterThan(0);
    expect(result.suggestLinkOnly).toBe(false);
  });

  it("Case C: an in-flight thread is enough to surface pick-up-where-you-left-off", () => {
    const inFlightThread = baseThread({
      id: ThreadId.makeUnsafe("thread-running"),
      inFlight: true,
      updatedAt: "2026-04-23T13:00:00.000Z",
    });
    const result = pickEmptyStatePresentation(baseInput({
      threads: [baseThread({ id: thisThreadId }), inFlightThread],
    }));
    expect(result.emptyStateCase).toBe("C");
    expect(result.items.some((item) => item.kind === "thread")).toBe(true);
  });

  it("Case C: an unsent draft is enough to surface pick-up-where-you-left-off", () => {
    const result = pickEmptyStatePresentation(baseInput({
      drafts: [baseDraft("draft-1")],
    }));
    expect(result.emptyStateCase).toBe("C");
    expect(result.items.some((item) => item.kind === "draft")).toBe(true);
  });

  it("Case C: with 3+ open drafts, suggestions hide behind the 'Suggest a question' link", () => {
    const drafts: DraftLikeSummary[] = [
      baseDraft("draft-1"),
      baseDraft("draft-2"),
      baseDraft("draft-3"),
    ];
    const result = pickEmptyStatePresentation(baseInput({
      threads: [
        baseThread({
          id: ThreadId.makeUnsafe("t-done"),
          hasAssistantReply: true,
        }),
      ],
      drafts,
    }));
    expect(result.emptyStateCase).toBe("C");
    expect(result.items.length).toBeLessThanOrEqual(4);
    expect(result.secondaryItems.length).toBe(0);
    expect(result.suggestLinkOnly).toBe(true);
  });

  it("Case D: many started threads, none completed, no graduation", () => {
    const manyStarted = Array.from({ length: CASE_D_THREAD_COUNT_THRESHOLD }, (_, i) =>
      baseThread({ id: ThreadId.makeUnsafe(`t-${i}`) }),
    );
    const result = pickEmptyStatePresentation(baseInput({
      threads: [baseThread({ id: thisThreadId }), ...manyStarted],
    }));
    expect(result.emptyStateCase).toBe("D");
    expect(result.items.length).toBe(0);
  });

  it("Case D does not fire once the user has graduated", () => {
    const manyStarted = Array.from({ length: CASE_D_THREAD_COUNT_THRESHOLD }, (_, i) =>
      baseThread({ id: ThreadId.makeUnsafe(`t-${i}`) }),
    );
    const result = pickEmptyStatePresentation(baseInput({
      threads: [baseThread({ id: thisThreadId }), ...manyStarted],
      manualDatasetConnections: true, // Manually connected dataset → graduated.
    }));
    expect(result.emptyStateCase).toBe("C");
  });

  it("empty-state users still get a non-empty generic list", () => {
    const result = pickEmptyStatePresentation(baseInput());
    expect(result.emptyStateCase).toBe("B");
    expect(result.items.length).toBeGreaterThan(0);
  });
});
