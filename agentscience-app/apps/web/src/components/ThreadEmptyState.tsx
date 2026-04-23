/**
 * Per-thread empty state. Three zones, top to bottom, centered at 680px:
 *
 *   Zone 1: greeting (EB Garamond h1 + IBM Plex Sans subtext).
 *   Zone 2: primary list — research questions OR the user's own open loops.
 *   Zone 3: connected datasets with Plex-Mono counts.
 *
 * All structure lives on thin 1px horizontal rules (`border-rule`). No cards.
 * No shadows. No accent color except the hover shift to `text-brand` on
 * interactive items.
 */
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ThreadId } from "@agentscience/contracts";
import { useEffect, useMemo, useState } from "react";
import { useComposerDraftStore } from "../composerDraftStore";
import { useComposerFocusStore } from "../composerFocusStore";
import {
  datasetEntryToMention,
  datasetProviderToMention,
  useComposerDatasetMentionStore,
} from "../composerDatasetMentionStore";
import { useOnboardingStore } from "../onboardingStore";
import {
  GENERIC_DATA_INTERESTS,
  resolveDataInterestChips,
} from "../onboardingCatalog";
import {
  fetchDatasetProviders,
  fetchDatasetRegistry,
  type DatasetEntry,
  type DatasetProvider,
} from "../lib/datasetRegistry";
import { useStore } from "../store";
import { cn } from "../lib/utils";
import {
  buildGreeting,
  CASE_D_MESSAGE,
  formatConnectedDatasetCount,
  pickEmptyStatePresentation,
  type ConnectedDatasetSummary,
  type DraftLikeSummary,
  type PickedItem,
  type ProjectSummary,
  type ThreadLikeSummary,
} from "./ThreadEmptyState.logic";

interface ThreadEmptyStateProps {
  threadId: ThreadId;
}

export function ThreadEmptyState({ threadId }: ThreadEmptyStateProps) {
  const navigate = useNavigate();
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const requestComposerFocus = useComposerFocusStore((store) => store.requestFocus);
  const threads = useStore((store) => store.threads);
  const projects = useStore((store) => store.projects);
  const draftsByThreadId = useComposerDraftStore((store) => store.draftsByThreadId);
  const draftThreadsByThreadId = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId,
  );

  const onboardingProfile = useOnboardingStore((store) => store.profile);
  const welcomeGreetingConsumed = useOnboardingStore(
    (store) => store.welcomeGreetingConsumed,
  );
  const onboardingCompletedAt = useOnboardingStore((store) => store.completedAt);
  const onboardingSkipped = useOnboardingStore((store) => store.skipped);
  const markWelcomeGreetingConsumed = useOnboardingStore(
    (store) => store.markWelcomeGreetingConsumed,
  );

  const datasetsQuery = useQuery({
    queryKey: ["thread-empty-state:datasets"],
    queryFn: ({ signal }) => fetchDatasetRegistry({ signal, limit: 500 }),
    staleTime: 60_000,
    retry: false,
  });
  const providersQuery = useQuery({
    queryKey: ["thread-empty-state:providers"],
    queryFn: ({ signal }) => fetchDatasetProviders({ signal, limit: 200 }),
    staleTime: 60_000,
    retry: false,
  });

  const registerDatasetMention = useComposerDatasetMentionStore(
    (store) => store.registerDatasetMention,
  );

  // Auto-connected datasets/providers from onboarding are registered as
  // mentions on this thread so `@dataset:slug` / `@provider:slug` tokens
  // resolve the moment the user composes a message. Without this, Zone 3
  // row clicks would drop unrecognized mentions into the composer.
  useEffect(() => {
    if (!datasetsQuery.data && !providersQuery.data) return;
    const datasets = datasetsQuery.data ?? [];
    const providers = providersQuery.data ?? [];
    const datasetsBySlug = new Map(
      datasets.map((d) => [
        d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
        d,
      ]),
    );
    const providersBySlug = new Map(providers.map((p) => [p.slug, p]));
    for (const entry of onboardingProfile.autoConnectedDatasets) {
      if (entry.kind === "dataset") {
        const dataset = datasetsBySlug.get(entry.slug);
        if (dataset) {
          registerDatasetMention(threadId, datasetEntryToMention(dataset));
        }
      } else {
        const provider = providersBySlug.get(entry.slug);
        if (provider) {
          registerDatasetMention(threadId, datasetProviderToMention(provider));
        }
      }
    }
  }, [
    datasetsQuery.data,
    providersQuery.data,
    onboardingProfile.autoConnectedDatasets,
    registerDatasetMention,
    threadId,
  ]);

  // Stable-per-mount rotation salt so visit 2 picks a different 4.
  const [renderSalt] = useState<number>(
    () => Math.floor(Math.random() * 256) + Math.floor(Date.now() / 60_000),
  );

  const threadSummaries = useMemo<ReadonlyArray<ThreadLikeSummary>>(() => {
    return threads.map((thread) => {
      const hasAssistantReply = thread.messages.some(
        (message) => message.role === "assistant" && message.text.length > 0,
      );
      const inFlight =
        thread.session?.status === "running" ||
        thread.session?.status === "connecting" ||
        thread.latestTurn?.state === "running";
      const hasDraftArtifact = thread.activities.some(
        (activity) => activity.kind === "paper.presented",
      );
      return {
        id: thread.id,
        title: thread.title,
        updatedAt: thread.updatedAt,
        createdAt: thread.createdAt,
        hasAssistantReply,
        inFlight: Boolean(inFlight),
        archived: thread.archivedAt !== null,
        hasDraftArtifact,
        // We don't have a real "opened" signal yet; treat presented-once as
        // opened for the graduation check. Refine when we track openings.
        artifactOpened: hasDraftArtifact,
      } satisfies ThreadLikeSummary;
    });
  }, [threads]);

  const draftSummaries = useMemo<ReadonlyArray<DraftLikeSummary>>(() => {
    const entries: DraftLikeSummary[] = [];
    for (const [draftThreadId, draftThread] of Object.entries(draftThreadsByThreadId)) {
      if (!draftThread) continue;
      const typedThreadId = draftThreadId as ThreadId;
      const draft = draftsByThreadId[typedThreadId];
      const hasContent = Boolean(draft?.prompt && draft.prompt.trim().length > 0);
      entries.push({
        threadId: typedThreadId,
        updatedAt: draftThread.createdAt,
        title: "New thread",
        hasContent,
        promotedToServer: false,
      });
    }
    return entries;
  }, [draftThreadsByThreadId, draftsByThreadId]);

  const projectSummaries = useMemo<ReadonlyArray<ProjectSummary>>(() => {
    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      hasContent: Boolean(
        threads.some(
          (thread) => thread.projectId === project.id && thread.archivedAt === null,
        ),
      ),
    }));
  }, [projects, threads]);

  const connectedDataInterests = useMemo<ReadonlyArray<string>>(() => {
    return onboardingProfile.dataInterests;
  }, [onboardingProfile.dataInterests]);

  const isFirstThreadPostOnboarding = useMemo(() => {
    if (!onboardingCompletedAt) return false;
    if (onboardingSkipped) return false;
    const threadsWithMessages = threadSummaries.filter(
      (thread) => thread.hasAssistantReply,
    );
    return threadsWithMessages.length === 0;
  }, [onboardingCompletedAt, onboardingSkipped, threadSummaries]);

  const manualDatasetConnections = useMemo(() => {
    // We treat any user interest not in the auto-connected set as a signal
    // of a manual connection step. Heuristic; refine once we have real
    // workspace dataset-connection events.
    const auto = new Set(
      onboardingProfile.autoConnectedDatasets.map((entry) => entry.slug),
    );
    return onboardingProfile.dataInterests.some((id) => {
      const chip =
        resolveDataInterestChips(onboardingProfile.field).find((c) => c.id === id) ??
        GENERIC_DATA_INTERESTS.find((c) => c.id === id);
      if (!chip) return false;
      const slug = chip.datasetSlug ?? chip.providerSlug ?? null;
      return slug !== null && !auto.has(slug);
    });
  }, [onboardingProfile.autoConnectedDatasets, onboardingProfile.dataInterests, onboardingProfile.field]);

  const presentation = useMemo(
    () =>
      pickEmptyStatePresentation({
        thisThreadId: threadId,
        threads: threadSummaries,
        drafts: draftSummaries,
        projects: projectSummaries,
        fields: onboardingProfile.field,
        dataInterests: onboardingProfile.dataInterests,
        connectedDataInterests,
        renderSalt,
        isFirstThreadPostOnboarding,
        welcomeGreetingConsumed,
        manualDatasetConnections,
      }),
    [
      connectedDataInterests,
      draftSummaries,
      isFirstThreadPostOnboarding,
      manualDatasetConnections,
      onboardingProfile.dataInterests,
      onboardingProfile.field,
      projectSummaries,
      renderSalt,
      threadId,
      threadSummaries,
      welcomeGreetingConsumed,
    ],
  );

  const greeting = useMemo(
    () => buildGreeting(presentation.emptyStateCase),
    [presentation.emptyStateCase],
  );

  // Case A can only fire once per account. Consume as soon as we actually
  // paint it — no delay, no dwell time required. Runs in an effect so we
  // never touch another store during render.
  useEffect(() => {
    if (presentation.emptyStateCase !== "A") return;
    if (welcomeGreetingConsumed) return;
    markWelcomeGreetingConsumed();
  }, [
    presentation.emptyStateCase,
    welcomeGreetingConsumed,
    markWelcomeGreetingConsumed,
  ]);

  const handleItemClick = (item: PickedItem) => {
    if (item.kind === "suggestion" && item.promptText) {
      setPrompt(threadId, item.promptText);
      requestComposerFocus({ threadId, seedPrompt: item.promptText });
      return;
    }
    if (item.kind === "thread" || item.kind === "draft") {
      void navigate({ to: "/$threadId", params: { threadId: item.id } });
      return;
    }
    if (item.kind === "project") {
      // There's no project route today; opening it surfaces the most recent
      // thread in that project if one exists, else leaves the user here.
      const thread = threads.find((t) => t.projectId === item.id && t.archivedAt === null);
      if (thread) {
        void navigate({ to: "/$threadId", params: { threadId: thread.id } });
      }
    }
  };

  const handleDatasetClick = (dataset: ConnectedDatasetSummary) => {
    const mention =
      dataset.kind === "dataset"
        ? `@dataset:${dataset.slug}`
        : `@provider:${dataset.slug}`;
    const currentDraft =
      useComposerDraftStore.getState().draftsByThreadId[threadId];
    const currentPrompt = currentDraft?.prompt ?? "";
    const separator =
      currentPrompt.length === 0 || /\s$/.test(currentPrompt) ? "" : " ";
    const nextPrompt = `${currentPrompt}${separator}${mention} `;
    setPrompt(threadId, nextPrompt);
    requestComposerFocus({ threadId, seedPrompt: nextPrompt });
  };

  if (presentation.emptyStateCase === "D") {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="mx-auto w-full max-w-[680px]">
          <h1 className="font-display text-[2rem] leading-[1.12] text-ink sm:text-[2.25rem]">
            {greeting.title}
          </h1>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-light">
            {CASE_D_MESSAGE}
          </p>
          <div className="mt-6">
            <button
              type="button"
              onClick={() => {
                // Stub scoping dialog: for now focus the composer with a
                // seed prompt that drives a narrowing conversation. When the
                // real dialog lands, swap this for a modal trigger.
                const seed =
                  "I've started several threads but haven't finished one. Help me narrow down what to focus on first.";
                setPrompt(threadId, seed);
                requestComposerFocus({ threadId, seedPrompt: seed });
              }}
              className="inline-flex items-center rounded-[4px] border border-ink bg-ink px-4 py-2 text-[0.8125rem] font-medium text-snow-white transition-colors duration-150 ease-linear hover:bg-[#333]"
            >
              Help me narrow down
            </button>
          </div>
        </div>
      </div>
    );
  }

  const connected = deriveConnectedDatasets({
    autoConnected: onboardingProfile.autoConnectedDatasets,
    providers: providersQuery.data ?? [],
    datasets: datasetsQuery.data ?? [],
  });

  return (
    <div className="flex h-full w-full justify-center overflow-y-auto px-6 pb-16 pt-12 sm:pt-16">
      <div className="w-full max-w-[680px]">
        {/* Zone 1: Greeting */}
        <header>
          <h1 className="font-display text-[2rem] leading-[1.12] text-ink sm:text-[2.5rem]">
            {greeting.title}
          </h1>
          {greeting.subtitle ? (
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-light">
              {greeting.subtitle}
            </p>
          ) : null}
        </header>

        {/* Zone 2: Primary list */}
        {presentation.items.length > 0 ? (
          <PrimarySection
            emptyStateCase={presentation.emptyStateCase}
            items={presentation.items}
            onItemClick={handleItemClick}
          />
        ) : null}

        {/* Optional "Or try something new" subsection (Case C with slack) */}
        {presentation.secondaryItems.length > 0 ? (
          <section className="mt-10">
            <SectionLabel
              label="Or try something new"
              subtext="Suggested questions based on your field."
            />
            <ItemList items={presentation.secondaryItems} onItemClick={handleItemClick} />
          </section>
        ) : null}

        {/* "Suggest a question" text link when Case C is fully self-supplied */}
        {presentation.suggestLinkOnly ? (
          <div className="mt-8 border-t border-rule pt-4">
            <button
              type="button"
              onClick={() => {
                const first = presentation.suggestions[0];
                if (!first) return;
                setPrompt(threadId, first.question);
                requestComposerFocus({ threadId, seedPrompt: first.question });
              }}
              className="text-[0.8125rem] text-ink-light transition-colors duration-150 ease-linear hover:text-brand"
            >
              Suggest a question
            </button>
          </div>
        ) : null}

        {/* Zone 3: Connected data */}
        {connected.length > 0 ? (
          <section className="mt-12">
            <SectionLabel
              label="Or work from your data"
              subtext={
                onboardingSkipped
                  ? "Open sources connected by default. Reference any of them with @ in the composer."
                  : "These sources are connected. Reference any of them with @ in the composer."
              }
            />
            <ul className="mt-4 border-t border-rule">
              {connected.map((dataset) => (
                <li key={`${dataset.kind}:${dataset.slug}`}>
                  <button
                    type="button"
                    onClick={() => handleDatasetClick(dataset)}
                    className="flex w-full items-baseline justify-between gap-6 border-b border-rule py-4 text-left transition-colors duration-150 ease-linear"
                  >
                    <div className="flex min-w-0 flex-1 items-baseline gap-3">
                      <span className="text-[0.9375rem] font-medium text-ink transition-colors duration-150 ease-linear group-hover:text-brand">
                        {dataset.name}
                      </span>
                      {dataset.description ? (
                        <span className="truncate text-[0.8125rem] text-ink-light">
                          {dataset.description}
                        </span>
                      ) : null}
                    </div>
                    {dataset.countLabel ? (
                      <span className="shrink-0 font-mono text-[0.75rem] text-ink-faint">
                        {dataset.countLabel}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function PrimarySection({
  emptyStateCase,
  items,
  onItemClick,
}: {
  emptyStateCase: "A" | "B" | "C";
  items: ReadonlyArray<PickedItem>;
  onItemClick: (item: PickedItem) => void;
}) {
  const { label, subtext } = useMemo(() => {
    switch (emptyStateCase) {
      case "A":
        return {
          label: "A few places to start",
          subtext: "Each is a complete question you can run as-is or reshape in the composer.",
        };
      case "B":
        return {
          label: "A few places to start",
          subtext: "Each is a complete question you can run as-is or reshape in the composer.",
        };
      case "C":
        return {
          label: "Pick up where you left off",
          subtext: "Drafts and threads you were working on.",
        };
    }
  }, [emptyStateCase]);

  return (
    <section className="mt-10">
      <SectionLabel label={label} subtext={subtext} />
      <ItemList items={items} onItemClick={onItemClick} />
    </section>
  );
}

function SectionLabel({ label, subtext }: { label: string; subtext: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-[0.9375rem] font-medium text-ink">{label}</h2>
      {subtext ? (
        <p className="text-[0.8125rem] text-ink-light">{subtext}</p>
      ) : null}
    </div>
  );
}

function ItemList({
  items,
  onItemClick,
}: {
  items: ReadonlyArray<PickedItem>;
  onItemClick: (item: PickedItem) => void;
}) {
  return (
    <ul className="mt-4 border-t border-rule">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onItemClick(item)}
            className={cn(
              "group flex w-full items-baseline justify-between gap-6 border-b border-rule py-4 text-left",
            )}
          >
            <span
              className={cn(
                "font-display text-[1.125rem] leading-snug text-ink transition-colors duration-150 ease-linear",
                "group-hover:text-brand",
              )}
            >
              {item.title}
            </span>
            <span className="shrink-0 font-mono text-[0.75rem] text-ink-faint transition-colors duration-150 ease-linear group-hover:text-ink-light">
              {item.sourceTag}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function deriveConnectedDatasets(input: {
  autoConnected: ReadonlyArray<{ kind: "dataset" | "provider"; slug: string }>;
  providers: ReadonlyArray<DatasetProvider>;
  datasets: ReadonlyArray<DatasetEntry>;
}): ReadonlyArray<ConnectedDatasetSummary> {
  if (input.autoConnected.length === 0) return [];
  const providersBySlug = new Map(input.providers.map((p) => [p.slug, p]));
  const datasetsBySlug = new Map(
    input.datasets.map((d) => [
      d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
      d,
    ]),
  );

  const summaries: ConnectedDatasetSummary[] = [];
  const seen = new Set<string>();
  for (const entry of input.autoConnected) {
    const key = `${entry.kind}:${entry.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (entry.kind === "provider") {
      const provider = providersBySlug.get(entry.slug);
      if (provider) {
        summaries.push({
          kind: "provider",
          slug: provider.slug,
          name: provider.name,
          description: shortenDescription(provider.description),
          countLabel: formatConnectedDatasetCount(provider.datasetCount, labelForKind("datasets")),
        });
      } else {
        summaries.push({
          kind: "provider",
          slug: entry.slug,
          name: entry.slug,
          description: "",
          countLabel: null,
        });
      }
      continue;
    }
    const dataset = datasetsBySlug.get(entry.slug);
    if (dataset) {
      summaries.push({
        kind: "dataset",
        slug: entry.slug,
        name: dataset.name,
        description: shortenDescription(dataset.description),
        countLabel: null,
      });
    } else {
      summaries.push({
        kind: "dataset",
        slug: entry.slug,
        name: entry.slug,
        description: "",
        countLabel: null,
      });
    }
  }
  return summaries;
}

function labelForKind(unit: string): string {
  return unit;
}

function shortenDescription(input: string | null): string {
  const text = (input ?? "").trim();
  if (text.length === 0) return "";
  if (text.length <= 72) return text;
  return `${text.slice(0, 69).trimEnd()}…`;
}
