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
import { BrandMark } from "./BrandMark";
import { useComposerDraftStore } from "../composerDraftStore";
import { isElectron } from "../env";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useSettings } from "../hooks/useSettings";
import { useThreadActions } from "../hooks/useThreadActions";
import { cn, newCommandId, newProjectId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { useUiStateStore } from "../uiStateStore";
import { buildSidebarThreadEntries, type SidebarThreadEntryRecord } from "./Sidebar.logic";
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
  SidebarSeparator,
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
  workspaceRoot: string;
  creating: boolean;
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
  const { archiveThread, moveThreadToProject } = useThreadActions();
  const projects = useStore((state) => state.projects);
  const sidebarThreadsById = useStore((state) => state.sidebarThreadsById);
  const threadIdsByProjectId = useStore((state) => state.threadIdsByProjectId);
  const draftThreadsByThreadId = useComposerDraftStore((state) => state.draftThreadsByThreadId);
  const draftsByThreadId = useComposerDraftStore((state) => state.draftsByThreadId);
  const projectExpandedById = useUiStateStore((state) => state.projectExpandedById);
  const projectOrder = useUiStateStore((state) => state.projectOrder);
  const setProjectExpanded = useUiStateStore((state) => state.setProjectExpanded);
  const settings = useSettings();
  const projectSortOrder = settings.sidebarProjectSortOrder;
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [contextMenu, setContextMenu] = useState<ThreadContextMenuState | null>(null);
  const [createProjectDialog, setCreateProjectDialog] = useState<CreateProjectDialogState>({
    open: false,
    name: "",
    workspaceRoot: "",
    creating: false,
  });
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

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
      workspaceRoot: "",
      creating: false,
    });
  };

  const pickProjectWorkspaceRoot = async () => {
    const api = readNativeApi();
    if (!api) {
      return;
    }
    const pickedFolder = await api.dialogs.pickFolder();
    if (!pickedFolder) {
      return;
    }
    setCreateProjectDialog((current) => ({
      ...current,
      workspaceRoot: pickedFolder,
      name: current.name || pickedFolder.split("/").filter(Boolean).at(-1) || "",
    }));
  };

  const submitCreateProject = async () => {
    const api = readNativeApi();
    if (!api) {
      return;
    }
    const title = createProjectDialog.name.trim();
    const workspaceRoot = createProjectDialog.workspaceRoot.trim();
    if (!title || !workspaceRoot || createProjectDialog.creating) {
      return;
    }
    setCreateProjectDialog((current) => ({ ...current, creating: true }));
    try {
      await api.orchestration.dispatchCommand({
        type: "project.create",
        commandId: newCommandId(),
        projectId: newProjectId(),
        title,
        workspaceRoot,
        createdAt: new Date().toISOString(),
      });
      setCreateProjectDialog({
        open: false,
        name: "",
        workspaceRoot: "",
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

  return (
    <>
      <SidebarHeader
        className={cn(
          "border-b border-sidebar-border px-4",
          isElectron ? "drag-region h-[52px] py-0 pl-[86px]" : "h-[52px] py-0",
        )}
      >
        <div className="flex h-full min-w-0 w-full items-center gap-2 text-sidebar-foreground">
          <BrandMark size={22} wordmarkClassName="text-[1rem]" />
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
                    const isEditingThread = editing?.kind === "thread" && editing.id === thread.id;

                    return (
                      <div
                        key={thread.id}
                        className={cn(
                          "group/thread flex items-start gap-1 rounded-md transition-colors",
                          routeThreadId === thread.id
                            ? "bg-sidebar-accent text-sidebar-foreground"
                            : "hover:bg-sidebar-accent/60",
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
                                onBlur={() => void commitThreadRename(thread.id, thread.title)}
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
                                <div className="truncate text-[0.9375rem] font-medium leading-snug tracking-[-0.005em] text-sidebar-foreground">
                                  {thread.title}
                                </div>
                                <div className="mt-1 text-xs text-sidebar-foreground/60">
                                  {formatRelativeTimeLabel(thread.timestamp)}
                                </div>
                              </>
                            )}
                          </div>
                        </button>
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
                            editing?.kind === "thread" && editing.id === thread.id;
                          const canRenameThread = !thread.isDraft;

                          return (
                            <div
                              key={thread.id}
                              className={cn(
                                "group/thread flex items-start gap-1 rounded-md transition-colors",
                                routeThreadId === thread.id
                                  ? "bg-sidebar-accent text-sidebar-foreground"
                                  : "hover:bg-sidebar-accent/60",
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
                                          "truncate text-[0.9375rem] font-medium leading-snug tracking-[-0.005em]",
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
                                      title="Rename paper"
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
                                    title="Archive paper"
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
              No projects yet.
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
              <span>Papers</span>
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
              <button
                type="button"
                className="flex w-full rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-accent"
                onClick={() => {
                  void moveThreadToProject(contextMenu.threadId, null);
                  setContextMenu(null);
                }}
              >
                Remove from Project
              </button>
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className="flex w-full rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-accent"
                  onClick={() => {
                    void moveThreadToProject(contextMenu.threadId, project.id);
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
              Projects are tied to a workspace root. Pick the folder first, then papers can be moved
              into it.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">Project name</div>
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
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">Workspace root</div>
              <div className="flex gap-2">
                <Input
                  value={createProjectDialog.workspaceRoot}
                  onChange={(event) =>
                    setCreateProjectDialog((current) => ({
                      ...current,
                      workspaceRoot: event.target.value,
                    }))
                  }
                  placeholder="/path/to/workspace"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void pickProjectWorkspaceRoot()}
                >
                  Choose
                </Button>
              </div>
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
                createProjectDialog.name.trim().length === 0 ||
                createProjectDialog.workspaceRoot.trim().length === 0
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
