# Architecture

This is the shortest useful description of how AgentScience works today.

Read this first if you are new to the codebase.

## What the system is

AgentScience is a desktop app and web UI for running research work with coding agents.

At a high level there are three pieces:

- the desktop shell in `apps/desktop`
- the web app in `apps/web`
- the backend in `apps/server`

The backend is the center of the system. The UI sends commands to the backend. The backend turns those commands into events, applies them to its read model, writes the database projections, and streams the resulting events back to the UI.

If you keep that picture in your head, most of the repo makes sense.

## The main idea

The backend keeps orchestration state as commands, events, projections, and snapshots.

That means:

1. The UI sends a command.
2. The backend validates that command against the current read model.
3. If valid, the backend emits one or more domain events.
4. Those events update projection tables and local metadata.
5. The backend rebuilds and serves a snapshot for the UI.

Why this matters:

- one path for writes
- a clear audit trail
- predictable recovery after restart
- easier reasoning about project, paper, and workspace changes

The important write flow lives here:

- [decider.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/server/src/orchestration/decider.ts)
- [OrchestrationEngine.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/server/src/orchestration/Layers/OrchestrationEngine.ts)
- [ProjectionPipeline.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/server/src/orchestration/Layers/ProjectionPipeline.ts)

The important read flow lives here:

- [ProjectionSnapshotQuery.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts)

## Core rules

These rules matter because a lot of recent work depends on them.

- The database is the source of truth.
- The filesystem follows the database. It does not lead it.
- A project slug is fixed at creation time.
- A paper slug is fixed at creation time, unless a move needs a collision-safe rename.
- Title is editable and separate from slug.
- The system does not scan the filesystem to discover projects or papers.
- The system does not use stamp files to decide what exists.
- Workspace migration is a hard cut. There is no reconciliation layer trying to merge old and new models.

If you see code drifting away from those rules, it is probably moving in the wrong direction.

## The user-facing model

There are three important concepts:

### Workspace root

This is the top-level folder the app owns.

The backend ensures this shape exists:

- `Projects/`
- `Papers/`

Code:

- [WorkspaceLayout.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/server/src/workspace/Layers/WorkspaceLayout.ts)
- [WorkspacePaths.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/server/src/workspace/Services/WorkspacePaths.ts)

### Project

A project is a named container for papers.

Important fields:

- `id`
- `title`
- `folderSlug`
- `defaultModelSelection`
- `scripts`

On disk, a project lives at:

- `Projects/<project-folder-slug>/`

Its papers live at:

- `Projects/<project-folder-slug>/papers/`

### Paper

In the product people say "paper". In the orchestration model it is still a thread.

Important fields:

- `id`
- `projectId` which can be `null`
- `title`
- `folderSlug`
- `modelSelection`
- `runtimeMode`
- `interactionMode`

If the paper belongs to a project, it lives at:

- `Projects/<project-folder-slug>/papers/<paper-folder-slug>/`

If it does not belong to a project, it lives at:

- `Papers/<paper-folder-slug>/`

This split matters because the UI uses project language while the orchestration engine still has thread semantics in many places.

## Storage model

There are two layers to care about.

### 1. Main local tables

The main project and paper records live mainly in:

- `research_projects`
- `research_chats`
- `chat_messages`

These hold the canonical project, paper, and message records.

### 2. Supporting metadata and projections

The backend also stores local metadata in `device_state` and projection tables used for the orchestration snapshot and runtime behavior.

This is where things like model selections, scripts, runtime metadata, and projection state are kept.

Why this split exists:

- the main tables keep the product objects
- local metadata keeps app-specific state that does not belong in the main object rows
- the projection layer gives the UI a fast, stable read model

The snapshot query stitches those pieces together here:

- [ProjectionSnapshotQuery.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts#L441)

## The commands that matter most

You do not need to memorize every command. These are the ones that define the workspace model.

### `project.create`

Creates a project with:

- a stable `projectId`
- a stable `folderSlug`
- an editable `title`

Code:

- [decider.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/server/src/orchestration/decider.ts#L64)

### `project.meta.update`

Updates project title and metadata like default model selection and scripts.

Important detail:

- changing the title does not rename the folder

### `thread.create`

Creates a paper with its own stable folder slug.

### `paper.move`

Moves a paper between project scope and root scope.

This is the operation that changes filesystem location. It may need a collision-safe slug if the destination scope already has that folder name.

### `workspace.rootChange`

Moves the whole workspace root to a new location.

This is handled by the backend. The backend validates and persists the new root, then the client refreshes from snapshot.

## How the UI stays in sync

The web app has two main sync paths:

- snapshot bootstrap and recovery
- live domain events

On startup, the client fetches the full orchestration snapshot.

After that, it listens for domain events and applies incremental updates.

When needed, it falls back to snapshot recovery so the UI can converge back to the backend state.

Why this matters:

- it keeps the client simple
- it gives the backend final say
- it reduces weird state drift in long-running sessions

Good files to read:

- [routes/__root.tsx](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/web/src/routes/__root.tsx)
- [store.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/web/src/store.ts)

## Workspace layout behavior

The backend owns folder creation and moves.

That behavior lives here:

- [WorkspaceLayout.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/server/src/workspace/Layers/WorkspaceLayout.ts)

The current shape is:

```text
<workspace-root>/
  Projects/
    <project-slug>/
      papers/
        <paper-slug>/
  Papers/
    <paper-slug>/
```

Why this matters:

- project folders are easy to reason about
- root-level papers still have a clear home
- moving a paper is just a move between two known scopes

## Project scripts

Projects can carry setup scripts.

Those scripts are part of project metadata, and they run in the project or worktree context when needed.

Why this matters:

- scripts belong to the project, not to one paper
- the runner resolves project paths from `workspaceRoot + project.folderSlug`

Code:

- [ProjectSetupScriptRunner.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/server/src/project/Layers/ProjectSetupScriptRunner.ts)

## Recent architecture changes that matter

The current system moved away from older workspace-root-per-project thinking.

Now:

- the workspace root is global
- projects and papers are tracked by folder slug
- papers move between scopes through orchestration events
- workspace root changes are explicit commands

If you are reading older notes or fork-era code comments, be careful. A lot of older assumptions around workspace roots, title uniqueness, and filesystem discovery are no longer true.

## What to read next

If you want the shortest path into the backend:

1. [decider.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/server/src/orchestration/decider.ts)
2. [OrchestrationEngine.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/server/src/orchestration/Layers/OrchestrationEngine.ts)
3. [ProjectionPipeline.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/server/src/orchestration/Layers/ProjectionPipeline.ts)
4. [ProjectionSnapshotQuery.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts)
5. [WorkspaceLayout.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/server/src/workspace/Layers/WorkspaceLayout.ts)

If you want the shortest path into the UI:

1. [routes/__root.tsx](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/web/src/routes/__root.tsx)
2. [store.ts](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/web/src/store.ts)
3. [Sidebar.tsx](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/web/src/components/Sidebar.tsx)
4. [ChatView.tsx](/Users/vineetreddy/Documents/GitHub/agentscience-app/agentscience-app/apps/web/src/components/ChatView.tsx)

That is enough to onboard into the current system without reading the whole repo first.
