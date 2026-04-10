import { type ProjectId, type ThreadId } from "@agentscience/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  FolderIcon,
  FolderPlusIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { APP_VERSION } from "../branding";
import { useComposerDraftStore } from "../composerDraftStore";
import { isElectron } from "../env";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useSettings } from "../hooks/useSettings";
import { useThreadActions } from "../hooks/useThreadActions";
import { cn, newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { useUiStateStore } from "../uiStateStore";
import { toastManager } from "./ui/toast";
import { Button } from "./ui/button";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "./ui/sidebar";

interface SidebarThreadEntry {
  id: ThreadId;
  projectId: ProjectId;
  title: string;
  timestamp: string;
  isDraft: boolean;
}

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

function deriveDraftTitle(prompt: string | undefined): string {
  const firstMeaningfulLine = prompt
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstMeaningfulLine) {
    return "New Research";
  }

  return firstMeaningfulLine.length > 56
    ? `${firstMeaningfulLine.slice(0, 53).trimEnd()}...`
    : firstMeaningfulLine;
}

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeDraftThread, activeThread, defaultProjectId, handleNewThread, routeThreadId } =
    useHandleNewThread();
  const { archiveThread } = useThreadActions();
  const projects = useStore((state) => state.projects);
  const sidebarThreadsById = useStore((state) => state.sidebarThreadsById);
  const threadIdsByProjectId = useStore((state) => state.threadIdsByProjectId);
  const draftThreadsByThreadId = useComposerDraftStore((state) => state.draftThreadsByThreadId);
  const draftsByThreadId = useComposerDraftStore((state) => state.draftsByThreadId);
  const projectExpandedById = useUiStateStore((state) => state.projectExpandedById);
  const projectOrder = useUiStateStore((state) => state.projectOrder);
  const setProjectExpanded = useUiStateStore((state) => state.setProjectExpanded);
  const projectSortOrder = useSettings((state) => state.sidebarProjectSortOrder);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [contextMenu, setContextMenu] = useState<ThreadContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const activeProjectId =
    activeThread?.projectId ?? activeDraftThread?.projectId ?? defaultProjectId;

  const visibleThreadsById = useMemo(() => {
    const visibleThreads = Object.values(sidebarThreadsById).filter(
      (thread) => thread.archivedAt === null,
    );
    return new Map(visibleThreads.map((thread) => [thread.id, thread] as const));
  }, [sidebarThreadsById]);

  const orderedProjects = useMemo(() => {
    if (projectSortOrder === "manual" && projectOrder.length > 0) {
      const projectsById = new Map(projects.map((project) => [project.id, project] as const));
      const ordered = projectOrder
        .map((projectId) => projectsById.get(projectId))
        .filter((project): project is NonNullable<typeof project> => project !== undefined);
      const remaining = projects.filter((project) => !projectOrder.includes(project.id));
      return [...ordered, ...remaining];
    }

    return [...projects].toSorted((left, right) => {
      const leftThreadIds = threadIdsByProjectId[left.id] ?? [];
      const rightThreadIds = threadIdsByProjectId[right.id] ?? [];

      const leftLatest = Math.max(
        Date.parse(left.updatedAt ?? left.createdAt ?? "") || Number.NEGATIVE_INFINITY,
        ...leftThreadIds.map((threadId) => {
          const thread = visibleThreadsById.get(threadId);
          return (
            Date.parse(
              thread?.latestUserMessageAt ?? thread?.updatedAt ?? thread?.createdAt ?? "",
            ) || Number.NEGATIVE_INFINITY
          );
        }),
      );
      const rightLatest = Math.max(
        Date.parse(right.updatedAt ?? right.createdAt ?? "") || Number.NEGATIVE_INFINITY,
        ...rightThreadIds.map((threadId) => {
          const thread = visibleThreadsById.get(threadId);
          return (
            Date.parse(
              thread?.latestUserMessageAt ?? thread?.updatedAt ?? thread?.createdAt ?? "",
            ) || Number.NEGATIVE_INFINITY
          );
        }),
      );

      if (rightLatest !== leftLatest) {
        return rightLatest - leftLatest;
      }

      return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
    });
  }, [projectOrder, projectSortOrder, projects, threadIdsByProjectId, visibleThreadsById]);

  const threadEntriesByProjectId = useMemo(() => {
    const entries = new Map<ProjectId, SidebarThreadEntry[]>();
    const persistedThreadIds = new Set<string>();

    for (const [projectId, threadIds] of Object.entries(threadIdsByProjectId)) {
      const projectEntries = threadIds
        .map((threadId) => visibleThreadsById.get(threadId))
        .filter((thread): thread is NonNullable<typeof thread> => thread !== undefined)
        .map((thread) => {
          persistedThreadIds.add(thread.id);
          return {
            id: thread.id,
            projectId: thread.projectId,
            isDraft: false,
            timestamp: thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
            title: thread.title,
          } satisfies SidebarThreadEntry;
        });

      entries.set(
        projectId as ProjectId,
        projectEntries.toSorted((left, right) => right.timestamp.localeCompare(left.timestamp)),
      );
    }

    for (const [threadId, draftThread] of Object.entries(draftThreadsByThreadId)) {
      if (persistedThreadIds.has(threadId)) {
        continue;
      }

      const projectEntries = entries.get(draftThread.projectId) ?? [];
      projectEntries.push({
        id: threadId as ThreadId,
        projectId: draftThread.projectId,
        isDraft: true,
        timestamp: draftThread.createdAt,
        title: deriveDraftTitle(draftsByThreadId[threadId as ThreadId]?.prompt),
      });
      entries.set(
        draftThread.projectId,
        projectEntries.toSorted((left, right) => right.timestamp.localeCompare(left.timestamp)),
      );
    }

    return entries;
  }, [draftThreadsByThreadId, draftsByThreadId, threadIdsByProjectId, visibleThreadsById]);

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

  const commitProjectRename = async (projectId: ProjectId, originalName: string) => {
    const nextTitle =
      editing?.kind === "project" && editing.id === projectId ? editing.value.trim() : "";
    setEditing(null);
    if (!nextTitle || nextTitle === originalName) {
      return;
    }

    const api = readNativeApi();
    if (!api) {
      return;
    }

    try {
      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId,
        title: nextTitle,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to rename project",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const commitThreadRename = async (threadId: ThreadId, originalTitle: string) => {
    const nextTitle =
      editing?.kind === "thread" && editing.id === threadId ? editing.value.trim() : "";
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
      await api.orchestration.dispatchCommand({
        type: "thread.meta.update",
        commandId: newCommandId(),
        threadId,
        title: nextTitle,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to rename chat",
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
        title: "Failed to archive chat",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
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

  return (
    <>
      <SidebarHeader
        className={cn(
          "border-b border-sidebar-border px-4",
          isElectron ? "drag-region h-[52px] py-0 pl-[90px]" : "py-4",
        )}
      >
        <div className="flex min-w-0 w-full items-center justify-end gap-3">
          {/* <span className="rounded-full border border-sidebar-border bg-sidebar-accent/60 px-2 py-0.5 text-[11px] font-medium text-sidebar-foreground/75">
            v{APP_VERSION}
          </span> */}
        </div>
      </SidebarHeader>

      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup className="gap-3 px-3 py-3">
          <Button
            className="w-full justify-start gap-2"
            disabled={activeProjectId === null}
            onClick={() => {
              if (!activeProjectId) return;
              void handleNewThread(activeProjectId);
            }}
          >
            <PlusIcon className="size-4" />
            New Research
          </Button>

          <div className="space-y-1">
            {orderedProjects.map((project) => {
              const projectThreads = threadEntriesByProjectId.get(project.id) ?? [];
              const isExpanded = projectExpandedById[project.id] ?? true;
              const isEditingProject = editing?.kind === "project" && editing.id === project.id;

              return (
                <div
                  key={project.id}
                  className="border-b border-sidebar-border/60 pb-2 last:border-b-0"
                >
                  <div className="group/project flex items-center gap-1 px-2 py-1">
                    <button
                      type="button"
                      className="inline-flex size-6 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      onClick={() => setProjectExpanded(project.id, !isExpanded)}
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
                          onBlur={() => void commitProjectRename(project.id, project.name)}
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
                          onClick={() => setProjectExpanded(project.id, !isExpanded)}
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
                          title="New chat"
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
                        <p className="px-2 py-2 text-sm text-sidebar-foreground/55">No chats yet</p>
                      ) : (
                        projectThreads.map((thread) => {
                          const isEditingThread =
                            editing?.kind === "thread" && editing.id === thread.id;
                          const canRenameThread = !thread.isDraft;

                          return (
                            <div
                              key={thread.id}
                              className={cn(
                                "group/thread flex items-start gap-1 rounded-xl transition-colors",
                                routeThreadId === thread.id
                                  ? "bg-zinc-500/15 text-sidebar-foreground shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border))]"
                                  : "hover:bg-sidebar-accent/50",
                              )}
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
                                        void commitThreadRename(thread.id, thread.title)
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
                                      <div
                                        className={cn(
                                          "truncate text-[15px] font-medium",
                                          routeThreadId === thread.id
                                            ? "text-sidebar-foreground"
                                            : "text-sidebar-foreground",
                                        )}
                                      >
                                        {thread.title}
                                      </div>
                                      <div
                                        className={cn(
                                          "mt-1 text-xs",
                                          routeThreadId === thread.id
                                            ? "text-sidebar-foreground/75"
                                            : "text-sidebar-foreground/60",
                                        )}
                                      >
                                        {formatRelativeTimeLabel(thread.timestamp)}
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
                                      title="Rename chat"
                                    >
                                      <PencilIcon className="size-3.5" />
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="inline-flex size-7 items-center justify-center rounded-md text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                                    onClick={() => {
                                      void handleArchiveThread(thread.id);
                                    }}
                                    title="Archive chat"
                                  >
                                    <ArchiveIcon className="size-3.5" />
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
              No research projects yet.
            </div>
          ) : null}
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              disabled
              className="gap-2 px-2 py-2 text-muted-foreground"
              title="My Papers arrives in Phase 4."
            >
              <FileTextIcon className="size-4" />
              <span>My Papers</span>
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
            Rename chat
          </button>
          <button
            type="button"
            className="flex w-full rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-accent"
            onClick={() => {
              void handleArchiveThread(contextMenu.threadId);
            }}
          >
            Archive chat
          </button>
        </div>
      ) : null}
    </>
  );
}
