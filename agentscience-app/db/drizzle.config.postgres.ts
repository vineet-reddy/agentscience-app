import { defineConfig } from "drizzle-kit";

const postgresUrl =
  process.env.AGENTSCIENCE_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/agentscience";

export default defineConfig({
  schema: "./db/schema/postgres.ts",
  out: "./db/postgres/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: postgresUrl,
  },
  strict: true,
  verbose: true,
});
