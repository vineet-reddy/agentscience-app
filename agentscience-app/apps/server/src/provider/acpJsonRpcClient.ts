import type { ChildProcessWithoutNullStreams } from "node:child_process";

export type JsonRpcId = number | string;
export type JsonRecord = Record<string, unknown>;

export interface AcpJsonRpcClientOptions {
  readonly requestTimeoutMs?: number;
  readonly onNotification?: (method: string, params: unknown) => void;
  readonly onRequest?: (id: JsonRpcId, method: string, params: unknown) => Promise<unknown>;
  readonly onStdoutText?: (text: string) => void;
  readonly onStderrText?: (text: string) => void;
  readonly onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60_000;

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }
  const record = asRecord(cause);
  const message = asString(record?.message);
  if (message && message.trim().length > 0) return message;
  return fallback;
}

export class AcpJsonRpcClient {
  private nextId = 0;
  private buffer = "";
  private closed = false;
  private pending = new Map<
    JsonRpcId,
    {
      readonly resolve: (value: unknown) => void;
      readonly reject: (error: Error) => void;
      readonly timeout: NodeJS.Timeout;
    }
  >();
  private readonly requestTimeoutMs: number;
  private readonly onNotification: (method: string, params: unknown) => void;
  private readonly onRequest: (id: JsonRpcId, method: string, params: unknown) => Promise<unknown>;
  private readonly onStdoutText: (text: string) => void;
  private readonly onStderrText: (text: string) => void;
  private readonly onExit: (code: number | null, signal: NodeJS.Signals | null) => void;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    options: AcpJsonRpcClientOptions = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.onNotification = options.onNotification ?? (() => undefined);
    this.onRequest =
      options.onRequest ??
      (async (_id, method) => {
        throw new Error(`Unsupported ACP client method: ${method}`);
      });
    this.onStdoutText = options.onStdoutText ?? (() => undefined);
    this.onStderrText = options.onStderrText ?? (() => undefined);
    this.onExit = options.onExit ?? (() => undefined);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consumeStdout(chunk));
    child.stderr.on("data", (chunk: string) => this.onStderrText(chunk));
    child.on("exit", (code, signal) => {
      this.closed = true;
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`ACP process exited before response ${String(id)}.`));
      }
      this.pending.clear();
      this.onExit(code, signal);
    });
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error("ACP process is closed."));
    }
    const id = this.nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
    });
    this.write({ jsonrpc: "2.0", id, method, params });
    return promise;
  }

  notify(method: string, params: unknown): void {
    if (this.closed) return;
    this.write({ jsonrpc: "2.0", method, params });
  }

  dispose(): void {
    this.closed = true;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("ACP client disposed."));
    }
    this.pending.clear();
    try {
      this.child.stdin.end();
      this.child.stdout.destroy();
      this.child.stderr.destroy();
      this.child.kill("SIGTERM");
    } catch {
      // Ignore shutdown races.
    }
  }

  private write(message: unknown): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private consumeStdout(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let message: JsonRecord;
      try {
        message = JSON.parse(trimmed) as JsonRecord;
      } catch {
        this.onStdoutText(trimmed);
        continue;
      }
      void this.handleMessage(message);
    }
  }

  private async handleMessage(message: JsonRecord): Promise<void> {
    const id = message.id as JsonRpcId | undefined;
    const method = asString(message.method);
    if (method && id !== undefined) {
      try {
        const result = await this.onRequest(id, method, message.params);
        this.write({ jsonrpc: "2.0", id, result: result ?? null });
      } catch (error) {
        this.write({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32603,
            message: toMessage(error, "ACP client request failed."),
          },
        });
      }
      return;
    }
    if (method) {
      this.onNotification(method, message.params);
      return;
    }
    if (id !== undefined) {
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(id);
      if ("error" in message) {
        pending.reject(new Error(toMessage(asRecord(message.error), "ACP request failed.")));
      } else {
        pending.resolve(message.result);
      }
    }
  }
}
