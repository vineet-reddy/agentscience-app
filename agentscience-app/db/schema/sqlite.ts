import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

export {
  artifactOwnerTypes,
  messageRoles,
  messageTypes,
  paperStatuses,
  publicationVisibilities,
  recordStatuses,
  runPhases,
  runStatuses,
  sharingStrategies,
  syncQueueOperations,
  syncQueueStatuses,
  syncStates,
  type ArtifactOwnerType,
  type MessageRole,
  type MessageType,
  type PaperStatus,
  type PublicationVisibility,
  type RecordStatus,
  type RunPhase,
  type RunStatus,
  type SharingStrategy,
  type SyncQueueOperation,
  type SyncQueueStatus,
  type SyncState,
} from "./shared";

export const researchProjects = sqliteTable(
  "research_projects",
  {
    projectId: text("project_id").primaryKey(),
    userId: text("user_id").notNull(),
    workspaceId: text("workspace_id"),
    workspaceRoot: text("workspace_root"),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    sharingStrategy: text("sharing_strategy").notNull().default("local_only"),
    syncState: text("sync_state").notNull().default("local_only"),
    remoteProjectId: text("remote_project_id"),
    defaultChatId: text("default_chat_id").references((): AnySQLiteColumn => researchChats.chatId, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    uniqueIndex("idx_sqlite_research_projects_user_workspace_root").on(
      table.userId,
      table.workspaceRoot,
    ),
    index("idx_sqlite_research_projects_user_updated").on(table.userId, table.updatedAt),
  ],
);

export const researchChats = sqliteTable(
  "research_chats",
  {
    chatId: text("chat_id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => researchProjects.projectId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    workspaceId: text("workspace_id"),
    title: text("title").notNull(),
    agentProfile: text("agent_profile").notNull().default("agentscience"),
    status: text("status").notNull().default("active"),
    sharingStrategy: text("sharing_strategy").notNull(),
    syncState: text("sync_state").notNull().default("local_only"),
    remoteChatId: text("remote_chat_id"),
    lastMessageAt: text("last_message_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    index("idx_sqlite_research_chats_project_updated").on(table.projectId, table.updatedAt),
    index("idx_sqlite_research_chats_user_updated").on(table.userId, table.updatedAt),
  ],
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    messageId: text("message_id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => researchChats.chatId, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => researchProjects.projectId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    messageType: text("message_type").notNull().default("text"),
    contentMarkdown: text("content_markdown").notNull(),
    clientCreatedAt: text("client_created_at"),
    createdAt: text("created_at").notNull(),
    sequenceNo: integer("sequence_no").notNull(),
    runId: text("run_id"),
    sharingStrategy: text("sharing_strategy").notNull(),
    syncState: text("sync_state").notNull().default("local_only"),
    remoteMessageId: text("remote_message_id"),
    metadataJson: text("metadata_json").notNull().default("{}"),
  },
  (table) => [
    uniqueIndex("idx_sqlite_chat_messages_chat_sequence").on(table.chatId, table.sequenceNo),
    index("idx_sqlite_chat_messages_chat_created").on(table.chatId, table.createdAt),
  ],
);

export const researchRuns = sqliteTable(
  "research_runs",
  {
    runId: text("run_id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => researchChats.chatId, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => researchProjects.projectId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    workspaceId: text("workspace_id"),
    triggerMessageId: text("trigger_message_id").references(() => chatMessages.messageId, {
      onDelete: "set null",
    }),
    status: text("status").notNull(),
    phase: text("phase").notNull(),
    sharingStrategy: text("sharing_strategy").notNull(),
    syncState: text("sync_state").notNull().default("local_only"),
    remoteRunId: text("remote_run_id"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    failedAt: text("failed_at"),
    publishedPaperId: text("published_paper_id").references((): AnySQLiteColumn => papers.paperId, {
      onDelete: "set null",
    }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    runtimeMetadataJson: text("runtime_metadata_json").notNull().default("{}"),
  },
  (table) => [
    index("idx_sqlite_research_runs_chat_started").on(table.chatId, table.startedAt),
    index("idx_sqlite_research_runs_user_started").on(table.userId, table.startedAt),
  ],
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    artifactId: text("artifact_id").primaryKey(),
    userId: text("user_id").notNull(),
    workspaceId: text("workspace_id"),
    ownerType: text("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    artifactType: text("artifact_type").notNull(),
    storageProvider: text("storage_provider").notNull().default("local_fs"),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type"),
    byteSize: integer("byte_size"),
    checksumSha256: text("checksum_sha256"),
    sharingStrategy: text("sharing_strategy").notNull(),
    syncState: text("sync_state").notNull().default("local_only"),
    remoteArtifactId: text("remote_artifact_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_sqlite_artifacts_owner").on(table.ownerType, table.ownerId, table.createdAt),
  ],
);

export const papers = sqliteTable(
  "papers",
  {
    paperId: text("paper_id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => researchProjects.projectId, { onDelete: "cascade" }),
    chatId: text("chat_id").references(() => researchChats.chatId, { onDelete: "set null" }),
    runId: text("run_id").references(() => researchRuns.runId, { onDelete: "set null" }),
    userId: text("user_id").notNull(),
    workspaceId: text("workspace_id"),
    title: text("title").notNull(),
    abstract: text("abstract"),
    status: text("status").notNull(),
    publicationVisibility: text("publication_visibility").notNull().default("private"),
    pdfArtifactId: text("pdf_artifact_id").references(() => artifacts.artifactId, {
      onDelete: "set null",
    }),
    latexArtifactId: text("latex_artifact_id").references(() => artifacts.artifactId, {
      onDelete: "set null",
    }),
    sharingStrategy: text("sharing_strategy").notNull(),
    syncState: text("sync_state").notNull().default("local_only"),
    remotePaperId: text("remote_paper_id"),
    sourceSnapshotJson: text("source_snapshot_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    publishedAt: text("published_at"),
  },
  (table) => [
    index("idx_sqlite_papers_user_created").on(table.userId, table.createdAt),
    index("idx_sqlite_papers_project_created").on(table.projectId, table.createdAt),
  ],
);

export const paperDatasetLinks = sqliteTable(
  "paper_dataset_links",
  {
    paperDatasetLinkId: text("paper_dataset_link_id").primaryKey(),
    paperId: text("paper_id")
      .notNull()
      .references(() => papers.paperId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    datasetSource: text("dataset_source").notNull(),
    datasetExternalId: text("dataset_external_id"),
    datasetLabel: text("dataset_label").notNull(),
    citationText: text("citation_text"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_sqlite_paper_dataset_links_paper").on(table.paperId, table.createdAt)],
);

export const syncQueue = sqliteTable(
  "sync_queue",
  {
    queueId: text("queue_id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    operation: text("operation").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status").notNull().default("pending"),
    retryCount: integer("retry_count").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_sqlite_sync_queue_status_created").on(table.status, table.createdAt),
    index("idx_sqlite_sync_queue_entity").on(table.entityType, table.entityId),
  ],
);

export const deviceState = sqliteTable("device_state", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type SqliteResearchProject = typeof researchProjects.$inferSelect;
export type SqliteResearchChat = typeof researchChats.$inferSelect;
export type SqliteChatMessage = typeof chatMessages.$inferSelect;
export type SqliteResearchRun = typeof researchRuns.$inferSelect;
export type SqliteArtifact = typeof artifacts.$inferSelect;
export type SqlitePaper = typeof papers.$inferSelect;
export type SqlitePaperDatasetLink = typeof paperDatasetLinks.$inferSelect;
export type SqliteSyncQueueEntry = typeof syncQueue.$inferSelect;
export type SqliteDeviceState = typeof deviceState.$inferSelect;
