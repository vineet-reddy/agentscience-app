import assert from "node:assert/strict";

import { ThreadId } from "@agentscience/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ProviderSessionRuntimeRepositoryLive } from "../../persistence/Layers/ProviderSessionRuntime.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { ProviderSessionDirectoryLive } from "./ProviderSessionDirectory.ts";

const TestLayer = ProviderSessionDirectoryLive.pipe(
  Layer.provide(ProviderSessionRuntimeRepositoryLive),
  Layer.provide(SqlitePersistenceMemory),
  Layer.provide(NodeServices.layer),
);

it.effect("persists Gemini provider bindings", () =>
  Effect.gen(function* () {
    const directory = yield* ProviderSessionDirectory;
    const threadId = ThreadId.makeUnsafe("thread-gemini-binding");

    yield* directory.upsert({
      threadId,
      provider: "gemini",
      adapterKey: "gemini",
      runtimeMode: "approval-required",
      status: "running",
      resumeCursor: { sessionId: "gemini-session" },
    });

    const binding = Option.getOrThrow(yield* directory.getBinding(threadId));
    const provider = yield* directory.getProvider(threadId);

    assert.equal(binding.provider, "gemini");
    assert.equal(binding.adapterKey, "gemini");
    assert.deepEqual(binding.resumeCursor, { sessionId: "gemini-session" });
    assert.equal(provider, "gemini");
  }).pipe(Effect.provide(TestLayer)),
);
