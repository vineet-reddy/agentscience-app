# Database Layout

This folder holds the Agent Science database design and migration tooling.

## Structure

- `schema/shared.ts`: shared domain constants and TypeScript unions
- `schema/sqlite.ts`: local-first desktop SQLite schema
- `schema/postgres.ts`: server-side Postgres schema
- `drizzle.config.sqlite.ts`: Drizzle config for local SQLite migrations
- `drizzle.config.postgres.ts`: Drizzle config for server Postgres migrations
- `sqlite/migrations/`: generated SQLite migrations
- `postgres/migrations/`: generated Postgres migrations
- `postgres/bootstrap.sql`: one-time Postgres bootstrap for schema and extension setup

## Why It Is Split This Way

We want one logical product model with two storage backends:

- local SQLite is the workstation source of truth
- server Postgres is the sync and publishing database

That means the entity model stays aligned across both backends, while each database can
still use its own column types and migration output.

## Type Inference

Yes, you can inherit types from the Drizzle schemas later.

Examples:

- SQLite row types come from `db/schema/sqlite.ts`
- Postgres row types come from `db/schema/postgres.ts`
- shared string-union types come from `db/schema/shared.ts`

For example:

```ts
import type { SqliteResearchProject } from "../db/schema/sqlite";
import type { PostgresResearchProject } from "../db/schema/postgres";
import type { SharingStrategy } from "../db/schema/shared";
```

## Commands

Generate SQLite migrations:

```bash
pkgx bun run db:generate:sqlite
```

Generate Postgres migrations:

```bash
pkgx bun run db:generate:postgres
```

## Environment Variables

SQLite generation:

- `AGENTSCIENCE_LOCAL_DB_URL`
  - default: `./db/sqlite/agentscience.sqlite`

Postgres generation:

- `AGENTSCIENCE_DATABASE_URL`
  - default: `postgres://postgres:postgres@localhost:5432/agentscience`

## Postgres Bootstrap

Drizzle generates the table migrations, but it does not create the custom schema or
required extension automatically in this setup.

Before applying Postgres migrations in a fresh database, run:

```bash
psql "$AGENTSCIENCE_DATABASE_URL" -f ./db/postgres/bootstrap.sql
```

That creates:

- schema `agent_science`
- extension `pgcrypto`

## Removing the Latest Unapplied Migration

If you generated a migration and want to discard it before applying it anywhere:

1. Delete the newest SQL file in `sqlite/migrations/` or `postgres/migrations/`
2. Delete the newest matching snapshot in the backend's `meta/` folder
3. Update the backend's `meta/_journal.json` to remove that entry

If you want a safer workflow, regenerate only after schema edits are settled.
