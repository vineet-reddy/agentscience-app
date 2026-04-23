/**
 * Pure logic for the per-thread empty state: which case (A/B/C/D) applies to
 * the user at thread-open, which questions to surface, which datasets to
 * show. Kept separate from React so the state machine is testable in
 * isolation and stays readable.
 */
import type { ThreadId } from "@agentscience/contracts";
import type { FieldTag } from "../onboardingCatalog";
import {
  pickSuggestedQuestions,
  type SuggestedQuestion,
} from "../lib/suggestedQuestions";

/**
 * Threshold for triggering Case D: the user has started this many threads
 * without finishing any of them. Spec says "5 or 6".
 */
export const CASE_D_THREAD_COUNT_THRESHOLD = 5;

export type EmptyStateCase = "A" | "B" | "C" | "D";

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

export interface ConnectedDatasetSummary {
  kind: "dataset" | "provider";
  slug: string;
  name: string;
  description: string;
  /** IBM Plex Mono count label, e.g. "2,428 samples" or "46k patients". */
  countLabel: string | null;
}

export interface PickPrimaryListInput {
  thisThreadId: ThreadId;
  /** All threads the user has (we exclude the active thread from this list). */
  threads: ReadonlyArray<ThreadLikeSummary>;
  /** All live drafts (in-composer, not yet sent). */
  drafts: ReadonlyArray<DraftLikeSummary>;
  /** All user projects. */
  projects: ReadonlyArray<ProjectSummary>;
  /** User's field tags from onboarding. */
  fields: ReadonlyArray<FieldTag>;
  /** User's `data_interests` from onboarding. */
  dataInterests: ReadonlyArray<string>;
  /** Slugs currently connected in the workspace. */
  connectedDataInterests: ReadonlyArray<string>;
  /**
   * Number of prior empty-state renders this session, used to rotate
   * suggestions so visit 2 != visit 1.
   */
  renderSalt: number;
  /**
   * True iff this is the user's very first thread and they just completed
   * (not skipped) onboarding. Unlocks the Case A greeting.
   */
  isFirstThreadPostOnboarding: boolean;
  /**
   * True iff the user has already seen the Case A greeting once (then it
   * should never show again).
   */
  welcomeGreetingConsumed: boolean;
  /**
   * True iff the user has manually connected a dataset beyond the
   * onboarding defaults, a strong signal they're a returning user.
   */
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
    fields,
    dataInterests,
    connectedDataInterests,
    renderSalt,
    isFirstThreadPostOnboarding,
    welcomeGreetingConsumed,
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

  const hasGraduated =
    threadsCompleted > 0 || activeProjects.length > 0 || manualDatasetConnections;

  const caseD =
    threadsStarted >= CASE_D_THREAD_COUNT_THRESHOLD &&
    threadsCompleted === 0 &&
    !hasGraduated;

  const suggestions = pickSuggestedQuestions({
    fields,
    dataInterests,
    connectedDataInterests,
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

  if (hasGraduated) {
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
  if (isFirstThreadPostOnboarding && !welcomeGreetingConsumed && threadsStarted === 0) {
    return {
      emptyStateCase: "A",
      items: suggestionItems.slice(0, 4),
      secondaryItems: [],
      suggestLinkOnly: false,
      suggestions,
    };
  }
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

function buildOwnWorkItems(input: {
  inflightThreads: ReadonlyArray<ThreadLikeSummary>;
  completedThreads: ReadonlyArray<ThreadLikeSummary>;
  drafts: ReadonlyArray<DraftLikeSummary>;
  projects: ReadonlyArray<ProjectSummary>;
}): PickedItem[] {
  const byUpdatedDesc = <T extends { updatedAt?: string | undefined }>(
    a: T,
    b: T,
  ): number => {
    const aTs = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bTs = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    return bTs - aTs;
  };

  const inflight = [...input.inflightThreads].sort(byUpdatedDesc).map<PickedItem>((thread) => ({
    kind: "thread",
    id: thread.id,
    title: thread.title || "Untitled thread",
    subtitle: "In progress",
    sourceTag: "In progress",
  }));

  const drafts = [...input.drafts]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map<PickedItem>((draft) => ({
      kind: "draft",
      id: draft.threadId,
      title: draft.title || "Untitled draft",
      subtitle: "Draft",
      sourceTag: "Draft",
    }));

  const completed = [...input.completedThreads]
    .filter((thread) => !input.inflightThreads.some((t) => t.id === thread.id))
    .sort(byUpdatedDesc)
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
    case "A":
      return {
        title: "Welcome to AgentScience.",
        subtitle: "Here's what a question looks like.",
      };
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
 * Format an IBM Plex Mono count label for the connected-dataset list.
 * Accepts an integer; returns null if we shouldn't show anything.
 */
export function formatConnectedDatasetCount(
  value: number | null | undefined,
  unit: string,
): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  const formatted =
    value >= 1000
      ? new Intl.NumberFormat("en-US").format(value)
      : String(value);
  return `${formatted} ${unit}`;
}

/**
 * Case-D copy.
 */
export const CASE_D_MESSAGE =
  "You've started several threads recently without finishing one. Want help narrowing down?";
