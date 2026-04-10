/**
 * RoutingTextGeneration – Uses the Codex text generation layer for all requests.
 *
 * @module RoutingTextGeneration
 */
import { Effect, Layer } from "effect";

import { TextGeneration } from "../Services/TextGeneration.ts";
import { CodexTextGenerationLive } from "./CodexTextGeneration.ts";

export const RoutingTextGenerationLive = Layer.effect(
  TextGeneration,
  Effect.gen(function* () {
    return yield* TextGeneration;
  }),
).pipe(Layer.provide(CodexTextGenerationLive));
