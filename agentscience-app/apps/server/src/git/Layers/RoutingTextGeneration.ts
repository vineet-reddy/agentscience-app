/**
 * RoutingTextGeneration – Routes text generation to the selected provider.
 *
 * @module RoutingTextGeneration
 */
import { Effect, Layer } from "effect";

import { TextGeneration } from "../Services/TextGeneration.ts";
import { makeCodexTextGeneration } from "./CodexTextGeneration.ts";
import { makeGeminiTextGeneration } from "./GeminiTextGeneration.ts";

export const RoutingTextGenerationLive = Layer.effect(
  TextGeneration,
  Effect.gen(function* () {
    const codex = yield* makeCodexTextGeneration;
    const gemini = yield* makeGeminiTextGeneration;
    return {
      generateCommitMessage: (input) =>
        input.modelSelection.provider === "gemini"
          ? gemini.generateCommitMessage(input)
          : codex.generateCommitMessage(input),
      generatePrContent: (input) =>
        input.modelSelection.provider === "gemini"
          ? gemini.generatePrContent(input)
          : codex.generatePrContent(input),
      generateBranchName: (input) =>
        input.modelSelection.provider === "gemini"
          ? gemini.generateBranchName(input)
          : codex.generateBranchName(input),
      generateThreadTitle: (input) =>
        input.modelSelection.provider === "gemini"
          ? gemini.generateThreadTitle(input)
          : codex.generateThreadTitle(input),
    };
  }),
);
