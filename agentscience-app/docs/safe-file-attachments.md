# Safe File Attachments

AgentScience lets researchers attach local files to a chat. This includes PDFs, CSVs, code, JSON, images, and other files.

## The Problem

Researchers may attach data that is hard or impossible to replace. A file may be an internal dataset, a one-off experimental result, or a document that took months to produce.

The unsafe version of this feature would hand the original desktop path directly to the agent. That creates two risks:

- The agent or one of its tools could edit the original file by accident.
- The app could leak more local context than needed, such as the user's original file path.
- If the agent could freely read outside the workspace, it could try to match filenames against the rest of the user's desktop.

Non-technical users should not have to understand those risks before using the app. The app should make the safe path the default.

## The Solution

AgentScience treats every attached file as an imported copy, not as the original file.

The lifecycle is:

1. The user picks a file or drops it onto the composer.
2. The desktop shell sends the selected path to the local AgentScience backend.
3. The backend immediately copies the file into app-managed attachment storage under `~/.agentscience/.../attachments`.
4. The copied attachment gets a generated id, a sanitized storage filename, size metadata, MIME metadata, and a SHA-256 hash.
5. The chat stores only attachment metadata. It does not store the original selected path.
6. When a Codex turn starts, AgentScience copies the preserved attachment into the active thread workspace at `.agentscience/attachments/<attachment-id>/<filename>`. The staging directories are recreated as normal directories, and the staged copy is marked read-only when the operating system supports it.
7. Codex is told to read that staged workspace copy. It is also told to write derived files instead of overwriting the staged input.
8. The embedded Codex thread is started with a workspace-scoped permissions profile. The active chat directory is treated as the project root, Codex gets only minimal system reads plus read/write access to that root, and legacy `workspace-write` writable roots are still set to the same directory for compatibility.

The original selected file path is never passed to Codex and is never used as a working file.

## Filename Policy

AgentScience keeps the original filename as user-facing and agent-facing context.

This is intentional. In research workflows, filenames often carry useful information: paper titles, accession names, trial identifiers, dates, instrument names, or dataset versions. Hiding filenames by default would make the agent less useful and would not be the real security boundary.

Instead, AgentScience follows the normal file-upload split:

- The original absolute path is private and is not shown to Codex.
- The original filename is preserved as metadata and may be shown in the UI and prompt.
- The stored and staged file path is controlled by AgentScience and lives under the active thread workspace.
- The Codex sandbox and permissions profile are responsible for preventing filesystem reads and writes outside the active thread workspace.

This matches common practice in AI file tools: filenames are useful document metadata, while storage paths and workspace boundaries carry the safety responsibility.

## What This Protects

This design protects the user's original desktop files from accidental mutation by the agent.

If Codex reads, parses, transforms, or writes files during the turn, it works from a disposable staged copy inside the thread workspace. If something goes wrong, the original source file remains outside the agent workspace.

The staged file may be replaced on a retry or a later turn. That is fine because the staged file is not the user's source of truth.

The app also avoids sending the user's original local path into the chat transcript or the Codex prompt. Filenames are still shown because users and the agent need to know what was attached, but paths are not.

Import and staging errors are intentionally generic. We do not return raw filesystem errors to the UI because those errors can include private local paths.

The important boundary is the Codex sandbox plus the AgentScience permissions profile. AgentScience starts embedded Codex sessions with:

- `project_root_markers = []`, so the active chat directory is the project root even though it is not a Git repo.
- `default_permissions = "agentscience-workspace"`.
- `permissions.agentscience-workspace.filesystem.":minimal" = "read"`, so Codex has the small baseline reads needed for normal command execution.
- `permissions.agentscience-workspace.filesystem.":project_roots"."." = "write"`, so the active thread workspace is readable and writable.
- `sandbox_workspace_write.writable_roots = [<active thread workspace>]`, so older workspace-write enforcement has the same writable root.

That means the intended and tested operating area for reads, writes, and shell commands is the thread workspace, including `.agentscience/attachments/...`, not `~/Desktop`, `~/Downloads`, or the original source folder.

Because this depends on Codex permissions profiles, AgentScience requires Codex CLI `v0.128.0` or newer before starting the embedded runtime.

We verified this boundary with a local macOS Codex `v0.128.0` sandbox probe using the same permissions profile shape: reading a file inside the active workspace succeeded, while reading a known file outside that workspace failed with `Operation not permitted`.

## What This Does Not Protect

An attached file is still sent to the AI provider as part of the user's request, either as an image input or as file content available in the Codex workspace. Users should not attach sensitive, regulated, confidential, or third-party data unless they are allowed to share it with the configured AI provider.

The filename is also visible to the configured AI provider. If the filename itself is sensitive, the user should rename a local copy before attaching it.

That is why the app shows a first-use warning before file attachment import.

This feature prevents accidental local file corruption and avoids exposing original local paths. It is not a data-loss-prevention system, a redaction system, or a replacement for institutional data handling rules.

## Implementation Reference

The main implementation points are:

- `apps/desktop/src/main.ts`: native file picker.
- `apps/desktop/src/preload.ts`: safe bridge for drag/drop file paths.
- `apps/server/src/attachmentStore.ts`: copies selected files into app-managed attachment storage and records metadata.
- `apps/server/src/codexAppServerManager.ts`: stages disposable per-turn workspace copies for Codex and starts the embedded Codex thread with the workspace-scoped permissions profile.
- `apps/web/src/components/ChatView.tsx`: composer UI, drag/drop, first-use warning, and send wiring.
- `apps/web/src/components/chat/MessagesTimeline.tsx`: file attachment display in sent messages.

The key invariants are:

- **The only path Codex sees is the staged workspace copy, never the user's original selected path.**
- **The active Codex filesystem profile grants minimal system reads plus access to the active thread workspace, not the user's whole desktop.**
