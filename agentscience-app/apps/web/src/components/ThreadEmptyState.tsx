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
  BookOpenTextIcon,
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
import { AGENT_WORKFLOW_MODES, type PaperWorkflowMode } from "../paperWorkflowModes";
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
    if (
      selectedPaperMode === "literature-review" ||
      selectedPaperMode === "experimental-design" ||
      selectedPaperMode === "data-analysis" ||
      selectedPaperMode === "grant-writing"
    ) {
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
        />
      );
    }
    return (
      <NewAgentModePicker
        selectedMode={selectedPaperMode}
        onSelectMode={handleModeSelect}
        onSkip={() => {
          setPaperWorkflowMode(threadId, null);
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
  mode: Exclude<PaperWorkflowMode, "general-agent" | "open">;
  onSeedPrompt: (seed: string) => void;
  onSubmitPrompt: (seed: string) => void;
  onPickFiles: () => Promise<ChatFileAttachment[]>;
  onPickFolder: () => Promise<string | null>;
  onImportDroppedFiles: (files: File[]) => Promise<ChatFileAttachment[]>;
  onBrowseDatasets: () => void;
}

const AGENT_START_COPY: Record<
  AgentWorkflowStartSurfaceProps["mode"],
  {
    title: string;
    subtitle: string;
    composerHint: string;
    startLabel: string;
    startPrompt: string;
  }
> = {
  "literature-review": {
    title: "Survey what's known",
    subtitle: "Start from papers you already trust, then ask the agent to map the field.",
    composerHint: "Describe what you want reviewed",
    startLabel: "Start review",
    startPrompt: "Start the literature review using the intake context and attached files.",
  },
  "experimental-design": {
    title: "Design the experiment",
    subtitle: "Point the agent at prior work, protocols, and constraints before it designs.",
    composerHint: "Describe the question you want to test",
    startLabel: "Start design",
    startPrompt: "Design the experiment using the intake context and attached files.",
  },
  "data-analysis": {
    title: "Analyze your data",
    subtitle: "Connect a dataset, code, or prior analysis so the agent starts from evidence.",
    composerHint: "Describe what you want to find in the data",
    startLabel: "Start analysis",
    startPrompt: "Analyze the data using the intake context and attached files.",
  },
  "grant-writing": {
    title: "Write the grant",
    subtitle: "Start with the call or mechanism so aims, page limits, and review criteria line up.",
    composerHint: "Describe what you're applying for",
    startLabel: "Start grant",
    startPrompt: "Write the grant using the intake context and attached files.",
  },
};

function AgentWorkflowStartSurface({
  threadId,
  mode,
  onSeedPrompt,
  onSubmitPrompt,
  onPickFiles,
  onPickFolder,
  onImportDroppedFiles,
  onBrowseDatasets,
}: AgentWorkflowStartSurfaceProps) {
  const modeOption = AGENT_WORKFLOW_MODES.find((entry) => entry.id === mode);
  const copy = AGENT_START_COPY[mode];

  return (
    <div className="flex h-full w-full justify-center overflow-y-auto px-6 pb-40 pt-10 sm:pb-44 sm:pt-14">
      <div className="w-full max-w-[720px]">
        <header className="text-center">
          <div className="flex items-center justify-center gap-2 text-[0.8125rem] font-medium text-ink-light">
            <span
              aria-hidden
              className={cn("size-2 shrink-0 rounded-full", modeOption?.dotClassName)}
            />
            <span>{modeOption?.label ?? copy.title}</span>
          </div>
          <h1 className="mt-5 font-display text-[2.25rem] leading-[1.08] text-ink sm:text-[3rem]">
            {copy.title}
          </h1>
          <p className="mx-auto mt-3 max-w-[600px] text-[0.9375rem] leading-relaxed text-ink-light">
            {copy.subtitle}
          </p>
        </header>

        <div className="mt-10 border-y border-rule py-5">
          {mode === "literature-review" ? (
            <LiteratureReviewIntake
              threadId={threadId}
              onSeedPrompt={onSeedPrompt}
              onPickFiles={onPickFiles}
            />
          ) : mode === "experimental-design" ? (
            <ExperimentalDesignIntake
              threadId={threadId}
              onSeedPrompt={onSeedPrompt}
              onPickFiles={onPickFiles}
              onPickFolder={onPickFolder}
              onImportDroppedFiles={onImportDroppedFiles}
            />
          ) : mode === "data-analysis" ? (
            <DataAnalysisIntake
              threadId={threadId}
              onSeedPrompt={onSeedPrompt}
              onPickFiles={onPickFiles}
              onBrowseDatasets={onBrowseDatasets}
            />
          ) : (
            <GrantWritingIntake
              threadId={threadId}
              onSeedPrompt={onSeedPrompt}
              onPickFiles={onPickFiles}
            />
          )}
        </div>

        <div className="mt-5 flex justify-center">
          <Button size="sm" onClick={() => onSubmitPrompt(copy.startPrompt)}>
            <CheckIcon className="size-3.5" />
            {copy.startLabel}
          </Button>
        </div>

        <p className="mt-5 text-center text-[0.8125rem] text-ink-faint">
          Or use the composer below to {copy.composerHint.toLowerCase()}.
        </p>
      </div>
    </div>
  );
}

function LiteratureReviewIntake({
  threadId,
  onSeedPrompt,
  onPickFiles,
}: {
  threadId: ThreadId;
  onSeedPrompt: (seed: string) => void;
  onPickFiles: () => Promise<ChatFileAttachment[]>;
}) {
  const [sources, setSources] = useState("");
  const normalizedSources = sources.trim();
  const upsertIntakeEntry = useAgentIntakeStore((store) => store.upsertEntry);

  useEffect(() => {
    upsertIntakeEntry(threadId, "literature-review", {
      id: "sources",
      label: "Seed papers and sources",
      value: sources,
    });
  }, [sources, threadId, upsertIntakeEntry]);

  return (
    <div className="mx-auto max-w-[640px]">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[0.9375rem] font-medium text-ink">Papers you already have</h2>
        <p className="text-[0.8125rem] text-ink-light">PMIDs, DOIs, URLs, or citations</p>
      </div>
      <textarea
        value={sources}
        onChange={(event) => setSources(event.target.value)}
        rows={5}
        placeholder={"32842672\n10.1038/s41586-023-06887-8\nhttps://pubmed.ncbi.nlm.nih.gov/35414745/"}
        className="mt-3 min-h-32 w-full resize-y rounded-[8px] border border-rule bg-card px-4 py-3 font-mono text-[0.875rem] leading-relaxed text-ink outline-none transition-colors duration-150 placeholder:text-ink-faint focus:border-ink"
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
  threadId,
  onSeedPrompt,
  onPickFiles,
  onPickFolder,
  onImportDroppedFiles,
}: {
  threadId: ThreadId;
  onSeedPrompt: (seed: string) => void;
  onPickFiles: () => Promise<ChatFileAttachment[]>;
  onPickFolder: () => Promise<string | null>;
  onImportDroppedFiles: (files: File[]) => Promise<ChatFileAttachment[]>;
}) {
  const [dragActive, setDragActive] = useState(false);
  const upsertIntakeEntry = useAgentIntakeStore((store) => store.upsertEntry);

  return (
    <div className="mx-auto max-w-[640px]">
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
          "flex min-h-44 w-full flex-col items-center justify-center rounded-[8px] border border-dashed px-8 py-8 text-center transition-colors duration-150",
          dragActive ? "border-ink bg-secondary" : "border-rule bg-card hover:bg-secondary/70",
        )}
      >
        <FolderOpenIcon className="size-8 text-ink-light" />
        <span className="mt-4 text-[0.9375rem] font-medium text-ink">
          Drop existing work here
        </span>
        <span className="mt-2 max-w-[460px] text-[0.875rem] leading-relaxed text-ink-light">
          Proposals, drafts, protocols, pilot data, related papers, or click to browse.
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
  threadId,
  onSeedPrompt,
  onPickFiles,
  onBrowseDatasets,
}: {
  threadId: ThreadId;
  onSeedPrompt: (seed: string) => void;
  onPickFiles: () => Promise<ChatFileAttachment[]>;
  onBrowseDatasets: () => void;
}) {
  const [dataset, setDataset] = useState("");
  const [datasetItems, setDatasetItems] = useState<string[]>([]);
  const normalizedDataset = dataset.trim();
  const recentDatasets = ["NHANES 2017-2018", "MIMIC-IV", "pilot_data.csv"];
  const upsertIntakeEntry = useAgentIntakeStore((store) => store.upsertEntry);

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
    <div className="mx-auto max-w-[640px]">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[0.9375rem] font-medium text-ink">Your dataset</h2>
        <button
          type="button"
          onClick={onBrowseDatasets}
          className="text-[0.8125rem] text-ink-light transition-colors hover:text-ink"
        >
          Browse registry
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-[8px] border border-rule bg-card px-3 py-2 focus-within:border-ink">
        <DatabaseIcon className="size-4 shrink-0 text-ink-light" />
        <input
          type="text"
          value={dataset}
          onChange={(event) => setDataset(event.target.value)}
          placeholder="Search saved datasets, paste a URL, or name a local file"
          className="min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink outline-none placeholder:text-ink-faint"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={normalizedDataset.length === 0}
          onClick={() => addDatasetItem(normalizedDataset)}
        >
          Add
        </Button>
      </div>
      {datasetItems.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {datasetItems.map((entry) => (
            <span
              key={entry}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-[3px] text-[0.8125rem] text-ink"
            >
              <DatabaseIcon className="size-3" />
              {entry}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[0.8125rem] text-ink-light">Recent</span>
        {recentDatasets.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => addDatasetItem(entry)}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-[3px] text-[0.8125rem] text-ink transition-colors hover:border-ink-faint"
          >
            <DatabaseIcon className="size-3" />
            {entry}
          </button>
        ))}
      </div>
      <AgentActionRow
        actions={[
          {
            label: "Bring in code",
            icon: FileTextIcon,
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
  threadId,
  onSeedPrompt,
  onPickFiles,
}: {
  threadId: ThreadId;
  onSeedPrompt: (seed: string) => void;
  onPickFiles: () => Promise<ChatFileAttachment[]>;
}) {
  const [target, setTarget] = useState("");
  const normalizedTarget = target.trim();
  const commonTargets = ["NIH R01", "NIH R21", "NSF CAREER", "Sloan"];
  const upsertIntakeEntry = useAgentIntakeStore((store) => store.upsertEntry);

  useEffect(() => {
    upsertIntakeEntry(threadId, "grant-writing", {
      id: "funding-target",
      label: "Funding target",
      value: target,
    });
  }, [target, threadId, upsertIntakeEntry]);

  return (
    <div className="mx-auto max-w-[640px]">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[0.9375rem] font-medium text-ink">Funding target</h2>
        <button
          type="button"
          onClick={() => onSeedPrompt("Find relevant funding mechanisms for this project:\n")}
          className="text-[0.8125rem] text-ink-light transition-colors hover:text-ink"
        >
          Browse mechanisms
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-[8px] border border-rule bg-card px-3 py-2 focus-within:border-ink">
        <LinkIcon className="size-4 shrink-0 text-ink-light" />
        <input
          type="text"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          placeholder="Search NIH/NSF mechanisms, paste RFP URL, or name the call"
          className="min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink outline-none placeholder:text-ink-faint"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={normalizedTarget.length === 0}
          onClick={() => onSeedPrompt("Describe the project or aims for this funding target:\n")}
        >
          Add
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[0.8125rem] text-ink-light">Common</span>
        {commonTargets.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setTarget(entry)}
            className="rounded-full border border-border bg-secondary px-2.5 py-[3px] text-[0.8125rem] text-ink transition-colors hover:border-ink-faint"
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
    <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[0.8125rem]">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.label}
            type="button"
            disabled={action.disabled}
            onClick={action.onClick}
            className={cn(
              "inline-flex items-center gap-1.5 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45",
              action.primary
                ? "font-medium text-ink hover:text-accent-color"
                : "text-ink-light hover:text-ink",
            )}
          >
            <Icon className="size-3.5" />
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
    <div className="flex h-full w-full justify-center overflow-y-auto px-6 pb-48 pt-14 sm:pb-52 sm:pt-20">
      <div className="w-full max-w-[680px]">
        <header className="text-center">
          <h1 className="font-display text-[2.25rem] leading-[1.08] text-ink sm:text-[3rem]">
            Choose a research agent
          </h1>
          <p className="mx-auto mt-3 max-w-[520px] text-[0.9375rem] leading-relaxed text-ink-light">
            Pick the specialist agent for your research task, or keep it open-ended.
          </p>
        </header>

        <div className="mt-10 grid gap-3 border-y border-rule py-4 sm:grid-cols-2">
          {AGENT_WORKFLOW_MODES.map((mode) => {
            const selected = selectedMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelectMode(selected ? null : mode.id)}
                className={cn(
                  "group flex min-h-28 flex-col items-start justify-start rounded-[8px] border border-rule bg-background px-4 py-4 text-left transition-colors duration-150 ease-linear",
                  "hover:border-ink-faint hover:bg-snow-white",
                  selected && "border-ink bg-snow-white",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className={cn("size-2.5 shrink-0 rounded-full", mode.dotClassName)}
                  />
                  <span className="truncate text-[0.9375rem] font-medium text-ink">
                    {mode.label}
                  </span>
                </span>
                <span className="mt-3 text-[0.875rem] leading-relaxed text-ink-light">
                  {mode.description}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={onSkip}
            className="inline-flex items-center rounded-[4px] border border-rule bg-background px-4 py-2 text-[0.8125rem] font-medium text-ink transition-colors duration-150 ease-linear hover:bg-snow-white-dark"
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
