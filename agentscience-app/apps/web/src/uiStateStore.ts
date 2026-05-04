import { Debouncer } from "@tanstack/react-pacer";
import { type ProjectId, type ThreadId } from "@agentscience/contracts";
import { create } from "zustand";
import {
  isPaperWorkflowMode,
  type PaperWorkflowMode,
} from "./paperWorkflowModes";

const PERSISTED_STATE_KEY = "agentscience:ui-state:v1";
const LEGACY_PERSISTED_STATE_KEYS = [
  "agentscience:renderer-state:v8",
  "agentscience:renderer-state:v7",
  "agentscience:renderer-state:v6",
  "agentscience:renderer-state:v5",
  "agentscience:renderer-state:v4",
  "agentscience:renderer-state:v3",
  "codething:renderer-state:v4",
  "codething:renderer-state:v3",
  "codething:renderer-state:v2",
  "codething:renderer-state:v1",
] as const;

interface PersistedUiState {
  expandedProjectFolderSlugs?: string[];
  projectOrderFolderSlugs?: string[];
  expandedProjectCwds?: string[];
  projectOrderCwds?: string[];
  paperWorkflowModeByThreadId?: Record<string, unknown>;
}

export interface UiProjectState {
  projectExpandedById: Record<string, boolean>;
  projectOrder: ProjectId[];
}

export interface UiThreadState {
  threadLastVisitedAtById: Record<string, string>;
  paperWorkflowModeByThreadId: Record<string, PaperWorkflowMode>;
}

export interface UiState extends UiProjectState, UiThreadState {}

export interface SyncProjectInput {
  id: ProjectId;
  folderSlug: string;
}

export interface SyncThreadInput {
  id: ThreadId;
  seedVisitedAt?: string | undefined;
}

const initialState: UiState = {
  projectExpandedById: {},
  projectOrder: [],
  threadLastVisitedAtById: {},
  paperWorkflowModeByThreadId: {},
};

const persistedExpandedProjectFolderSlugs = new Set<string>();
const persistedProjectOrderFolderSlugs: string[] = [];
const currentProjectFolderSlugById = new Map<ProjectId, string>();
let legacyKeysCleanedUp = false;

function readPersistedState(): UiState {
  if (typeof window === "undefined") {
    return initialState;
  }
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) {
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        const legacyRaw = window.localStorage.getItem(legacyKey);
        if (!legacyRaw) {
          continue;
        }
        const parsed = JSON.parse(legacyRaw) as PersistedUiState;
        hydratePersistedProjectState(parsed);
        return {
          ...initialState,
          paperWorkflowModeByThreadId: hydratePaperWorkflowModes(parsed),
        };
      }
      return initialState;
    }
    const parsed = JSON.parse(raw) as PersistedUiState;
    hydratePersistedProjectState(parsed);
    return {
      ...initialState,
      paperWorkflowModeByThreadId: hydratePaperWorkflowModes(parsed),
    };
  } catch {
    return initialState;
  }
}

function hydratePersistedProjectState(parsed: PersistedUiState): void {
  persistedExpandedProjectFolderSlugs.clear();
  persistedProjectOrderFolderSlugs.length = 0;
  for (const folderSlug of parsed.expandedProjectFolderSlugs ?? parsed.expandedProjectCwds ?? []) {
    if (typeof folderSlug === "string" && folderSlug.length > 0) {
      persistedExpandedProjectFolderSlugs.add(folderSlug);
    }
  }
  for (const folderSlug of parsed.projectOrderFolderSlugs ?? parsed.projectOrderCwds ?? []) {
    if (
      typeof folderSlug === "string" &&
      folderSlug.length > 0 &&
      !persistedProjectOrderFolderSlugs.includes(folderSlug)
    ) {
      persistedProjectOrderFolderSlugs.push(folderSlug);
    }
  }
}

function hydratePaperWorkflowModes(
  parsed: PersistedUiState,
): Record<string, PaperWorkflowMode> {
  const result: Record<string, PaperWorkflowMode> = {};
  for (const [threadId, mode] of Object.entries(parsed.paperWorkflowModeByThreadId ?? {})) {
    if (threadId.length > 0 && isPaperWorkflowMode(mode)) {
      result[threadId] = mode;
    }
  }
  return result;
}

function persistState(state: UiState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const expandedProjectFolderSlugs = Object.entries(state.projectExpandedById)
      .filter(([, expanded]) => expanded)
      .flatMap(([projectId]) => {
        const folderSlug = currentProjectFolderSlugById.get(projectId as ProjectId);
        return folderSlug ? [folderSlug] : [];
      });
    const projectOrderFolderSlugs = state.projectOrder.flatMap((projectId) => {
      const folderSlug = currentProjectFolderSlugById.get(projectId);
      return folderSlug ? [folderSlug] : [];
    });
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        expandedProjectFolderSlugs,
        projectOrderFolderSlugs,
        paperWorkflowModeByThreadId: state.paperWorkflowModeByThreadId,
      } satisfies PersistedUiState),
    );
    if (!legacyKeysCleanedUp) {
      legacyKeysCleanedUp = true;
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        window.localStorage.removeItem(legacyKey);
      }
    }
  } catch {
    // Ignore quota/storage errors to avoid breaking chat UX.
  }
}

const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

function recordsEqual<T>(left: Record<string, T>, right: Record<string, T>): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (const [key, value] of leftEntries) {
    if (right[key] !== value) {
      return false;
    }
  }
  return true;
}

function projectOrdersEqual(left: readonly ProjectId[], right: readonly ProjectId[]): boolean {
  return (
    left.length === right.length && left.every((projectId, index) => projectId === right[index])
  );
}

export function syncProjects(state: UiState, projects: readonly SyncProjectInput[]): UiState {
  const previousProjectFolderSlugById = new Map(currentProjectFolderSlugById);
  const previousProjectIdByFolderSlug = new Map(
    [...previousProjectFolderSlugById.entries()].map(([projectId, folderSlug]) => [
      folderSlug,
      projectId,
    ] as const),
  );
  currentProjectFolderSlugById.clear();
  for (const project of projects) {
    currentProjectFolderSlugById.set(project.id, project.folderSlug);
  }
  const folderSlugMappingChanged =
    previousProjectFolderSlugById.size !== currentProjectFolderSlugById.size ||
    projects.some(
      (project) => previousProjectFolderSlugById.get(project.id) !== project.folderSlug,
    );

  const nextExpandedById: Record<string, boolean> = {};
  const previousExpandedById = state.projectExpandedById;
  const persistedOrderByFolderSlug = new Map(
    persistedProjectOrderFolderSlugs.map((folderSlug, index) => [folderSlug, index] as const),
  );
  const mappedProjects = projects.map((project, index) => {
    const previousProjectIdForFolderSlug = previousProjectIdByFolderSlug.get(project.folderSlug);
    const expanded =
      previousExpandedById[project.id] ??
      (previousProjectIdForFolderSlug
        ? previousExpandedById[previousProjectIdForFolderSlug]
        : undefined) ??
      (persistedExpandedProjectFolderSlugs.size > 0
        ? persistedExpandedProjectFolderSlugs.has(project.folderSlug)
        : true);
    nextExpandedById[project.id] = expanded;
    return {
      id: project.id,
      folderSlug: project.folderSlug,
      incomingIndex: index,
    };
  });

  const nextProjectOrder =
    state.projectOrder.length > 0
      ? (() => {
          const nextProjectIdByFolderSlug = new Map(
            mappedProjects.map((project) => [project.folderSlug, project.id] as const),
          );
          const usedProjectIds = new Set<ProjectId>();
          const orderedProjectIds: ProjectId[] = [];

          for (const projectId of state.projectOrder) {
            const matchedProjectId =
              (projectId in nextExpandedById ? projectId : undefined) ??
              (() => {
                const previousFolderSlug = previousProjectFolderSlugById.get(projectId);
                return previousFolderSlug
                  ? nextProjectIdByFolderSlug.get(previousFolderSlug)
                  : undefined;
              })();
            if (!matchedProjectId || usedProjectIds.has(matchedProjectId)) {
              continue;
            }
            usedProjectIds.add(matchedProjectId);
            orderedProjectIds.push(matchedProjectId);
          }

          for (const project of mappedProjects) {
            if (usedProjectIds.has(project.id)) {
              continue;
            }
            orderedProjectIds.push(project.id);
          }

          return orderedProjectIds;
        })()
      : mappedProjects
          .map((project) => ({
            id: project.id,
            incomingIndex: project.incomingIndex,
            orderIndex:
              persistedOrderByFolderSlug.get(project.folderSlug) ??
              persistedProjectOrderFolderSlugs.length + project.incomingIndex,
          }))
          .toSorted((left, right) => {
            const byOrder = left.orderIndex - right.orderIndex;
            if (byOrder !== 0) {
              return byOrder;
            }
            return left.incomingIndex - right.incomingIndex;
          })
          .map((project) => project.id);

  if (
    recordsEqual(state.projectExpandedById, nextExpandedById) &&
    projectOrdersEqual(state.projectOrder, nextProjectOrder) &&
    !folderSlugMappingChanged
  ) {
    return state;
  }

  return {
    ...state,
    projectExpandedById: nextExpandedById,
    projectOrder: nextProjectOrder,
  };
}

export function syncThreads(state: UiState, threads: readonly SyncThreadInput[]): UiState {
  const retainedThreadIds = new Set(threads.map((thread) => thread.id));
  const nextThreadLastVisitedAtById = Object.fromEntries(
    Object.entries(state.threadLastVisitedAtById).filter(([threadId]) =>
      retainedThreadIds.has(threadId as ThreadId),
    ),
  );
  for (const thread of threads) {
    if (
      nextThreadLastVisitedAtById[thread.id] === undefined &&
      thread.seedVisitedAt !== undefined &&
      thread.seedVisitedAt.length > 0
    ) {
      nextThreadLastVisitedAtById[thread.id] = thread.seedVisitedAt;
    }
  }
  const threadVisitsEqual = recordsEqual(
    state.threadLastVisitedAtById,
    nextThreadLastVisitedAtById,
  );
  if (threadVisitsEqual) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
  };
}

export function markThreadVisited(state: UiState, threadId: ThreadId, visitedAt?: string): UiState {
  const at = visitedAt ?? new Date().toISOString();
  const visitedAtMs = Date.parse(at);
  const previousVisitedAt = state.threadLastVisitedAtById[threadId];
  const previousVisitedAtMs = previousVisitedAt ? Date.parse(previousVisitedAt) : NaN;
  if (
    Number.isFinite(previousVisitedAtMs) &&
    Number.isFinite(visitedAtMs) &&
    previousVisitedAtMs >= visitedAtMs
  ) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: at,
    },
  };
}

export function markThreadUnread(
  state: UiState,
  threadId: ThreadId,
  latestTurnCompletedAt: string | null | undefined,
): UiState {
  if (!latestTurnCompletedAt) {
    return state;
  }
  const latestTurnCompletedAtMs = Date.parse(latestTurnCompletedAt);
  if (Number.isNaN(latestTurnCompletedAtMs)) {
    return state;
  }
  const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
  if (state.threadLastVisitedAtById[threadId] === unreadVisitedAt) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: unreadVisitedAt,
    },
  };
}

export function clearThreadUi(state: UiState, threadId: ThreadId): UiState {
  if (
    !(threadId in state.threadLastVisitedAtById) &&
    !(threadId in state.paperWorkflowModeByThreadId)
  ) {
    return state;
  }
  const nextThreadLastVisitedAtById = { ...state.threadLastVisitedAtById };
  delete nextThreadLastVisitedAtById[threadId];
  const nextPaperWorkflowModeByThreadId = { ...state.paperWorkflowModeByThreadId };
  delete nextPaperWorkflowModeByThreadId[threadId];
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
    paperWorkflowModeByThreadId: nextPaperWorkflowModeByThreadId,
  };
}

export function setPaperWorkflowMode(
  state: UiState,
  threadId: ThreadId,
  mode: PaperWorkflowMode | null,
): UiState {
  const current = state.paperWorkflowModeByThreadId[threadId] ?? null;
  if (current === mode) {
    return state;
  }
  const nextPaperWorkflowModeByThreadId = { ...state.paperWorkflowModeByThreadId };
  if (mode === null) {
    delete nextPaperWorkflowModeByThreadId[threadId];
  } else {
    nextPaperWorkflowModeByThreadId[threadId] = mode;
  }
  return {
    ...state,
    paperWorkflowModeByThreadId: nextPaperWorkflowModeByThreadId,
  };
}

export function toggleProject(state: UiState, projectId: ProjectId): UiState {
  const expanded = state.projectExpandedById[projectId] ?? true;
  return {
    ...state,
    projectExpandedById: {
      ...state.projectExpandedById,
      [projectId]: !expanded,
    },
  };
}

export function setProjectExpanded(
  state: UiState,
  projectId: ProjectId,
  expanded: boolean,
): UiState {
  if ((state.projectExpandedById[projectId] ?? true) === expanded) {
    return state;
  }
  return {
    ...state,
    projectExpandedById: {
      ...state.projectExpandedById,
      [projectId]: expanded,
    },
  };
}

export function reorderProjects(
  state: UiState,
  draggedProjectId: ProjectId,
  targetProjectId: ProjectId,
): UiState {
  if (draggedProjectId === targetProjectId) {
    return state;
  }
  const draggedIndex = state.projectOrder.findIndex((projectId) => projectId === draggedProjectId);
  const targetIndex = state.projectOrder.findIndex((projectId) => projectId === targetProjectId);
  if (draggedIndex < 0 || targetIndex < 0) {
    return state;
  }
  const projectOrder = [...state.projectOrder];
  const [draggedProject] = projectOrder.splice(draggedIndex, 1);
  if (!draggedProject) {
    return state;
  }
  projectOrder.splice(targetIndex, 0, draggedProject);
  return {
    ...state,
    projectOrder,
  };
}

interface UiStateStore extends UiState {
  syncProjects: (projects: readonly SyncProjectInput[]) => void;
  syncThreads: (threads: readonly SyncThreadInput[]) => void;
  markThreadVisited: (threadId: ThreadId, visitedAt?: string) => void;
  markThreadUnread: (threadId: ThreadId, latestTurnCompletedAt: string | null | undefined) => void;
  clearThreadUi: (threadId: ThreadId) => void;
  setPaperWorkflowMode: (threadId: ThreadId, mode: PaperWorkflowMode | null) => void;
  toggleProject: (projectId: ProjectId) => void;
  setProjectExpanded: (projectId: ProjectId, expanded: boolean) => void;
  reorderProjects: (draggedProjectId: ProjectId, targetProjectId: ProjectId) => void;
}

export const useUiStateStore = create<UiStateStore>((set) => ({
  ...readPersistedState(),
  syncProjects: (projects) => set((state) => syncProjects(state, projects)),
  syncThreads: (threads) => set((state) => syncThreads(state, threads)),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId, latestTurnCompletedAt) =>
    set((state) => markThreadUnread(state, threadId, latestTurnCompletedAt)),
  clearThreadUi: (threadId) => set((state) => clearThreadUi(state, threadId)),
  setPaperWorkflowMode: (threadId, mode) =>
    set((state) => setPaperWorkflowMode(state, threadId, mode)),
  toggleProject: (projectId) => set((state) => toggleProject(state, projectId)),
  setProjectExpanded: (projectId, expanded) =>
    set((state) => setProjectExpanded(state, projectId, expanded)),
  reorderProjects: (draggedProjectId, targetProjectId) =>
    set((state) => reorderProjects(state, draggedProjectId, targetProjectId)),
}));

useUiStateStore.subscribe((state) => debouncedPersistState.maybeExecute(state));

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistState.flush();
  });
}
