import type { ModelCapabilities, ServerProviderModel } from "@agentscience/contracts";

import type { CodexAccountSnapshot } from "./codexAccount.ts";

export type CodexModelAvailability = "apiKey" | "chatgpt" | "unknown";

export type CodexCatalogModel = ServerProviderModel & {
  readonly availableFor?: ReadonlyArray<CodexModelAvailability>;
};

const CATALOG_PATH = "/api/v1/app/model-catalog";
const CATALOG_TIMEOUT_MS = 1_500;
const REMOVED_MODEL_SLUGS = new Set([
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2-codex",
  "gpt-5.2",
]);
type CatalogFetch = (input: URL, init: RequestInit) => Promise<Response>;

export const DEFAULT_CODEX_GPT_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [
    { value: "xhigh", label: "Extra High" },
    { value: "high", label: "High" },
    { value: "medium", label: "Medium", isDefault: true },
    { value: "low", label: "Low" },
  ],
  supportsFastMode: true,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseAvailability(value: unknown): ReadonlyArray<CodexModelAvailability> | undefined {
  if (!Array.isArray(value)) return undefined;
  const availability = value.filter(
    (entry): entry is CodexModelAvailability =>
      entry === "apiKey" || entry === "chatgpt" || entry === "unknown",
  );
  return availability.length > 0 ? availability : undefined;
}

function parseCapabilities(value: unknown): ModelCapabilities | null {
  const caps = asObject(value);
  if (!caps) return null;

  const reasoningEffortLevels: Array<ModelCapabilities["reasoningEffortLevels"][number]> = [];
  if (Array.isArray(caps.reasoningEffortLevels)) {
    for (const entry of caps.reasoningEffortLevels) {
      const record = asObject(entry);
      const value = asNonEmptyString(record?.value);
      const label = asNonEmptyString(record?.label);
      if (!value || !label) continue;
      reasoningEffortLevels.push(
        typeof record?.isDefault === "boolean"
          ? { value, label, isDefault: record.isDefault }
          : { value, label },
      );
    }
  }

  const contextWindowOptions: Array<ModelCapabilities["contextWindowOptions"][number]> = [];
  if (Array.isArray(caps.contextWindowOptions)) {
    for (const entry of caps.contextWindowOptions) {
      const record = asObject(entry);
      const value = asNonEmptyString(record?.value);
      const label = asNonEmptyString(record?.label);
      if (!value || !label) continue;
      contextWindowOptions.push(
        typeof record?.isDefault === "boolean"
          ? { value, label, isDefault: record.isDefault }
          : { value, label },
      );
    }
  }

  const promptInjectedEffortLevels = Array.isArray(caps.promptInjectedEffortLevels)
    ? caps.promptInjectedEffortLevels.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      )
    : [];

  return {
    reasoningEffortLevels,
    supportsFastMode: caps.supportsFastMode === true,
    supportsThinkingToggle: caps.supportsThinkingToggle === true,
    contextWindowOptions,
    promptInjectedEffortLevels,
  };
}

function parseCatalogModel(value: unknown): CodexCatalogModel | null {
  const record = asObject(value);
  const slug = asNonEmptyString(record?.slug);
  const name = asNonEmptyString(record?.name);
  if (!slug || !name) return null;
  const availableFor = parseAvailability(record?.availableFor);

  const model: CodexCatalogModel = {
    slug,
    name,
    isCustom: false,
    capabilities: parseCapabilities(record?.capabilities),
  };
  return availableFor ? { ...model, availableFor } : model;
}

export function mergeCodexCatalogModels(
  builtInModels: ReadonlyArray<CodexCatalogModel>,
  remoteModels: ReadonlyArray<CodexCatalogModel>,
): ReadonlyArray<CodexCatalogModel> {
  const bySlug = new Map<string, CodexCatalogModel>();
  const activeBuiltInModels = builtInModels.filter((model) => !REMOVED_MODEL_SLUGS.has(model.slug));
  const activeRemoteModels = remoteModels.filter((model) => !REMOVED_MODEL_SLUGS.has(model.slug));
  for (const model of activeBuiltInModels) {
    bySlug.set(model.slug, model);
  }
  for (const model of activeRemoteModels) {
    bySlug.set(model.slug, model);
  }
  return [...activeRemoteModels.map((model) => bySlug.get(model.slug)!), ...activeBuiltInModels]
    .filter(
      (model, index, all) => all.findIndex((candidate) => candidate.slug === model.slug) === index,
    )
    .filter((model) => !REMOVED_MODEL_SLUGS.has(model.slug));
}

export function modelsForCodexAccount(
  models: ReadonlyArray<CodexCatalogModel>,
  account: CodexAccountSnapshot | undefined,
): ReadonlyArray<ServerProviderModel> {
  const accountType = account?.type ?? "unknown";
  return models
    .filter((model) => !model.availableFor || model.availableFor.includes(accountType))
    .map(({ availableFor: _availableFor, ...model }) => model);
}

export async function fetchCodexModelCatalog(
  baseUrl: string,
  fetchImpl: CatalogFetch = globalThis.fetch,
): Promise<ReadonlyArray<CodexCatalogModel>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  try {
    const url = new URL(CATALOG_PATH, baseUrl);
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return [];

    const body = asObject(await response.json());
    const providers = asObject(body?.providers);
    const codex = asObject(providers?.codex);
    const models = Array.isArray(codex?.models) ? codex.models : [];
    return models.map(parseCatalogModel).filter((model): model is CodexCatalogModel => !!model);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
