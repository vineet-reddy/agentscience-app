import {
  index,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  bigint,
  jsonb,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

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
  type SyncState,
} from "./shared";

const agentScience = pgSchema("agent_science");

export const researchProjects = agentScience.table(
  "research_projects",
  {
    projectId: uuid("project_id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    workspaceId: uuid("workspace_id"),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    sharingStrategy: text("sharing_strategy").notNull(),
    syncSource: text("sync_source").notNull().default("desktop"),
    defaultChatId: uuid("default_chat_id").references((): AnyPgColumn => researchChats.chatId, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("idx_postgres_research_projects_user_title").on(table.userId, table.title),
    index("idx_postgres_research_projects_user_updated").on(table.userId, table.updatedAt),
  ],
);

export const researchChats = agentScience.table(
  "research_chats",
  {
    chatId: uuid("chat_id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => researchProjects.projectId, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    workspaceId: uuid("workspace_id"),
    title: text("title").notNull(),
    agentProfile: text("agent_profile").notNull().default("agentscience"),
    status: text("status").notNull().default("active"),
    sharingStrategy: text("sharing_strategy").notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_postgres_research_chats_project_updated").on(table.projectId, table.updatedAt),
    index("idx_postgres_research_chats_user_updated").on(table.userId, table.updatedAt),
  ],
);

export const chatMessages = agentScience.table(
  "chat_messages",
  {
    messageId: uuid("message_id").defaultRandom().primaryKey(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => researchChats.chatId, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => researchProjects.projectId, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    role: text("role").notNull(),
    messageType: text("message_type").notNull().default("text"),
    contentMarkdown: text("content_markdown").notNull(),
    clientCreatedAt: timestamp("client_created_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sequenceNo: bigint("sequence_no", { mode: "number" }).notNull(),
    runId: uuid("run_id"),
    metadataJson: jsonb("metadata_json").notNull().default({}),
  },
  (table) => [
    uniqueIndex("idx_postgres_chat_messages_chat_sequence").on(table.chatId, table.sequenceNo),
    index("idx_postgres_chat_messages_chat_created").on(table.chatId, table.createdAt),
  ],
);

export const researchRuns = agentScience.table(
  "research_runs",
  {
    runId: uuid("run_id").defaultRandom().primaryKey(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => researchChats.chatId, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => researchProjects.projectId, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    workspaceId: uuid("workspace_id"),
    triggerMessageId: uuid("trigger_message_id").references(() => chatMessages.messageId, {
      onDelete: "set null",
    }),
    status: text("status").notNull(),
    phase: text("phase").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    publishedPaperId: uuid("published_paper_id").references((): AnyPgColumn => papers.paperId, {
      onDelete: "set null",
    }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    runtimeMetadataJson: jsonb("runtime_metadata_json").notNull().default({}),
  },
  (table) => [
    index("idx_postgres_research_runs_chat_started").on(table.chatId, table.startedAt),
    index("idx_postgres_research_runs_user_started").on(table.userId, table.startedAt),
  ],
);

export const artifacts = agentScience.table(
  "artifacts",
  {
    artifactId: uuid("artifact_id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    workspaceId: uuid("workspace_id"),
    ownerType: text("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    artifactType: text("artifact_type").notNull(),
    storageProvider: text("storage_provider").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type"),
    byteSize: bigint("byte_size", { mode: "number" }),
    checksumSha256: text("checksum_sha256"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_postgres_artifacts_owner").on(table.ownerType, table.ownerId, table.createdAt),
  ],
);

export const papers = agentScience.table(
  "papers",
  {
    paperId: uuid("paper_id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => researchProjects.projectId, { onDelete: "cascade" }),
    chatId: uuid("chat_id").references(() => researchChats.chatId, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => researchRuns.runId, { onDelete: "set null" }),
    userId: uuid("user_id").notNull(),
    workspaceId: uuid("workspace_id"),
    title: text("title").notNull(),
    abstract: text("abstract"),
    status: text("status").notNull(),
    publicationVisibility: text("publication_visibility").notNull().default("private"),
    pdfArtifactId: uuid("pdf_artifact_id").references(() => artifacts.artifactId, {
      onDelete: "set null",
    }),
    latexArtifactId: uuid("latex_artifact_id").references(() => artifacts.artifactId, {
      onDelete: "set null",
    }),
    sourceSnapshotJson: jsonb("source_snapshot_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_postgres_papers_user_created").on(table.userId, table.createdAt),
    index("idx_postgres_papers_project_created").on(table.projectId, table.createdAt),
  ],
);

export const runEvents = agentScience.table(
  "run_events",
  {
    runEventId: uuid("run_event_id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => researchRuns.runId, { onDelete: "cascade" }),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => researchChats.chatId, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    sequenceNo: bigint("sequence_no", { mode: "number" }).notNull(),
    eventType: text("event_type").notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_postgres_run_events_run_sequence").on(table.runId, table.sequenceNo),
  ],
);

export const paperDatasetLinks = agentScience.table(
  "paper_dataset_links",
  {
    paperDatasetLinkId: uuid("paper_dataset_link_id").defaultRandom().primaryKey(),
    paperId: uuid("paper_id")
      .notNull()
      .references(() => papers.paperId, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    datasetSource: text("dataset_source").notNull(),
    datasetExternalId: text("dataset_external_id"),
    datasetLabel: text("dataset_label").notNull(),
    citationText: text("citation_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_postgres_paper_dataset_links_paper").on(table.paperId, table.createdAt)],
);

export type PostgresResearchProject = typeof researchProjects.$inferSelect;
export type PostgresResearchChat = typeof researchChats.$inferSelect;
export type PostgresChatMessage = typeof chatMessages.$inferSelect;
export type PostgresResearchRun = typeof researchRuns.$inferSelect;
export type PostgresArtifact = typeof artifacts.$inferSelect;
export type PostgresPaper = typeof papers.$inferSelect;
export type PostgresRunEvent = typeof runEvents.$inferSelect;
export type PostgresPaperDatasetLink = typeof paperDatasetLinks.$inferSelect;
