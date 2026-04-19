import { defineConfig } from "tsdown";

const sourcemapEnv = process.env.AGENTSCIENCE_SERVER_SOURCEMAP?.trim().toLowerCase();
const shouldEmitSourcemaps = !(sourcemapEnv === "0" || sourcemapEnv === "false");

export default defineConfig({
  entry: ["src/bin.ts"],
  format: ["esm", "cjs"],
  checks: {
    legacyCjs: false,
  },
  outDir: "dist",
  sourcemap: shouldEmitSourcemaps,
  clean: true,
  noExternal: (id) => id.startsWith("@agentscience/"),
  inlineOnly: false,
  banner: {
    js: "#!/usr/bin/env node\n",
  },
});
