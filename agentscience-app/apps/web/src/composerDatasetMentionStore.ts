import { type ThreadId } from "@agentscience/contracts";
import { create } from "zustand";
import {
  DATASET_MENTION_PREFIX,
  extractDatasetSlug,
  extractProviderSlug,
  isDatasetMentionPath,
  isProviderMentionPath,
  PROVIDER_MENTION_PREFIX,
} from "./composer-editor-mentions";
import {
  type DatasetEntry,
  type DatasetProvider,
  datasetToSlug,
} from "./lib/datasetRegistry";

/**
 * A single registry reference attached to a composer. Two kinds:
 * - `dataset`: a leaf dataset (e.g. openneuro-ds005398)
 * - `provider`: a whole catalog (e.g. OpenNeuro). Providers carry the agent
 *    search recipe so a downstream agent can query the underlying catalog
 *    without hardcoded knowledge.
 */
export type ComposerRegistryMention =
  | {
      kind: "dataset";
      slug: string;
      datasetId: string;
      name: string;
      shortName: string | null;
      url: string;
      domain: string;
      provider: { slug: string; name: string } | null;
    }
  | {
      kind: "provider";
      slug: string;
      providerId: string;
      name: string;
      homeUrl: string;
      domain: string;
      description: string;
      search: {
        kind: "GRAPHQL" | "REST" | "HTML";
        endpoint: string | null;
        queryTemplate: string | null;
      } | null;
      datasetUrlTemplate: string | null;
      agentInstructions: string | null;
    };

/**
 * Legacy alias: much of the code base (and serialized drafts) refers to a
 * "ComposerDatasetMention". Providers are stored under the same umbrella so
 * the store, chip renderer, and payload code share a single addressable
 * namespace keyed by mention key.
 */
export type ComposerDatasetMention = ComposerRegistryMention;

function mentionKeyFor(mention: ComposerRegistryMention): string {
  return mention.kind === "dataset"
    ? `${DATASET_MENTION_PREFIX}${mention.slug}`
    : `${PROVIDER_MENTION_PREFIX}${mention.slug}`;
}

function mentionsEqual(a: ComposerRegistryMention, b: ComposerRegistryMention): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "dataset" && b.kind === "dataset") {
    return (
      a.slug === b.slug &&
      a.datasetId === b.datasetId &&
      a.name === b.name &&
      a.shortName === b.shortName &&
      a.url === b.url &&
      a.domain === b.domain &&
      (a.provider?.slug ?? null) === (b.provider?.slug ?? null) &&
      (a.provider?.name ?? null) === (b.provider?.name ?? null)
    );
  }
  if (a.kind === "provider" && b.kind === "provider") {
    return (
      a.slug === b.slug &&
      a.providerId === b.providerId &&
      a.name === b.name &&
      a.homeUrl === b.homeUrl &&
      a.domain === b.domain &&
      a.description === b.description &&
      (a.search?.kind ?? null) === (b.search?.kind ?? null) &&
      (a.search?.endpoint ?? null) === (b.search?.endpoint ?? null) &&
      (a.search?.queryTemplate ?? null) === (b.search?.queryTemplate ?? null) &&
      a.datasetUrlTemplate === b.datasetUrlTemplate &&
      a.agentInstructions === b.agentInstructions
    );
  }
  return false;
}

interface ComposerDatasetMentionStoreState {
  mentionsByThreadId: Record<ThreadId, Record<string, ComposerRegistryMention>>;
  registerDatasetMention: (threadId: ThreadId, mention: ComposerRegistryMention) => void;
  clearDatasetMentions: (threadId: ThreadId) => void;
}

export const useComposerDatasetMentionStore = create<ComposerDatasetMentionStoreState>()(
  (set) => ({
    mentionsByThreadId: {},
    registerDatasetMention: (threadId, mention) => {
      if (threadId.length === 0 || mention.slug.length === 0) {
        return;
      }
      set((state) => {
        const existing = state.mentionsByThreadId[threadId] ?? {};
        const key = mentionKeyFor(mention);
        const current = existing[key];
        if (current && mentionsEqual(current, mention)) {
          return state;
        }
        return {
          mentionsByThreadId: {
            ...state.mentionsByThreadId,
            [threadId]: {
              ...existing,
              [key]: mention,
            },
          },
        };
      });
    },
    clearDatasetMentions: (threadId) => {
      if (threadId.length === 0) {
        return;
      }
      set((state) => {
        if (!state.mentionsByThreadId[threadId]) {
          return state;
        }
        const { [threadId]: _removed, ...rest } = state.mentionsByThreadId;
        return { mentionsByThreadId: rest };
      });
    },
  }),
);

export function datasetEntryToMention(
  dataset: DatasetEntry,
): Extract<ComposerRegistryMention, { kind: "dataset" }> {
  return {
    kind: "dataset",
    slug: datasetToSlug(dataset),
    datasetId: dataset.id,
    name: dataset.name,
    shortName: dataset.shortName,
    url: dataset.url,
    domain: dataset.domain,
    provider: dataset.provider
      ? { slug: dataset.provider.slug, name: dataset.provider.name }
      : null,
  };
}

export function datasetProviderToMention(
  provider: DatasetProvider,
): Extract<ComposerRegistryMention, { kind: "provider" }> {
  return {
    kind: "provider",
    slug: provider.slug,
    providerId: provider.id,
    name: provider.name,
    homeUrl: provider.homeUrl,
    domain: provider.domain,
    description: provider.description,
    search: provider.searchKind
      ? {
          kind: provider.searchKind,
          endpoint: provider.searchEndpoint,
          queryTemplate: provider.searchQueryTemplate,
        }
      : null,
    datasetUrlTemplate: provider.datasetUrlTemplate,
    agentInstructions: provider.agentInstructions,
  };
}

export function getDatasetMentionForPath(
  mentionsForThread: Record<string, ComposerRegistryMention> | undefined,
  path: string,
): ComposerRegistryMention | null {
  if (isDatasetMentionPath(path)) {
    const slug = extractDatasetSlug(path);
    if (!slug) return null;
    return mentionsForThread?.[`${DATASET_MENTION_PREFIX}${slug}`] ?? null;
  }
  if (isProviderMentionPath(path)) {
    const slug = extractProviderSlug(path);
    if (!slug) return null;
    return mentionsForThread?.[`${PROVIDER_MENTION_PREFIX}${slug}`] ?? null;
  }
  return null;
}

const EMPTY_MENTIONS: Record<string, ComposerRegistryMention> = Object.freeze({});

export function useComposerDatasetMentionsForThread(
  threadId: ThreadId,
): Record<string, ComposerRegistryMention> {
  return useComposerDatasetMentionStore(
    (state) => state.mentionsByThreadId[threadId] ?? EMPTY_MENTIONS,
  );
}

const REGISTRY_MENTION_TOKEN_REGEX = new RegExp(
  `(^|\\s)@(${DATASET_MENTION_PREFIX}|${PROVIDER_MENTION_PREFIX})([^\\s@]+)`,
  "g",
);

export function collectDatasetMentionsFromPrompt(
  prompt: string,
  mentionsForThread: Record<string, ComposerRegistryMention>,
): ComposerRegistryMention[] {
  const seen = new Set<string>();
  const ordered: ComposerRegistryMention[] = [];
  for (const match of prompt.matchAll(REGISTRY_MENTION_TOKEN_REGEX)) {
    const prefix = match[2];
    const slug = match[3];
    if (!prefix || !slug) continue;
    const key = `${prefix}${slug}`;
    if (seen.has(key)) continue;
    const mention = mentionsForThread[key];
    if (!mention) continue;
    seen.add(key);
    ordered.push(mention);
  }
  return ordered;
}

// Mirrors the <terminal_context> pattern in lib/terminalContext.ts: the block
// is appended to the outgoing message text so the model can resolve each
// @dataset: / @provider: mention, while the UI strips it from the rendered
// bubble via deriveDisplayedUserMessageState. Keep data out of prose; hide
// plumbing. The matching stripper lives in lib/terminalContext.ts to colocate
// all trailing-context display logic and avoid an import cycle.

function buildDatasetEntryLines(
  mention: Extract<ComposerRegistryMention, { kind: "dataset" }>,
): string[] {
  const lines: string[] = [
    "- kind: dataset",
    `  mention: @${DATASET_MENTION_PREFIX}${mention.slug}`,
    `  name: ${mention.name}`,
  ];
  if (mention.shortName && mention.shortName !== mention.name) {
    lines.push(`  short_name: ${mention.shortName}`);
  }
  lines.push(`  id: ${mention.datasetId}`);
  if (mention.url) lines.push(`  url: ${mention.url}`);
  if (mention.domain) lines.push(`  domain: ${mention.domain}`);
  if (mention.provider) {
    lines.push(`  provider_slug: ${mention.provider.slug}`);
    lines.push(`  provider_name: ${mention.provider.name}`);
  }
  return lines;
}

function buildProviderEntryLines(
  mention: Extract<ComposerRegistryMention, { kind: "provider" }>,
): string[] {
  const lines: string[] = [
    "- kind: provider",
    `  mention: @${PROVIDER_MENTION_PREFIX}${mention.slug}`,
    `  name: ${mention.name}`,
    `  id: ${mention.providerId}`,
    `  home_url: ${mention.homeUrl}`,
    `  domain: ${mention.domain}`,
  ];
  if (mention.description) lines.push(`  description: ${mention.description}`);
  if (mention.search) {
    lines.push(`  search_kind: ${mention.search.kind}`);
    if (mention.search.endpoint) {
      lines.push(`  search_endpoint: ${mention.search.endpoint}`);
    }
    if (mention.search.queryTemplate) {
      lines.push(`  search_query_template: ${mention.search.queryTemplate}`);
    }
  }
  if (mention.datasetUrlTemplate) {
    lines.push(`  dataset_url_template: ${mention.datasetUrlTemplate}`);
  }
  if (mention.agentInstructions) {
    lines.push(`  agent_instructions: ${mention.agentInstructions}`);
  }
  return lines;
}

export function formatDatasetReferencesAppendix(
  mentions: ReadonlyArray<ComposerRegistryMention>,
): string {
  if (mentions.length === 0) return "";
  const bodyLines: string[] = [];
  for (const mention of mentions) {
    if (mention.kind === "dataset") {
      bodyLines.push(...buildDatasetEntryLines(mention));
    } else {
      bodyLines.push(...buildProviderEntryLines(mention));
    }
  }
  return ["<dataset_context>", ...bodyLines, "</dataset_context>"].join("\n");
}

export function appendDatasetReferencesToPrompt(
  prompt: string,
  mentionsForThread: Record<string, ComposerRegistryMention>,
): string {
  const referenced = collectDatasetMentionsFromPrompt(prompt, mentionsForThread);
  const appendix = formatDatasetReferencesAppendix(referenced);
  if (!appendix) return prompt;
  const trimmed = prompt.replace(/\s+$/, "");
  return trimmed.length > 0 ? `${trimmed}\n\n${appendix}` : appendix;
}
