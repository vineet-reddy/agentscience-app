/**
 * AgentScienceAuth - Sign-in to the AgentScience web platform.
 *
 * Implements the device-code flow exposed by agentscience.app:
 *   - `POST /api/v1/auth/device` to request a short-lived verification code.
 *   - The user approves the code in their browser against the Clerk session.
 *   - `GET /api/v1/auth/device/{code}` is polled until a bearer token is
 *     returned; the token is persisted to disk with 0600 permissions.
 *   - `GET /api/v1/me` resolves the profile attached to the token.
 *
 * The service keeps the authenticated token in memory so other server
 * services can attach it to outbound requests via `getBearerToken`.
 *
 * @module agentScienceAuth
 */
import {
  AgentScienceAuthError,
  type AgentScienceAuthState,
  type AgentScienceAuthUser,
} from "@agentscience/contracts";
import { homedir } from "node:os";
import nodePath from "node:path";
import {
  Duration,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Path,
  Ref,
  Schema,
  ServiceMap,
} from "effect";

import { ServerConfig } from "./config";

const TOKEN_FILE_NAME = "agentscience-auth.json";
const TOKEN_FILE_MODE = 0o600;
const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_ATTEMPTS = 60 * 5;
const HTTP_TIMEOUT_MS = 20_000;
const SHARED_CLI_CONFIG_PATH = nodePath.join(
  homedir(),
  ".config",
  "agentscience",
  "config.json",
);

export interface AgentScienceAuthShape {
  /** Current observable auth state. */
  readonly getState: Effect.Effect<AgentScienceAuthState, AgentScienceAuthError>;
  /** Kick off a device-code login and start polling in the background. */
  readonly startLogin: Effect.Effect<AgentScienceAuthState, AgentScienceAuthError>;
  /** Abort an in-flight device-code login. */
  readonly cancelLogin: Effect.Effect<AgentScienceAuthState, AgentScienceAuthError>;
  /** Delete the persisted bearer token. */
  readonly signOut: Effect.Effect<AgentScienceAuthState, AgentScienceAuthError>;
  /**
   * Bearer token for `Authorization` headers, or `undefined` when the user
   * is signed out. Intended for internal use by other services.
   */
  readonly getBearerToken: Effect.Effect<string | undefined>;
}

export class AgentScienceAuthService extends ServiceMap.Service<
  AgentScienceAuthService,
  AgentScienceAuthShape
>()("agentscience/AgentScienceAuthService") {}

interface StoredToken {
  readonly token: string;
}

interface RuntimeState {
  readonly state: AgentScienceAuthState;
  readonly token: string | undefined;
  readonly pollFiber: Fiber.Fiber<void, never> | null;
}

function now(): string {
  return new Date().toISOString();
}

function isoPlus(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function toAuthError(cause: unknown, fallback: string): AgentScienceAuthError {
  const message =
    cause instanceof Error && cause.message.trim().length > 0 ? cause.message : fallback;
  return new AgentScienceAuthError({
    message,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function makeSignedOutState(baseUrl: string, message?: string): AgentScienceAuthState {
  return {
    status: "signed-out",
    updatedAt: now(),
    baseUrl,
    ...(message ? { message } : {}),
  };
}

function makePendingState(
  baseUrl: string,
  input: {
    readonly code: string;
    readonly verificationUrl: string;
    readonly expiresAt: string;
  },
): AgentScienceAuthState {
  return {
    status: "pending",
    updatedAt: now(),
    baseUrl,
    code: input.code,
    verificationUrl: input.verificationUrl,
    expiresAt: input.expiresAt,
  };
}

function makeSignedInState(
  baseUrl: string,
  user: AgentScienceAuthUser,
): AgentScienceAuthState {
  return {
    status: "signed-in",
    updatedAt: now(),
    baseUrl,
    user,
  };
}

function makeFailedState(baseUrl: string, message: string): AgentScienceAuthState {
  return {
    status: "failed",
    updatedAt: now(),
    baseUrl,
    message,
  };
}

const DeviceStartResponse = Schema.Struct({
  code: Schema.String,
  verificationUrl: Schema.String,
  pollUrl: Schema.String,
  expiresIn: Schema.Number,
});

const DevicePollPending = Schema.Struct({
  status: Schema.Literal("pending"),
});
const DevicePollComplete = Schema.Struct({
  status: Schema.Literal("complete"),
  token: Schema.String,
});
const DevicePollExpired = Schema.Struct({
  status: Schema.Literal("expired"),
});
const DevicePollResponse = Schema.Union([
  DevicePollPending,
  DevicePollComplete,
  DevicePollExpired,
]);

const MeResponse = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  handle: Schema.String,
  email: Schema.NullOr(Schema.String),
  institution: Schema.optional(Schema.NullOr(Schema.String)),
  publicationProfileComplete: Schema.optional(Schema.Boolean),
  publishNameRequired: Schema.optional(Schema.Boolean),
});

const toUser = (profile: {
  readonly id: string;
  readonly name: string;
  readonly handle: string;
  readonly email: string | null;
  readonly institution?: string | null | undefined;
  readonly publicationProfileComplete?: boolean | undefined;
  readonly publishNameRequired?: boolean | undefined;
}): AgentScienceAuthUser => ({
  id: profile.id,
  name: profile.name.trim().length > 0 ? profile.name : profile.handle,
  handle: profile.handle,
  email: profile.email,
  institution: profile.institution?.trim() ? profile.institution.trim() : null,
  publicationProfileComplete: profile.publicationProfileComplete ?? false,
  publishNameRequired: profile.publishNameRequired ?? false,
});

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/$/, "");
  return `${trimmed}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Minimal HTTP client interface so tests can inject stubbed responses without
 * touching the network. Matches `globalThis.fetch`.
 */
export interface HttpFetch {
  (
    input: string,
    init?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    },
  ): Promise<{
    readonly ok: boolean;
    readonly status: number;
    json(): Promise<unknown>;
    text(): Promise<string>;
  }>;
}

interface AgentScienceAuthDependencies {
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly fetch: HttpFetch;
  readonly baseUrl: string;
  readonly tokenFilePath: string;
  readonly sharedCliConfigPath?: string;
}

async function readJson<A>(
  response: Awaited<ReturnType<HttpFetch>>,
  schema: Schema.Decoder<A>,
  fallback: string,
): Promise<A> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      body.length > 0
        ? `${fallback} (${response.status}): ${body.slice(0, 200)}`
        : `${fallback} (${response.status}).`,
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new Error(`${fallback}: invalid JSON response.`, { cause });
  }
  const decodedExit = Schema.decodeUnknownExit(schema)(payload);
  if (Exit.isFailure(decodedExit)) {
    throw new Error(`${fallback}: unexpected response shape.`);
  }
  return decodedExit.value;
}

const withHttpTimeout = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  fallbackMessage: string,
): Effect.Effect<A, E | AgentScienceAuthError, R> =>
  effect.pipe(
    Effect.timeout(Duration.millis(HTTP_TIMEOUT_MS)),
    Effect.catchTag(
      "TimeoutError",
      () => Effect.fail(new AgentScienceAuthError({ message: fallbackMessage })),
    ),
  );

export const makeAgentScienceAuthService = Effect.fn(function* (
  dependencies: AgentScienceAuthDependencies,
) {
  const { fs, fetch, baseUrl, tokenFilePath, sharedCliConfigPath } = dependencies;

  const runtimeRef = yield* Ref.make<RuntimeState>({
    state: makeSignedOutState(baseUrl),
    token: undefined,
    pollFiber: null,
  });

  const setRuntime = (patch: Partial<RuntimeState>) =>
    Ref.update(runtimeRef, (runtime) => ({ ...runtime, ...patch }));

  const writeToken = (token: string) =>
    Effect.gen(function* () {
      const serialized: StoredToken = { token };
      yield* fs.writeFileString(tokenFilePath, `${JSON.stringify(serialized)}\n`);
      yield* Effect.promise(() =>
        import("node:fs/promises").then((m) => m.chmod(tokenFilePath, TOKEN_FILE_MODE)),
      ).pipe(Effect.ignore);
    }).pipe(
      Effect.mapError((cause) => toAuthError(cause, "Failed to persist AgentScience token.")),
    );

  const removeTokenFile = fs
    .remove(tokenFilePath, { force: true })
    .pipe(Effect.ignore, Effect.asVoid);

  const syncSharedCliConfig = (token: string, user: AgentScienceAuthUser) =>
    Effect.tryPromise({
      try: async () => {
        if (!sharedCliConfigPath) return;
        const nodeFs = await import("node:fs/promises");
        await nodeFs.mkdir(nodePath.dirname(sharedCliConfigPath), { recursive: true });
        let existing: Record<string, unknown> = {};
        try {
          existing = JSON.parse(await nodeFs.readFile(sharedCliConfigPath, "utf8"));
        } catch {
          existing = {};
        }

        const nextConfig: Record<string, unknown> = {
          ...existing,
          baseUrl,
          token,
          authorName: user.name,
        };
        if (user.institution) {
          nextConfig.authorAffiliation = user.institution;
        } else {
          delete nextConfig.authorAffiliation;
        }

        await nodeFs.writeFile(
          sharedCliConfigPath,
          `${JSON.stringify(nextConfig, null, 2)}\n`,
          { mode: TOKEN_FILE_MODE },
        );
        await nodeFs.chmod(sharedCliConfigPath, TOKEN_FILE_MODE).catch(() => undefined);
      },
      catch: (cause) => toAuthError(cause, "Failed to sync AgentScience CLI profile."),
    });

  const clearSharedCliConfigAuth = Effect.tryPromise({
    try: async () => {
      if (!sharedCliConfigPath) return;
      const nodeFs = await import("node:fs/promises");
      let existing: Record<string, unknown> = {};
      try {
        existing = JSON.parse(await nodeFs.readFile(sharedCliConfigPath, "utf8"));
      } catch {
        return;
      }
      delete existing.token;
      delete existing.authorName;
      delete existing.authorAffiliation;
      await nodeFs.writeFile(
        sharedCliConfigPath,
        `${JSON.stringify(existing, null, 2)}\n`,
        { mode: TOKEN_FILE_MODE },
      );
    },
    catch: (cause) => toAuthError(cause, "Failed to clear AgentScience CLI profile."),
  });

  const readStoredToken: Effect.Effect<string | undefined> = Effect.gen(function* () {
    const exists = yield* fs
      .exists(tokenFilePath)
      .pipe(Effect.catchCause(() => Effect.succeed(false)));
    if (!exists) return undefined;
    const raw = yield* fs
      .readFileString(tokenFilePath)
      .pipe(Effect.catchCause(() => Effect.succeed("")));
    if (raw.length === 0) return undefined;
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as StoredToken,
      catch: () => undefined,
    }).pipe(Effect.catchCause(() => Effect.succeed<StoredToken | undefined>(undefined)));
    if (
      !parsed ||
      typeof parsed.token !== "string" ||
      parsed.token.length === 0
    ) {
      return undefined;
    }
    return parsed.token;
  });

  const fetchMe = (token: string) =>
    withHttpTimeout(
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(joinUrl(baseUrl, "/api/v1/me"), {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
          });
          if (response.status === 401) {
            return undefined;
          }
          return await readJson(response, MeResponse, "Failed to read AgentScience profile");
        },
        catch: (cause) => toAuthError(cause, "Failed to read AgentScience profile."),
      }),
      "AgentScience profile request timed out.",
    );

  const resolveUser = (token: string) =>
    fetchMe(token).pipe(
      Effect.map((profile) => (profile ? toUser(profile) : undefined)),
    );

  const revokeToken = (token: string) =>
    withHttpTimeout(
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(joinUrl(baseUrl, "/api/v1/auth/revoke"), {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (response.status === 401) {
            return;
          }

          if (response.ok) {
            return;
          }

          const body = await response.text().catch(() => "");
          throw new Error(
            body.length > 0
              ? `Failed to revoke AgentScience token (${response.status}): ${body.slice(0, 200)}`
              : `Failed to revoke AgentScience token (${response.status}).`,
          );
        },
        catch: (cause) => toAuthError(cause, "Failed to revoke AgentScience token."),
      }),
      "AgentScience sign-out request timed out.",
    );

  const hydrateFromStoredToken = Effect.gen(function* () {
    const token = yield* readStoredToken;
    if (!token) return;
    const user = yield* resolveUser(token).pipe(
      Effect.catchCause(() => Effect.succeed(undefined as AgentScienceAuthUser | undefined)),
    );
    if (!user) {
      yield* removeTokenFile;
      return;
    }
    yield* syncSharedCliConfig(token, user).pipe(Effect.ignore);
    yield* setRuntime({
      state: makeSignedInState(baseUrl, user),
      token,
    });
  });

  const startDeviceCode = withHttpTimeout(
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(joinUrl(baseUrl, "/api/v1/auth/device"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        return await readJson(response, DeviceStartResponse, "Failed to start AgentScience login");
      },
      catch: (cause) => toAuthError(cause, "Failed to start AgentScience login."),
    }),
    "AgentScience login request timed out.",
  );

  const pollDeviceCode = (code: string) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(
          joinUrl(baseUrl, `/api/v1/auth/device/${encodeURIComponent(code)}`),
          { method: "GET" },
        );
        if (response.status === 404 || response.status === 410) {
          return { status: "expired" as const };
        }
        return await readJson(response, DevicePollResponse, "Device code poll failed");
      },
      catch: (cause) => toAuthError(cause, "Device code poll failed."),
    });

  const finalizeSignIn = (token: string) =>
    Effect.gen(function* () {
      const user = yield* resolveUser(token).pipe(
        Effect.catchCause(() => Effect.succeed(undefined as AgentScienceAuthUser | undefined)),
      );
      if (!user) {
        yield* setRuntime({
          state: makeFailedState(
            baseUrl,
            "AgentScience accepted the token but the profile could not be read.",
          ),
          pollFiber: null,
        });
        return;
      }
      const writeError = yield* writeToken(token).pipe(
        Effect.map(() => undefined as string | undefined),
        Effect.catch((err) => Effect.succeed(err.message)),
      );
      if (writeError !== undefined) {
        yield* setRuntime({
          state: makeFailedState(baseUrl, writeError),
          pollFiber: null,
        });
        return;
      }
      yield* syncSharedCliConfig(token, user).pipe(Effect.ignore);
      yield* setRuntime({
        state: makeSignedInState(baseUrl, user),
        token,
        pollFiber: null,
      });
    });

  const runPollingLoop = (code: string) =>
    Effect.gen(function* () {
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
        yield* Effect.sleep(Duration.millis(POLL_INTERVAL_MS));
        const pollResult = yield* pollDeviceCode(code).pipe(
          Effect.catchCause(() => Effect.succeed(undefined)),
        );
        if (!pollResult) continue;
        if (pollResult.status === "pending") continue;
        if (pollResult.status === "expired") {
          yield* setRuntime({
            state: makeFailedState(baseUrl, "Sign-in code expired before approval."),
            pollFiber: null,
          });
          return;
        }
        yield* finalizeSignIn(pollResult.token);
        return;
      }
      yield* setRuntime({
        state: makeFailedState(baseUrl, "Timed out waiting for sign-in."),
        pollFiber: null,
      });
    }).pipe(Effect.ignoreCause({ log: true }));

  yield* hydrateFromStoredToken.pipe(Effect.ignoreCause({ log: true }));

  const getState: AgentScienceAuthShape["getState"] = Ref.get(runtimeRef).pipe(
    Effect.map((runtime) => runtime.state),
  );

  const startLogin: AgentScienceAuthShape["startLogin"] = Effect.gen(function* () {
    const runtime = yield* Ref.get(runtimeRef);
    if (runtime.state.status === "pending") {
      return runtime.state;
    }
    const started = yield* startDeviceCode;
    const expiresAt = isoPlus(started.expiresIn * 1000);
    const state = makePendingState(baseUrl, {
      code: started.code,
      verificationUrl: started.verificationUrl,
      expiresAt,
    });
    const fiber = yield* Effect.forkDetach(runPollingLoop(started.code));
    yield* setRuntime({ state, pollFiber: fiber });
    return state;
  });

  const cancelLogin: AgentScienceAuthShape["cancelLogin"] = Effect.gen(function* () {
    const runtime = yield* Ref.get(runtimeRef);
    if (runtime.pollFiber) {
      yield* Fiber.interrupt(runtime.pollFiber).pipe(Effect.ignore);
    }
    yield* setRuntime({
      state: makeSignedOutState(baseUrl),
      pollFiber: null,
    });
    return yield* getState;
  });

  const signOut: AgentScienceAuthShape["signOut"] = Effect.gen(function* () {
    const runtime = yield* Ref.get(runtimeRef);
    if (runtime.pollFiber) {
      yield* Fiber.interrupt(runtime.pollFiber).pipe(Effect.ignore);
    }
    if (runtime.token) {
      yield* revokeToken(runtime.token);
    }
    yield* removeTokenFile;
    yield* clearSharedCliConfigAuth.pipe(Effect.ignore);
    yield* setRuntime({
      state: makeSignedOutState(baseUrl),
      token: undefined,
      pollFiber: null,
    });
    return yield* getState;
  });

  const getBearerToken: AgentScienceAuthShape["getBearerToken"] = Ref.get(runtimeRef).pipe(
    Effect.map((runtime) => runtime.token),
  );

  return {
    getState,
    startLogin,
    cancelLogin,
    signOut,
    getBearerToken,
  } satisfies AgentScienceAuthShape;
});

export const AgentScienceAuthLive = Layer.effect(
  AgentScienceAuthService,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const tokenFilePath = path.join(config.stateDir, TOKEN_FILE_NAME);
    const fetchImpl: HttpFetch = (input, init) =>
      globalThis.fetch(input, init) as unknown as ReturnType<HttpFetch>;
    return yield* makeAgentScienceAuthService({
      fs,
      path,
      fetch: fetchImpl,
      baseUrl: config.agentScienceBaseUrl,
      tokenFilePath,
      sharedCliConfigPath: SHARED_CLI_CONFIG_PATH,
    });
  }),
);
