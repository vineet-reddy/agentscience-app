import path from "node:path";
import { mkdir, readFile, rename, rm, writeFile, chmod } from "node:fs/promises";

import { ServerSettingsError } from "@agentscience/contracts";
import { Effect } from "effect";

const AUTH_MARKERS_FILE_NAME = "provider-auth-markers.json";
const AUTH_MARKERS_FILE_MODE = 0o600;

interface StoredProviderAuthMarkers {
  readonly geminiAgentScienceGoogleSignedInAt?: string;
  readonly geminiGoogleSignedInAt?: string;
}

function authMarkersPath(stateDir: string): string {
  return path.join(stateDir, AUTH_MARKERS_FILE_NAME);
}

function toSettingsError(cause: unknown, detail: string, stateDir: string) {
  return new ServerSettingsError({
    settingsPath: authMarkersPath(stateDir),
    detail,
    cause,
  });
}

async function readAuthMarkersFile(stateDir: string): Promise<StoredProviderAuthMarkers> {
  try {
    const raw = await readFile(authMarkersPath(stateDir), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const record = parsed as Record<string, unknown>;
    return {
      ...(typeof record.geminiAgentScienceGoogleSignedInAt === "string"
        ? { geminiAgentScienceGoogleSignedInAt: record.geminiAgentScienceGoogleSignedInAt }
        : {}),
      ...(typeof record.geminiGoogleSignedInAt === "string"
        ? { geminiGoogleSignedInAt: record.geminiGoogleSignedInAt }
        : {}),
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeAuthMarkersFile(
  stateDir: string,
  markers: StoredProviderAuthMarkers,
): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  const targetPath = authMarkersPath(stateDir);
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(markers, null, 2)}\n`, {
    mode: AUTH_MARKERS_FILE_MODE,
  });
  await chmod(tempPath, AUTH_MARKERS_FILE_MODE);
  await rename(tempPath, targetPath);
  await chmod(targetPath, AUTH_MARKERS_FILE_MODE);
}

export function hasGeminiGoogleAuthMarker(stateDir: string) {
  return Effect.tryPromise({
    try: async () => {
      const markers = await readAuthMarkersFile(stateDir);
      return Boolean(markers.geminiAgentScienceGoogleSignedInAt?.trim());
    },
    catch: (cause) => toSettingsError(cause, "failed to read provider auth marker", stateDir),
  });
}

export function markGeminiGoogleAuthenticated(stateDir: string) {
  return Effect.tryPromise({
    try: async () => {
      const markers = await readAuthMarkersFile(stateDir);
      const next = {
        ...markers,
        geminiAgentScienceGoogleSignedInAt: new Date().toISOString(),
      };
      delete next.geminiGoogleSignedInAt;
      await writeAuthMarkersFile(stateDir, next);
    },
    catch: (cause) => toSettingsError(cause, "failed to write provider auth marker", stateDir),
  });
}

export function clearGeminiGoogleAuthMarker(stateDir: string) {
  return Effect.tryPromise({
    try: async () => {
      const markers = await readAuthMarkersFile(stateDir);
      if (!markers.geminiAgentScienceGoogleSignedInAt && !markers.geminiGoogleSignedInAt) return;
      const next = { ...markers };
      delete next.geminiAgentScienceGoogleSignedInAt;
      delete next.geminiGoogleSignedInAt;
      if (Object.values(next).every((value) => !value)) {
        await rm(authMarkersPath(stateDir), { force: true });
        return;
      }
      await writeAuthMarkersFile(stateDir, next);
    },
    catch: (cause) => toSettingsError(cause, "failed to clear provider auth marker", stateDir),
  });
}
