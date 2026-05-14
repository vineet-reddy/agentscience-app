/**
 * Pure logic for the per-thread empty state: which case (A/B/C/D) applies to
 * the user at thread-open, which questions to surface, which datasets to
 * show. Kept separate from React so the state machine is testable in
 * isolation and stays readable.
 */
import type { ThreadId } from "@agentscience/contracts";
import {
  pickSuggestedQuestions,
  type SuggestedQuestion,
} from "../lib/suggestedQuestions";

/**
 * Threshold for triggering Case D: the user has started this many threads
 * without finishing any of them. Spec says "5 or 6".
 */
export const CASE_D_THREAD_COUNT_THRESHOLD = 5;

export type EmptyStateCase = "B" | "C" | "D";

export interface ThreadLikeSummary {
  id: ThreadId;
  title: string;
  updatedAt?: string | undefined;
  createdAt: string;
  /** True iff at least one assistant response has landed in this thread. */
  hasAssistantReply: boolean;
  /** True iff session is in-progress (running/connecting). */
  inFlight: boolean;
  /** True iff the thread is archived (excluded from all suggestions). */
  archived: boolean;
  /** True iff the thread ever produced an artifact like a paper draft. */
  hasDraftArtifact: boolean;
  /** True iff the user has "opened" that artifact. */
  artifactOpened: boolean;
}

export interface DraftLikeSummary {
  threadId: ThreadId;
  updatedAt: string;
  title: string;
  hasContent: boolean;
  promotedToServer: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  hasContent: boolean;
}

export interface PickPrimaryListInput {
  thisThreadId: ThreadId;
  /** All threads the user has (we exclude the active thread from this list). */
  threads: ReadonlyArray<ThreadLikeSummary>;
  /** All live drafts (in-composer, not yet sent). */
  drafts: ReadonlyArray<DraftLikeSummary>;
  /** All user projects. */
  projects: ReadonlyArray<ProjectSummary>;
  /**
   * Number of prior empty-state renders this session, used to rotate
   * suggestions so visit 2 != visit 1.
   */
  renderSalt: number;
  /** True iff the user has manually connected a dataset, a strong signal they're a returning user. */
  manualDatasetConnections: boolean;
}

export interface PickedItem {
  kind: "thread" | "draft" | "project" | "suggestion";
  id: string;
  title: string;
  subtitle?: string | null;
  sourceTag: string;
  /** Suggestion question text to seed composer with (for `suggestion` kind). */
  promptText?: string;
}

export interface PickPrimaryListResult {
  /** A / B / C / D. */
  emptyStateCase: EmptyStateCase;
  /** Primary items in zone 2. */
  items: ReadonlyArray<PickedItem>;
  /**
   * Extra items shown beneath an "Or try something new" divider in Case C
   * when the user doesn't have enough of their own work to fill the list.
   */
  secondaryItems: ReadonlyArray<PickedItem>;
  /**
   * In Case C with 3+ of their own open loops, suggestions move behind a
   * "Suggest a question" link. This flag tells the UI to render that link
   * instead of an inline secondary section.
   */
  suggestLinkOnly: boolean;
  /** The curated suggestions chosen, even if they end up in secondaryItems. */
  suggestions: ReadonlyArray<SuggestedQuestion>;
}

/**
 * Decide which case the user is in and what to render in zone 2.
 */
export function pickEmptyStatePresentation(
  input: PickPrimaryListInput,
): PickPrimaryListResult {
  const {
    thisThreadId,
    threads,
    drafts,
    projects,
    renderSalt,
    manualDatasetConnections,
  } = input;

  const otherThreads = threads.filter(
    (thread) => thread.id !== thisThreadId && !thread.archived,
  );
  const threadsStarted = otherThreads.length;
  const threadsCompleted = otherThreads.filter(
    (thread) => thread.hasAssistantReply || (thread.hasDraftArtifact && thread.artifactOpened),
  ).length;
  const inflight = otherThreads.filter((thread) => thread.inFlight);
  const openDrafts = drafts.filter(
    (draft) => draft.hasContent && draft.threadId !== thisThreadId,
  );
  const activeProjects = projects.filter((project) => project.hasContent);

  const hasOwnWork =
    inflight.length > 0 ||
    openDrafts.length > 0 ||
    threadsCompleted > 0 ||
    activeProjects.length > 0 ||
    manualDatasetConnections;

  const caseD =
    threadsStarted >= CASE_D_THREAD_COUNT_THRESHOLD &&
    threadsCompleted === 0 &&
    !hasOwnWork;

  const suggestions = pickSuggestedQuestions({
    renderSalt,
  });

  if (caseD) {
    return {
      emptyStateCase: "D",
      items: [],
      secondaryItems: [],
      suggestLinkOnly: false,
      suggestions,
    };
  }

  if (hasOwnWork) {
    const ownItems = buildOwnWorkItems({
      inflightThreads: inflight,
      completedThreads: otherThreads.filter(
        (thread) => thread.hasAssistantReply || thread.hasDraftArtifact,
      ),
      drafts: openDrafts,
      projects: activeProjects,
    });
    const suggestionItems = suggestions.map(toSuggestionItem);
    if (ownItems.length >= 3) {
      return {
        emptyStateCase: "C",
        items: ownItems.slice(0, 4),
        secondaryItems: [],
        suggestLinkOnly: true,
        suggestions,
      };
    }
    const fillCount = Math.max(0, 4 - ownItems.length);
    return {
      emptyStateCase: "C",
      items: ownItems,
      secondaryItems: suggestionItems.slice(0, fillCount),
      suggestLinkOnly: false,
      suggestions,
    };
  }

  const suggestionItems = suggestions.map(toSuggestionItem);
  return {
    emptyStateCase: "B",
    items: suggestionItems.slice(0, 4),
    secondaryItems: [],
    suggestLinkOnly: false,
    suggestions,
  };
}

function toSuggestionItem(question: SuggestedQuestion): PickedItem {
  return {
    kind: "suggestion",
    id: `suggestion:${question.id}`,
    title: question.question,
    sourceTag: question.sourceTag,
    promptText: question.question,
  };
}

const byUpdatedDesc = <T extends { updatedAt?: string | undefined }>(
  a: T,
  b: T,
): number => {
  const aTs = a.updatedAt ? Date.parse(a.updatedAt) : 0;
  const bTs = b.updatedAt ? Date.parse(b.updatedAt) : 0;
  return bTs - aTs;
};

function buildOwnWorkItems(input: {
  inflightThreads: ReadonlyArray<ThreadLikeSummary>;
  completedThreads: ReadonlyArray<ThreadLikeSummary>;
  drafts: ReadonlyArray<DraftLikeSummary>;
  projects: ReadonlyArray<ProjectSummary>;
}): PickedItem[] {
  const inflight = input.inflightThreads.toSorted(byUpdatedDesc).map<PickedItem>((thread) => ({
    kind: "thread",
    id: thread.id,
    title: thread.title || "Untitled thread",
    subtitle: "In progress",
    sourceTag: "In progress",
  }));

  const drafts = input.drafts
    .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map<PickedItem>((draft) => ({
      kind: "draft",
      id: draft.threadId,
      title: draft.title || "Untitled draft",
      subtitle: "Draft",
      sourceTag: "Draft",
    }));

  const completed = [...input.completedThreads]
    .filter((thread) => !input.inflightThreads.some((t) => t.id === thread.id))
    .toSorted(byUpdatedDesc)
    .slice(0, 3)
    .map<PickedItem>((thread) => ({
      kind: "thread",
      id: thread.id,
      title: thread.title || "Untitled thread",
      subtitle: "Recent thread",
      sourceTag: "Thread",
    }));

  const projects = [...input.projects].slice(0, 2).map<PickedItem>((project) => ({
    kind: "project",
    id: project.id,
    title: project.name,
    subtitle: "Project",
    sourceTag: "Project",
  }));

  const combined: PickedItem[] = [];
  const seen = new Set<string>();
  for (const bucket of [inflight, drafts, projects, completed]) {
    for (const item of bucket) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      combined.push(item);
      if (combined.length >= 4) break;
    }
    if (combined.length >= 4) break;
  }
  return combined;
}

/**
 * Greeting / subtext strings for each case. Split out for clarity and tests.
 */
export function buildGreeting(
  emptyStateCase: EmptyStateCase,
): { title: string; subtitle: string | null } {
  switch (emptyStateCase) {
    case "B":
      return {
        title: "What will you investigate?",
        subtitle:
          "Describe a question below, or start from one of the directions. AgentScience will find the data, run the analysis, and draft the paper.",
      };
    case "C":
      return {
        title: "Pick up where you left off.",
        subtitle: null,
      };
    case "D":
      return {
        title: "Let's narrow the scope.",
        subtitle: null,
      };
  }
}

/**
 * Case-D copy.
 */
export const CASE_D_MESSAGE =
  "You've started several threads recently without finishing one. Want help narrowing down?";
