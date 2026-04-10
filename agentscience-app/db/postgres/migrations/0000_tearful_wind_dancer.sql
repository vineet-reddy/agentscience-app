CREATE TABLE "agent_science"."artifacts" (
	"artifact_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"artifact_type" text NOT NULL,
	"storage_provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text,
	"byte_size" bigint,
	"checksum_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_science"."chat_messages" (
	"message_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"message_type" text DEFAULT 'text' NOT NULL,
	"content_markdown" text NOT NULL,
	"client_created_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sequence_no" bigint NOT NULL,
	"run_id" uuid,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_science"."paper_dataset_links" (
	"paper_dataset_link_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paper_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"dataset_source" text NOT NULL,
	"dataset_external_id" text,
	"dataset_label" text NOT NULL,
	"citation_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_science"."papers" (
	"paper_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"chat_id" uuid,
	"run_id" uuid,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"title" text NOT NULL,
	"abstract" text,
	"status" text NOT NULL,
	"publication_visibility" text DEFAULT 'private' NOT NULL,
	"pdf_artifact_id" uuid,
	"latex_artifact_id" uuid,
	"source_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_science"."research_chats" (
	"chat_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"title" text NOT NULL,
	"agent_profile" text DEFAULT 'agentscience' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sharing_strategy" text NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_science"."research_projects" (
	"project_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"sharing_strategy" text NOT NULL,
	"sync_source" text DEFAULT 'desktop' NOT NULL,
	"default_chat_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_science"."research_runs" (
	"run_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"trigger_message_id" uuid,
	"status" text NOT NULL,
	"phase" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"published_paper_id" uuid,
	"error_code" text,
	"error_message" text,
	"runtime_metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_science"."run_events" (
	"run_event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"sequence_no" bigint NOT NULL,
	"event_type" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_science"."chat_messages" ADD CONSTRAINT "chat_messages_chat_id_research_chats_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "agent_science"."research_chats"("chat_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_science"."chat_messages" ADD CONSTRAINT "chat_messages_project_id_research_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "agent_science"."research_projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_science"."paper_dataset_links" ADD CONSTRAINT "paper_dataset_links_paper_id_papers_paper_id_fk" FOREIGN KEY ("paper_id") REFERENCES "agent_science"."papers"("paper_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_science"."papers" ADD CONSTRAINT "papers_project_id_research_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "agent_science"."research_projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_science"."papers" ADD CONSTRAINT "papers_chat_id_research_chats_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "agent_science"."research_chats"("chat_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_science"."papers" ADD CONSTRAINT "papers_run_id_research_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "agent_science"."research_runs"("run_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_science"."papers" ADD CONSTRAINT "papers_pdf_artifact_id_artifacts_artifact_id_fk" FOREIGN KEY ("pdf_artifact_id") REFERENCES "agent_science"."artifacts"("artifact_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_science"."papers" ADD CONSTRAINT "papers_latex_artifact_id_artifacts_artifact_id_fk" FOREIGN KEY ("latex_artifact_id") REFERENCES "agent_science"."artifacts"("artifact_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_science"."research_chats" ADD CONSTRAINT "research_chats_project_id_research_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "agent_science"."research_projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_science"."research_projects" ADD CONSTRAINT "research_projects_default_chat_id_research_chats_chat_id_fk" FOREIGN KEY ("default_chat_id") REFERENCES "agent_science"."research_chats"("chat_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_science"."research_runs" ADD CONSTRAINT "research_runs_chat_id_research_chats_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "agent_science"."research_chats"("chat_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_science"."research_runs" ADD CONSTRAINT "research_runs_project_id_research_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "agent_science"."research_projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_science"."research_runs" ADD CONSTRAINT "research_runs_trigger_message_id_chat_messages_message_id_fk" FOREIGN KEY ("trigger_message_id") REFERENCES "agent_science"."chat_messages"("message_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_science"."research_runs" ADD CONSTRAINT "research_runs_published_paper_id_papers_paper_id_fk" FOREIGN KEY ("published_paper_id") REFERENCES "agent_science"."papers"("paper_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_science"."run_events" ADD CONSTRAINT "run_events_run_id_research_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "agent_science"."research_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_science"."run_events" ADD CONSTRAINT "run_events_chat_id_research_chats_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "agent_science"."research_chats"("chat_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_postgres_artifacts_owner" ON "agent_science"."artifacts" USING btree ("owner_type","owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_postgres_chat_messages_chat_sequence" ON "agent_science"."chat_messages" USING btree ("chat_id","sequence_no");--> statement-breakpoint
CREATE INDEX "idx_postgres_chat_messages_chat_created" ON "agent_science"."chat_messages" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_postgres_paper_dataset_links_paper" ON "agent_science"."paper_dataset_links" USING btree ("paper_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_postgres_papers_user_created" ON "agent_science"."papers" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_postgres_papers_project_created" ON "agent_science"."papers" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_postgres_research_chats_project_updated" ON "agent_science"."research_chats" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "idx_postgres_research_chats_user_updated" ON "agent_science"."research_chats" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_postgres_research_projects_user_title" ON "agent_science"."research_projects" USING btree ("user_id","title");--> statement-breakpoint
CREATE INDEX "idx_postgres_research_projects_user_updated" ON "agent_science"."research_projects" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "idx_postgres_research_runs_chat_started" ON "agent_science"."research_runs" USING btree ("chat_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_postgres_research_runs_user_started" ON "agent_science"."research_runs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_postgres_run_events_run_sequence" ON "agent_science"."run_events" USING btree ("run_id","sequence_no");