import { defineConfig } from "drizzle-kit";

const sqliteUrl = process.env.AGENTSCIENCE_LOCAL_DB_URL ?? "./db/sqlite/agentscience.sqlite";

export default defineConfig({
  schema: "./db/schema/sqlite.ts",
  out: "./db/sqlite/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: sqliteUrl,
  },
  strict: true,
  verbose: true,
});
