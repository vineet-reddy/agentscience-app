/**
 * Per-thread empty state. Three zones, top to bottom, centered at 680px:
 *
 *   Zone 1: greeting (EB Garamond h1 + IBM Plex Sans subtext).
 *   Zone 2: primary list of research questions or the user's own open loops.
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
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenTextIcon,
  Code2Icon,
  CheckIcon,
  ClipboardIcon,
  DatabaseIcon,
  FileTextIcon,
  FileUpIcon,
  FolderOpenIcon,
  LinkIcon,
  SearchIcon,
} from "lucide-react";
import { useComposerDraftStore } from "../composerDraftStore";
import { useComposerAutoSubmitStore } from "../composerAutoSubmitStore";
import { useComposerFocusStore } from "../composerFocusStore";
import { useAgentIntakeStore } from "../agentIntakeStore";
import {
  datasetEntryToMention,
  datasetProviderToMention,
  useComposerDatasetMentionStore,
} from "../composerDatasetMentionStore";
import { useOnboardingStore } from "../onboardingStore";
import { OPEN_AUTO_CONNECT_DATASET_IDS } from "../onboardingCatalog";
import {
  fetchDatasetProviders,
  fetchDatasetRegistry,
  type DatasetEntry,
  type DatasetProvider,
} from "../lib/datasetRegistry";
import { useStore } from "../store";
import { cn } from "../lib/utils";
import type { PaperWorkflowMode } from "../paperWorkflowModes";
import {
  AGENT_CONFIGS,
  AGENT_CONFIG_BY_MODE,
  AgentGlyph,
  isSpecialistAgentMode,
  type AgentConfig,
  type SpecialistAgentMode,
} from "../agentRegistry";
import { useUiStateStore } from "../uiStateStore";
import { readNativeApi } from "../nativeApi";
import { toastManager } from "./ui/toast";
import { Button } from "./ui/button";
import type { ChatFileAttachment } from "../types";
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
  const requestComposerSubmit = useComposerAutoSubmitStore((store) => store.requestSubmit);
  const requestComposerFocus = useComposerFocusStore((store) => store.requestFocus);
  const threads = useStore((store) => store.threads);
  const projects = useStore((store) => store.projects);
  const draftsByThreadId = useComposerDraftStore((store) => store.draftsByThreadId);
  const draftThreadsByThreadId = useComposerDraftStore((store) => store.draftThreadsByThreadId);
  const isDraftThread = useComposerDraftStore((store) =>
    Object.hasOwn(store.draftThreadsByThreadId, threadId),
  );
  const draftThreadKind = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId[threadId]?.kind ?? "paper",
  );
  const selectedPaperMode = useUiStateStore(
    (store) => store.paperWorkflowModeByThreadId[threadId] ?? null,
  );
  const setPaperWorkflowMode = useUiStateStore((store) => store.setPaperWorkflowMode);
  const addFiles = useComposerDraftStore((store) => store.addFiles);
  const clearAgentIntakeContext = useAgentIntakeStore((store) => store.clearContext);

  const onboardingProfile = useOnboardingStore((store) => store.profile);
  const welcomeGreetingConsumed = useOnboardingStore((store) => store.welcomeGreetingConsumed);
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
        d.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, ""),
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
        threads.some((thread) => thread.projectId === project.id && thread.archivedAt === null),
      ),
    }));
  }, [projects, threads]);

  const connectedDataInterests = useMemo<ReadonlyArray<string>>(() => {
    return onboardingProfile.dataInterests.filter((id) => OPEN_AUTO_CONNECT_DATASET_IDS.has(id));
  }, [onboardingProfile.dataInterests]);

  const isFirstThreadPostOnboarding = useMemo(() => {
    if (!onboardingCompletedAt) return false;
    if (onboardingSkipped) return false;
    const threadsWithMessages = threadSummaries.filter((thread) => thread.hasAssistantReply);
    return threadsWithMessages.length === 0;
  }, [onboardingCompletedAt, onboardingSkipped, threadSummaries]);

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
        manualDatasetConnections: false,
      }),
    [
      connectedDataInterests,
      draftSummaries,
      isFirstThreadPostOnboarding,
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
  // paint it (no delay, no dwell time required). Runs in an effect so we
  // never touch another store during render.
  useEffect(() => {
    if (presentation.emptyStateCase !== "A") return;
    if (welcomeGreetingConsumed) return;
    markWelcomeGreetingConsumed();
  }, [presentation.emptyStateCase, welcomeGreetingConsumed, markWelcomeGreetingConsumed]);

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
      dataset.kind === "dataset" ? `@dataset:${dataset.slug}` : `@provider:${dataset.slug}`;
    const currentDraft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    const currentPrompt = currentDraft?.prompt ?? "";
    const separator = currentPrompt.length === 0 || /\s$/.test(currentPrompt) ? "" : " ";
    const nextPrompt = `${currentPrompt}${separator}${mention} `;
    setPrompt(threadId, nextPrompt);
    requestComposerFocus({ threadId, seedPrompt: nextPrompt });
  };

  const handleModeSelect = (mode: PaperWorkflowMode | null) => {
    if (mode !== selectedPaperMode) {
      clearAgentIntakeContext(threadId);
    }
    setPaperWorkflowMode(threadId, mode);
    requestComposerFocus({ threadId });
  };

  const seedPrompt = (seed: string) => {
    const text = seed.trim();
    if (text.length === 0) {
      requestComposerFocus({ threadId });
      return;
    }
    setPrompt(threadId, text);
    requestComposerFocus({ threadId, seedPrompt: text });
  };

  const submitPrompt = (seed: string) => {
    const text = seed.trim();
    if (text.length === 0) {
      requestComposerFocus({ threadId });
      return;
    }
    setPrompt(threadId, text);
    requestComposerFocus({ threadId, seedPrompt: text });
    requestComposerSubmit({ threadId });
  };

  const importFiles = async (paths: string[]): Promise<ChatFileAttachment[]> => {
    const uniquePaths = Array.from(new Set(paths.filter((path) => path.trim().length > 0)));
    if (uniquePaths.length === 0) return [];
    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "File import is only available in the desktop app.",
      });
      return [];
    }
    try {
      const result = await api.attachments.importFiles({ threadId, paths: uniquePaths });
      const imported = result.attachments.filter((attachment) => attachment.type === "file");
      if (imported.length > 0) {
        addFiles(threadId, imported);
        requestComposerFocus({ threadId });
      }
      return imported;
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not attach files",
        description: error instanceof Error ? error.message : "Import failed.",
      });
      return [];
    }
  };

  const pickFiles = async (): Promise<ChatFileAttachment[]> => {
    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "File picking is only available in the desktop app.",
      });
      return [];
    }
    try {
      const paths = await api.dialogs.pickFiles();
      return await importFiles(paths);
    } catch {
      toastManager.add({ type: "error", title: "Failed to open the file picker." });
      return [];
    }
  };

  const pickFolder = async (): Promise<string | null> => {
    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Folder picking is only available in the desktop app.",
      });
      return null;
    }
    try {
      const path = await api.dialogs.pickFolder();
      return path || null;
    } catch {
      toastManager.add({ type: "error", title: "Failed to open the folder picker." });
      return null;
    }
  };

  const importDroppedFiles = async (files: File[]): Promise<ChatFileAttachment[]> => {
    if (files.length === 0) return [];
    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Drop import is only available in the desktop app.",
      });
      return [];
    }
    try {
      const paths = await api.dialogs.getFilePaths(files);
      return await importFiles(paths);
    } catch {
      toastManager.add({ type: "error", title: "Could not read dropped files." });
      return [];
    }
  };

  if (isDraftThread && draftThreadKind === "agent") {
    if (isSpecialistAgentMode(selectedPaperMode)) {
      return (
        <AgentWorkflowStartSurface
          threadId={threadId}
          mode={selectedPaperMode}
          onSeedPrompt={seedPrompt}
          onSubmitPrompt={submitPrompt}
          onPickFiles={pickFiles}
          onPickFolder={pickFolder}
          onImportDroppedFiles={importDroppedFiles}
          onBrowseDatasets={() => void navigate({ to: "/datasets" })}
          onBackToAgentPicker={() => {
            setPaperWorkflowMode(threadId, null);
            clearAgentIntakeContext(threadId);
            requestComposerFocus({ threadId });
          }}
        />
      );
    }
    return (
      <NewAgentModePicker
        selectedMode={selectedPaperMode}
        onSelectMode={handleModeSelect}
        onSkip={() => {
          setPaperWorkflowMode(threadId, null);
          clearAgentIntakeContext(threadId);
          requestComposerFocus({ threadId });
        }}
      />
    );
  }

  if (isDraftThread) {
    return <NewPaperDraftEmptyState />;
  }

  if (presentation.emptyStateCase === "D") {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="mx-auto w-full max-w-[680px]">
          <h1 className="font-display text-[2rem] leading-[1.12] text-ink sm:text-[2.25rem]">
            {greeting.title}
          </h1>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-light">{CASE_D_MESSAGE}</p>
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
              className="inline-flex items-center rounded-[4px] border border-ink bg-ink px-4 py-2 text-[0.8125rem] font-medium text-snow-white transition-colors duration-150 ease-linear hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
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

function NewPaperDraftEmptyState() {
  return (
    <div className="flex h-full w-full justify-center overflow-y-auto px-6 pb-16 pt-16 sm:pt-24">
      <div className="w-full max-w-[680px]">
        <header className="text-center">
          <h1 className="font-display text-[2.25rem] leading-[1.08] text-ink sm:text-[3rem]">
            Create a new paper end-to-end
          </h1>
          <p className="mx-auto mt-3 max-w-[520px] text-[0.9375rem] leading-relaxed text-ink-light">
            Describe the research question, dataset, or scientific idea you want to turn into a
            paper.
          </p>
        </header>
      </div>
    </div>
  );
}

interface AgentWorkflowStartSurfaceProps {
  threadId: ThreadId;
  mode: SpecialistAgentMode;
  onSeedPrompt: (seed: string) => void;
  onSubmitPrompt: (seed: string) => void;
  onPickFiles: () => Promise<ChatFileAttachment[]>;
  onPickFolder: () => Promise<string | null>;
  onImportDroppedFiles: (files: File[]) => Promise<ChatFileAttachment[]>;
  onBrowseDatasets: () => void;
  onBackToAgentPicker: () => void;
}

function AgentWorkflowStartSurface({
  threadId,
  mode,
  onSeedPrompt,
  onSubmitPrompt,
  onPickFiles,
  onPickFolder,
  onImportDroppedFiles,
  onBrowseDatasets,
  onBackToAgentPicker,
}: AgentWorkflowStartSurfaceProps) {
  const agent = AGENT_CONFIG_BY_MODE[mode];

  return (
    <div className="flex h-full w-full justify-center overflow-y-auto px-6 pb-40 pt-12 sm:px-10 sm:pb-44 sm:pt-16">
      <div className="w-full max-w-[820px]">
        <header className="relative">
          <button
            type="button"
            onClick={onBackToAgentPicker}
            className="group mb-6 inline-flex size-8 items-center justify-center rounded-[4px] border border-rule bg-snow-white text-ink-light transition-colors duration-150 hover:bg-snow-white-dark hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:absolute sm:-left-12 sm:top-0 sm:mb-0"
            aria-label="Back to all research agents"
            title="Back to all agents"
          >
            <ArrowLeftIcon
              aria-hidden="true"
              className="size-4 text-ink-faint transition-colors duration-150 group-hover:text-brand"
              strokeWidth={1.7}
            />
          </button>
          <div className="inline-flex items-center gap-2 text-[0.875rem] font-medium text-ink-light">
            <AgentGlyph agent={agent} className="size-4" />
            <span>{agent.name}</span>
          </div>
          <h1 className="mt-4 font-display text-[1.875rem] leading-[1.15] text-ink">
            {agent.title}
          </h1>
          <p className="mt-3 max-w-[560px] text-[1rem] leading-relaxed text-ink-light">
            {agent.lede}
          </p>
        </header>

        <div className="mt-10 border-y border-rule py-8">
          {mode === "literature-review" ? (
            <LiteratureReviewIntake
              agent={agent}
              threadId={threadId}
              onSeedPrompt={onSeedPrompt}
              onPickFiles={onPickFiles}
            />
          ) : mode === "experimental-design" ? (
            <ExperimentalDesignIntake
              agent={agent}
              threadId={threadId}
              onSeedPrompt={onSeedPrompt}
              onPickFiles={onPickFiles}
              onPickFolder={onPickFolder}
              onImportDroppedFiles={onImportDroppedFiles}
            />
          ) : mode === "data-analysis" ? (
            <DataAnalysisIntake
              agent={agent}
              threadId={threadId}
              onSeedPrompt={onSeedPrompt}
              onPickFiles={onPickFiles}
              onBrowseDatasets={onBrowseDatasets}
            />
          ) : (
            <GrantWritingIntake
              agent={agent}
              threadId={threadId}
              onSeedPrompt={onSeedPrompt}
              onPickFiles={onPickFiles}
            />
          )}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button
            size="sm"
            className="rounded-[4px] hover:bg-ink/90"
            onClick={() => onSubmitPrompt(agent.startPrompt)}
          >
            <CheckIcon className="size-3.5" />
            {agent.startLabel}
          </Button>
          <p className="text-[0.875rem] text-ink-faint">
            or just describe it in the chat below
          </p>
        </div>
      </div>
    </div>
  );
}

function LiteratureReviewIntake({
  agent,
  threadId,
  onSeedPrompt,
  onPickFiles,
}: {
  agent: AgentConfig;
  threadId: ThreadId;
  onSeedPrompt: (seed: string) => void;
  onPickFiles: () => Promise<ChatFileAttachment[]>;
}) {
  const [sources, setSources] = useState("");
  const normalizedSources = sources.trim();
  const upsertIntakeEntry = useAgentIntakeStore((store) => store.upsertEntry);
  const block = agent.sourceBlock.kind === "paste" ? agent.sourceBlock : null;

  useEffect(() => {
    upsertIntakeEntry(threadId, "literature-review", {
      id: "sources",
      label: "Seed papers and sources",
      value: sources,
    });
  }, [sources, threadId, upsertIntakeEntry]);

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[0.9375rem] font-medium text-ink">
          {block?.fieldHead ?? "Papers you already have"}
        </h2>
        <p className="text-right text-[0.8125rem] text-ink-faint">
          {block?.hint ?? "PMIDs, DOIs, URLs, or citations"}
        </p>
      </div>
      <textarea
        value={sources}
        onChange={(event) => setSources(event.target.value)}
        rows={5}
        placeholder={block?.placeholder}
        className="mt-3 min-h-[104px] w-full resize-y rounded-[4px] border border-rule bg-snow-white px-5 py-4 font-mono text-[0.9375rem] leading-relaxed text-ink outline-none transition-colors duration-150 placeholder:text-ink-faint focus:border-brand"
      />
      <AgentActionRow
        actions={[
          {
            label: "Search databases",
            icon: SearchIcon,
            onClick: () => {
              if (normalizedSources.length > 0) {
                onSeedPrompt(
                  "Search the literature databases using the seed sources already listed above.",
                );
                return;
              }
              onSeedPrompt("Search the literature databases for this topic: ");
            },
          },
          {
            label: "Upload PDFs",
            icon: FileUpIcon,
            onClick: async () => {
              await onPickFiles();
            },
          },
          {
            label: "Import .bib / .ris",
            icon: FileTextIcon,
            onClick: async () => {
              await onPickFiles();
            },
          },
        ]}
      />
    </div>
  );
}

function ExperimentalDesignIntake({
  agent,
  threadId,
  onSeedPrompt,
  onPickFiles,
  onPickFolder,
  onImportDroppedFiles,
}: {
  agent: AgentConfig;
  threadId: ThreadId;
  onSeedPrompt: (seed: string) => void;
  onPickFiles: () => Promise<ChatFileAttachment[]>;
  onPickFolder: () => Promise<string | null>;
  onImportDroppedFiles: (files: File[]) => Promise<ChatFileAttachment[]>;
}) {
  const [dragActive, setDragActive] = useState(false);
  const upsertIntakeEntry = useAgentIntakeStore((store) => store.upsertEntry);
  const block = agent.sourceBlock.kind === "dropzone" ? agent.sourceBlock : null;

  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          await onPickFiles();
        }}
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragActive(false);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragActive(false);
          void onImportDroppedFiles(Array.from(event.dataTransfer.files));
        }}
        className={cn(
          "flex min-h-[156px] w-full flex-col items-center justify-center rounded-[4px] border border-dashed bg-snow-white px-8 py-8 text-center transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
          dragActive ? "border-ink-faint" : "border-rule hover:border-ink-faint",
        )}
      >
        <FolderOpenIcon className="size-8 text-ink-faint" strokeWidth={1.6} />
        <span className="mt-4 text-[0.9375rem] font-medium text-ink">
          {block?.dropTitle ?? "Drop existing work here"}
        </span>
        <span className="mt-2 max-w-[460px] text-[0.875rem] leading-relaxed text-ink-light">
          {block?.dropSub ??
            "Proposals, drafts, protocols, pilot data, or related papers. Or click to browse."}
        </span>
      </button>
      <AgentActionRow
        actions={[
          {
            label: "Connect a folder",
            icon: FolderOpenIcon,
            onClick: async () => {
              const folderPath = await onPickFolder();
              if (!folderPath) return;
              upsertIntakeEntry(threadId, "experimental-design", {
                id: "folder",
                label: "Connected work folder",
                value: folderPath,
              });
            },
          },
          {
            label: "Paste a draft",
            icon: ClipboardIcon,
            onClick: () => onSeedPrompt("Here is the draft or protocol I want you to build from:\n"),
          },
          {
            label: "Use a template",
            icon: FileTextIcon,
            onClick: () => onSeedPrompt("Design this experiment using a preregistration-ready template: "),
          },
        ]}
      />
    </div>
  );
}

function DataAnalysisIntake({
  agent,
  threadId,
  onSeedPrompt,
  onPickFiles,
  onBrowseDatasets,
}: {
  agent: AgentConfig;
  threadId: ThreadId;
  onSeedPrompt: (seed: string) => void;
  onPickFiles: () => Promise<ChatFileAttachment[]>;
  onBrowseDatasets: () => void;
}) {
  const [dataset, setDataset] = useState("");
  const [datasetItems, setDatasetItems] = useState<string[]>([]);
  const normalizedDataset = dataset.trim();
  const upsertIntakeEntry = useAgentIntakeStore((store) => store.upsertEntry);
  const block = agent.sourceBlock.kind === "searchPick" ? agent.sourceBlock : null;
  const recentDatasets = block?.picks.chips ?? ["NHANES 2017-2018", "MIMIC-IV", "pilot_data.csv"];

  useEffect(() => {
    const values = [...datasetItems, dataset].map((entry) => entry.trim()).filter(Boolean);
    upsertIntakeEntry(threadId, "data-analysis", {
      id: "dataset",
      label: "Datasets or data sources",
      value: values.join("\n"),
    });
  }, [dataset, datasetItems, threadId, upsertIntakeEntry]);

  const addDatasetItem = (value: string) => {
    const normalized = value.trim();
    if (normalized.length === 0) return;
    setDatasetItems((items) =>
      items.some((item) => item.toLowerCase() === normalized.toLowerCase())
        ? items
        : [...items, normalized],
    );
    setDataset("");
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[0.9375rem] font-medium text-ink">
          {block?.fieldHead ?? "Your dataset"}
        </h2>
        <button
          type="button"
          onClick={onBrowseDatasets}
          className="text-[0.875rem] text-ink-light transition-colors hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {block?.browseLink ?? "Browse registry"}
        </button>
      </div>
      <div className="mt-3 flex h-11 items-center rounded-[4px] border border-rule bg-snow-white pl-4 transition-colors duration-150 focus-within:border-brand">
        <DatabaseIcon className="mr-3 size-4 shrink-0 text-ink-faint" strokeWidth={1.6} />
        <input
          type="text"
          value={dataset}
          onChange={(event) => setDataset(event.target.value)}
          placeholder={block?.placeholder ?? "Search saved datasets, paste a URL, or name a local file"}
          className="min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink outline-none placeholder:text-ink-faint"
        />
        <button
          type="button"
          disabled={normalizedDataset.length === 0}
          onClick={() => addDatasetItem(normalizedDataset)}
          className="h-full border-l border-rule px-5 text-[0.8125rem] font-medium text-ink transition-colors duration-150 hover:bg-snow-white-dark disabled:pointer-events-none disabled:opacity-45"
        >
          {block?.addLabel ?? "Add"}
        </button>
      </div>
      {datasetItems.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {datasetItems.map((entry) => (
            <span
              key={entry}
              className="inline-flex items-center gap-1.5 rounded-[4px] border border-rule bg-background px-3 py-1.5 text-[0.8125rem] font-medium text-ink"
            >
              <DatabaseIcon className="size-3.5 text-ink-faint" strokeWidth={1.6} />
              {entry}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[0.8125rem] text-ink-faint">{block?.picks.label ?? "Recent"}</span>
        {recentDatasets.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => addDatasetItem(entry)}
            className="inline-flex items-center gap-1.5 rounded-[4px] border border-rule bg-background px-3 py-1.5 text-[0.8125rem] font-medium text-ink transition-colors hover:bg-snow-white-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <DatabaseIcon className="size-3.5 text-ink-faint" strokeWidth={1.6} />
            {entry}
          </button>
        ))}
      </div>
      <AgentActionRow
        actions={[
          {
            label: "Bring in code",
            icon: Code2Icon,
            onClick: async () => {
              await onPickFiles();
            },
          },
          {
            label: "Connect a database",
            icon: DatabaseIcon,
            onClick: () => onSeedPrompt("Connect to this database or endpoint for analysis:\n"),
          },
          {
            label: "Browse the registry",
            icon: SearchIcon,
            onClick: onBrowseDatasets,
          },
        ]}
      />
    </div>
  );
}

function GrantWritingIntake({
  agent,
  threadId,
  onSeedPrompt,
  onPickFiles,
}: {
  agent: AgentConfig;
  threadId: ThreadId;
  onSeedPrompt: (seed: string) => void;
  onPickFiles: () => Promise<ChatFileAttachment[]>;
}) {
  const [target, setTarget] = useState("");
  const normalizedTarget = target.trim();
  const upsertIntakeEntry = useAgentIntakeStore((store) => store.upsertEntry);
  const block = agent.sourceBlock.kind === "searchPick" ? agent.sourceBlock : null;
  const commonTargets = block?.picks.chips ?? ["NIH R01", "NIH R21", "NSF CAREER", "Sloan"];

  useEffect(() => {
    upsertIntakeEntry(threadId, "grant-writing", {
      id: "funding-target",
      label: "Funding target",
      value: target,
    });
  }, [target, threadId, upsertIntakeEntry]);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[0.9375rem] font-medium text-ink">
          {block?.fieldHead ?? "Funding target"}
        </h2>
        <button
          type="button"
          onClick={() => onSeedPrompt("Find relevant funding mechanisms for this project:\n")}
          className="text-[0.875rem] text-ink-light transition-colors hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {block?.browseLink ?? "Browse mechanisms"}
        </button>
      </div>
      <div className="mt-3 flex h-11 items-center rounded-[4px] border border-rule bg-snow-white pl-4 transition-colors duration-150 focus-within:border-brand">
        <LinkIcon className="mr-3 size-4 shrink-0 text-ink-faint" strokeWidth={1.6} />
        <input
          type="text"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          placeholder={block?.placeholder ?? "Search NIH/NSF mechanisms, paste an RFP URL, or name the call"}
          className="min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink outline-none placeholder:text-ink-faint"
        />
        <button
          type="button"
          disabled={normalizedTarget.length === 0}
          onClick={() => onSeedPrompt("Describe the project or aims for this funding target:\n")}
          className="h-full border-l border-rule px-5 text-[0.8125rem] font-medium text-ink transition-colors duration-150 hover:bg-snow-white-dark disabled:pointer-events-none disabled:opacity-45"
        >
          {block?.addLabel ?? "Add"}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[0.8125rem] text-ink-faint">{block?.picks.label ?? "Common"}</span>
        {commonTargets.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setTarget(entry)}
            className="rounded-[4px] border border-rule bg-background px-3 py-1.5 text-[0.8125rem] font-medium text-ink transition-colors hover:bg-snow-white-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {entry}
          </button>
        ))}
      </div>
      <AgentActionRow
        actions={[
          {
            label: "Bring in prior drafts",
            icon: BookOpenTextIcon,
            onClick: async () => {
              await onPickFiles();
            },
          },
          {
            label: "Attach preliminary data",
            icon: DatabaseIcon,
            onClick: async () => {
              await onPickFiles();
            },
          },
          {
            label: "Use a template",
            icon: FileTextIcon,
            onClick: () => onSeedPrompt("Use this grant template or mechanism structure:\n"),
          },
        ]}
      />
    </div>
  );
}

function AgentActionRow({
  actions,
}: {
  actions: ReadonlyArray<{
    label: string;
    icon: typeof SearchIcon;
    primary?: boolean;
    disabled?: boolean;
    onClick: () => void;
  }>;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[0.875rem]">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.label}
            type="button"
            disabled={action.disabled}
            onClick={action.onClick}
            className={cn(
              "group inline-flex items-center gap-2 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
              action.primary
                ? "font-medium text-ink hover:text-brand"
                : "text-ink-light hover:text-ink",
            )}
          >
            <Icon
              className="size-4 text-ink-faint transition-colors duration-150 group-hover:text-brand"
              strokeWidth={1.6}
            />
            {action.label}
          </button>
        );
      })}
    </div>
  );
}

function NewAgentModePicker({
  selectedMode,
  onSelectMode,
  onSkip,
}: {
  selectedMode: PaperWorkflowMode | null;
  onSelectMode: (mode: PaperWorkflowMode | null) => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex h-full w-full justify-center overflow-y-auto px-6 pb-48 pt-12 sm:px-10 sm:pb-52 sm:pt-20">
      <div className="w-full max-w-[820px]">
        <header>
          <h1 className="font-display text-[1.875rem] leading-[1.15] text-ink">
            Choose a research agent
          </h1>
          <p className="mt-3 max-w-[620px] text-[1rem] leading-relaxed text-ink-light">
            Pick the specialist agent for your research task, or keep it open-ended.
          </p>
        </header>

        <div className="mt-10 border-y border-rule">
          {AGENT_CONFIGS.map((agent) => {
            const selected = selectedMode === agent.id;
            return (
              <button
                key={agent.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelectMode(selected ? null : agent.id)}
                className={cn(
                  "group flex w-full items-center gap-5 border-b border-rule px-2 py-5 text-left transition-colors duration-150 ease-linear last:border-b-0 hover:bg-snow-white focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand",
                  selected && "bg-snow-white",
                )}
              >
                <AgentGlyph agent={agent} active={selected} className="size-5" />
                <span className="w-48 shrink-0 truncate text-[1rem] font-medium text-ink transition-colors duration-150 group-hover:text-brand">
                  {agent.name}
                </span>
                <span className="min-w-0 flex-1 text-[0.9375rem] text-ink-light">
                  {agent.chooserDesc}
                </span>
                <ArrowRightIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 -translate-x-1 text-ink-faint opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:text-brand group-hover:opacity-100"
                  strokeWidth={1.7}
                />
              </button>
            );
          })}
        </div>

        <div className="mt-7">
          <button
            type="button"
            onClick={onSkip}
            className="text-[0.875rem] text-ink-light transition-colors duration-150 ease-linear hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Skip and chat about anything else
          </button>
        </div>
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
      {subtext ? <p className="text-[0.8125rem] text-ink-light">{subtext}</p> : null}
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
      d.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
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
