import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

function slugBase(title: string, fallback: string): string {
  const cleaned = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : fallback;
}

function nextUniqueSlug(baseSlug: string, taken: Set<string>): string {
  if (!taken.has(baseSlug)) {
    taken.add(baseSlug);
    return baseSlug;
  }

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${baseSlug}-${suffix}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
    suffix += 1;
  }

  const fallback = `${baseSlug}-${Date.now()}`;
  taken.add(fallback);
  return fallback;
}

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const projectRows = yield* sql<{
    readonly projectId: string;
    readonly userId: string;
    readonly workspaceId: string | null;
    readonly title: string;
    readonly description: string | null;
    readonly status: string;
    readonly sharingStrategy: string;
    readonly syncState: string;
    readonly remoteProjectId: string | null;
    readonly defaultChatId: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly archivedAt: string | null;
  }>`
    SELECT
      project_id AS "projectId",
      user_id AS "userId",
      workspace_id AS "workspaceId",
      title,
      description,
      status,
      sharing_strategy AS "sharingStrategy",
      sync_state AS "syncState",
      remote_project_id AS "remoteProjectId",
      default_chat_id AS "defaultChatId",
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      archived_at AS "archivedAt"
    FROM research_projects
    ORDER BY created_at ASC, project_id ASC
  `;

  const projectSlugsById = new Map<string, string>();
  const takenProjectSlugsByUser = new Map<string, Set<string>>();
  for (const row of projectRows) {
    const taken = takenProjectSlugsByUser.get(row.userId) ?? new Set<string>();
    takenProjectSlugsByUser.set(row.userId, taken);
    projectSlugsById.set(
      row.projectId,
      nextUniqueSlug(slugBase(row.title, "project"), taken),
    );
  }

  const chatRows = yield* sql<{
    readonly threadId: string;
    readonly projectId: string | null;
    readonly userId: string;
    readonly title: string;
  }>`
    SELECT
      chat_id AS "threadId",
      project_id AS "projectId",
      user_id AS "userId",
      title
    FROM research_chats
    ORDER BY created_at ASC, chat_id ASC
  `;

  const chatSlugsById = new Map<string, string>();
  const takenChatSlugsByScope = new Map<string, Set<string>>();
  for (const row of chatRows) {
    const scopeKey = `${row.userId}:${row.projectId ?? "__root__"}`;
    const taken = takenChatSlugsByScope.get(scopeKey) ?? new Set<string>();
    takenChatSlugsByScope.set(scopeKey, taken);
    chatSlugsById.set(row.threadId, nextUniqueSlug(slugBase(row.title, "paper"), taken));
  }

  const chatTableInfo = yield* sql<{
    readonly name: string;
  }>`
    PRAGMA table_info(research_chats)
  `;
  if (!chatTableInfo.some((column) => column.name === "folder_slug")) {
    yield* sql`
      ALTER TABLE research_chats
      ADD COLUMN folder_slug TEXT
    `;
  }

  const projectionProjectTableInfo = yield* sql<{
    readonly name: string;
  }>`
    PRAGMA table_info(projection_projects)
  `;
  if (!projectionProjectTableInfo.some((column) => column.name === "folder_slug")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN folder_slug TEXT
    `;
  }

  const projectionThreadTableInfo = yield* sql<{
    readonly name: string;
  }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!projectionThreadTableInfo.some((column) => column.name === "folder_slug")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN folder_slug TEXT
    `;
  }

  yield* Effect.forEach(
    chatSlugsById,
    ([threadId, folderSlug]) =>
      sql`
        UPDATE research_chats
        SET folder_slug = ${folderSlug}
        WHERE chat_id = ${threadId}
      `,
    { concurrency: 1 },
  );

  yield* sql`
    DROP INDEX IF EXISTS idx_sqlite_research_projects_user_workspace_root
  `;

  yield* sql`
    DROP INDEX IF EXISTS idx_sqlite_research_projects_user_updated
  `;

  yield* sql`
    ALTER TABLE research_projects
    RENAME TO research_projects__legacy
  `;

  yield* sql`
    CREATE TABLE research_projects (
      project_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workspace_id TEXT,
      folder_slug TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      sharing_strategy TEXT NOT NULL DEFAULT 'local_only',
      sync_state TEXT NOT NULL DEFAULT 'local_only',
      remote_project_id TEXT,
      default_chat_id TEXT REFERENCES research_chats(chat_id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    )
  `;

  yield* Effect.forEach(
    projectRows,
    (row) =>
      sql`
        INSERT INTO research_projects (
          project_id,
          user_id,
          workspace_id,
          folder_slug,
          title,
          description,
          status,
          sharing_strategy,
          sync_state,
          remote_project_id,
          default_chat_id,
          created_at,
          updated_at,
          archived_at
        )
        VALUES (
          ${row.projectId},
          ${row.userId},
          ${row.workspaceId},
          ${projectSlugsById.get(row.projectId) ?? slugBase(row.title, "project")},
          ${row.title},
          ${row.description},
          ${row.status},
          ${row.sharingStrategy},
          ${row.syncState},
          ${row.remoteProjectId},
          ${row.defaultChatId},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.archivedAt}
        )
      `,
    { concurrency: 1 },
  );

  yield* sql`
    CREATE UNIQUE INDEX idx_sqlite_research_projects_user_folder_slug
    ON research_projects(user_id, folder_slug)
  `;
  yield* sql`
    CREATE INDEX idx_sqlite_research_projects_user_updated
    ON research_projects(user_id, updated_at)
  `;

  yield* Effect.forEach(
    projectSlugsById,
    ([projectId, folderSlug]) =>
      sql`
        UPDATE projection_projects
        SET folder_slug = ${folderSlug}
        WHERE project_id = ${projectId}
      `,
    { concurrency: 1 },
  );

  yield* sql`
    DROP INDEX IF EXISTS idx_projection_projects_workspace_root_deleted_at
  `;

  yield* sql`
    CREATE TABLE projection_projects__new (
      project_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      folder_slug TEXT NOT NULL,
      default_model_selection_json TEXT,
      scripts_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `;

  yield* sql`
    INSERT INTO projection_projects__new (
      project_id,
      title,
      folder_slug,
      default_model_selection_json,
      scripts_json,
      created_at,
      updated_at,
      deleted_at
    )
    SELECT
      project_id,
      title,
      folder_slug,
      default_model_selection_json,
      scripts_json,
      created_at,
      updated_at,
      deleted_at
    FROM projection_projects
  `;

  yield* sql`
    DROP TABLE projection_projects
  `;

  yield* sql`
    ALTER TABLE projection_projects__new
    RENAME TO projection_projects
  `;

  yield* sql`
    CREATE INDEX idx_projection_projects_updated_at
    ON projection_projects(updated_at)
  `;

  yield* Effect.forEach(
    chatSlugsById,
    ([threadId, folderSlug]) =>
      sql`
        UPDATE projection_threads
        SET folder_slug = ${folderSlug}
        WHERE thread_id = ${threadId}
      `,
    { concurrency: 1 },
  );
});
