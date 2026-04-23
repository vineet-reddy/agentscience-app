import { describe, it, expect } from "vitest";
import { ThreadId } from "@agentscience/contracts";
import {
  CASE_D_THREAD_COUNT_THRESHOLD,
  buildGreeting,
  formatConnectedDatasetCount,
  pickEmptyStatePresentation,
  type DraftLikeSummary,
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

describe("pickEmptyStatePresentation", () => {
  it("Case A: brand new user, onboarding complete, first thread, greeting unconsumed", () => {
    const result = pickEmptyStatePresentation({
      thisThreadId,
      threads: [baseThread({ id: thisThreadId })],
      drafts: [],
      projects: [],
      fields: ["oncology"],
      dataInterests: ["depmap"],
      connectedDataInterests: ["depmap"],
      renderSalt: 0,
      isFirstThreadPostOnboarding: true,
      welcomeGreetingConsumed: false,
      manualDatasetConnections: false,
    });
    expect(result.emptyStateCase).toBe("A");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.length).toBeLessThanOrEqual(4);
    expect(buildGreeting("A").title).toBe("Welcome to AgentScience.");
  });

  it("Case B: once greeting has been consumed, drop back to the standard prompt", () => {
    const result = pickEmptyStatePresentation({
      thisThreadId,
      threads: [baseThread({ id: thisThreadId })],
      drafts: [],
      projects: [],
      fields: ["oncology"],
      dataInterests: ["depmap"],
      connectedDataInterests: ["depmap"],
      renderSalt: 0,
      isFirstThreadPostOnboarding: true,
      welcomeGreetingConsumed: true,
      manualDatasetConnections: false,
    });
    expect(result.emptyStateCase).toBe("B");
    expect(buildGreeting("B").title).toBe("What will you investigate?");
  });

  it("Case C: user has completed a thread → shows own work with suggestion fill", () => {
    const completedThread = baseThread({
      id: ThreadId.makeUnsafe("thread-completed"),
      hasAssistantReply: true,
      updatedAt: "2026-04-23T13:00:00.000Z",
    });
    const result = pickEmptyStatePresentation({
      thisThreadId,
      threads: [baseThread({ id: thisThreadId }), completedThread],
      drafts: [],
      projects: [],
      fields: [],
      dataInterests: [],
      connectedDataInterests: [],
      renderSalt: 0,
      isFirstThreadPostOnboarding: false,
      welcomeGreetingConsumed: true,
      manualDatasetConnections: false,
    });
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
    const result = pickEmptyStatePresentation({
      thisThreadId,
      threads: [baseThread({ id: thisThreadId }), inFlightThread],
      drafts: [],
      projects: [],
      fields: ["oncology"],
      dataInterests: ["depmap"],
      connectedDataInterests: ["depmap"],
      renderSalt: 0,
      isFirstThreadPostOnboarding: false,
      welcomeGreetingConsumed: true,
      manualDatasetConnections: false,
    });
    expect(result.emptyStateCase).toBe("C");
    expect(result.items.some((item) => item.kind === "thread")).toBe(true);
  });

  it("Case C: an unsent draft is enough to surface pick-up-where-you-left-off", () => {
    const result = pickEmptyStatePresentation({
      thisThreadId,
      threads: [baseThread({ id: thisThreadId })],
      drafts: [baseDraft("draft-1")],
      projects: [],
      fields: ["oncology"],
      dataInterests: ["depmap"],
      connectedDataInterests: ["depmap"],
      renderSalt: 0,
      isFirstThreadPostOnboarding: false,
      welcomeGreetingConsumed: true,
      manualDatasetConnections: false,
    });
    expect(result.emptyStateCase).toBe("C");
    expect(result.items.some((item) => item.kind === "draft")).toBe(true);
  });

  it("Case C: with 3+ open drafts, suggestions hide behind the 'Suggest a question' link", () => {
    const drafts: DraftLikeSummary[] = [
      baseDraft("draft-1"),
      baseDraft("draft-2"),
      baseDraft("draft-3"),
    ];
    const result = pickEmptyStatePresentation({
      thisThreadId,
      threads: [
        baseThread({
          id: ThreadId.makeUnsafe("t-done"),
          hasAssistantReply: true,
        }),
      ],
      drafts,
      projects: [],
      fields: ["oncology"],
      dataInterests: [],
      connectedDataInterests: [],
      renderSalt: 0,
      isFirstThreadPostOnboarding: false,
      welcomeGreetingConsumed: true,
      manualDatasetConnections: false,
    });
    expect(result.emptyStateCase).toBe("C");
    expect(result.items.length).toBeLessThanOrEqual(4);
    expect(result.secondaryItems.length).toBe(0);
    expect(result.suggestLinkOnly).toBe(true);
  });

  it("Case D: many started threads, none completed, no graduation", () => {
    const manyStarted = Array.from({ length: CASE_D_THREAD_COUNT_THRESHOLD }, (_, i) =>
      baseThread({ id: ThreadId.makeUnsafe(`t-${i}`) }),
    );
    const result = pickEmptyStatePresentation({
      thisThreadId,
      threads: [baseThread({ id: thisThreadId }), ...manyStarted],
      drafts: [],
      projects: [],
      fields: [],
      dataInterests: [],
      connectedDataInterests: [],
      renderSalt: 0,
      isFirstThreadPostOnboarding: false,
      welcomeGreetingConsumed: true,
      manualDatasetConnections: false,
    });
    expect(result.emptyStateCase).toBe("D");
    expect(result.items.length).toBe(0);
  });

  it("Case D does not fire once the user has graduated", () => {
    const manyStarted = Array.from({ length: CASE_D_THREAD_COUNT_THRESHOLD }, (_, i) =>
      baseThread({ id: ThreadId.makeUnsafe(`t-${i}`) }),
    );
    const result = pickEmptyStatePresentation({
      thisThreadId,
      threads: [baseThread({ id: thisThreadId }), ...manyStarted],
      drafts: [],
      projects: [],
      fields: [],
      dataInterests: [],
      connectedDataInterests: [],
      renderSalt: 0,
      isFirstThreadPostOnboarding: false,
      welcomeGreetingConsumed: true,
      manualDatasetConnections: true, // Manually connected dataset → graduated.
    });
    expect(result.emptyStateCase).toBe("C");
  });

  it("skipped-onboarding users still get a non-empty generic list", () => {
    const result = pickEmptyStatePresentation({
      thisThreadId,
      threads: [baseThread({ id: thisThreadId })],
      drafts: [],
      projects: [],
      fields: [],
      dataInterests: [],
      connectedDataInterests: [],
      renderSalt: 0,
      isFirstThreadPostOnboarding: false,
      welcomeGreetingConsumed: false,
      manualDatasetConnections: false,
    });
    expect(result.emptyStateCase).toBe("B");
    expect(result.items.length).toBeGreaterThan(0);
  });
});

describe("formatConnectedDatasetCount", () => {
  it("formats with thousands separators", () => {
    expect(formatConnectedDatasetCount(46000, "patients")).toBe("46,000 patients");
    expect(formatConnectedDatasetCount(2428, "samples")).toBe("2,428 samples");
  });

  it("passes small numbers through verbatim", () => {
    expect(formatConnectedDatasetCount(42, "datasets")).toBe("42 datasets");
  });

  it("returns null for invalid input", () => {
    expect(formatConnectedDatasetCount(null, "x")).toBeNull();
    expect(formatConnectedDatasetCount(undefined, "x")).toBeNull();
    expect(formatConnectedDatasetCount(-1, "x")).toBeNull();
  });
});
