import { execFile } from "node:child_process";
import { statSync } from "node:fs";

import {
  AgentScienceRuntimeActionError,
  type ServerRuntimeAgentScience,
  type ServerRuntimeAgentScienceCli,
  type ServerRuntimeAgentScienceSurface,
} from "@agentscience/contracts";
import { Effect, Equal, Exit, Layer, PubSub, Ref, ServiceMap, Stream } from "effect";

import { ServerConfig, type ServerConfigShape } from "./config";
import { resolveManagedAgentScienceCliLaunch } from "./managedAgentScienceCli";

const AGENTSCIENCE_RUNTIME_STATUS_TIMEOUT_MS = 15_000;
const AGENTSCIENCE_RUNTIME_STATUS_MAX_BUFFER_BYTES = 1024 * 1024;
const AGENTSCIENCE_RUNTIME_ACTION_TIMEOUT_MS = 5 * 60_000;
const AGENTSCIENCE_RUNTIME_ACTION_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const AGENTSCIENCE_INSTALLED_VERSION_TIMEOUT_MS = 10_000;
const AGENTSCIENCE_INSTALLED_VERSION_MAX_BUFFER_BYTES = 512 * 1024;
const MANAGED_CODEX_BINARY_ENV = "AGENTSCIENCE_MANAGED_CODEX_BINARY_PATH";
const MANAGED_SCIENCE_RUNTIME_BIN_DIR_ENV = "AGENTSCIENCE_MANAGED_SCIENCE_RUNTIME_BIN_DIR";
const MANAGED_PYTHON_PATH_ENV = "AGENTSCIENCE_MANAGED_PYTHON_PATH";
const DESKTOP_MANAGED_CLI_MISSING_MESSAGE =
  "This AgentScience app build is missing its bundled CLI. Reinstall the latest app.";
const DESKTOP_MANAGED_RUNTIME_MISSING_MESSAGE =
  "This AgentScience app build is missing its bundled scientific runtime. Install the latest app release.";

interface RawAgentScienceRuntimeCli {
  version?: unknown;
  personalityVersion?: unknown;
  personalityContentHash?: unknown;
  latestVersion?: unknown;
  checkedAt?: unknown;
  checkSource?: unknown;
}

interface RawAgentScienceRuntimeSurface {
  surface?: unknown;
  scope?: unknown;
  installed?: unknown;
  installMode?: unknown;
  autoUpdates?: unknown;
  personalityVersion?: unknown;
  personalityContentHash?: unknown;
  refreshRecommended?: unknown;
  current?: unknown;
}

interface RawAgentScienceRuntimeStatusPayload {
  ok?: unknown;
  updateAvailable?: unknown;
  cli?: RawAgentScienceRuntimeCli;
  codex?: { active?: RawAgentScienceRuntimeSurface } | undefined;
  claudeCode?: { active?: RawAgentScienceRuntimeSurface } | undefined;
  nextSteps?: unknown;
}

interface RawAgentScienceRuntimeStatusEnvelope {
  runtime?: RawAgentScienceRuntimeStatusPayload;
}

interface RawInstalledAgentSciencePackageTree {
  dependencies?: {
    agentscience?: {
      version?: unknown;
    };
  };
}

export interface AgentScienceRuntimeStatusShape {
  readonly getSnapshot: Effect.Effect<ServerRuntimeAgentScience>;
  readonly refresh: Effect.Effect<ServerRuntimeAgentScience>;
  readonly applyRecommendedActions: Effect.Effect<
    ServerRuntimeAgentScience,
    AgentScienceRuntimeActionError
  >;
  readonly streamChanges: Stream.Stream<ServerRuntimeAgentScience>;
}

export class AgentScienceRuntimeStatus extends ServiceMap.Service<
  AgentScienceRuntimeStatus,
  AgentScienceRuntimeStatusShape
>()("agentscience/AgentScienceRuntimeStatus") {}

function normalizeNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeNonEmptyString(entry))
    .filter((entry): entry is string => entry !== undefined);
}

function toRuntimeSurface(
  value: RawAgentScienceRuntimeSurface | undefined,
): ServerRuntimeAgentScienceSurface | undefined {
  const surface = normalizeNonEmptyString(value?.surface);
  const scope = normalizeNonEmptyString(value?.scope);
  if (!surface || !scope) {
    return undefined;
  }

  return {
    surface,
    scope,
    installed: normalizeBoolean(value?.installed),
    ...(normalizeNonEmptyString(value?.installMode)
      ? { installMode: normalizeNonEmptyString(value?.installMode) }
      : {}),
    autoUpdates: normalizeBoolean(value?.autoUpdates),
    ...(normalizeNonEmptyString(value?.personalityVersion)
      ? { personalityVersion: normalizeNonEmptyString(value?.personalityVersion) }
      : {}),
    ...(normalizeNonEmptyString(value?.personalityContentHash)
      ? { personalityContentHash: normalizeNonEmptyString(value?.personalityContentHash) }
      : {}),
    refreshRecommended: normalizeBoolean(value?.refreshRecommended),
    current: normalizeBoolean(value?.current),
  };
}

function toRuntimeCli(
  value: RawAgentScienceRuntimeCli | undefined,
): {
  readonly cli?: ServerRuntimeAgentScienceCli;
  readonly checkedAt?: string;
} {
  const version = normalizeNonEmptyString(value?.version);
  const latestVersion = normalizeNonEmptyString(value?.latestVersion);
  const personalityVersion = normalizeNonEmptyString(value?.personalityVersion);
  const personalityContentHash = normalizeNonEmptyString(value?.personalityContentHash);
  const checkSource = normalizeNonEmptyString(value?.checkSource);
  const checkedAt = normalizeNonEmptyString(value?.checkedAt);

  const cli =
    version ||
    latestVersion ||
    personalityVersion ||
    personalityContentHash ||
    checkSource
      ? {
          ...(version ? { version } : {}),
          ...(latestVersion ? { latestVersion } : {}),
          ...(personalityVersion ? { personalityVersion } : {}),
          ...(personalityContentHash ? { personalityContentHash } : {}),
          ...(checkSource ? { checkSource } : {}),
        }
      : undefined;

  return {
    ...(cli ? { cli } : {}),
    ...(checkedAt ? { checkedAt } : {}),
  };
}

export function createInitialAgentScienceRuntimeStatus(
  checkedAt = new Date().toISOString(),
): ServerRuntimeAgentScience {
  return {
    state: "checking",
    checkedAt,
    ok: false,
    updateAvailable: false,
    refreshRecommended: false,
    nextSteps: [],
  };
}

export function createUnavailableAgentScienceRuntimeStatus(
  checkedAt: string,
  message: string,
): ServerRuntimeAgentScience {
  return {
    state: "unavailable",
    checkedAt,
    ok: false,
    updateAvailable: false,
    refreshRecommended: false,
    nextSteps: [],
    message,
  };
}

export function createErroredAgentScienceRuntimeStatus(
  checkedAt: string,
  message: string,
): ServerRuntimeAgentScience {
  return {
    state: "error",
    checkedAt,
    ok: false,
    updateAvailable: false,
    refreshRecommended: false,
    nextSteps: [],
    message,
  };
}

export function parseAgentScienceRuntimeStatusJson(
  stdout: string,
  checkedAtFallback = new Date().toISOString(),
): ServerRuntimeAgentScience {
  const parsed = JSON.parse(stdout) as RawAgentScienceRuntimeStatusEnvelope;
  const runtime = parsed.runtime;
  if (!runtime || typeof runtime !== "object") {
    throw new Error("Runtime status output did not include a runtime payload.");
  }

  const { cli, checkedAt } = toRuntimeCli(runtime.cli);
  const codexActive = toRuntimeSurface(runtime.codex?.active);
  const claudeCodeActive = toRuntimeSurface(runtime.claudeCode?.active);
  const refreshRecommended =
    Boolean(codexActive?.refreshRecommended) || Boolean(claudeCodeActive?.refreshRecommended);
  const ok = runtime.ok !== false;
  const resolvedCheckedAt = checkedAt ?? checkedAtFallback;

  return {
    state: ok ? "ready" : "error",
    checkedAt: resolvedCheckedAt,
    ok,
    updateAvailable: normalizeBoolean(runtime.updateAvailable),
    refreshRecommended,
    nextSteps: normalizeStringArray(runtime.nextSteps),
    ...(cli ? { cli } : {}),
    ...(codexActive ? { codexActive } : {}),
    ...(claudeCodeActive ? { claudeCodeActive } : {}),
    ...(!ok ? { message: "AgentScience runtime check reported a problem." } : {}),
  };
}

export function parseInstalledAgentSciencePackageVersionJson(
  stdout: string,
): string | undefined {
  const parsed = JSON.parse(stdout) as RawInstalledAgentSciencePackageTree;
  return normalizeNonEmptyString(parsed.dependencies?.agentscience?.version);
}

function removeAgentScienceUpdateSteps(nextSteps: readonly string[]): string[] {
  return nextSteps.filter((step) => !/\bnpm\s+install\b.*\bagentscience@latest\b/i.test(step));
}

export function reconcileInstalledAgentScienceCliVersion(
  status: ServerRuntimeAgentScience,
  installedVersion: string | null | undefined,
): ServerRuntimeAgentScience {
  const cli = status.cli;
  const latestVersion = cli?.latestVersion;

  if (
    status.state !== "ready" ||
    !status.updateAvailable ||
    !cli ||
    !latestVersion ||
    !installedVersion ||
    installedVersion !== latestVersion
  ) {
    return status;
  }

  return {
    ...status,
    updateAvailable: false,
    nextSteps: removeAgentScienceUpdateSteps(status.nextSteps),
    cli: {
      ...cli,
      version: installedVersion,
    },
  };
}

function summarizeCommandFailure(stderr: string, fallback: string): string {
  const detail = stderr.trim();
  if (!detail) {
    return fallback;
  }

  const firstLine = detail.split(/\r?\n/u)[0]?.trim();
  return firstLine && firstLine.length > 0 ? firstLine : fallback;
}

type AgentScienceMaintenanceCommand = {
  readonly command: string;
  readonly args: readonly string[];
};

type AgentScienceCliLaunch = {
  readonly command: string;
  readonly args: readonly string[];
  readonly version?: string;
};

function isDirectory(candidatePath: string | undefined): boolean {
  if (!candidatePath) {
    return false;
  }

  try {
    return statSync(candidatePath).isDirectory();
  } catch {
    return false;
  }
}

function isFile(candidatePath: string | undefined): boolean {
  if (!candidatePath) {
    return false;
  }

  try {
    return statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

function isDesktopMode(config: Pick<ServerConfigShape, "mode">): boolean {
  return config.mode === "desktop";
}

function isManagedDesktopCodexEnvironment(): boolean {
  return Boolean(normalizeNonEmptyString(process.env[MANAGED_CODEX_BINARY_ENV]));
}

export function hasManagedScienceRuntime(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isDirectory(normalizeNonEmptyString(env[MANAGED_SCIENCE_RUNTIME_BIN_DIR_ENV])) &&
    isFile(normalizeNonEmptyString(env[MANAGED_PYTHON_PATH_ENV]));
}

export function normalizeDesktopManagedStatus(
  status: ServerRuntimeAgentScience,
  managedCliVersion: string | undefined,
): ServerRuntimeAgentScience {
  const nextSteps = removeAgentScienceUpdateSteps(status.nextSteps);
  const cli = status.cli
    ? {
        ...status.cli,
        ...(managedCliVersion ? { version: managedCliVersion } : {}),
      }
    : managedCliVersion
      ? { version: managedCliVersion }
      : undefined;

  if (status.state !== "ready") {
    return {
      ...status,
      nextSteps,
      ...(cli ? { cli } : {}),
    };
  }

  return {
    ...status,
    updateAvailable: false,
    nextSteps,
    ...(cli ? { cli } : {}),
  };
}

function resolveAgentScienceCliLaunch(
  config: Pick<ServerConfigShape, "mode">,
  cliArgs: readonly string[],
): AgentScienceCliLaunch | null {
  if (!isDesktopMode(config)) {
    return {
      command: "agentscience",
      args: cliArgs,
    };
  }

  return resolveManagedAgentScienceCliLaunch(cliArgs);
}

function createDesktopManagedRuntimeError(
  checkedAt: string,
  message: string,
): ServerRuntimeAgentScience {
  return createErroredAgentScienceRuntimeStatus(checkedAt, message);
}

function resolveExecutable(binaryName: string): string {
  return process.platform === "win32" ? `${binaryName}.cmd` : binaryName;
}

function resolveRecommendedMaintenanceCommands(
  config: Pick<ServerConfigShape, "mode">,
  status: ServerRuntimeAgentScience,
): ReadonlyArray<AgentScienceMaintenanceCommand> {
  if (status.state !== "ready") {
    return [];
  }

  const commands: AgentScienceMaintenanceCommand[] = [];

  if (status.updateAvailable) {
    if (isDesktopMode(config)) {
      return [];
    }

    commands.push({
      command: resolveExecutable("npm"),
      args: ["install", "-g", "agentscience@latest"],
    });
  }

  if (status.codexActive?.refreshRecommended) {
    const launch = resolveAgentScienceCliLaunch(config, [
      "setup",
      "codex",
      ...(status.codexActive.scope === "project" ? ["--project"] : []),
    ]);
    if (!launch) {
      return [];
    }

    commands.push({
      command: launch.command,
      args: launch.args,
    });
  }

  if (status.claudeCodeActive?.refreshRecommended) {
    const launch = resolveAgentScienceCliLaunch(config, [
      "setup",
      "claude-code",
      ...(status.claudeCodeActive.scope === "project" ? ["--project"] : []),
    ]);
    if (!launch) {
      return [];
    }

    commands.push({
      command: launch.command,
      args: launch.args,
    });
  }

  return commands;
}

function runMaintenanceCommand(
  cwd: string,
  command: AgentScienceMaintenanceCommand,
): Effect.Effect<void, AgentScienceRuntimeActionError> {
  return Effect.promise(() => {
    return new Promise<void>((resolve, reject) => {
      execFile(
        command.command,
        [...command.args],
        {
          cwd,
          env: process.env,
          encoding: "utf8",
          timeout: AGENTSCIENCE_RUNTIME_ACTION_TIMEOUT_MS,
          maxBuffer: AGENTSCIENCE_RUNTIME_ACTION_MAX_BUFFER_BYTES,
        },
        (error, _stdout, stderr) => {
          if (!error) {
            resolve();
            return;
          }

          reject(
            new Error(
              summarizeCommandFailure(
                stderr,
                error.killed ? "AgentScience update timed out." : "AgentScience update failed.",
              ),
              { cause: error },
            ),
          );
        },
      );
    });
  }).pipe(
    Effect.mapError(
      (error: unknown) =>
        new AgentScienceRuntimeActionError({
          message: error instanceof Error ? error.message : "AgentScience update failed.",
          cause: error,
        }),
    ),
  );
}

function readInstalledAgentSciencePackageVersion(
  cwd: string,
): Effect.Effect<string | undefined> {
  return Effect.promise(() => {
    return new Promise<string | undefined>((resolve) => {
      execFile(
        resolveExecutable("npm"),
        ["ls", "-g", "agentscience", "--depth=0", "--json"],
        {
          cwd,
          env: process.env,
          encoding: "utf8",
          timeout: AGENTSCIENCE_INSTALLED_VERSION_TIMEOUT_MS,
          maxBuffer: AGENTSCIENCE_INSTALLED_VERSION_MAX_BUFFER_BYTES,
        },
        (error, stdout) => {
          if (error) {
            resolve(undefined);
            return;
          }

          try {
            resolve(parseInstalledAgentSciencePackageVersionJson(stdout));
          } catch {
            resolve(undefined);
          }
        },
      );
    });
  });
}

function reconcileRuntimeStatusWithInstalledCliVersion(
  config: Pick<ServerConfigShape, "mode">,
  cwd: string,
  status: ServerRuntimeAgentScience,
): Effect.Effect<ServerRuntimeAgentScience> {
  if (isDesktopMode(config)) {
    return Effect.succeed(status);
  }

  if (
    status.state !== "ready" ||
    !status.updateAvailable ||
    !status.cli?.latestVersion
  ) {
    return Effect.succeed(status);
  }

  return readInstalledAgentSciencePackageVersion(cwd).pipe(
    Effect.map((installedVersion) =>
      reconcileInstalledAgentScienceCliVersion(status, installedVersion),
    ),
  );
}

function runAgentScienceRuntimeStatusCommand(
  config: Pick<ServerConfigShape, "cwd" | "mode">,
): Effect.Effect<ServerRuntimeAgentScience> {
  return Effect.promise(() => {
    const checkedAt = new Date().toISOString();
    const launch = resolveAgentScienceCliLaunch(config, ["runtime", "status", "--json"]);

    if (!launch) {
      return Promise.resolve(
        createUnavailableAgentScienceRuntimeStatus(checkedAt, DESKTOP_MANAGED_CLI_MISSING_MESSAGE),
      );
    }

    if (isDesktopMode(config) && isManagedDesktopCodexEnvironment() && !hasManagedScienceRuntime()) {
      return Promise.resolve(
        createDesktopManagedRuntimeError(checkedAt, DESKTOP_MANAGED_RUNTIME_MISSING_MESSAGE),
      );
    }

    return new Promise<ServerRuntimeAgentScience>((resolve) => {
      execFile(
        launch.command,
        [...launch.args],
        {
          cwd: config.cwd,
          env: process.env,
          encoding: "utf8",
          timeout: AGENTSCIENCE_RUNTIME_STATUS_TIMEOUT_MS,
          maxBuffer: AGENTSCIENCE_RUNTIME_STATUS_MAX_BUFFER_BYTES,
        },
        (error, stdout, stderr) => {
          if (error) {
            const errorCode = (error as NodeJS.ErrnoException).code;
            if (errorCode === "ENOENT") {
              resolve(
                createUnavailableAgentScienceRuntimeStatus(
                  checkedAt,
                  "AgentScience runtime check is unavailable on this system.",
                ),
              );
              return;
            }

            resolve(
              createErroredAgentScienceRuntimeStatus(
                checkedAt,
                summarizeCommandFailure(
                  stderr,
                  error.killed
                    ? "AgentScience runtime check timed out."
                    : "AgentScience runtime check failed.",
                ),
              ),
            );
            return;
          }

          try {
            const parsed = parseAgentScienceRuntimeStatusJson(stdout, checkedAt);
            resolve(
              isDesktopMode(config)
                ? normalizeDesktopManagedStatus(parsed, launch.version)
                : parsed,
            );
          } catch (parseError) {
            resolve(
              createErroredAgentScienceRuntimeStatus(
                checkedAt,
                parseError instanceof Error
                  ? parseError.message
                  : "AgentScience runtime check returned invalid JSON.",
              ),
            );
          }
        },
      );
    });
  }).pipe(
    Effect.flatMap((status) => reconcileRuntimeStatusWithInstalledCliVersion(config, config.cwd, status)),
  );
}

export const AgentScienceRuntimeStatusLive = Layer.effect(
  AgentScienceRuntimeStatus,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const changesPubSub = yield* Effect.acquireRelease(
      PubSub.unbounded<ServerRuntimeAgentScience>(),
      PubSub.shutdown,
    );
    const snapshotRef = yield* Ref.make<ServerRuntimeAgentScience>(
      createInitialAgentScienceRuntimeStatus(),
    );

    const publishSnapshot = (next: ServerRuntimeAgentScience) =>
      Effect.gen(function* () {
        const previous = yield* Ref.get(snapshotRef);
        yield* Ref.set(snapshotRef, next);
        if (!Equal.equals(previous, next)) {
          yield* PubSub.publish(changesPubSub, next);
        }
      });

    return {
      getSnapshot: Ref.get(snapshotRef),
      refresh: Effect.gen(function* () {
        yield* publishSnapshot(createInitialAgentScienceRuntimeStatus());
        const next = yield* runAgentScienceRuntimeStatusCommand(config);
        yield* publishSnapshot(next);
        return next;
      }),
      applyRecommendedActions: Effect.gen(function* () {
        const current = yield* Ref.get(snapshotRef);
        const status =
          current.state === "ready" ? current : yield* runAgentScienceRuntimeStatusCommand(config);
        const commands = resolveRecommendedMaintenanceCommands(config, status);

        if (commands.length === 0) {
          yield* publishSnapshot(status);
          return status;
        }

        yield* publishSnapshot(createInitialAgentScienceRuntimeStatus());

        const exit = yield* Effect.exit(
          Effect.forEach(commands, (command) => runMaintenanceCommand(config.cwd, command), {
            concurrency: 1,
          }),
        );

        const refreshed = yield* runAgentScienceRuntimeStatusCommand(config);
        yield* publishSnapshot(refreshed);

        if (Exit.isFailure(exit)) {
          return yield* Effect.failCause(exit.cause);
        }

        return refreshed;
      }),
      get streamChanges() {
        return Stream.fromPubSub(changesPubSub);
      },
    } satisfies AgentScienceRuntimeStatusShape;
  }),
);
