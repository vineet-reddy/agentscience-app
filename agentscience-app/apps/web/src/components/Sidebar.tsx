import { type ProjectId, type ThreadId } from "@agentscience/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DatabaseIcon,
  FileTextIcon,
  FolderIcon,
  FolderPlusIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react";
import {
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BrandMark } from "./BrandMark";
import { useComposerDraftStore } from "../composerDraftStore";
import { isElectron } from "../env";
import { useDesktopFullScreen } from "../hooks/useDesktopFullScreen";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useSettings } from "../hooks/useSettings";
import { useThreadActions } from "../hooks/useThreadActions";
import { cn, isMacPlatform, newCommandId, newProjectId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { useUiStateStore } from "../uiStateStore";
import { nextWorkspaceSlug } from "../workspaceSlugs";
import {
  buildSidebarThreadEntries,
  type SidebarThreadEntryRecord,
  resolveThreadStatusPill,
  type ThreadStatusPill,
} from "./Sidebar.logic";
import { dispatchCommandAndSyncSnapshot } from "./Sidebar.rename";
import { toastManager } from "./ui/toast";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "./ui/sidebar";

type SidebarThreadEntry = SidebarThreadEntryRecord<ThreadId, ProjectId | null>;

interface EditingState {
  kind: "project" | "thread";
  id: string;
  value: string;
}

interface ThreadContextMenuState {
  threadId: ThreadId;
  x: number;
  y: number;
}

interface CreateProjectDialogState {
  open: boolean;
  name: string;
  creating: boolean;
}

function ThreadStatusDot({ status }: { status: ThreadStatusPill | null }) {
  if (!status) {
    return null;
  }

  return (
    <span
      aria-label={status.label}
      title={status.label}
      className={cn("mt-1 size-2 shrink-0 rounded-full", status.dotClass, status.pulse && "animate-pulse")}
    />
  );
}

function deriveDraftTitle(prompt: string | undefined): string {
  const firstMeaningfulLine = prompt
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstMeaningfulLine) {
    return "New Paper";
  }

  return firstMeaningfulLine.length > 56
    ? `${firstMeaningfulLine.slice(0, 53).trimEnd()}...`
    : firstMeaningfulLine;
}

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { handleNewThread, routeThreadId } = useHandleNewThread();
  const { archiveThread, confirmAndDeleteThread, movePaper } = useThreadActions();
  const projects = useStore((state) => state.projects);
  const sidebarThreadsById = useStore((state) => state.sidebarThreadsById);
  const threadIdsByProjectId = useStore((state) => state.threadIdsByProjectId);
  const syncServerReadModel = useStore((state) => state.syncServerReadModel);
  const draftThreadsByThreadId = useComposerDraftStore(
    (state) => state.draftThreadsByThreadId,
  );
  const draftsByThreadId = useComposerDraftStore(
    (state) => state.draftsByThreadId,
  );
  const projectExpandedById = useUiStateStore(
    (state) => state.projectExpandedById,
  );
  const projectOrder = useUiStateStore((state) => state.projectOrder);
  const threadLastVisitedAtById = useUiStateStore(
    (state) => state.threadLastVisitedAtById,
  );
  const setProjectExpanded = useUiStateStore(
    (state) => state.setProjectExpanded,
  );
  const settings = useSettings();
  const projectSortOrder = settings.sidebarProjectSortOrder;
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [contextMenu, setContextMenu] = useState<ThreadContextMenuState | null>(
    null,
  );
  const [createProjectDialog, setCreateProjectDialog] =
    useState<CreateProjectDialogState>({
      open: false,
      name: "",
      creating: false,
    });
  const [draggedThreadId, setDraggedThreadId] = useState<ThreadId | null>(null);
  const [dropProjectId, setDropProjectId] = useState<ProjectId | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const visibleThreadsById = useMemo(() => {
    const visibleThreads = Object.values(sidebarThreadsById).filter(
      (thread) => thread.archivedAt === null,
    );
    return new Map(
      visibleThreads.map((thread) => [thread.id, thread] as const),
    );
  }, [sidebarThreadsById]);

  const orderedProjects = useMemo(() => {
    if (projectSortOrder === "manual" && projectOrder.length > 0) {
      const projectsById = new Map(
        projects.map((project) => [project.id, project] as const),
      );
      const ordered = projectOrder
        .map((projectId) => projectsById.get(projectId))
        .filter(
          (project): project is NonNullable<typeof project> =>
            project !== undefined,
        );
      const remaining = projects.filter(
        (project) => !projectOrder.includes(project.id),
      );
      return [...ordered, ...remaining];
    }

    return [...projects].toSorted((left, right) => {
      const leftThreadIds = threadIdsByProjectId[left.id] ?? [];
      const rightThreadIds = threadIdsByProjectId[right.id] ?? [];

      const leftLatest = Math.max(
        Date.parse(left.updatedAt ?? left.createdAt ?? "") ||
          Number.NEGATIVE_INFINITY,
        ...leftThreadIds.map((threadId) => {
          const thread = visibleThreadsById.get(threadId);
          return (
            Date.parse(
              thread?.latestUserMessageAt ??
                thread?.updatedAt ??
                thread?.createdAt ??
                "",
            ) || Number.NEGATIVE_INFINITY
          );
        }),
      );
      const rightLatest = Math.max(
        Date.parse(right.updatedAt ?? right.createdAt ?? "") ||
          Number.NEGATIVE_INFINITY,
        ...rightThreadIds.map((threadId) => {
          const thread = visibleThreadsById.get(threadId);
          return (
            Date.parse(
              thread?.latestUserMessageAt ??
                thread?.updatedAt ??
                thread?.createdAt ??
                "",
            ) || Number.NEGATIVE_INFINITY
          );
        }),
      );

      if (rightLatest !== leftLatest) {
        return rightLatest - leftLatest;
      }

      return (
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
      );
    });
  }, [
    projectOrder,
    projectSortOrder,
    projects,
    threadIdsByProjectId,
    visibleThreadsById,
  ]);

  const threadEntriesByProjectId = useMemo(() => {
    return buildSidebarThreadEntries({
      visibleThreads: [...visibleThreadsById.values()],
      draftThreadsByThreadId,
      draftTitleByThreadId: Object.fromEntries(
        Object.entries(draftsByThreadId).map(([threadId, draft]) => [
          threadId,
          deriveDraftTitle(draft?.prompt),
        ]),
      ),
    }) as Map<ProjectId | null, SidebarThreadEntry[]>;
  }, [draftThreadsByThreadId, draftsByThreadId, visibleThreadsById]);
  const recentThreads = threadEntriesByProjectId.get(null) ?? [];

  const resolveStatusForThread = (threadId: ThreadId): ThreadStatusPill | null => {
    const thread = visibleThreadsById.get(threadId);
    if (!thread) {
      return null;
    }

    return resolveThreadStatusPill({
      thread: {
        ...thread,
        lastVisitedAt: threadLastVisitedAtById[threadId],
      },
    });
  };

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setContextMenu(null);
    };

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [contextMenu]);

  const commitProjectRename = async (
    projectId: ProjectId,
    originalName: string,
  ) => {
    const nextTitle =
      editing?.kind === "project" && editing.id === projectId
        ? editing.value.trim()
        : "";
    setEditing(null);
    if (!nextTitle || nextTitle === originalName) {
      return;
    }

    const api = readNativeApi();
    if (!api) {
      return;
    }

    try {
      await dispatchCommandAndSyncSnapshot(api, {
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId,
        title: nextTitle,
      }, syncServerReadModel);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to rename project",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const commitThreadRename = async (
    threadId: ThreadId,
    originalTitle: string,
  ) => {
    const nextTitle =
      editing?.kind === "thread" && editing.id === threadId
        ? editing.value.trim()
        : "";
    setEditing(null);
    setContextMenu(null);
    if (!nextTitle || nextTitle === originalTitle) {
      return;
    }

    const api = readNativeApi();
    if (!api) {
      return;
    }

    try {
      await dispatchCommandAndSyncSnapshot(api, {
        type: "thread.meta.update",
        commandId: newCommandId(),
        threadId,
        title: nextTitle,
      }, syncServerReadModel);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to rename paper",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const handleArchiveThread = async (threadId: ThreadId) => {
    setContextMenu(null);
    try {
      await archiveThread(threadId);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to archive paper",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const handleDeleteThread = async (threadId: ThreadId) => {
    setContextMenu(null);
    try {
      await confirmAndDeleteThread(threadId);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to delete paper",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const handleMovePaper = async (
    threadId: ThreadId,
    projectId: ProjectId | null,
  ) => {
    try {
      await movePaper(threadId, projectId);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to move paper",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const resetDragState = () => {
    setDraggedThreadId(null);
    setDropProjectId(null);
  };

  const handleThreadDragStart = (
    event: DragEvent<HTMLDivElement>,
    thread: SidebarThreadEntry,
  ) => {
    if (thread.isDraft) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", thread.id);
    setDraggedThreadId(thread.id);
  };

  const handleProjectDragOver = (
    event: DragEvent<HTMLDivElement>,
    projectId: ProjectId,
  ) => {
    if (!draggedThreadId) {
      return;
    }
    const draggedThread = visibleThreadsById.get(draggedThreadId);
    if (!draggedThread || draggedThread.projectId === projectId) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropProjectId !== projectId) {
      setDropProjectId(projectId);
    }
  };

  const handleProjectDrop = async (
    event: DragEvent<HTMLDivElement>,
    projectId: ProjectId,
  ) => {
    event.preventDefault();
    const nextThreadId = draggedThreadId;
    resetDragState();
    if (!nextThreadId) {
      return;
    }
    const draggedThread = visibleThreadsById.get(nextThreadId);
    if (!draggedThread || draggedThread.projectId === projectId) {
      return;
    }
    setProjectExpanded(projectId, true);
    await handleMovePaper(nextThreadId, projectId);
  };

  const handleEditingKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    input: { kind: "project" | "thread"; id: string; originalTitle: string },
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setEditing(null);
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    if (input.kind === "project") {
      void commitProjectRename(input.id as ProjectId, input.originalTitle);
      return;
    }
    void commitThreadRename(input.id as ThreadId, input.originalTitle);
  };

  const openCreateProjectDialog = () => {
    setCreateProjectDialog({
      open: true,
      name: "",
      creating: false,
    });
  };

  const submitCreateProject = async () => {
    const api = readNativeApi();
    if (!api) {
      return;
    }
    const title = createProjectDialog.name.trim();
    if (!title || createProjectDialog.creating) {
      return;
    }
    const folderSlug = nextWorkspaceSlug(
      title,
      projects.map((project) => project.folderSlug),
      "project",
    );
    setCreateProjectDialog((current) => ({ ...current, creating: true }));
    try {
      await api.orchestration.dispatchCommand({
        type: "project.create",
        commandId: newCommandId(),
        projectId: newProjectId(),
        title,
        folderSlug,
        createdAt: new Date().toISOString(),
      });
      setCreateProjectDialog({
        open: false,
        name: "",
        creating: false,
      });
    } catch (error) {
      setCreateProjectDialog((current) => ({ ...current, creating: false }));
      toastManager.add({
        type: "error",
        title: "Failed to create project",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };
  const contextThread = contextMenu
    ? visibleThreadsById.get(contextMenu.threadId)
    : undefined;
  const isMacElectron = isElectron && isMacPlatform(navigator.platform);
  const isFullScreen = useDesktopFullScreen();
  // Traffic-light inset is only shown when the window has its native chrome
  // (windowed Mac Electron). In fullscreen macOS hides the traffic lights so
  // we collapse the inset and let the logo row sit at the top.
  const showTitlebarInset = isMacElectron && !isFullScreen;

  return (
    <>
      <SidebarHeader className="flex shrink-0 flex-col gap-0 p-0">
        {showTitlebarInset ? (
          // Empty drag strip that reserves vertical space for the traffic
          // lights on macOS. No button lives here — the sidebar toggle sits
          // in the logo row below for a stable, balanced anchor.
          <div className="drag-region h-9 shrink-0" />
        ) : null}
        {/*
          Border lives on THIS row (not the wrapper) so it renders at the
          exact same pixel y-position as the page header's own h-[52px]
          `border-b` row (see DatasetsView / ChatView / PapersView). Keeping
          both borders flush across the sidebar seam is surprisingly finicky
          with a wrapper-owned border.
        */}
        <div
          className={cn(
            "flex h-[52px] shrink-0 items-center gap-2 border-b border-sidebar-border pl-4 pr-2 text-sidebar-foreground",
            isElectron && "drag-region",
          )}
        >
          <BrandMark size={28} wordmarkClassName="text-lg" />
          <SidebarTrigger
            className="ml-auto size-7 shrink-0 text-sidebar-foreground/60 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
            aria-label="Collapse sidebar"
          />
        </div>
      </SidebarHeader>

      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup className="gap-3 px-3 py-3">
          <Button
            className="w-full justify-start gap-2"
            onClick={() => {
              void handleNewThread(null);
            }}
          >
            <PlusIcon className="size-4" />
            New Paper
          </Button>

          <div className="space-y-1">
            <div className="border-b border-sidebar-border/60 pb-2">
              <div className="flex items-center gap-2 px-2 py-1">
                <FileTextIcon className="size-4 text-sidebar-foreground/70" />
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-faint">
                  Recents
                </div>
              </div>
              <div className="mt-1 space-y-0.5 pl-2">
                {recentThreads.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-sidebar-foreground/55">
                    New papers appear here until you move them into a project.
                  </p>
                ) : (
                  recentThreads.map((thread) => {
                    const isEditingThread =
                      editing?.kind === "thread" && editing.id === thread.id;
                    const threadStatus = resolveStatusForThread(thread.id);

                    return (
                      <div
                        key={thread.id}
                        draggable={!thread.isDraft}
                        className={cn(
                          "group/thread flex items-start gap-1 rounded-md transition-colors",
                          !thread.isDraft &&
                            "cursor-grab active:cursor-grabbing",
                          draggedThreadId === thread.id && "opacity-60",
                          routeThreadId === thread.id
                            ? "bg-sidebar-accent text-sidebar-foreground"
                            : "hover:bg-sidebar-accent/60",
                        )}
                        onDragEnd={resetDragState}
                        onDragStart={(event) =>
                          handleThreadDragStart(event, thread)
                        }
                        onContextMenu={(event) => {
                          if (thread.isDraft) {
                            return;
                          }
                          event.preventDefault();
                          setContextMenu({
                            threadId: thread.id,
                            x: event.clientX,
                            y: event.clientY,
                          });
                        }}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-start px-3 py-2 text-left"
                          onClick={() => {
                            void navigate({
                              to: "/$threadId",
                              params: { threadId: thread.id },
                            });
                          }}
                        >
                          <div className="min-w-0 flex-1">
                            {isEditingThread ? (
                              <input
                                autoFocus
                                className="w-full rounded border border-sidebar-border bg-background px-2 py-1 text-sm text-foreground outline-none"
                                value={editing.value}
                                onClick={(event) => event.stopPropagation()}
                                onBlur={() =>
                                  void commitThreadRename(
                                    thread.id,
                                    thread.title,
                                  )
                                }
                                onChange={(event) =>
                                  setEditing({
                                    kind: "thread",
                                    id: thread.id,
                                    value: event.target.value,
                                  })
                                }
                                onKeyDown={(event) =>
                                  handleEditingKeyDown(event, {
                                    kind: "thread",
                                    id: thread.id,
                                    originalTitle: thread.title,
                                  })
                                }
                              />
                            ) : (
                              <>
                                <div className="flex items-start gap-2">
                                  <div className="min-w-0 flex-1 truncate text-[0.9375rem] font-medium leading-snug tracking-[-0.005em] text-sidebar-foreground">
                                    {thread.title}
                                  </div>
                                  <ThreadStatusDot status={threadStatus} />
                                </div>
                                <div className="mt-1 text-xs text-sidebar-foreground/60">
                                  {formatRelativeTimeLabel(thread.timestamp)}
                                </div>
                              </>
                            )}
                          </div>
                        </button>
                        {!isEditingThread && !thread.isDraft ? (
                          <div className="flex items-center gap-0.5 pr-2 pt-2 opacity-0 transition-opacity group-hover/thread:opacity-100 group-focus-within/thread:opacity-100">
                            <button
                              type="button"
                              className="inline-flex size-7 items-center justify-center rounded-md text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                              data-testid={`thread-archive-${thread.id}`}
                              onClick={() => {
                                void handleArchiveThread(thread.id);
                              }}
                              title="Archive paper"
                            >
                              <ArchiveIcon className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              className="inline-flex size-7 items-center justify-center rounded-md text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                              data-testid={`thread-delete-${thread.id}`}
                              onClick={() => {
                                void handleDeleteThread(thread.id);
                              }}
                              title="Delete paper"
                            >
                              <Trash2Icon className="size-3.5" />
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex items-center justify-between px-2 pt-1">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-faint">
                Projects
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                onClick={openCreateProjectDialog}
              >
                <PlusIcon className="size-3.5" />
                New Project
              </button>
            </div>

            {orderedProjects.map((project) => {
              const projectThreads =
                threadEntriesByProjectId.get(project.id) ?? [];
              const isExpanded = projectExpandedById[project.id] ?? true;
              const isEditingProject =
                editing?.kind === "project" && editing.id === project.id;

              return (
                <div
                  key={project.id}
                  className={cn(
                    "border-b border-sidebar-border/60 pb-2 transition-colors last:border-b-0",
                    dropProjectId === project.id &&
                      "rounded-md bg-sidebar-accent/40",
                  )}
                  onDragLeave={(event) => {
                    const nextTarget = event.relatedTarget;
                    if (
                      nextTarget instanceof Node &&
                      event.currentTarget.contains(nextTarget)
                    ) {
                      return;
                    }
                    setDropProjectId((current) =>
                      current === project.id ? null : current,
                    );
                  }}
                  onDragOver={(event) =>
                    handleProjectDragOver(event, project.id)
                  }
                  onDrop={(event) => void handleProjectDrop(event, project.id)}
                >
                  <div className="group/project flex items-center gap-1 px-2 py-1">
                    <button
                      type="button"
                      className="inline-flex size-6 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      onClick={() =>
                        setProjectExpanded(project.id, !isExpanded)
                      }
                    >
                      {isExpanded ? (
                        <ChevronDownIcon className="size-4" />
                      ) : (
                        <ChevronRightIcon className="size-4" />
                      )}
                    </button>

                    <FolderIcon className="size-4 text-sidebar-foreground/70" />

                    <div className="min-w-0 flex-1">
                      {isEditingProject ? (
                        <input
                          autoFocus
                          className="w-full rounded border border-sidebar-border bg-background px-2 py-1 text-sm text-foreground outline-none"
                          value={editing.value}
                          onBlur={() =>
                            void commitProjectRename(project.id, project.name)
                          }
                          onChange={(event) =>
                            setEditing({
                              kind: "project",
                              id: project.id,
                              value: event.target.value,
                            })
                          }
                          onKeyDown={(event) =>
                            handleEditingKeyDown(event, {
                              kind: "project",
                              id: project.id,
                              originalTitle: project.name,
                            })
                          }
                        />
                      ) : (
                        <button
                          type="button"
                          className="w-full truncate text-left text-[15px] font-medium text-sidebar-foreground"
                          onClick={() =>
                            setProjectExpanded(project.id, !isExpanded)
                          }
                          title={project.name}
                        >
                          {project.name}
                        </button>
                      )}
                    </div>

                    {!isEditingProject ? (
                      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/project:opacity-100 group-focus-within/project:opacity-100">
                        <button
                          type="button"
                          className="inline-flex size-7 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                          onClick={() => {
                            void handleNewThread(project.id);
                          }}
                          title="New paper"
                        >
                          <FolderPlusIcon className="size-4" />
                        </button>
                        <button
                          type="button"
                          className="inline-flex size-7 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                          onClick={() => {
                            setEditing({
                              kind: "project",
                              id: project.id,
                              value: project.name,
                            });
                          }}
                          title="Rename project"
                        >
                          <PencilIcon className="size-4" />
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {isExpanded ? (
                    <div className="mt-1 space-y-0.5 pl-8">
                      {projectThreads.length === 0 ? (
                        <p className="px-2 py-2 text-sm text-sidebar-foreground/55">
                          No papers yet
                        </p>
                      ) : (
                        projectThreads.map((thread) => {
                          const isEditingThread =
                            editing?.kind === "thread" &&
                            editing.id === thread.id;
                          const canRenameThread = !thread.isDraft;
                          const threadStatus = resolveStatusForThread(thread.id);

                          return (
                            <div
                              key={thread.id}
                              draggable={!thread.isDraft}
                              className={cn(
                                "group/thread flex items-start gap-1 rounded-md transition-colors",
                                !thread.isDraft &&
                                  "cursor-grab active:cursor-grabbing",
                                draggedThreadId === thread.id && "opacity-60",
                                routeThreadId === thread.id
                                  ? "bg-sidebar-accent text-sidebar-foreground"
                                  : "hover:bg-sidebar-accent/60",
                              )}
                              onDragEnd={resetDragState}
                              onDragStart={(event) =>
                                handleThreadDragStart(event, thread)
                              }
                              onContextMenu={(event) => {
                                if (thread.isDraft) {
                                  return;
                                }
                                event.preventDefault();
                                setContextMenu({
                                  threadId: thread.id,
                                  x: event.clientX,
                                  y: event.clientY,
                                });
                              }}
                            >
                              <button
                                type="button"
                                className="flex min-w-0 flex-1 items-start px-3 py-2 text-left"
                                onClick={() => {
                                  void navigate({
                                    to: "/$threadId",
                                    params: { threadId: thread.id },
                                  });
                                }}
                              >
                                <div className="min-w-0 flex-1">
                                  {isEditingThread ? (
                                    <input
                                      autoFocus
                                      className="w-full rounded border border-sidebar-border bg-background px-2 py-1 text-sm text-foreground outline-none"
                                      value={editing.value}
                                      onClick={(event) =>
                                        event.stopPropagation()
                                      }
                                      onBlur={() =>
                                        void commitThreadRename(
                                          thread.id,
                                          thread.title,
                                        )
                                      }
                                      onChange={(event) =>
                                        setEditing({
                                          kind: "thread",
                                          id: thread.id,
                                          value: event.target.value,
                                        })
                                      }
                                      onKeyDown={(event) =>
                                        handleEditingKeyDown(event, {
                                          kind: "thread",
                                          id: thread.id,
                                          originalTitle: thread.title,
                                        })
                                      }
                                    />
                                  ) : (
                                    <>
                                      <div className="flex items-start gap-2">
                                        <div
                                          className={cn(
                                            "min-w-0 flex-1 truncate text-[0.9375rem] font-medium leading-snug tracking-[-0.005em]",
                                            routeThreadId === thread.id
                                              ? "text-sidebar-foreground"
                                              : "text-sidebar-foreground",
                                          )}
                                        >
                                          {thread.title}
                                        </div>
                                        <ThreadStatusDot status={threadStatus} />
                                      </div>
                                      <div
                                        className={cn(
                                          "mt-1 text-xs",
                                          routeThreadId === thread.id
                                            ? "text-sidebar-foreground/75"
                                            : "text-sidebar-foreground/60",
                                        )}
                                      >
                                        {formatRelativeTimeLabel(
                                          thread.timestamp,
                                        )}
                                      </div>
                                    </>
                                  )}
                                </div>
                              </button>

                              {!isEditingThread && !thread.isDraft ? (
                                <div className="flex items-center gap-0.5 pr-2 pt-2 opacity-0 transition-opacity group-hover/thread:opacity-100 group-focus-within/thread:opacity-100">
                                  {canRenameThread ? (
                                    <button
                                      type="button"
                                      className="inline-flex size-7 items-center justify-center rounded-md text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                                      onClick={() => {
                                        setEditing({
                                          kind: "thread",
                                          id: thread.id,
                                          value: thread.title,
                                        });
                                      }}
                                      title="Rename paper"
                                    >
                                      <PencilIcon className="size-3.5" />
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="inline-flex size-7 items-center justify-center rounded-md text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                                    data-testid={`thread-archive-${thread.id}`}
                                    onClick={() => {
                                      void handleArchiveThread(thread.id);
                                    }}
                                    title="Archive paper"
                                  >
                                    <ArchiveIcon className="size-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    className="inline-flex size-7 items-center justify-center rounded-md text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                                    data-testid={`thread-delete-${thread.id}`}
                                    onClick={() => {
                                      void handleDeleteThread(thread.id);
                                    }}
                                    title="Delete paper"
                                  >
                                    <Trash2Icon className="size-3.5" />
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {orderedProjects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-sidebar-border px-3 py-4 text-sm text-sidebar-foreground/60">
              No projects yet.
            </div>
          ) : null}
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border px-2 py-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              isActive={
                location.pathname === "/papers" ||
                location.pathname.startsWith("/papers/")
              }
              className="gap-2 px-2 py-2"
              onClick={() => {
                void navigate({ to: "/papers" });
              }}
              title="Papers"
            >
              <FileTextIcon className="size-4" />
              <span>Papers</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              isActive={location.pathname.startsWith("/datasets")}
              className="gap-2 px-2 py-2"
              onClick={() => {
                void navigate({ to: "/datasets" });
              }}
            >
              <DatabaseIcon className="size-4" />
              <span>Datasets</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              isActive={location.pathname.startsWith("/settings")}
              className="gap-2 px-2 py-2"
              onClick={() => {
                void navigate({ to: "/settings" });
              }}
            >
              <SettingsIcon className="size-4" />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      {contextMenu ? (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-44 rounded-lg border border-border bg-popover p-1 shadow-lg"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
        >
          <button
            type="button"
            className="flex w-full rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-accent"
            onClick={() => {
              const thread = visibleThreadsById.get(contextMenu.threadId);
              if (!thread) {
                setContextMenu(null);
                return;
              }
              setEditing({
                kind: "thread",
                id: thread.id,
                value: thread.title,
              });
              setContextMenu(null);
            }}
          >
            Rename paper
          </button>
          {projects.length > 0 ? (
            <>
              <div className="px-3 py-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Move To Project
              </div>
              {contextThread?.projectId !== null ? (
                <button
                  type="button"
                  className="flex w-full rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-accent"
                  onClick={() => {
                    void handleMovePaper(contextMenu.threadId, null);
                    setContextMenu(null);
                  }}
                >
                  Remove from Project
                </button>
              ) : null}
              {projects
                .filter((project) => project.id !== contextThread?.projectId)
                .map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className="flex w-full rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-accent"
                    onClick={() => {
                      void handleMovePaper(contextMenu.threadId, project.id);
                      setContextMenu(null);
                    }}
                  >
                    {project.name}
                  </button>
                ))}
            </>
          ) : null}
          <button
            type="button"
            className="flex w-full rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-accent"
            onClick={() => {
              void handleArchiveThread(contextMenu.threadId);
            }}
          >
            Archive paper
          </button>
          <button
            type="button"
            className="flex w-full rounded-md px-3 py-2 text-left text-sm text-destructive hover:bg-accent"
            onClick={() => {
              void handleDeleteThread(contextMenu.threadId);
            }}
          >
            Delete paper
          </button>
        </div>
      ) : null}

      <Dialog
        modal
        open={createProjectDialog.open}
        onOpenChange={(open) =>
          setCreateProjectDialog((current) => ({
            ...current,
            open,
            creating: open ? current.creating : false,
          }))
        }
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
            <DialogDescription>
              Create a project enclosure for related papers.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">
                Project name
              </div>
              <Input
                autoFocus
                value={createProjectDialog.name}
                onChange={(event) =>
                  setCreateProjectDialog((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Resume & Cover Letters"
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setCreateProjectDialog((current) => ({
                  ...current,
                  open: false,
                  creating: false,
                }))
              }
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                createProjectDialog.creating ||
                createProjectDialog.name.trim().length === 0
              }
              onClick={() => void submitCreateProject()}
            >
              Create Project
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
