import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const chatRows = yield* sql<{
    readonly threadId: string;
    readonly projectId: string | null;
    readonly userId: string;
    readonly workspaceId: string | null;
    readonly folderSlug: string | null;
    readonly title: string;
    readonly agentProfile: string;
    readonly status: string;
    readonly sharingStrategy: string;
    readonly syncState: string;
    readonly remoteChatId: string | null;
    readonly lastMessageAt: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly archivedAt: string | null;
  }>`
    SELECT
      chat_id AS "threadId",
      project_id AS "projectId",
      user_id AS "userId",
      workspace_id AS "workspaceId",
      folder_slug AS "folderSlug",
      title,
      agent_profile AS "agentProfile",
      status,
      sharing_strategy AS "sharingStrategy",
      sync_state AS "syncState",
      remote_chat_id AS "remoteChatId",
      last_message_at AS "lastMessageAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      archived_at AS "archivedAt"
    FROM research_chats
    ORDER BY created_at ASC, chat_id ASC
  `;

  const chatMessageRows = yield* sql<{
    readonly messageId: string;
    readonly chatId: string;
    readonly projectId: string | null;
    readonly userId: string;
    readonly role: string;
    readonly messageType: string;
    readonly contentMarkdown: string;
    readonly clientCreatedAt: string | null;
    readonly createdAt: string;
    readonly sequenceNo: number;
    readonly runId: string | null;
    readonly sharingStrategy: string;
    readonly syncState: string;
    readonly remoteMessageId: string | null;
    readonly metadataJson: string;
  }>`
    SELECT
      message_id AS "messageId",
      chat_id AS "chatId",
      project_id AS "projectId",
      user_id AS "userId",
      role,
      message_type AS "messageType",
      content_markdown AS "contentMarkdown",
      client_created_at AS "clientCreatedAt",
      created_at AS "createdAt",
      sequence_no AS "sequenceNo",
      run_id AS "runId",
      sharing_strategy AS "sharingStrategy",
      sync_state AS "syncState",
      remote_message_id AS "remoteMessageId",
      metadata_json AS "metadataJson"
    FROM chat_messages
    ORDER BY created_at ASC, message_id ASC
  `;

  yield* sql`
    PRAGMA foreign_keys = OFF
  `;

  yield* sql`
    CREATE TABLE research_chats__new (
      chat_id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES research_projects(project_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      workspace_id TEXT,
      folder_slug TEXT NOT NULL,
      title TEXT NOT NULL,
      agent_profile TEXT NOT NULL DEFAULT 'agentscience',
      status TEXT NOT NULL DEFAULT 'active',
      sharing_strategy TEXT NOT NULL,
      sync_state TEXT NOT NULL DEFAULT 'local_only',
      remote_chat_id TEXT,
      last_message_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    )
  `;

  yield* Effect.forEach(
    chatRows,
    (row) =>
      sql`
        INSERT INTO research_chats__new (
          chat_id,
          project_id,
          user_id,
          workspace_id,
          folder_slug,
          title,
          agent_profile,
          status,
          sharing_strategy,
          sync_state,
          remote_chat_id,
          last_message_at,
          created_at,
          updated_at,
          archived_at
        )
        VALUES (
          ${row.threadId},
          ${row.projectId},
          ${row.userId},
          ${row.workspaceId},
          ${row.folderSlug ?? "paper"},
          ${row.title},
          ${row.agentProfile},
          ${row.status},
          ${row.sharingStrategy},
          ${row.syncState},
          ${row.remoteChatId},
          ${row.lastMessageAt},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.archivedAt}
        )
      `,
    { concurrency: 1 },
  );

  yield* sql`
    DROP TABLE research_chats
  `;
  yield* sql`
    ALTER TABLE research_chats__new
    RENAME TO research_chats
  `;

  yield* sql`
    CREATE INDEX idx_sqlite_research_chats_project_updated
    ON research_chats(project_id, updated_at)
  `;
  yield* sql`
    CREATE INDEX idx_sqlite_research_chats_user_updated
    ON research_chats(user_id, updated_at)
  `;

  yield* sql`
    CREATE TABLE chat_messages__new (
      message_id TEXT PRIMARY KEY NOT NULL,
      chat_id TEXT NOT NULL,
      project_id TEXT,
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

  yield* Effect.forEach(
    chatMessageRows,
    (row) =>
      sql`
        INSERT INTO chat_messages__new (
          message_id,
          chat_id,
          project_id,
          user_id,
          role,
          message_type,
          content_markdown,
          client_created_at,
          created_at,
          sequence_no,
          run_id,
          sharing_strategy,
          sync_state,
          remote_message_id,
          metadata_json
        )
        VALUES (
          ${row.messageId},
          ${row.chatId},
          ${row.projectId},
          ${row.userId},
          ${row.role},
          ${row.messageType},
          ${row.contentMarkdown},
          ${row.clientCreatedAt},
          ${row.createdAt},
          ${row.sequenceNo},
          ${row.runId},
          ${row.sharingStrategy},
          ${row.syncState},
          ${row.remoteMessageId},
          ${row.metadataJson}
        )
      `,
    { concurrency: 1 },
  );

  yield* sql`
    DROP TABLE chat_messages
  `;
  yield* sql`
    ALTER TABLE chat_messages__new
    RENAME TO chat_messages
  `;

  yield* sql`
    CREATE UNIQUE INDEX idx_sqlite_chat_messages_chat_sequence
    ON chat_messages(chat_id, sequence_no)
  `;
  yield* sql`
    CREATE INDEX idx_sqlite_chat_messages_chat_created
    ON chat_messages(chat_id, created_at)
  `;

  yield* sql`
    PRAGMA foreign_keys = ON
  `;
});
