import { Effect, Layer, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { GeminiModelSelection, TextGenerationError } from "@agentscience/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@agentscience/shared/git";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { buildAgentScienceGeminiEnv, buildGeminiLaunchSpec } from "../../provider/geminiCli.ts";
import { resolveEffectiveGeminiSettings } from "../../provider/geminiSettings.ts";
import { readProviderApiKey } from "../../provider/providerApiKeys.ts";
import {
  type TextGenerationShape,
  TextGeneration,
} from "../Services/TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "../Prompts.ts";
import {
  normalizeCliError,
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "../Utils.ts";

const GEMINI_TIMEOUT_MS = 180_000;

function extractJsonCandidate(output: string): string {
  const trimmed = output.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed)?.[1]?.trim();
  if (fenced) return fenced;
  const object = /\{[\s\S]*\}/.exec(trimmed)?.[0]?.trim();
  return object ?? trimmed;
}

export const makeGeminiTextGeneration = Effect.gen(function* () {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const serverSettings = yield* ServerSettingsService;
  const serverConfig = yield* ServerConfig;

  const readStreamAsString = <E>(
    operation: string,
    stream: Stream.Stream<Uint8Array, E>,
  ): Effect.Effect<string, TextGenerationError> =>
    stream.pipe(
      Stream.decodeText(),
      Stream.runFold(
        () => "",
        (acc, chunk) => acc + chunk,
      ),
      Effect.mapError((cause) =>
        normalizeCliError("gemini", operation, cause, "Failed to collect process output"),
      ),
    );

  const runGeminiJson = Effect.fn("runGeminiJson")(function* <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    modelSelection,
  }: {
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle";
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    modelSelection: GeminiModelSelection;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.map((current) => resolveEffectiveGeminiSettings(current.providers.gemini)),
      Effect.mapError((cause) =>
        normalizeCliError("gemini", operation, cause, "Failed to resolve Gemini settings"),
      ),
    );
    const geminiApiKey =
      settings.authMethod === "gemini-api-key"
        ? yield* readProviderApiKey(serverConfig.stateDir, "gemini").pipe(
            Effect.mapError((cause) =>
              normalizeCliError("gemini", operation, cause, "Failed to read Gemini API key"),
            ),
          )
        : undefined;
    const launchSpec = buildGeminiLaunchSpec({
      binaryPath: settings.binaryPath,
      args: [
        "--model",
        modelSelection.model,
        "--prompt",
        "Return only the JSON object. Do not wrap it in markdown.",
        "--output-format",
        "text",
      ],
      processEnv: buildAgentScienceGeminiEnv({
        stateDir: serverConfig.stateDir,
        apiKey: geminiApiKey,
      }),
    });
    const command = ChildProcess.make(
      launchSpec.command,
      [...launchSpec.args],
      {
        cwd,
        env: launchSpec.env,
        shell: launchSpec.shell,
        stdin: {
          stream: Stream.encodeText(Stream.make(prompt)),
        },
      },
    );
    const child = yield* commandSpawner.spawn(command).pipe(
      Effect.mapError((cause) =>
        normalizeCliError("gemini", operation, cause, "Failed to spawn Gemini CLI process"),
      ),
    );
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        readStreamAsString(operation, child.stdout),
        readStreamAsString(operation, child.stderr),
        child.exitCode.pipe(
          Effect.mapError((cause) =>
            normalizeCliError("gemini", operation, cause, "Failed to read Gemini CLI exit code"),
          ),
        ),
      ],
      { concurrency: "unbounded" },
    );
    if (exitCode !== 0) {
      const detail = stderr.trim() || stdout.trim();
      return yield* new TextGenerationError({
        operation,
        detail:
          detail.length > 0
            ? `Gemini CLI command failed: ${detail}`
            : `Gemini CLI command failed with code ${exitCode}.`,
      });
    }
    return yield* Effect.succeed(extractJsonCandidate(stdout)).pipe(
      Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson))),
      Effect.catchTag("SchemaError", (cause) =>
        Effect.fail(
          new TextGenerationError({
            operation,
            detail: "Gemini returned invalid structured output.",
            cause,
          }),
        ),
      ),
    );
  });

  const withGeminiTimeout = <A, E, R>(
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle",
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | TextGenerationError, R> =>
    effect.pipe(
      Effect.timeoutOption(GEMINI_TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new TextGenerationError({
                operation,
                detail: "Gemini CLI request timed out.",
              }),
            ),
          onSome: (value) => Effect.succeed(value),
        }),
      ),
    );

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = Effect.fn(
    "GeminiTextGeneration.generateCommitMessage",
  )(function* (input) {
    if (input.modelSelection.provider !== "gemini") {
      return yield* new TextGenerationError({
        operation: "generateCommitMessage",
        detail: "Invalid model selection.",
      });
    }
    const { prompt, outputSchema } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: input.includeBranch === true,
    });
    const generated = yield* withGeminiTimeout(
      "generateCommitMessage",
      runGeminiJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      }),
    );
    return {
      subject: sanitizeCommitSubject(generated.subject),
      body: generated.body.trim(),
      ...("branch" in generated && typeof generated.branch === "string"
        ? { branch: sanitizeFeatureBranchName(generated.branch) }
        : {}),
    };
  });

  const generatePrContent: TextGenerationShape["generatePrContent"] = Effect.fn(
    "GeminiTextGeneration.generatePrContent",
  )(function* (input) {
    if (input.modelSelection.provider !== "gemini") {
      return yield* new TextGenerationError({
        operation: "generatePrContent",
        detail: "Invalid model selection.",
      });
    }
    const { prompt, outputSchema } = buildPrContentPrompt(input);
    const generated = yield* withGeminiTimeout(
      "generatePrContent",
      runGeminiJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      }),
    );
    return {
      title: sanitizePrTitle(generated.title),
      body: generated.body.trim(),
    };
  });

  const generateBranchName: TextGenerationShape["generateBranchName"] = Effect.fn(
    "GeminiTextGeneration.generateBranchName",
  )(function* (input) {
    if (input.modelSelection.provider !== "gemini") {
      return yield* new TextGenerationError({
        operation: "generateBranchName",
        detail: "Invalid model selection.",
      });
    }
    const { prompt, outputSchema } = buildBranchNamePrompt({
      message: input.message,
      attachments: input.attachments,
    });
    const generated = yield* withGeminiTimeout(
      "generateBranchName",
      runGeminiJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      }),
    );
    return {
      branch: sanitizeBranchFragment(generated.branch),
    };
  });

  const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = Effect.fn(
    "GeminiTextGeneration.generateThreadTitle",
  )(function* (input) {
    if (input.modelSelection.provider !== "gemini") {
      return yield* new TextGenerationError({
        operation: "generateThreadTitle",
        detail: "Invalid model selection.",
      });
    }
    const { prompt, outputSchema } = buildThreadTitlePrompt({
      message: input.message,
      ...(input.conversation !== undefined ? { conversation: input.conversation } : {}),
      ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
    });
    const generated = yield* withGeminiTimeout(
      "generateThreadTitle",
      runGeminiJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      }),
    );
    return {
      title: sanitizeThreadTitle(generated.title),
    };
  });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGenerationShape;
});

export const GeminiTextGenerationLive = Layer.effect(TextGeneration, makeGeminiTextGeneration);
