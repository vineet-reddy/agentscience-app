CREATE TABLE `artifacts` (
	`artifact_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`artifact_type` text NOT NULL,
	`storage_provider` text DEFAULT 'local_fs' NOT NULL,
	`storage_key` text NOT NULL,
	`mime_type` text,
	`byte_size` integer,
	`checksum_sha256` text,
	`sharing_strategy` text NOT NULL,
	`sync_state` text DEFAULT 'local_only' NOT NULL,
	`remote_artifact_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sqlite_artifacts_owner` ON `artifacts` (`owner_type`,`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`message_id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`message_type` text DEFAULT 'text' NOT NULL,
	`content_markdown` text NOT NULL,
	`client_created_at` text,
	`created_at` text NOT NULL,
	`sequence_no` integer NOT NULL,
	`run_id` text,
	`sharing_strategy` text NOT NULL,
	`sync_state` text DEFAULT 'local_only' NOT NULL,
	`remote_message_id` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `research_chats`(`chat_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `research_projects`(`project_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sqlite_chat_messages_chat_sequence` ON `chat_messages` (`chat_id`,`sequence_no`);--> statement-breakpoint
CREATE INDEX `idx_sqlite_chat_messages_chat_created` ON `chat_messages` (`chat_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `device_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `paper_dataset_links` (
	`paper_dataset_link_id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`user_id` text NOT NULL,
	`dataset_source` text NOT NULL,
	`dataset_external_id` text,
	`dataset_label` text NOT NULL,
	`citation_text` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`paper_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sqlite_paper_dataset_links_paper` ON `paper_dataset_links` (`paper_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `papers` (
	`paper_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`chat_id` text,
	`run_id` text,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`title` text NOT NULL,
	`abstract` text,
	`status` text NOT NULL,
	`publication_visibility` text DEFAULT 'private' NOT NULL,
	`pdf_artifact_id` text,
	`latex_artifact_id` text,
	`sharing_strategy` text NOT NULL,
	`sync_state` text DEFAULT 'local_only' NOT NULL,
	`remote_paper_id` text,
	`source_snapshot_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`published_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `research_projects`(`project_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `research_chats`(`chat_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `research_runs`(`run_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`pdf_artifact_id`) REFERENCES `artifacts`(`artifact_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`latex_artifact_id`) REFERENCES `artifacts`(`artifact_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_sqlite_papers_user_created` ON `papers` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sqlite_papers_project_created` ON `papers` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `research_chats` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`title` text NOT NULL,
	`agent_profile` text DEFAULT 'agentscience' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`sharing_strategy` text NOT NULL,
	`sync_state` text DEFAULT 'local_only' NOT NULL,
	`remote_chat_id` text,
	`last_message_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `research_projects`(`project_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sqlite_research_chats_project_updated` ON `research_chats` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_sqlite_research_chats_user_updated` ON `research_chats` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `research_projects` (
	`project_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`sharing_strategy` text DEFAULT 'local_only' NOT NULL,
	`sync_state` text DEFAULT 'local_only' NOT NULL,
	`remote_project_id` text,
	`default_chat_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`default_chat_id`) REFERENCES `research_chats`(`chat_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sqlite_research_projects_user_title` ON `research_projects` (`user_id`,`title`);--> statement-breakpoint
CREATE INDEX `idx_sqlite_research_projects_user_updated` ON `research_projects` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `research_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`trigger_message_id` text,
	`status` text NOT NULL,
	`phase` text NOT NULL,
	`sharing_strategy` text NOT NULL,
	`sync_state` text DEFAULT 'local_only' NOT NULL,
	`remote_run_id` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`failed_at` text,
	`published_paper_id` text,
	`error_code` text,
	`error_message` text,
	`runtime_metadata_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `research_chats`(`chat_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `research_projects`(`project_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trigger_message_id`) REFERENCES `chat_messages`(`message_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`published_paper_id`) REFERENCES `papers`(`paper_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_sqlite_research_runs_chat_started` ON `research_runs` (`chat_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_sqlite_research_runs_user_started` ON `research_runs` (`user_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `sync_queue` (
	`queue_id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`operation` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sqlite_sync_queue_status_created` ON `sync_queue` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sqlite_sync_queue_entity` ON `sync_queue` (`entity_type`,`entity_id`);