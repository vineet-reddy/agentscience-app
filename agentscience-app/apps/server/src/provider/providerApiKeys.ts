import path from "node:path";
import { mkdir, readFile, rename, rm, writeFile, chmod } from "node:fs/promises";

import { Effect } from "effect";

import { ServerSettingsError } from "@agentscience/contracts";

const API_KEYS_FILE_NAME = "provider-api-keys.json";
const API_KEYS_FILE_MODE = 0o600;

type ProviderApiKeyId = "gemini";

interface StoredProviderApiKeys {
  readonly gemini?: string;
}

function apiKeysPath(stateDir: string): string {
  return path.join(stateDir, API_KEYS_FILE_NAME);
}

function toSettingsError(cause: unknown, detail: string, stateDir: string) {
  return new ServerSettingsError({
    settingsPath: apiKeysPath(stateDir),
    detail,
    cause,
  });
}

async function readApiKeysFile(stateDir: string): Promise<StoredProviderApiKeys> {
  try {
    const raw = await readFile(apiKeysPath(stateDir), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const record = parsed as Record<string, unknown>;
    return typeof record.gemini === "string" ? { gemini: record.gemini } : {};
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeApiKeysFile(stateDir: string, keys: StoredProviderApiKeys): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  const targetPath = apiKeysPath(stateDir);
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(keys, null, 2)}\n`, { mode: API_KEYS_FILE_MODE });
  await chmod(tempPath, API_KEYS_FILE_MODE);
  await rename(tempPath, targetPath);
  await chmod(targetPath, API_KEYS_FILE_MODE);
}

export function readProviderApiKey(stateDir: string, provider: ProviderApiKeyId) {
  return Effect.tryPromise({
    try: async () => {
      const keys = await readApiKeysFile(stateDir);
      return keys[provider]?.trim() || undefined;
    },
    catch: (cause) => toSettingsError(cause, "failed to read provider API key", stateDir),
  });
}

export function writeProviderApiKey(
  stateDir: string,
  provider: ProviderApiKeyId,
  apiKey: string,
) {
  return Effect.tryPromise({
    try: async () => {
      const keys = await readApiKeysFile(stateDir);
      await writeApiKeysFile(stateDir, {
        ...keys,
        [provider]: apiKey.trim(),
      });
    },
    catch: (cause) => toSettingsError(cause, "failed to write provider API key", stateDir),
  });
}

export function validateGeminiApiKey(apiKey: string, stateDir: string) {
  return Effect.tryPromise({
    try: async () => {
      const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
      url.searchParams.set("key", apiKey.trim());
      const response = await fetch(url, { method: "GET" });
      if (response.ok) return;

      let detail = "";
      try {
        const body = (await response.json()) as unknown;
        if (body && typeof body === "object" && "error" in body) {
          const error = (body as { error?: { message?: unknown } }).error;
          if (typeof error?.message === "string") detail = error.message;
        }
      } catch {
        detail = await response.text().catch(() => "");
      }

      throw new Error(
        detail.trim() ||
          `Gemini rejected this API key (${response.status} ${response.statusText}).`,
      );
    },
    catch: (cause) =>
      toSettingsError(
        cause,
        cause instanceof Error && cause.message.trim().length > 0
          ? cause.message
          : "failed to validate Gemini API key",
        stateDir,
      ),
  });
}

export function removeProviderApiKey(stateDir: string, provider: ProviderApiKeyId) {
  return Effect.tryPromise({
    try: async () => {
      const keys = await readApiKeysFile(stateDir);
      const next = { ...keys };
      delete next[provider];
      if (Object.values(next).every((value) => !value)) {
        await rm(apiKeysPath(stateDir), { force: true });
        return;
      }
      await writeApiKeysFile(stateDir, next);
    },
    catch: (cause) => toSettingsError(cause, "failed to remove provider API key", stateDir),
  });
}
