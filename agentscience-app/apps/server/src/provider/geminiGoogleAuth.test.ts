import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_SERVER_SETTINGS } from "@agentscience/contracts";
import { Effect, Layer } from "effect";
import { afterAll, afterEach, beforeEach, describe, it } from "vitest";

import { ServerConfig } from "../config";
import { ServerSettingsService } from "../serverSettings";
import { loginGeminiWithGoogle } from "./geminiGoogleAuth";

const tempDir = mkdtempSync(join(tmpdir(), "agentscience-gemini-google-auth-test-"));
const fakeGeminiPath = join(tempDir, "fake-gemini.mjs");
const authLogPath = join(tempDir, "auth-log.jsonl");

writeFileSync(
  fakeGeminiPath,
  `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

rl.on("line", (line) => {
  const message = JSON.parse(line);
  const { id, method, params } = message;
  if (method === "initialize") {
    write({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: 1,
        authMethods: [{ id: "oauth-personal", name: "Log in with Google" }],
        agentInfo: { name: "fake-gemini", title: "Fake Gemini", version: "0.0.0" },
        agentCapabilities: {},
      },
    });
    return;
  }
  if (method === "authenticate") {
    appendFileSync(process.env.AUTH_LOG_PATH, JSON.stringify({
      params,
      env: {
        GEMINI_CLI_HOME: process.env.GEMINI_CLI_HOME,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY,
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
        GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        GEMINI_FORCE_ENCRYPTED_FILE_STORAGE: process.env.GEMINI_FORCE_ENCRYPTED_FILE_STORAGE,
      },
    }) + "\\n");
    write({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  write({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});
`,
);
chmodSync(fakeGeminiPath, 0o755);

beforeEach(() => {
  process.env.AUTH_LOG_PATH = authLogPath;
  process.env.GEMINI_CLI_HOME = "/Users/scientist";
  process.env.GEMINI_API_KEY = "external-gemini-key";
  process.env.GOOGLE_API_KEY = "external-google-key";
  process.env.GOOGLE_APPLICATION_CREDENTIALS = "/Users/scientist/gcloud.json";
  writeFileSync(authLogPath, "");
});

afterEach(() => {
  delete process.env.AUTH_LOG_PATH;
  delete process.env.GEMINI_CLI_HOME;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("loginGeminiWithGoogle", () => {
  it("authenticates through Gemini ACP without changing the selected model provider", async () => {
    const layer = Layer.empty.pipe(
      Layer.provideMerge(
        ServerSettingsService.layerTest({
          providers: {
            gemini: {
              binaryPath: fakeGeminiPath,
              authMethod: "gemini-api-key",
            },
          },
        }),
      ),
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), { prefix: "gemini-google-auth-test-" }),
      ),
      Layer.provideMerge(NodeServices.layer),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const settings = yield* loginGeminiWithGoogle();
        return { config, settings };
      }).pipe(Effect.provide(layer)),
    );
    const authCalls = readFileSync(authLogPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as {
            params?: { methodId?: string };
            env?: Record<string, string | undefined>;
          },
      );

    assert.deepEqual(authCalls.map((call) => call.params), [{ methodId: "oauth-personal" }]);
    assert.equal(authCalls[0]?.env?.GEMINI_CLI_HOME, join(result.config.stateDir, "gemini"));
    assert.equal(authCalls[0]?.env?.GEMINI_API_KEY, undefined);
    assert.equal(authCalls[0]?.env?.GOOGLE_API_KEY, undefined);
    assert.equal(authCalls[0]?.env?.GOOGLE_APPLICATION_CREDENTIALS, undefined);
    assert.equal(authCalls[0]?.env?.GEMINI_FORCE_ENCRYPTED_FILE_STORAGE, "false");
    assert.deepEqual(
      result.settings.textGenerationModelSelection,
      DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
    );
    assert.equal(result.settings.providers.gemini.authMethod, "oauth-personal");
    assert.equal(result.settings.providers.gemini.enabled, true);
    assert.deepEqual(result.settings.providers.codex, DEFAULT_SERVER_SETTINGS.providers.codex);
  });
});
