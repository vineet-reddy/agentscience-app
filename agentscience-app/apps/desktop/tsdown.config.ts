import { defineConfig } from "tsdown";

const sourcemapEnv = process.env.AGENTSCIENCE_DESKTOP_SOURCEMAP?.trim().toLowerCase();
const shouldEmitSourcemaps = !(sourcemapEnv === "0" || sourcemapEnv === "false");

// Bake the Aptabase App Key into the bundle at build time. 
const aptabaseKey = process.env.AGENTSCIENCE_APTABASE_KEY?.trim() ?? "";

const shared = {
  format: "cjs" as const,
  outDir: "dist-electron",
  sourcemap: shouldEmitSourcemaps,
  outExtensions: () => ({ js: ".js" }),
  define: {
    __AGENTSCIENCE_APTABASE_KEY__: JSON.stringify(aptabaseKey),
  },
};

export default defineConfig([
  {
    ...shared,
    entry: ["src/main.ts"],
    clean: true,
    noExternal: (id) => id.startsWith("@agentscience/"),
  },
  {
    ...shared,
    entry: ["src/preload.ts"],
  },
]);
