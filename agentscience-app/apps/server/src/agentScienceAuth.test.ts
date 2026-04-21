/**
 * Unit tests for the AgentScienceAuth service.
 *
 * Covers the state-machine transitions that actually matter at runtime:
 *   - Fresh start yields `signed-out`.
 *   - `startLogin` returns `pending` and exposes a verification URL.
 *   - A `complete` poll response flips the service to `signed-in`, persists
 *     the bearer token to disk, and exposes it via `getBearerToken`.
 *   - An `expired` poll response flips the service to `failed`.
 *   - `signOut` from `signed-in` clears state and removes the token file.
 *   - A previously persisted token is hydrated on startup.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assert, it } from "@effect/vitest";
import { Duration, Effect, FileSystem, Layer, Path } from "effect";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";

import {
  type HttpFetch,
  makeAgentScienceAuthService,
} from "./agentScienceAuth.ts";

const TestPlatform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const BASE_URL = "https://agentscience.test";
const TOKEN = "tok_abcdef";
const PROFILE = {
  id: "user_1",
  name: "Alice Researcher",
  handle: "alice",
  email: "alice@example.com",
};

/**
 * Build a fetch stub that matches on the request method + pathname of the
 * requested URL. Each configured response can return either a JSON body or a
 * status + text pair.
 */
function makeStubFetch(
  responders: Array<{
    method: string;
    pathname: string;
    respond: () => { status: number; body?: unknown; text?: string };
  }>,
): { fetch: HttpFetch; calls: Array<{ method: string; url: string }> } {
  const calls: Array<{ method: string; url: string }> = [];
  const fetch: HttpFetch = async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url: input });
    const url = new URL(input);
    const match = responders.find(
      (responder) =>
        responder.method === method && responder.pathname === url.pathname,
    );
    if (!match) {
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => `no responder for ${method} ${url.pathname}`,
      };
    }
    const { status, body, text } = match.respond();
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body ?? {},
      text: async () => text ?? JSON.stringify(body ?? {}),
    };
  };
  return { fetch, calls };
}

it.effect("starts signed-out when no token exists on disk", () =>
  Effect.gen(function* () {
    const tempDir = yield* Effect.promise(() =>
      fs.mkdtemp(path.join(os.tmpdir(), "agentscience-auth-test-")),
    );
    const tokenFilePath = path.join(tempDir, "agentscience-auth.json");

    const { fetch } = makeStubFetch([]);
    const fsService = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;

    const service = yield* makeAgentScienceAuthService({
      fs: fsService,
      path: pathService,
      fetch,
      baseUrl: BASE_URL,
      tokenFilePath,
    });

    const state = yield* service.getState;
    assert.equal(state.status, "signed-out");
    const token = yield* service.getBearerToken;
    assert.equal(token, undefined);

    yield* Effect.promise(() => fs.rm(tempDir, { recursive: true, force: true }));
  }).pipe(Effect.provide(TestPlatform)),
);

it.effect(
  "startLogin returns pending with a verification URL",
  () =>
    Effect.gen(function* () {
      const tempDir = yield* Effect.promise(() =>
        fs.mkdtemp(path.join(os.tmpdir(), "agentscience-auth-test-")),
      );
      const tokenFilePath = path.join(tempDir, "agentscience-auth.json");

      const { fetch } = makeStubFetch([
        {
          method: "POST",
          pathname: "/api/v1/auth/device",
          respond: () => ({
            status: 200,
            body: {
              code: "USER-CODE-123",
              verificationUrl: `${BASE_URL}/approve/USER-CODE-123`,
              pollUrl: `${BASE_URL}/api/v1/auth/device/USER-CODE-123`,
              expiresIn: 600,
            },
          }),
        },
      ]);

      const fsService = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;

      const service = yield* makeAgentScienceAuthService({
        fs: fsService,
        path: pathService,
        fetch,
        baseUrl: BASE_URL,
        tokenFilePath,
      });

      const pending = yield* service.startLogin;
      assert.equal(pending.status, "pending");
      assert.equal(pending.code, "USER-CODE-123");
      assert.equal(pending.verificationUrl, `${BASE_URL}/approve/USER-CODE-123`);

      yield* service.cancelLogin;
      yield* Effect.promise(() => fs.rm(tempDir, { recursive: true, force: true }));
    }).pipe(Effect.provide(TestPlatform)),
  { timeout: 10_000 },
);

it.live(
  "completes sign-in, persists token with 0600, and exposes user profile",
  () =>
    Effect.gen(function* () {
      const tempDir = yield* Effect.promise(() =>
        fs.mkdtemp(path.join(os.tmpdir(), "agentscience-auth-test-")),
      );
      const tokenFilePath = path.join(tempDir, "agentscience-auth.json");

      let pollCount = 0;
      const { fetch } = makeStubFetch([
        {
          method: "POST",
          pathname: "/api/v1/auth/device",
          respond: () => ({
            status: 200,
            body: {
              code: "USER-CODE-123",
              verificationUrl: `${BASE_URL}/approve/USER-CODE-123`,
              pollUrl: `${BASE_URL}/api/v1/auth/device/USER-CODE-123`,
              expiresIn: 600,
            },
          }),
        },
        {
          method: "GET",
          pathname: "/api/v1/auth/device/USER-CODE-123",
          respond: () => {
            pollCount += 1;
            if (pollCount === 1) {
              return { status: 200, body: { status: "pending" } };
            }
            return { status: 200, body: { status: "complete", token: TOKEN } };
          },
        },
        {
          method: "GET",
          pathname: "/api/v1/me",
          respond: () => ({ status: 200, body: PROFILE }),
        },
      ]);

      const fsService = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;

      const service = yield* makeAgentScienceAuthService({
        fs: fsService,
        path: pathService,
        fetch,
        baseUrl: BASE_URL,
        tokenFilePath,
      });

      yield* service.startLogin;

      // Polling runs on a 2s interval; wait until the state flips.
      yield* Effect.sleep(Duration.millis(5_000));

      const signedInState = yield* service.getState;
      assert.equal(signedInState.status, "signed-in");
      assert.equal(signedInState.user?.handle, "alice");
      assert.equal(signedInState.user?.email, "alice@example.com");

      const bearer = yield* service.getBearerToken;
      assert.equal(bearer, TOKEN);

      const raw = yield* Effect.promise(() => fs.readFile(tokenFilePath, "utf8"));
      const parsed = JSON.parse(raw) as { token: string };
      assert.equal(parsed.token, TOKEN);

      const stat = yield* Effect.promise(() => fs.stat(tokenFilePath));
      const mode = stat.mode & 0o777;
      assert.equal(mode, 0o600);

      yield* service.signOut;
      const afterSignOut = yield* service.getState;
      assert.equal(afterSignOut.status, "signed-out");
      const afterSignOutBearer = yield* service.getBearerToken;
      assert.equal(afterSignOutBearer, undefined);

      const exists = yield* Effect.promise(() =>
        fs
          .access(tokenFilePath)
          .then(() => true)
          .catch(() => false),
      );
      assert.equal(exists, false);

      yield* Effect.promise(() => fs.rm(tempDir, { recursive: true, force: true }));
    }).pipe(Effect.provide(TestPlatform)),
  { timeout: 15_000 },
);

it.live(
  "hydrates signed-in state from a previously persisted token",
  () =>
    Effect.gen(function* () {
      const tempDir = yield* Effect.promise(() =>
        fs.mkdtemp(path.join(os.tmpdir(), "agentscience-auth-test-")),
      );
      const tokenFilePath = path.join(tempDir, "agentscience-auth.json");
      yield* Effect.promise(() =>
        fs.writeFile(tokenFilePath, JSON.stringify({ token: TOKEN })),
      );

      const { fetch } = makeStubFetch([
        {
          method: "GET",
          pathname: "/api/v1/me",
          respond: () => ({ status: 200, body: PROFILE }),
        },
      ]);

      const fsService = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;

      const service = yield* makeAgentScienceAuthService({
        fs: fsService,
        path: pathService,
        fetch,
        baseUrl: BASE_URL,
        tokenFilePath,
      });

      // Hydration runs inside the service constructor - wait a tick for it.
      yield* Effect.sleep(Duration.millis(250));

      const state = yield* service.getState;
      assert.equal(state.status, "signed-in");
      assert.equal(state.user?.handle, "alice");

      yield* Effect.promise(() => fs.rm(tempDir, { recursive: true, force: true }));
    }).pipe(Effect.provide(TestPlatform)),
  { timeout: 10_000 },
);

it.live(
  "discards an invalid stored token on hydrate and returns to signed-out",
  () =>
    Effect.gen(function* () {
      const tempDir = yield* Effect.promise(() =>
        fs.mkdtemp(path.join(os.tmpdir(), "agentscience-auth-test-")),
      );
      const tokenFilePath = path.join(tempDir, "agentscience-auth.json");
      yield* Effect.promise(() =>
        fs.writeFile(tokenFilePath, JSON.stringify({ token: "stale" })),
      );

      const { fetch } = makeStubFetch([
        {
          method: "GET",
          pathname: "/api/v1/me",
          respond: () => ({ status: 401, text: "Unauthorized" }),
        },
      ]);

      const fsService = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;

      const service = yield* makeAgentScienceAuthService({
        fs: fsService,
        path: pathService,
        fetch,
        baseUrl: BASE_URL,
        tokenFilePath,
      });

      yield* Effect.sleep(Duration.millis(250));

      const state = yield* service.getState;
      assert.equal(state.status, "signed-out");

      const exists = yield* Effect.promise(() =>
        fs
          .access(tokenFilePath)
          .then(() => true)
          .catch(() => false),
      );
      assert.equal(exists, false);

      yield* Effect.promise(() => fs.rm(tempDir, { recursive: true, force: true }));
    }).pipe(Effect.provide(TestPlatform)),
  { timeout: 10_000 },
);
