export const sharingStrategies = ["local_only", "sync_metadata", "sync_full", "published"] as const;

export type SharingStrategy = (typeof sharingStrategies)[number];

export const syncStates = [
  "local_only",
  "pending_sync",
  "synced",
  "sync_error",
  "published",
] as const;

export type SyncState = (typeof syncStates)[number];

export const recordStatuses = ["active", "archived", "deleted"] as const;

export type RecordStatus = (typeof recordStatuses)[number];

export const messageRoles = ["user", "assistant", "system", "tool"] as const;

export type MessageRole = (typeof messageRoles)[number];

export const messageTypes = ["text", "plan", "status", "error", "citation"] as const;

export type MessageType = (typeof messageTypes)[number];

export const runStatuses = ["queued", "running", "completed", "failed", "cancelled"] as const;

export type RunStatus = (typeof runStatuses)[number];

export const runPhases = [
  "planning",
  "dataset_search",
  "analysis",
  "writing",
  "latex_build",
  "publishing",
  "completed",
  "failed",
] as const;

export type RunPhase = (typeof runPhases)[number];

export const paperStatuses = ["draft", "ready_for_review", "published", "failed"] as const;

export type PaperStatus = (typeof paperStatuses)[number];

export const publicationVisibilities = ["private", "workspace", "public"] as const;

export type PublicationVisibility = (typeof publicationVisibilities)[number];

export const artifactOwnerTypes = ["run", "paper", "message"] as const;

export type ArtifactOwnerType = (typeof artifactOwnerTypes)[number];

export const syncQueueOperations = ["upsert", "delete", "publish"] as const;

export type SyncQueueOperation = (typeof syncQueueOperations)[number];

export const syncQueueStatuses = ["pending", "processing", "failed", "completed"] as const;

export type SyncQueueStatus = (typeof syncQueueStatuses)[number];
