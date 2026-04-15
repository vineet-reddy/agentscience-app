import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import readline from "node:readline";

import {
  CodexAuthError,
  type CodexAuthApiKeyLoginInput,
  type CodexAuthCancelLoginInput,
  type CodexAuthState,
} from "@agentscience/contracts";
import { Effect, Layer, Ref, Schema } from "effect";

import { ServerConfig } from "../../config";
import { buildCodexInitializeParams, killCodexChildProcess } from "../codexAppServer";
import { readCodexAccountSnapshot } from "../codexAccount";
import { buildCodexSpawnEnv, resolveCodexBinaryPath } from "../codexCli";
import { CodexAuth, type CodexAuthShape } from "../Services/CodexAuth";
import { CodexProvider } from "../Services/CodexProvider";
import { ServerSettingsService } from "../../serverSettings";

interface JsonRpcRequest {
  readonly id: string | number;
  readonly method: string;
  readonly params?: unknown;
}

interface JsonRpcResponse {
  readonly id: string | number;
  readonly result?: unknown;
  readonly error?: {
    readonly message?: unknown;
  };
}

interface JsonRpcNotification {
  readonly method: string;
  readonly params?: unknown;
}

interface PendingRequest {
  readonly method: string;
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

interface CodexRpcClientEvents {
  notification: [notification: JsonRpcNotification];
  closed: [error: Error | null];
}

interface PendingChatgptLogin {
  readonly client: CodexRpcClient;
}

interface AuthRuntimeState {
  readonly state: CodexAuthState;
  readonly pending: PendingChatgptLogin | null;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function toCodexAuthError(cause: unknown, fallback: string): CodexAuthError {
  const message =
    cause instanceof Error && cause.message.trim().length > 0 ? cause.message : fallback;
  return new CodexAuthError({
    message,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function now(): string {
  return new Date().toISOString();
}

function makeIdleState(defaultHomePath: string): CodexAuthState {
  return {
    status: "idle",
    updatedAt: now(),
    defaultHomePath,
  };
}

function makePendingState(
  defaultHomePath: string,
  input: {
    readonly loginType: "chatgpt";
    readonly loginId: string;
    readonly authUrl: string;
  },
): CodexAuthState {
  return {
    status: "pending",
    updatedAt: now(),
    defaultHomePath,
    loginType: input.loginType,
    loginId: input.loginId,
    authUrl: input.authUrl,
  };
}

function makeFailedState(
  defaultHomePath: string,
  message: string,
  input?: {
    readonly loginType?: "chatgpt";
    readonly loginId?: string;
    readonly authUrl?: string;
  },
): CodexAuthState {
  return {
    status: "failed",
    updatedAt: now(),
    defaultHomePath,
    message,
    ...(input?.loginType ? { loginType: input.loginType } : {}),
    ...(input?.loginId ? { loginId: input.loginId } : {}),
    ...(input?.authUrl ? { authUrl: input.authUrl } : {}),
  };
}

class CodexRpcClient extends EventEmitter<CodexRpcClientEvents> {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly output: readline.Interface;
  private nextRequestId = 1;
  private closed = false;

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    super();
    this.output = readline.createInterface({ input: child.stdout });
    this.attachListeners();
  }

  static async connect(input: {
    readonly binaryPath: string;
    readonly homePath?: string;
  }): Promise<CodexRpcClient> {
    const child = spawn(input.binaryPath, ["app-server"], {
      env: buildCodexSpawnEnv(input),
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    const client = new CodexRpcClient(child);
    await client.sendRequest("initialize", buildCodexInitializeParams());
    client.writeMessage({ method: "initialized" });
    return client;
  }

  async sendRequest<TResponse>(
    method: string,
    params: unknown,
    timeoutMs = 20_000,
  ): Promise<TResponse> {
    if (this.closed) {
      throw new Error("Codex auth client is closed.");
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    const result = await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`Timed out waiting for ${method}.`));
      }, timeoutMs);

      this.pending.set(String(id), {
        method,
        timeout,
        resolve,
        reject,
      });

      this.writeMessage({
        id,
        method,
        params,
      });
    });

    return result as TResponse;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Codex auth client closed before request completed."));
    }
    this.pending.clear();

    this.output.removeAllListeners();
    this.output.close();
    this.child.removeAllListeners();
    if (!this.child.killed) {
      killCodexChildProcess(this.child);
    }
    this.emit("closed", null);
  }

  private attachListeners(): void {
    this.output.on("line", (line) => {
      this.handleStdoutLine(line);
    });

    this.child.on("error", (error) => {
      this.closeWithError(error);
    });

    this.child.on("exit", (code, signal) => {
      if (this.closed) {
        return;
      }
      this.closeWithError(
        new Error(
          `codex app-server exited before auth completed (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
        ),
      );
    });
  }

  private closeWithError(error: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();

    this.output.removeAllListeners();
    this.output.close();
    this.child.removeAllListeners();
    if (!this.child.killed) {
      killCodexChildProcess(this.child);
    }
    this.emit("closed", error);
  }

  private handleStdoutLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.closeWithError(new Error("Received invalid JSON from codex app-server."));
      return;
    }

    if (!parsed || typeof parsed !== "object") {
      this.closeWithError(new Error("Received non-object message from codex app-server."));
      return;
    }

    if (this.isResponse(parsed)) {
      this.handleResponse(parsed);
      return;
    }

    if (this.isRequest(parsed)) {
      this.writeMessage({
        id: parsed.id,
        error: {
          code: -32601,
          message: `Unsupported server request: ${parsed.method}`,
        },
      });
      return;
    }

    if (this.isNotification(parsed)) {
      this.emit("notification", parsed);
      return;
    }

    this.closeWithError(new Error("Received unrecognized protocol message from codex app-server."));
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(String(response.id));
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(String(response.id));

    const errorMessage =
      response.error && typeof response.error.message === "string"
        ? response.error.message
        : undefined;
    if (errorMessage) {
      pending.reject(new Error(`${pending.method} failed: ${errorMessage}`));
      return;
    }

    pending.resolve(response.result);
  }

  private writeMessage(message: unknown): void {
    if (!this.child.stdin.writable) {
      throw new Error("Cannot write to codex app-server stdin.");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private isRequest(value: unknown): value is JsonRpcRequest {
    if (!value || typeof value !== "object") {
      return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.method === "string" &&
      (typeof candidate.id === "string" || typeof candidate.id === "number")
    );
  }

  private isNotification(value: unknown): value is JsonRpcNotification {
    if (!value || typeof value !== "object") {
      return false;
    }
    const candidate = value as Record<string, unknown>;
    return typeof candidate.method === "string" && !("id" in candidate);
  }

  private isResponse(value: unknown): value is JsonRpcResponse {
    if (!value || typeof value !== "object") {
      return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
      (typeof candidate.id === "string" || typeof candidate.id === "number") &&
      typeof candidate.method !== "string"
    );
  }
}

export const CodexAuthLive = Layer.effect(
  CodexAuth,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const serverSettings = yield* ServerSettingsService;
    const codexProvider = yield* CodexProvider;
    const services = yield* Effect.services();
    const runPromise = Effect.runPromiseWith(services);
    const defaultHomePath = join(config.stateDir, "codex");
    const refreshCodexProvider = codexProvider.refresh.pipe(
      Effect.ignore({ log: true }),
      Effect.asVoid,
    );
    const runtimeRef = yield* Ref.make<AuthRuntimeState>({
      state: makeIdleState(defaultHomePath),
      pending: null,
    });

    yield* Effect.addFinalizer(() =>
      Ref.get(runtimeRef).pipe(
        Effect.tap((runtime) => Effect.sync(() => runtime.pending?.client.close())),
        Effect.asVoid,
      ),
    );

    const getCodexSettings = serverSettings.getSettings.pipe(
      Effect.map((settings) => ({
        ...settings.providers.codex,
        binaryPath: resolveCodexBinaryPath(settings.providers.codex),
      })),
      Effect.mapError((cause) => toCodexAuthError(cause, "Failed to read Codex settings.")),
    );

    const setRuntimeState = (state: CodexAuthState, pending: PendingChatgptLogin | null = null) =>
      Ref.set(runtimeRef, { state, pending }).pipe(Effect.orDie);

    const clearPendingIfMatching = (client: CodexRpcClient, nextState: CodexAuthState) =>
      Ref.modify(runtimeRef, (runtime): [boolean, AuthRuntimeState] => {
        if (runtime.pending?.client !== client) {
          return [false, runtime];
        }
        return [true, { state: nextState, pending: null }];
      }).pipe(Effect.orDie);

    const closePendingClient = Effect.gen(function* () {
      const runtime = yield* Ref.get(runtimeRef);
      if (runtime.pending) {
        runtime.pending.client.close();
      }
      yield* Ref.set(runtimeRef, {
        state: makeIdleState(defaultHomePath),
        pending: null,
      });
    }).pipe(Effect.orDie);

    const attachPendingLoginListeners = (
      client: CodexRpcClient,
      expectedLoginId: string,
      authUrl: string,
    ) => {
      client.on("notification", (notification) => {
        if (notification.method !== "account/login/completed") {
          return;
        }

        const params = asObject(notification.params);
        const loginId = asString(params?.loginId);
        if (loginId !== expectedLoginId) {
          return;
        }

        const success = asBoolean(params?.success) === true;
        const errorMessage = asString(params?.error);
        const nextState = success
          ? makeIdleState(defaultHomePath)
          : makeFailedState(defaultHomePath, errorMessage ?? "ChatGPT login failed.", {
              loginType: "chatgpt",
              loginId: expectedLoginId,
              authUrl,
            });

        void runPromise(
          clearPendingIfMatching(client, nextState).pipe(
            Effect.tap((didUpdate) => (didUpdate ? refreshCodexProvider : Effect.void)),
          ),
        );
        client.close();
      });

      client.on("closed", (error) => {
        if (error === null) {
          return;
        }

        const failedState = makeFailedState(defaultHomePath, error.message, {
          loginType: "chatgpt",
          loginId: expectedLoginId,
          authUrl,
        });
        void runPromise(
          clearPendingIfMatching(client, failedState).pipe(
            Effect.tap((didUpdate) => (didUpdate ? refreshCodexProvider : Effect.void)),
          ),
        );
      });
    };

    const connectClient = (settings: { readonly binaryPath: string; readonly homePath: string }) =>
      Effect.tryPromise({
        try: () =>
          CodexRpcClient.connect({
            binaryPath: settings.binaryPath,
            ...(settings.homePath.trim().length > 0 ? { homePath: settings.homePath } : {}),
          }),
        catch: (cause) => toCodexAuthError(cause, "Failed to start Codex auth client."),
      });

    const getState: CodexAuthShape["getState"] = Ref.get(runtimeRef).pipe(
      Effect.map((runtime) => runtime.state),
      Effect.mapError((cause) => toCodexAuthError(cause, "Failed to read Codex auth state.")),
    );

    const startChatgptLogin: CodexAuthShape["startChatgptLogin"] = Effect.gen(function* () {
      const runtime = yield* Ref.get(runtimeRef);
      if (runtime.pending) {
        return runtime.state;
      }

      const settings = yield* getCodexSettings;
      const client = yield* connectClient(settings);
      const response = yield* Effect.tryPromise({
        try: () => client.sendRequest("account/login/start", { type: "chatgpt" }),
        catch: (cause) => toCodexAuthError(cause, "Failed to start ChatGPT login."),
      }).pipe(
        Effect.catch((cause) => {
          client.close();
          return Schema.is(CodexAuthError)(cause)
            ? Effect.fail(cause)
            : Effect.fail(toCodexAuthError(cause, "Failed to start ChatGPT login."));
        }),
      );
      const result = asObject(response);
      const loginId = asString(result?.loginId);
      const authUrl = asString(result?.authUrl);
      if (!loginId || !authUrl) {
        client.close();
        return yield* new CodexAuthError({
          message: "Codex did not return a ChatGPT login URL.",
        });
      }

      attachPendingLoginListeners(client, loginId, authUrl);

      const state = makePendingState(defaultHomePath, {
        loginType: "chatgpt",
        loginId,
        authUrl,
      });
      yield* setRuntimeState(state, { client });
      return state;
    });

    const loginWithApiKey: CodexAuthShape["loginWithApiKey"] = (input: CodexAuthApiKeyLoginInput) =>
      Effect.gen(function* () {
        yield* closePendingClient;
        const settings = yield* getCodexSettings;
        const client = yield* connectClient(settings);

        try {
          yield* Effect.tryPromise({
            try: () =>
              client.sendRequest("account/login/start", {
                type: "apiKey",
                apiKey: input.apiKey,
              }),
            catch: (cause) => toCodexAuthError(cause, "Failed to log in with the OpenAI API key."),
          });
          const accountResponse = yield* Effect.tryPromise({
            try: () => client.sendRequest("account/read", { refreshToken: false }),
            catch: (cause) => toCodexAuthError(cause, "Failed to verify the Codex account."),
          });
          const account = readCodexAccountSnapshot(accountResponse);
          if (account.type !== "apiKey") {
            return yield* new CodexAuthError({
              message: "Codex did not confirm the API key login.",
            });
          }
        } finally {
          client.close();
        }

        yield* setRuntimeState(makeIdleState(defaultHomePath));
        yield* refreshCodexProvider;
        return yield* getState;
      });

    const cancelChatgptLogin: CodexAuthShape["cancelChatgptLogin"] = (
      input?: CodexAuthCancelLoginInput,
    ) =>
      Effect.gen(function* () {
        const runtime = yield* Ref.get(runtimeRef);
        if (!runtime.pending) {
          return runtime.state;
        }

        const loginId = runtime.state.loginId;
        if (!loginId) {
          runtime.pending.client.close();
          yield* setRuntimeState(makeIdleState(defaultHomePath));
          return yield* getState;
        }

        if (input?.loginId && input.loginId !== loginId) {
          return yield* new CodexAuthError({
            message: "The pending Codex login does not match the requested login id.",
          });
        }

        try {
          yield* Effect.tryPromise({
            try: () =>
              runtime.pending!.client.sendRequest("account/login/cancel", {
                loginId,
              }),
            catch: (cause) => toCodexAuthError(cause, "Failed to cancel the ChatGPT login."),
          });
        } finally {
          runtime.pending.client.close();
        }

        yield* setRuntimeState(makeIdleState(defaultHomePath));
        yield* refreshCodexProvider;
        return yield* getState;
      });

    const logout: CodexAuthShape["logout"] = Effect.gen(function* () {
      yield* closePendingClient;
      const settings = yield* getCodexSettings;
      const client = yield* connectClient(settings);

      try {
        yield* Effect.tryPromise({
          try: () => client.sendRequest("account/logout", {}),
          catch: (cause) => toCodexAuthError(cause, "Failed to log out of Codex."),
        });
      } finally {
        client.close();
      }

      yield* setRuntimeState(makeIdleState(defaultHomePath));
      yield* refreshCodexProvider;
      return yield* getState;
    });

    return {
      getState,
      startChatgptLogin,
      loginWithApiKey,
      cancelChatgptLogin,
      logout,
    } satisfies CodexAuthShape;
  }),
);
