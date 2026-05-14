import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ThreadId } from "@agentscience/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, describe, it } from "vitest";
import { Effect, Layer } from "effect";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { GeminiAdapter } from "../Services/GeminiAdapter.ts";
import { makeGeminiAdapterLive } from "./GeminiAdapter.ts";

const tempDir = mkdtempSync(join(tmpdir(), "agentscience-gemini-adapter-test-"));
const fakeGeminiPath = join(tempDir, "fake-gemini.mjs");

writeFileSync(
  fakeGeminiPath,
  `#!/usr/bin/env node
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
        agentCapabilities: { promptCapabilities: { image: true, embeddedContext: true } },
      },
    });
    return;
  }
  if (method === "authenticate") {
    write({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "session/new") {
    write({
      jsonrpc: "2.0",
      id,
      result: {
        sessionId: "fake-session",
        modes: { currentModeId: "default", availableModes: [] },
        models: {
          currentModelId: "gemini-3.1-pro-preview",
          availableModels: [
            { modelId: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
          ],
        },
      },
    });
    return;
  }
  if (method === "session/set_mode" || method === "session/set_model") {
    write({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "session/prompt") {
    write({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Gemini response" },
        },
      },
    });
    write({ jsonrpc: "2.0", id, result: { stopReason: "end_turn" } });
    return;
  }
  write({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});
`,
);
chmodSync(fakeGeminiPath, 0o755);

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const liveLayer = makeGeminiAdapterLive().pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "gemini-adapter-test-" })),
  Layer.provideMerge(
    ServerSettingsService.layerTest({
      providers: {
        gemini: {
          binaryPath: fakeGeminiPath,
          authMethod: "oauth-personal",
        },
      },
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

describe("GeminiAdapterLive", () => {
  it("starts a Gemini ACP session and captures assistant output", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const adapter = yield* GeminiAdapter;
        const threadId = ThreadId.makeUnsafe("thread-gemini-adapter");

        const session = yield* adapter.startSession({
          provider: "gemini",
          threadId,
          cwd: process.cwd(),
          runtimeMode: "approval-required",
          modelSelection: {
            provider: "gemini",
            model: "gemini-3.1-pro-preview",
          },
        });

        const turn = yield* adapter.sendTurn({
          threadId,
          input: "hello",
          modelSelection: {
            provider: "gemini",
            model: "gemini-3.1-pro-preview",
          },
        });

        const snapshot = yield* adapter.readThread(threadId);
        yield* adapter.stopSession(threadId);

        assert.equal(session.provider, "gemini");
        assert.equal(session.model, "gemini-3.1-pro-preview");
        assert.equal(turn.threadId, threadId);
        assert.deepEqual(snapshot.turns.at(-1)?.items, [
          {
            type: "assistant",
            role: "assistant",
            text: "Gemini response",
          },
        ]);
      }).pipe(Effect.provide(liveLayer)),
    );
  });
});
