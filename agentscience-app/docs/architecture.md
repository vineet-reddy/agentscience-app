# Architecture

Read this first. If you only read one doc to onboard, read this one, in order, top to bottom.

AgentScience is a desktop app and web UI for running research work with coding agents. The interesting part is the backend, because almost every piece of behavior in the product is driven by a small, consistent write path through one orchestration engine. Once you understand that path, the rest of the repo stops looking like a pile of folders and starts looking like layers around that one spine.

At the highest level there are three apps in the monorepo:

- `apps/desktop`: the Electron shell that wraps the web app and embeds the server in packaged builds
- `apps/web`: the browser UI that talks to the server over websocket RPC
- `apps/server`: the backend, owns all state, owns the database, owns the filesystem, owns the orchestration engine

The server is the center of the system. The UI sends commands, the server turns those commands into events, applies the events to its in-memory read model, writes projection rows to sqlite, and streams the resulting events and snapshots back to the UI. That loop is the one idea to keep in your head while reading this doc.

## The write path (commands to events to projections)

The server runs orchestration as commands in, events out, and everything downstream is a consumer of those events. Concretely:

1. The UI sends a command over RPC, for example `project.create` or `paper.move`.
2. The orchestration engine validates that command against the current read model and the command invariants.
3. If valid, the decider returns one or more domain events like `project.created` or `paper.moved`.
4. Those events are appended to the event store and published on a pub/sub.
5. The projection pipeline consumes the events and updates the projection tables that the UI actually reads from.
6. The snapshot query stitches projections together into a single snapshot that the UI can render.
7. Reactors (orchestration, provider, checkpoint) react to events to drive side effects like filesystem moves, provider runtime work, git operations.

Why this shape matters:

- one write path, so you always know where a change comes from
- a full audit trail of what happened, for free
- predictable recovery after restart, because the read model is rebuilt from events and projections
- easier reasoning when project, paper, or workspace state gets weird, because the fix is always "find the event, find the projection, find the reactor"

The main files to read for this path:

- [decider.ts](../apps/server/src/orchestration/decider.ts): pure function from command plus read model to events, no side effects, one big switch by command type
- [projector.ts](../apps/server/src/orchestration/projector.ts): pure function from event plus read model to new read model
- [OrchestrationEngine.ts](../apps/server/src/orchestration/Layers/OrchestrationEngine.ts): the actual runtime that queues commands, persists events, maintains the in-memory read model, and publishes events
- [ProjectionPipeline.ts](../apps/server/src/orchestration/Layers/ProjectionPipeline.ts): consumes events and updates the sqlite projection tables
- [ProjectionSnapshotQuery.ts](../apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts): reads projection tables and produces the snapshot the UI sees

If you want to trace what happens on a single command, `decider.ts` is a good place to start because every command type has its own case there, and the switch reads like a table of contents for the whole write path.

## Core rules that drive a lot of recent work

These are not generic engineering tips. They are the opinionated rules the current system is built around, and a lot of recent refactors only make sense if you know them.

- the database is the source of truth for what exists
- the filesystem follows the database, it never leads it
- a project slug is fixed at creation time and never changes
- a paper slug is fixed at creation time, unless a move forces a collision-safe rename in the destination scope
- title is editable and separate from slug, renaming a title never touches the folder
- the system never scans the filesystem to discover projects or papers, there is no filesystem discovery layer
- there are no stamp files deciding what exists
- workspace migration is a hard cut, there is no reconciliation layer merging old and new models

If you see code drifting away from those rules, for ex. a reader that scans a directory to decide what projects exist, or a rename that touches folders when the title changes, it is going in the wrong direction. Fix the direction, do not add more reconciliation.

## The user-facing model

Three concepts. All three are important because the product language and the orchestration language disagree in one specific place (see Paper below).

### Workspace root

The top-level folder the app owns on disk. The backend guarantees the shape inside it:

```text
<workspace-root>/
  Projects/
    <project-slug>/
      papers/
        <paper-slug>/
  Papers/
    <paper-slug>/
```

Project folders live under `Projects/`. Papers that belong to a project live under that project at `papers/<paper-slug>/`. Papers that do not belong to any project live at the root under `Papers/<paper-slug>/`. That split is the only reason there are two top-level directories, it lets a paper move between "inside a project" and "at the root" without special casing.

Code:

- [WorkspaceLayout.ts](../apps/server/src/workspace/Layers/WorkspaceLayout.ts) ensures the root shape and creates folders
- [WorkspacePaths.ts](../apps/server/src/workspace/Services/WorkspacePaths.ts) resolves filesystem paths from slugs

### Project

A project is a named container for papers. Important fields:

- `id`: stable identifier, never changes
- `title`: editable, used in the UI
- `folderSlug`: stable, used on disk, never changes after create
- `defaultModelSelection`: default model for papers created inside the project
- `scripts`: optional setup scripts that belong to the project

On disk a project lives at `Projects/<project-folder-slug>/`, and its papers live at `Projects/<project-folder-slug>/papers/`.

### Paper

In the product the thing is called a "paper". In the orchestration model it is still called a "thread", and many commands and events use the word `thread`. Same thing, two names. This is a historical artifact from before the paper concept existed. When you read `thread.create` in the decider, that is the command that makes a paper.

Important fields:

- `id`
- `projectId` (nullable, null means a root-level paper)
- `title` (editable)
- `folderSlug` (stable after create, with one exception below)
- `modelSelection`
- `runtimeMode`
- `interactionMode`

Filesystem location depends on whether the paper is in a project or at the root:

- inside a project: `Projects/<project-folder-slug>/papers/<paper-folder-slug>/`
- at the root: `Papers/<paper-folder-slug>/`

The one exception to "slug is stable" is `paper.move`, which may need a collision-safe rename if the destination scope already has a paper with the same folder name. That rename is deliberate, it is the only place the system is allowed to change a slug.

Keeping the UI-language (paper) separate from the orchestration-language (thread) in your head helps when you are reading the orchestration code and wondering "where did papers go".

## Storage model

There are two tiers to keep straight.

### 1. Main project and paper records

The canonical product objects live in:

- `research_projects`: one row per project
- `research_chats`: one row per paper (again, "chat" is old naming for "thread" / "paper")
- `chat_messages`: one row per message

These are the tables you would expect to be the source of truth for product objects, and they are.

### 2. Supporting metadata and projections

The backend also keeps local metadata in `device_state` and a set of projection tables that back the orchestration snapshot and runtime behavior. Things like model selections, scripts, runtime metadata, and projection state live here.

Why this split exists:

- the main tables hold the product objects with the fields that make sense as first-class columns
- `device_state` holds device-local or app-specific metadata that does not belong in the main object rows
- the projection tables give the UI a fast, stable read model that the snapshot query can stitch together without joining the whole world

If you are ever confused about where to put a new field, ask whether it is a first-class property of the product object (main tables), device-local app state (`device_state`), or a derived view for the UI (projection tables).

The stitching happens in [ProjectionSnapshotQuery.ts](../apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts) around line 441.

## The commands worth knowing by name

There are a lot of commands. You do not need all of them in your head. These are the ones that define the workspace shape and that most new work ends up touching.

### `project.create`

Creates a project with a stable `projectId`, a stable `folderSlug`, and an editable `title`. After this command commits, the workspace layout has a new `Projects/<folderSlug>/papers/` directory. The slug is chosen once and never changes, so any code that keys off the project folder is safe forever.

### `project.meta.update`

Updates project title and metadata like default model selection and scripts. Important detail worth repeating because it surprises people: changing the title does not rename the folder. Title and folder slug are independent on purpose.

### `project.delete`

Removes a project. The filesystem effect is driven by the reactor responding to `project.deleted`, not by the command handler directly. Same pattern as every other move or delete in the system.

### `thread.create` (aka "create a paper")

Creates a paper with its own stable folder slug. If `projectId` is set, the paper is created inside that project, otherwise it is created at the workspace root under `Papers/`.

### `paper.move`

The one command that moves a paper between project scope and root scope. This is the operation that changes filesystem location, and it is the one place the system is allowed to change a slug if the destination already has a folder with that name (collision-safe rename). Everything else treats slugs as immutable.

### `workspace.rootChange`

Moves the whole workspace root to a new location. The backend validates the new root, persists it, rebuilds the layout, and the client refreshes from a fresh snapshot. This is also a single-command operation on purpose, so the old "many-step migration dance" is not a thing anymore.

For the full set of commands and events read [decider.ts](../apps/server/src/orchestration/decider.ts), it is one big switch and every case is only a few lines.

## How the UI stays in sync

The web app has two sync paths, and it is important to understand both because they explain almost every "the UI is out of sync" bug.

- snapshot bootstrap and recovery: on startup, the client fetches the full orchestration snapshot from the server and replaces its local state with that snapshot
- live domain events: after bootstrap, the client subscribes to the event stream and applies incremental updates as events arrive

If the client ever thinks its state might be wrong (for example after a reconnect, or after a command failed in a way that invalidates the local model), it falls back to the snapshot path to converge back to the backend state. The backend is always the final say, the client does not invent state.

This is why you will see almost no optimistic UI in the sync layer. The server owns everything, the client just replays.

Good files to read for the UI side:

- [routes/__root.tsx](../apps/web/src/routes/__root.tsx): sets up bootstrap, recovery, and the event stream subscription
- [store.ts](../apps/web/src/store.ts): the client-side state store that applies snapshots and events
- [Sidebar.tsx](../apps/web/src/components/Sidebar.tsx) and [ChatView.tsx](../apps/web/src/components/ChatView.tsx): the two main views, useful to see how the store gets consumed

## Workspace layout behavior

All folder creation, folder renames, and folder moves are owned by the backend. Reactors handle the side effects, the UI never touches the filesystem directly.

Code:

- [WorkspaceLayout.ts](../apps/server/src/workspace/Layers/WorkspaceLayout.ts)

Why this matters:

- project folders are easy to reason about because their layout is always derived from slugs, not from whatever the user did last in Finder
- root-level papers have a clear home under `Papers/` instead of floating around wherever
- moving a paper is just a move between two known scopes, not a free-form filesystem operation

If you are tempted to add filesystem code that lives outside the workspace layer, stop. Write it as a reactor that responds to a domain event instead.

## Project scripts

Projects can carry setup scripts. Those scripts are part of project metadata, and they run in the project or worktree context when the runner resolves the project path from `workspaceRoot + project.folderSlug`.

Why they live on the project and not on a paper:

- setup should be shared across every paper in the project, so it belongs one level up
- the runner does not need to care which specific paper triggered the setup, only which project owns it

Code:

- [ProjectSetupScriptRunner.ts](../apps/server/src/project/Layers/ProjectSetupScriptRunner.ts)

## Recent architecture changes that matter

A lot of code comments and older notes in this repo predate the current model. If you are reading something that feels inconsistent, check whether it is describing the old model. The main shifts are:

- workspace root used to be per-project, now it is global, there is one root for everything
- projects and papers used to be discovered by scanning the filesystem, now they are tracked by explicit slugs in the database
- papers used to move by some ad hoc filesystem dance, now they move through orchestration events
- workspace root changes used to be multi-step, now they are a single command

If older notes assume "the workspace is rooted inside a project" or "we figure out what exists by reading the disk" or "title uniqueness matters for the folder name", those assumptions are dead. The current system treats the database as the only source of truth and slugs as the only filesystem keys.

## Shortest path into the codebase

If you want to be useful on the backend as fast as possible:

1. [decider.ts](../apps/server/src/orchestration/decider.ts)
2. [projector.ts](../apps/server/src/orchestration/projector.ts)
3. [OrchestrationEngine.ts](../apps/server/src/orchestration/Layers/OrchestrationEngine.ts)
4. [ProjectionPipeline.ts](../apps/server/src/orchestration/Layers/ProjectionPipeline.ts)
5. [ProjectionSnapshotQuery.ts](../apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts)
6. [WorkspaceLayout.ts](../apps/server/src/workspace/Layers/WorkspaceLayout.ts)

If you want to be useful on the UI as fast as possible:

1. [routes/__root.tsx](../apps/web/src/routes/__root.tsx)
2. [store.ts](../apps/web/src/store.ts)
3. [Sidebar.tsx](../apps/web/src/components/Sidebar.tsx)
4. [ChatView.tsx](../apps/web/src/components/ChatView.tsx)

Reading those in order is enough to hold the system in your head without having to crawl the whole repo first. Everything else (providers, terminals, git, the desktop shell) is a consumer of the same write path described at the top.
