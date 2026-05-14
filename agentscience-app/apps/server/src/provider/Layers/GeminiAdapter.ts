import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Buffer } from "node:buffer";

import {
  ApprovalRequestId,
  EventId,
  ProviderItemId,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  TurnId,
  type ChatAttachment,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
  type ProviderTurnStartResult,
  type ProviderUserInputAnswers,
} from "@agentscience/contracts";
import { Effect, FileSystem, Layer, Queue, Stream } from "effect";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  buildAgentScienceDesktopSharedInstructions,
  loadDesktopAppPersonality,
} from "../../desktopPersonality.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  AcpJsonRpcClient,
  type JsonRecord,
  type JsonRpcId,
} from "../acpJsonRpcClient.ts";
import {
  ProviderAdapterProcessError,
  type ProviderAdapterError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import {
  buildAgentScienceGeminiEnv,
  buildGeminiLaunchSpec,
} from "../geminiCli.ts";
import { resolveEffectiveGeminiSettings } from "../geminiSettings.ts";
import { readProviderApiKey } from "../providerApiKeys.ts";
import {
  GeminiAdapter,
  type GeminiAdapterShape,
} from "../Services/GeminiAdapter.ts";

const PROVIDER = "gemini" as const;
const ACP_PROTOCOL_VERSION = 1;
const GEMINI_PERSONALITY = loadDesktopAppPersonality();
const GEMINI_PROVIDER_TRANSPORT_INSTRUCTIONS = `<provider_transport provider="gemini">
This session is delivered through Gemini ACP. Apply the shared AgentScience desktop instructions through the Gemini tools and modes available in this session.
</provider_transport>`;

type AcpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "resource_link"; uri: string; name?: string; mimeType?: string };

interface AcpSessionRuntime {
  readonly threadId: ThreadId;
  sessionId: string;
  readonly cwd: string;
  readonly client: AcpJsonRpcClient;
  readonly process: ChildProcessWithoutNullStreams;
  readonly createdAt: string;
  model: string | undefined;
  runtimeMode: ProviderSession["runtimeMode"];
  activeTurnId: TurnId | undefined;
  status: ProviderSession["status"];
  lastError: string | undefined;
  currentAssistantText: string;
  turns: Array<{ id: TurnId; items: unknown[] }>;
  pendingPermissions: Map<
    ApprovalRequestId,
    {
      readonly request: JsonRecord;
      readonly resolve: (response: unknown) => void;
    }
  >;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function eventId(): EventId {
  return EventId.makeUnsafe(randomUUID());
}

function runtimeItemId(value: string): RuntimeItemId {
  return RuntimeItemId.makeUnsafe(value);
}

function runtimeRequestId(value: string): RuntimeRequestId {
  return RuntimeRequestId.makeUnsafe(value);
}

function providerItemId(value: string): ProviderItemId {
  return ProviderItemId.makeUnsafe(value);
}

function turnId(value?: string): TurnId {
  return TurnId.makeUnsafe(value ?? randomUUID());
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = String(cause.message);
    if (message.trim().length > 0) return message;
  }
  return fallback;
}

function modeForRuntimeMode(
  runtimeMode: ProviderSession["runtimeMode"],
): string {
  return runtimeMode === "full-access" ? "yolo" : "default";
}

export function buildGeminiInstructionEnvelope(input: ProviderSendTurnInput): string {
  const interactionMode = input.interactionMode === "plan" ? "plan" : "default";
  const developerInstructions = buildAgentScienceDesktopSharedInstructions({
    personality: GEMINI_PERSONALITY,
    mode: interactionMode,
    ...(input.researchDepth !== undefined
      ? { researchDepth: input.researchDepth }
      : {}),
  });
  return [
    `<agentscience_instructions provider="gemini">`,
    GEMINI_PROVIDER_TRANSPORT_INSTRUCTIONS,
    developerInstructions,
    `</agentscience_instructions>`,
  ].join("\n");
}

function toToolItemType(
  kind: unknown,
):
  | "command_execution"
  | "file_change"
  | "mcp_tool_call"
  | "dynamic_tool_call"
  | "web_search"
  | "image_view" {
  switch (kind) {
    case "execute":
      return "command_execution";
    case "edit":
    case "delete":
    case "move":
      return "file_change";
    case "fetch":
      return "web_search";
    default:
      return "dynamic_tool_call";
  }
}

function toRequestType(
  kind: unknown,
):
  | "command_execution_approval"
  | "file_read_approval"
  | "file_change_approval"
  | "dynamic_tool_call"
  | "unknown" {
  switch (kind) {
    case "execute":
      return "command_execution_approval";
    case "read":
      return "file_read_approval";
    case "edit":
    case "delete":
    case "move":
      return "file_change_approval";
    default:
      return "dynamic_tool_call";
  }
}

function textFromContentBlock(content: unknown): string | undefined {
  const record = asRecord(content);
  if (!record || record.type !== "text") return undefined;
  return asString(record.text);
}

function summarizeToolContent(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const summaries = content.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];
    if (record.type === "content") {
      const text = textFromContentBlock(asRecord(record.content));
      return text ? [text] : [];
    }
    if (record.type === "diff") {
      const path = asString(record.path);
      return path ? [`Changed ${path}`] : [];
    }
    if (record.type === "terminal") {
      return ["Terminal output"];
    }
    return [];
  });
  return summaries.join("\n").trim() || undefined;
}

const makeGeminiAdapter = Effect.fn("makeGeminiAdapter")(function* () {
  const serverSettingsService = yield* ServerSettingsService;
  const serverConfig = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
  const sessions = new Map<ThreadId, AcpSessionRuntime>();
  const services = yield* Effect.services<never>();
  const runSync = Effect.runSyncWith(services);

  const publish = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
    Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid);

  const publishSync = (event: ProviderRuntimeEvent): void => {
    runSync(publish(event));
  };

  const baseEvent = (
    session: AcpSessionRuntime,
    raw: NonNullable<ProviderRuntimeEvent["raw"]>,
  ): Omit<ProviderRuntimeEvent, "type" | "payload"> => ({
    eventId: eventId(),
    provider: PROVIDER,
    threadId: session.threadId,
    createdAt: nowIso(),
    ...(session.activeTurnId ? { turnId: session.activeTurnId } : {}),
    raw,
  });

  const getSession = (
    threadId: ThreadId,
    method: string,
  ): Effect.Effect<AcpSessionRuntime, ProviderAdapterSessionNotFoundError> =>
    Effect.sync(() => sessions.get(threadId)).pipe(
      Effect.flatMap((session) =>
        session
          ? Effect.succeed(session)
          : Effect.fail(
              new ProviderAdapterSessionNotFoundError({
                provider: PROVIDER,
                threadId,
                cause: new Error(method),
              }),
            ),
      ),
    );

  const callAcp = <T>(
    session: AcpSessionRuntime,
    method: string,
    params: unknown,
  ): Effect.Effect<
    T,
    ProviderAdapterRequestError | ProviderAdapterSessionClosedError
  > =>
    Effect.tryPromise({
      try: () => session.client.request(method, params) as Promise<T>,
      catch: (cause) =>
        session.status === "closed"
          ? new ProviderAdapterSessionClosedError({
              provider: PROVIDER,
              threadId: session.threadId,
              cause,
            })
          : new ProviderAdapterRequestError({
              provider: PROVIDER,
              method,
              detail: toMessage(cause, `${method} failed.`),
              cause,
            }),
    });

  const materializeAttachment = Effect.fn("materializeGeminiAttachment")(
    function* (
      attachment: ChatAttachment,
    ): Effect.fn.Return<
      AcpContentBlock | undefined,
      ProviderAdapterRequestError
    > {
      const attachmentPath = resolveAttachmentPath({
        attachmentsDir: serverConfig.attachmentsDir,
        attachment,
      });
      if (!attachmentPath) {
        return undefined;
      }
      if (attachment.type === "file") {
        return {
          type: "resource_link",
          uri: `file://${attachmentPath}`,
          name: attachment.name,
          mimeType: attachment.mimeType,
        };
      }
      const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/prompt",
              detail: toMessage(cause, "Failed to read Gemini attachment."),
              cause,
            }),
        ),
      );
      return {
        type: "image",
        mimeType: attachment.mimeType,
        data: Buffer.from(bytes).toString("base64"),
      };
    },
  );

  function onSessionUpdate(session: AcpSessionRuntime, params: unknown): void {
    const update = asRecord(asRecord(params)?.update);
    if (!update) return;
    const updateKind = asString(update.sessionUpdate);
    const raw = {
      source: "gemini.acp.notification" as const,
      method: "session/update",
      payload: params,
    };
    if (
      updateKind === "agent_message_chunk" ||
      updateKind === "agent_thought_chunk"
    ) {
      const text = textFromContentBlock(update.content);
      if (!text) return;
      if (updateKind === "agent_message_chunk") {
        session.currentAssistantText += text;
      }
      publishSync({
        ...baseEvent(session, raw),
        type: "content.delta",
        payload: {
          streamKind:
            updateKind === "agent_thought_chunk"
              ? "reasoning_text"
              : "assistant_text",
          delta: text,
        },
      });
      return;
    }
    if (updateKind === "plan") {
      const entries = Array.isArray(update.entries) ? update.entries : [];
      publishSync({
        ...baseEvent(session, raw),
        type: "turn.plan.updated",
        payload: {
          plan: entries
            .map(asRecord)
            .filter((entry): entry is JsonRecord => entry !== undefined)
            .map((entry) => ({
              step: asString(entry.content) ?? "step",
              status:
                entry.status === "completed"
                  ? "completed"
                  : entry.status === "in_progress"
                    ? "inProgress"
                    : "pending",
            })),
        },
      });
      return;
    }
    if (updateKind === "tool_call" || updateKind === "tool_call_update") {
      const toolCallId = asString(update.toolCallId) ?? randomUUID();
      const itemId = runtimeItemId(toolCallId);
      const kind = update.kind;
      const title = asString(update.title);
      const detail = summarizeToolContent(update.content) ?? title;
      const status =
        update.status === "completed"
          ? "completed"
          : update.status === "failed"
            ? "failed"
            : "inProgress";
      const eventType =
        updateKind === "tool_call"
          ? "item.started"
          : status === "completed" || status === "failed"
            ? "item.completed"
            : "item.updated";
      publishSync({
        ...baseEvent(session, raw),
        itemId,
        providerRefs: { providerItemId: providerItemId(toolCallId) },
        type: eventType,
        payload: {
          itemType: toToolItemType(kind),
          status,
          ...(title ? { title } : {}),
          ...(detail ? { detail } : {}),
          data: update,
        },
      });
      return;
    }
    if (updateKind === "current_mode_update") {
      publishSync({
        ...baseEvent(session, raw),
        type: "session.configured",
        payload: {
          config: {
            currentModeId: asString(update.currentModeId) ?? "default",
          },
        },
      });
      return;
    }
    if (updateKind === "session_info_update") {
      const title = asString(update.title);
      if (!title) return;
      publishSync({
        ...baseEvent(session, raw),
        type: "thread.metadata.updated",
        payload: {
          name: title,
          metadata: update,
        },
      });
    }
  }

  function onPermissionRequest(
    session: AcpSessionRuntime,
    id: JsonRpcId,
    params: unknown,
  ) {
    const requestId = ApprovalRequestId.makeUnsafe(
      `gemini:${String(id)}:${randomUUID()}`,
    );
    const request = asRecord(params) ?? {};
    const toolCall = asRecord(request.toolCall) ?? {};
    const options = Array.isArray(request.options) ? request.options : [];
    const autoResponse = safeAgentScienceInternalPermissionResponse(
      request,
      options,
    );
    if (autoResponse) {
      return Promise.resolve(autoResponse);
    }

    session.pendingPermissions.set(requestId, {
      request,
      resolve: () => undefined,
    });

    publishSync({
      ...baseEvent(session, {
        source: "gemini.acp.request",
        method: "session/request_permission",
        payload: params,
      }),
      requestId: runtimeRequestId(requestId),
      providerRefs: { providerRequestId: requestId },
      type: "request.opened",
      payload: {
        requestType: toRequestType(toolCall.kind),
        ...(asString(toolCall.title)
          ? { detail: asString(toolCall.title) }
          : {}),
        args: request,
      },
    });

    return new Promise<unknown>((resolve) => {
      session.pendingPermissions.set(requestId, { request, resolve });
    });
  }

  const startSession: GeminiAdapterShape["startSession"] = Effect.fn(
    "GeminiAdapter.startSession",
  )(function* (
    input: ProviderSessionStartInput,
  ): Effect.fn.Return<ProviderSession, ProviderAdapterError> {
    if (input.provider !== undefined && input.provider !== PROVIDER) {
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "startSession",
        issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
      });
    }
    if (!input.cwd) {
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "startSession",
        issue: "Gemini sessions require a cwd.",
      });
    }

    const settings = yield* serverSettingsService.getSettings.pipe(
      Effect.map((current) =>
        resolveEffectiveGeminiSettings(current.providers.gemini),
      ),
      Effect.mapError(
        (error) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId: input.threadId,
            detail: error.message,
            cause: error,
          }),
      ),
    );
    const geminiApiKey =
      settings.authMethod === "gemini-api-key"
        ? yield* readProviderApiKey(serverConfig.stateDir, PROVIDER).pipe(
            Effect.mapError(
              (error) =>
                new ProviderAdapterProcessError({
                  provider: PROVIDER,
                  threadId: input.threadId,
                  detail: error.message,
                  cause: error,
                }),
            ),
          )
        : undefined;

    const launchSpec = buildGeminiLaunchSpec({
      binaryPath: settings.binaryPath,
      args: ["--acp"],
        processEnv: buildAgentScienceGeminiEnv({
          stateDir: serverConfig.stateDir,
          cwd: input.cwd,
          apiKey: geminiApiKey,
        }),
      });
    const child = spawn(launchSpec.command, [...launchSpec.args], {
      cwd: input.cwd,
      env: launchSpec.env,
      shell: launchSpec.shell,
    });

    const createdAt = nowIso();
    const session: AcpSessionRuntime = {
      threadId: input.threadId,
      sessionId: "",
      cwd: input.cwd,
      client: undefined as unknown as AcpJsonRpcClient,
      process: child,
      createdAt,
      model:
        input.modelSelection?.provider === "gemini"
          ? input.modelSelection.model
          : undefined,
      runtimeMode: input.runtimeMode,
      activeTurnId: undefined,
      status: "connecting",
      lastError: undefined,
      currentAssistantText: "",
      turns: [],
      pendingPermissions: new Map(),
    };

    const client = new AcpJsonRpcClient(child, {
      onNotification: (method, params) => {
        if (method === "session/update") {
          onSessionUpdate(session, params);
        }
      },
      onRequest: (id, method, params) => {
        if (method === "session/request_permission") {
          return onPermissionRequest(session, id, params);
        }
        throw new Error(`Unsupported Gemini ACP client method: ${method}`);
      },
      onStdoutText: (text) => {
        publishSync({
          ...baseEvent(session, {
            source: "gemini.acp.stderr",
            method: "stdout",
            payload: { text },
          }),
          type: "runtime.warning",
          payload: { message: text },
        });
      },
      onStderrText: (text) => {
        publishSync({
          ...baseEvent(session, {
            source: "gemini.acp.stderr",
            method: "stderr",
            payload: { text },
          }),
          type: "runtime.warning",
          payload: { message: text.trim() || "Gemini stderr" },
        });
      },
      onExit: (code, signal) => {
        session.status = "closed";
        publishSync({
          ...baseEvent(session, {
            source: "gemini.acp.stderr",
            method: "process/exit",
            payload: { code, signal },
          }),
          type: "session.exited",
          payload: {
            reason: signal
              ? `Gemini exited via ${signal}`
              : `Gemini exited with code ${code}`,
            exitKind: code === 0 || code === null ? "graceful" : "error",
          },
        });
      },
    });
    Object.assign(session, { client });
    sessions.set(input.threadId, session);

    return yield* Effect.gen(function* () {
      yield* callAcp<JsonRecord>(session, "initialize", {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: {
          name: "agentscience",
          title: "AgentScience",
          version: "0.0.0",
        },
      });
      yield* callAcp<JsonRecord>(session, "authenticate", {
        methodId: settings.authMethod,
      });
      const newSession = yield* callAcp<JsonRecord>(session, "session/new", {
        cwd: input.cwd,
        mcpServers: [],
      });
      const providerSessionId = asString(newSession.sessionId);
      if (!providerSessionId) {
        return yield* new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId: input.threadId,
          detail: "Gemini ACP did not return a session id.",
        });
      }
      Object.assign(session, { sessionId: providerSessionId });
      session.status = "ready";
      session.model =
        input.modelSelection?.provider === "gemini"
          ? input.modelSelection.model
          : asString(asRecord(newSession.models)?.currentModelId);
      yield* callAcp<JsonRecord>(session, "session/set_mode", {
        sessionId: providerSessionId,
        modeId: modeForRuntimeMode(input.runtimeMode),
      }).pipe(Effect.catch(() => Effect.succeed({})));
      if (input.modelSelection?.provider === "gemini") {
        yield* callAcp<JsonRecord>(session, "session/set_model", {
          sessionId: providerSessionId,
          modelId: input.modelSelection.model,
        }).pipe(Effect.catch(() => Effect.succeed({})));
      }
      yield* publish({
        ...baseEvent(session, {
          source: "gemini.acp.notification",
          method: "session/new",
          payload: newSession,
        }),
        type: "session.started",
        payload: { resume: { sessionId: providerSessionId } },
      });
      return {
        provider: PROVIDER,
        status: "ready",
        runtimeMode: input.runtimeMode,
        cwd: input.cwd,
        model: session.model,
        threadId: input.threadId,
        resumeCursor: { sessionId: providerSessionId },
        createdAt,
        updatedAt: nowIso(),
      } satisfies ProviderSession;
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          client.dispose();
          sessions.delete(input.threadId);
        }).pipe(Effect.andThen(Effect.fail(error))),
      ),
    );
  });

  const sendTurn: GeminiAdapterShape["sendTurn"] = Effect.fn(
    "GeminiAdapter.sendTurn",
  )(function* (
    input: ProviderSendTurnInput,
  ): Effect.fn.Return<ProviderTurnStartResult, ProviderAdapterError> {
    const session = yield* getSession(input.threadId, "session/prompt");
    if (
      input.modelSelection?.provider === "gemini" &&
      input.modelSelection.model !== session.model
    ) {
      yield* callAcp<JsonRecord>(session, "session/set_model", {
        sessionId: session.sessionId,
        modelId: input.modelSelection.model,
      }).pipe(Effect.catch(() => Effect.succeed({})));
      session.model = input.modelSelection.model;
    }
    const desiredMode =
      input.interactionMode === "plan"
        ? "plan"
        : modeForRuntimeMode(session.runtimeMode);
    yield* callAcp<JsonRecord>(session, "session/set_mode", {
      sessionId: session.sessionId,
      modeId: desiredMode,
    }).pipe(Effect.catch(() => Effect.succeed({})));

    const blocks: AcpContentBlock[] = [];
    const instructionEnvelope = buildGeminiInstructionEnvelope(input);
    const promptText = [instructionEnvelope, input.input]
      .filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      )
      .join("\n\n");
    if (promptText) {
      blocks.push({ type: "text", text: promptText });
    }
    const attachments = yield* Effect.forEach(
      input.attachments ?? [],
      (attachment) => materializeAttachment(attachment),
      { concurrency: 1 },
    );
    blocks.push(
      ...attachments.filter(
        (entry): entry is AcpContentBlock => entry !== undefined,
      ),
    );

    const id = turnId();
    session.activeTurnId = id;
    session.status = "running";
    session.currentAssistantText = "";
    const turnStartedPayload: JsonRecord = {};
    if (session.model) {
      turnStartedPayload.model = session.model;
    }
    yield* publish({
      ...baseEvent(session, {
        source: "gemini.acp.notification",
        method: "session/prompt",
        payload: { prompt: blocks },
      }),
      turnId: id,
      type: "turn.started",
      payload: turnStartedPayload,
    });

    const response = yield* callAcp<JsonRecord>(session, "session/prompt", {
      sessionId: session.sessionId,
      prompt: blocks,
    });
    const assistantText = session.currentAssistantText.trim();
    session.turns.push({
      id,
      items: assistantText
        ? [
            {
              type: "assistant",
              role: "assistant",
              text: assistantText,
            },
          ]
        : [],
    });
    session.status = "ready";
    session.activeTurnId = undefined;
    yield* publish({
      ...baseEvent(
        { ...session, activeTurnId: id },
        {
          source: "gemini.acp.notification",
          method: "session/prompt:response",
          payload: response,
        },
      ),
      turnId: id,
      type: "turn.completed",
      payload: {
        state: response.stopReason === "cancelled" ? "cancelled" : "completed",
        ...(asString(response.stopReason)
          ? { stopReason: asString(response.stopReason) }
          : {}),
      },
    });

    return {
      threadId: input.threadId,
      turnId: id,
      resumeCursor: { sessionId: session.sessionId },
    };
  });

  const interruptTurn: GeminiAdapterShape["interruptTurn"] = (threadId) =>
    getSession(threadId, "session/cancel").pipe(
      Effect.tap((session) =>
        Effect.sync(() =>
          session.client.notify("session/cancel", {
            sessionId: session.sessionId,
          }),
        ),
      ),
      Effect.asVoid,
    );

  const respondToRequest: GeminiAdapterShape["respondToRequest"] = (
    threadId,
    requestId,
    decision,
  ) =>
    getSession(threadId, "session/request_permission").pipe(
      Effect.flatMap((session) => {
        const pending = session.pendingPermissions.get(requestId);
        if (!pending) {
          return Effect.fail(
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/request_permission",
              detail: `Unknown Gemini permission request '${requestId}'.`,
            }),
          );
        }
        const options = Array.isArray(pending.request.options)
          ? pending.request.options
          : [];
        const option = choosePermissionOption(options, decision);
        const response = buildPermissionResponse(option);
        pending.resolve(response);
        session.pendingPermissions.delete(requestId);
        return publish({
          ...baseEvent(session, {
            source: "gemini.acp.request",
            method: "session/request_permission:response",
            payload: response,
          }),
          requestId: runtimeRequestId(requestId),
          providerRefs: { providerRequestId: requestId },
          type: "request.resolved",
          payload: {
            requestType: toRequestType(
              asRecord(pending.request.toolCall)?.kind,
            ),
            decision,
            resolution: response,
          },
        });
      }),
    );

  const respondToUserInput: GeminiAdapterShape["respondToUserInput"] = (
    threadId,
    _requestId,
    _answers: ProviderUserInputAnswers,
  ) =>
    getSession(threadId, "user-input").pipe(
      Effect.flatMap(() =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "user-input",
            detail:
              "Gemini ACP does not expose structured user-input requests.",
          }),
        ),
      ),
    );

  const stopSession: GeminiAdapterShape["stopSession"] = (threadId) =>
    Effect.sync(() => {
      const session = sessions.get(threadId);
      if (!session) return;
      session.client.dispose();
      sessions.delete(threadId);
    });

  const listSessions: GeminiAdapterShape["listSessions"] = () =>
    Effect.sync(() =>
      Array.from(
        sessions.values(),
        (session) =>
          Object.assign(
            {
              provider: PROVIDER,
              status: session.status,
              runtimeMode: session.runtimeMode,
              cwd: session.cwd,
              threadId: session.threadId,
              resumeCursor: session.sessionId
                ? { sessionId: session.sessionId }
                : undefined,
              createdAt: session.createdAt,
              updatedAt: nowIso(),
            },
            session.model ? { model: session.model } : {},
            session.activeTurnId ? { activeTurnId: session.activeTurnId } : {},
            session.lastError ? { lastError: session.lastError } : {},
          ) satisfies ProviderSession,
      ),
    );

  const hasSession: GeminiAdapterShape["hasSession"] = (threadId) =>
    Effect.sync(() => sessions.has(threadId));

  const readThread: GeminiAdapterShape["readThread"] = (threadId) =>
    getSession(threadId, "thread/read").pipe(
      Effect.map((session) => ({
        threadId,
        turns: session.turns,
      })),
    );

  const rollbackThread: GeminiAdapterShape["rollbackThread"] = (
    threadId,
    numTurns,
  ) =>
    getSession(threadId, "thread/rollback").pipe(
      Effect.flatMap((session) => {
        if (!Number.isInteger(numTurns) || numTurns < 1) {
          return Effect.fail(
            new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "rollbackThread",
              issue: "numTurns must be an integer >= 1.",
            }),
          );
        }
        session.turns.splice(
          Math.max(0, session.turns.length - numTurns),
          numTurns,
        );
        return Effect.succeed({
          threadId,
          turns: session.turns,
        });
      }),
    );

  const stopAll: GeminiAdapterShape["stopAll"] = () =>
    Effect.sync(() => {
      for (const session of sessions.values()) {
        session.client.dispose();
      }
      sessions.clear();
    });

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const session of sessions.values()) {
        session.client.dispose();
      }
      sessions.clear();
    }).pipe(Effect.andThen(Queue.shutdown(runtimeEventQueue))),
  );

  return {
    provider: PROVIDER,
    capabilities: {
      sessionModelSwitch: "in-session",
    },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    get streamEvents() {
      return Stream.fromQueue(runtimeEventQueue);
    },
  } satisfies GeminiAdapterShape;
});

function choosePermissionOption(
  options: ReadonlyArray<unknown>,
  decision: ProviderApprovalDecision,
): string | undefined {
  const normalized = options
    .map(asRecord)
    .filter((entry): entry is JsonRecord => entry !== undefined);
  const byKind = (kind: string) =>
    normalized.find(
      (option) => option.kind === kind && typeof option.optionId === "string",
    )?.optionId as string | undefined;
  switch (decision) {
    case "accept":
      return byKind("allow_once") ?? byKind("allow_always");
    case "acceptForSession":
      return byKind("allow_always") ?? byKind("allow_once");
    case "decline":
      return byKind("reject_once") ?? byKind("reject_always");
    case "cancel":
      return undefined;
  }
}

function buildPermissionResponse(optionId: string | undefined): JsonRecord {
  return optionId
    ? { outcome: { outcome: "selected", optionId } }
    : { outcome: { outcome: "cancelled" } };
}

function normalizeShellCommand(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function parseShellCommandSequence(value: string): ReadonlyArray<readonly string[]> | undefined {
  const commands: string[][] = [[]];
  let token = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  const finishToken = () => {
    if (token.length > 0) {
      commands[commands.length - 1]?.push(token);
      token = "";
    }
  };

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (!char) continue;

    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
        continue;
      }
      if (quote === '"' && (char === "$" || char === "`")) {
        return undefined;
      }
      token += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      finishToken();
      continue;
    }

    if (char === "|" && value[index + 1] === "|") {
      finishToken();
      if ((commands.at(-1)?.length ?? 0) === 0) return undefined;
      commands.push([]);
      index += 1;
      continue;
    }

    if (";&|<>`$(){}".includes(char)) {
      return undefined;
    }

    token += char;
  }

  if (quote || escaped) return undefined;
  finishToken();
  if ((commands.at(-1)?.length ?? 0) === 0) return undefined;
  return commands;
}

function isManagedAgentScienceExecutable(value: string): boolean {
  return (
    value === "agentscience" ||
    value === "./.cache/agentscience/bin/agentscience" ||
    value === ".cache/agentscience/bin/agentscience"
  );
}

function consumeReadOnlyAgentScienceFlags(
  args: readonly string[],
  allowed: ReadonlySet<string>,
): boolean {
  let hasQuery = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--query" && allowed.has("--query")) {
      const value = args[index + 1];
      if (!value) return false;
      hasQuery = true;
      index += 1;
      continue;
    }
    if (arg === "--limit" && allowed.has("--limit")) {
      const value = args[index + 1];
      if (!value || !/^\d{1,4}$/.test(value)) return false;
      index += 1;
      continue;
    }
    if (arg === "--json" && allowed.has("--json")) {
      continue;
    }
    return false;
  }
  return allowed.has("--query") ? hasQuery : true;
}

function isSafeAgentScienceInternalArgv(argv: readonly string[]): boolean {
  if (!isManagedAgentScienceExecutable(argv[0] ?? "")) return false;

  const [, group, command, ...args] = argv;
  if (group === "runtime" && command === "status") {
    return args.length === 1 && args[0] === "--json";
  }
  if (group === "registry" && command === "search") {
    return consumeReadOnlyAgentScienceFlags(
      args,
      new Set(["--query", "--limit", "--json"]),
    );
  }
  if (group === "papers" && command === "list") {
    return consumeReadOnlyAgentScienceFlags(
      args,
      new Set(["--query", "--limit", "--json"]),
    );
  }
  if (group === "papers" && command === "get") {
    const [slug, ...remaining] = args;
    return (
      typeof slug === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(slug) &&
      consumeReadOnlyAgentScienceFlags(remaining, new Set(["--json"]))
    );
  }
  return false;
}

function stringValuesFromRecord(
  record: JsonRecord | undefined,
  keys: ReadonlyArray<string>,
) {
  return keys.flatMap((key) => {
    const value = record?.[key];
    return typeof value === "string" ? [value] : [];
  });
}

export function isSafeAgentScienceInternalPermissionRequest(
  request: JsonRecord,
): boolean {
  const toolCall = asRecord(request.toolCall);
  if (toolCall?.kind !== "execute") {
    return false;
  }

  const args = asRecord(toolCall.args);
  const commandCandidates = [
    ...stringValuesFromRecord(toolCall, ["title", "command", "cmd"]),
    ...stringValuesFromRecord(args, ["command", "cmd"]),
    ...stringValuesFromRecord(request, ["command", "cmd"]),
  ].map(normalizeShellCommand);

  return commandCandidates.some((command) => {
    const parsed = parseShellCommandSequence(command);
    return parsed?.every(isSafeAgentScienceInternalArgv) ?? false;
  });
}

function safeAgentScienceInternalPermissionResponse(
  request: JsonRecord,
  options: ReadonlyArray<unknown>,
): JsonRecord | undefined {
  if (!isSafeAgentScienceInternalPermissionRequest(request)) {
    return undefined;
  }
  const option = choosePermissionOption(options, "accept");
  return option ? buildPermissionResponse(option) : undefined;
}

export const GeminiAdapterLive = Layer.effect(
  GeminiAdapter,
  makeGeminiAdapter(),
);

export function makeGeminiAdapterLive() {
  return Layer.effect(GeminiAdapter, makeGeminiAdapter());
}
