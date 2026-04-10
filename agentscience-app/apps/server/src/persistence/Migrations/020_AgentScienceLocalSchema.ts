import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS artifacts (
      artifact_id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      workspace_id TEXT,
      owner_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      storage_provider TEXT DEFAULT 'local_fs' NOT NULL,
      storage_key TEXT NOT NULL,
      mime_type TEXT,
      byte_size INTEGER,
      checksum_sha256 TEXT,
      sharing_strategy TEXT NOT NULL,
      sync_state TEXT DEFAULT 'local_only' NOT NULL,
      remote_artifact_id TEXT,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_sqlite_artifacts_owner
    ON artifacts(owner_type, owner_id, created_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS device_state (
      key TEXT PRIMARY KEY NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS research_projects (
      project_id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      workspace_id TEXT,
      workspace_root TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'active' NOT NULL,
      sharing_strategy TEXT DEFAULT 'local_only' NOT NULL,
      sync_state TEXT DEFAULT 'local_only' NOT NULL,
      remote_project_id TEXT,
      default_chat_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      FOREIGN KEY (default_chat_id) REFERENCES research_chats(chat_id) ON DELETE SET NULL
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sqlite_research_projects_user_workspace_root
    ON research_projects(user_id, workspace_root)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_sqlite_research_projects_user_updated
    ON research_projects(user_id, updated_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS research_chats (
      chat_id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      workspace_id TEXT,
      title TEXT NOT NULL,
      agent_profile TEXT DEFAULT 'agentscience' NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      sharing_strategy TEXT NOT NULL,
      sync_state TEXT DEFAULT 'local_only' NOT NULL,
      remote_chat_id TEXT,
      last_message_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      FOREIGN KEY (project_id) REFERENCES research_projects(project_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_sqlite_research_chats_project_updated
    ON research_chats(project_id, updated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_sqlite_research_chats_user_updated
    ON research_chats(user_id, updated_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS chat_messages (
      message_id TEXT PRIMARY KEY NOT NULL,
      chat_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      message_type TEXT DEFAULT 'text' NOT NULL,
      content_markdown TEXT NOT NULL,
      client_created_at TEXT,
      created_at TEXT NOT NULL,
      sequence_no INTEGER NOT NULL,
      run_id TEXT,
      sharing_strategy TEXT NOT NULL,
      sync_state TEXT DEFAULT 'local_only' NOT NULL,
      remote_message_id TEXT,
      metadata_json TEXT DEFAULT '{}' NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES research_chats(chat_id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES research_projects(project_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sqlite_chat_messages_chat_sequence
    ON chat_messages(chat_id, sequence_no)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_sqlite_chat_messages_chat_created
    ON chat_messages(chat_id, created_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS papers (
      paper_id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      chat_id TEXT,
      run_id TEXT,
      user_id TEXT NOT NULL,
      workspace_id TEXT,
      title TEXT NOT NULL,
      abstract TEXT,
      status TEXT NOT NULL,
      publication_visibility TEXT DEFAULT 'private' NOT NULL,
      pdf_artifact_id TEXT,
      latex_artifact_id TEXT,
      sharing_strategy TEXT NOT NULL,
      sync_state TEXT DEFAULT 'local_only' NOT NULL,
      remote_paper_id TEXT,
      source_snapshot_json TEXT DEFAULT '{}' NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT,
      FOREIGN KEY (project_id) REFERENCES research_projects(project_id) ON DELETE CASCADE,
      FOREIGN KEY (chat_id) REFERENCES research_chats(chat_id) ON DELETE SET NULL,
      FOREIGN KEY (run_id) REFERENCES research_runs(run_id) ON DELETE SET NULL,
      FOREIGN KEY (pdf_artifact_id) REFERENCES artifacts(artifact_id) ON DELETE SET NULL,
      FOREIGN KEY (latex_artifact_id) REFERENCES artifacts(artifact_id) ON DELETE SET NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_sqlite_papers_user_created
    ON papers(user_id, created_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_sqlite_papers_project_created
    ON papers(project_id, created_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS paper_dataset_links (
      paper_dataset_link_id TEXT PRIMARY KEY NOT NULL,
      paper_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      dataset_source TEXT NOT NULL,
      dataset_external_id TEXT,
      dataset_label TEXT NOT NULL,
      citation_text TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (paper_id) REFERENCES papers(paper_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_sqlite_paper_dataset_links_paper
    ON paper_dataset_links(paper_id, created_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS research_runs (
      run_id TEXT PRIMARY KEY NOT NULL,
      chat_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      workspace_id TEXT,
      trigger_message_id TEXT,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      sharing_strategy TEXT NOT NULL,
      sync_state TEXT DEFAULT 'local_only' NOT NULL,
      remote_run_id TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      failed_at TEXT,
      published_paper_id TEXT,
      error_code TEXT,
      error_message TEXT,
      runtime_metadata_json TEXT DEFAULT '{}' NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES research_chats(chat_id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES research_projects(project_id) ON DELETE CASCADE,
      FOREIGN KEY (trigger_message_id) REFERENCES chat_messages(message_id) ON DELETE SET NULL,
      FOREIGN KEY (published_paper_id) REFERENCES papers(paper_id) ON DELETE SET NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_sqlite_research_runs_chat_started
    ON research_runs(chat_id, started_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_sqlite_research_runs_user_started
    ON research_runs(user_id, started_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS sync_queue (
      queue_id TEXT PRIMARY KEY NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT DEFAULT 'pending' NOT NULL,
      retry_count INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_sqlite_sync_queue_status_created
    ON sync_queue(status, created_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_sqlite_sync_queue_entity
    ON sync_queue(entity_type, entity_id)
  `;
});
