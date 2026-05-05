import {
  type CodexModelOptions,
  DEFAULT_MODEL_BY_PROVIDER,
  type ModelCapabilities,
  type ProviderModelOptions,
  type ProviderKind,
  type ServerProvider,
  type ServerProviderModel,
} from "@agentscience/contracts";
import { getDefaultEffort, normalizeModelSlug } from "@agentscience/shared/model";

const EMPTY_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

export function getProviderModels(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind,
): ReadonlyArray<ServerProviderModel> {
  return providers.find((candidate) => candidate.provider === provider)?.models ?? [];
}

export function getProviderSnapshot(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind,
): ServerProvider | undefined {
  return providers.find((candidate) => candidate.provider === provider);
}

export function isProviderEnabled(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind,
): boolean {
  return getProviderSnapshot(providers, provider)?.enabled ?? true;
}

export function resolveSelectableProvider(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind | null | undefined,
): ProviderKind {
  const requested = provider ?? "codex";
  if (isProviderEnabled(providers, requested)) {
    return requested;
  }
  return providers.find((candidate) => candidate.enabled)?.provider ?? requested;
}

export function getProviderModelCapabilities(
  models: ReadonlyArray<ServerProviderModel>,
  model: string | null | undefined,
  provider: ProviderKind,
): ModelCapabilities {
  const slug = normalizeModelSlug(model, provider);
  return models.find((candidate) => candidate.slug === slug)?.capabilities ?? EMPTY_CAPABILITIES;
}

export function getDefaultServerModel(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind,
): string {
  const models = getProviderModels(providers, provider);
  return (
    getLatestBuiltInGptModel(models)?.slug ??
    models.find((model) => !model.isCustom)?.slug ??
    models[0]?.slug ??
    DEFAULT_MODEL_BY_PROVIDER[provider]
  );
}

function getLatestBuiltInGptModel(
  models: ReadonlyArray<ServerProviderModel>,
): ServerProviderModel | null {
  return (
    models
      .filter((model) => !model.isCustom)
      .map((model) => ({ model, rank: getGptModelRank(model.slug) }))
      .filter(
        (entry): entry is { model: ServerProviderModel; rank: GptModelRank } => entry.rank !== null,
      )
      .toSorted(compareGptModelRanks)[0]?.model ?? null
  );
}

type GptModelRank = {
  readonly version: readonly number[];
  readonly variantRank: number;
};

function getGptModelRank(slug: string): GptModelRank | null {
  const match = /^gpt-(\d+(?:\.\d+)*)(?:-(.+))?$/.exec(slug);
  if (!match) {
    return null;
  }

  const versionSource = match[1];
  if (!versionSource) {
    return null;
  }

  const version = versionSource
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
  if (version.length === 0) {
    return null;
  }

  return {
    version,
    variantRank: getGptVariantRank(match[2] ?? ""),
  };
}

function getGptVariantRank(variant: string): number {
  if (!variant) return 40;
  if (variant.includes("codex") && !variant.includes("spark")) return 30;
  if (variant.includes("mini")) return 20;
  if (variant.includes("spark")) return 15;
  if (variant.includes("nano")) return 10;
  return 0;
}

function compareGptModelRanks(
  left: { readonly rank: GptModelRank },
  right: { readonly rank: GptModelRank },
): number {
  const maxLength = Math.max(left.rank.version.length, right.rank.version.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = left.rank.version[index] ?? 0;
    const rightPart = right.rank.version[index] ?? 0;
    if (leftPart !== rightPart) {
      return rightPart - leftPart;
    }
  }
  return right.rank.variantRank - left.rank.variantRank;
}

export function getDefaultProviderModelOptions(
  models: ReadonlyArray<ServerProviderModel>,
  provider: ProviderKind,
  model: string | null | undefined,
): ProviderModelOptions[ProviderKind] | undefined {
  const caps = getProviderModelCapabilities(models, model, provider);
  if (provider !== "codex") {
    return undefined;
  }

  const effort = getDefaultEffort(caps);
  const options: CodexModelOptions = {
    ...(effort ? { reasoningEffort: effort as CodexModelOptions["reasoningEffort"] } : {}),
    ...(caps.supportsFastMode ? { fastMode: true } : {}),
  };

  return Object.keys(options).length > 0 ? options : undefined;
}
