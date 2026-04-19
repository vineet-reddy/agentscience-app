import { defineConfig } from "tsdown";

const sourcemapEnv = process.env.AGENTSCIENCE_DESKTOP_SOURCEMAP?.trim().toLowerCase();
const shouldEmitSourcemaps = !(sourcemapEnv === "0" || sourcemapEnv === "false");

const shared = {
  format: "cjs" as const,
  outDir: "dist-electron",
  sourcemap: shouldEmitSourcemaps,
  outExtensions: () => ({ js: ".js" }),
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
