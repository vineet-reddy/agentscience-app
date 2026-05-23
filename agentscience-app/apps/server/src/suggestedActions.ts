import type { SuggestedAction } from "@agentscience/contracts";

export const SUGGESTED_ACTIONS_TAG = "suggested_actions" as const;

const SUGGESTED_ACTIONS_OPEN_TAG = "<suggested_actions>";
const SUGGESTED_ACTIONS_CLOSE_TAG = "</suggested_actions>";
const MAX_ACTION_ID_LENGTH = 48;
const MAX_ACTION_LABEL_LENGTH = 96;
const MAX_ACTION_DESCRIPTION_LENGTH = 160;

const SUGGESTED_ACTIONS_BLOCK_REGEX =
  /<suggested_actions>\s*([\s\S]*?)\s*<\/suggested_actions>/gi;

export interface SuggestedActionsTextStreamFilterState {
  readonly pendingText: string;
  readonly insideSuggestedActionsBlock: boolean;
}

export const emptySuggestedActionsTextStreamFilterState: SuggestedActionsTextStreamFilterState = {
  pendingText: "",
  insideSuggestedActionsBlock: false,
};

function normalizedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength).trimEnd() : trimmed;
}

function normalizeKind(value: unknown): SuggestedAction["kind"] | null {
  return value === "send" || value === "compose" ? value : null;
}

function findTagIndex(value: string, tag: string): number {
  return value.toLowerCase().indexOf(tag);
}

function retainedPotentialTagPrefixLength(value: string): number {
  const lowerValue = value.toLowerCase();
  const maxLength = Math.min(SUGGESTED_ACTIONS_OPEN_TAG.length - 1, lowerValue.length);
  for (let length = maxLength; length > 0; length -= 1) {
    if (SUGGESTED_ACTIONS_OPEN_TAG.startsWith(lowerValue.slice(-length))) {
      return length;
    }
  }
  return 0;
}

export function filterSuggestedActionsStreamingText(input: {
  readonly state: SuggestedActionsTextStreamFilterState;
  readonly delta: string;
}): {
  readonly state: SuggestedActionsTextStreamFilterState;
  readonly visibleDelta: string;
} {
  let pendingText = `${input.state.pendingText}${input.delta}`;
  let insideSuggestedActionsBlock = input.state.insideSuggestedActionsBlock;
  let visibleDelta = "";

  while (pendingText.length > 0) {
    if (insideSuggestedActionsBlock) {
      const closeTagIndex = findTagIndex(pendingText, SUGGESTED_ACTIONS_CLOSE_TAG);
      if (closeTagIndex === -1) {
        return {
          state: {
            pendingText,
            insideSuggestedActionsBlock,
          },
          visibleDelta,
        };
      }
      pendingText = pendingText.slice(closeTagIndex + SUGGESTED_ACTIONS_CLOSE_TAG.length);
      insideSuggestedActionsBlock = false;
      continue;
    }

    const openTagIndex = findTagIndex(pendingText, SUGGESTED_ACTIONS_OPEN_TAG);
    if (openTagIndex !== -1) {
      visibleDelta += pendingText.slice(0, openTagIndex);
      pendingText = pendingText.slice(openTagIndex + SUGGESTED_ACTIONS_OPEN_TAG.length);
      insideSuggestedActionsBlock = true;
      continue;
    }

    const retainedLength = retainedPotentialTagPrefixLength(pendingText);
    const emitLength = pendingText.length - retainedLength;
    if (emitLength > 0) {
      visibleDelta += pendingText.slice(0, emitLength);
      pendingText = pendingText.slice(emitLength);
    }
    break;
  }

  return {
    state: {
      pendingText,
      insideSuggestedActionsBlock,
    },
    visibleDelta,
  };
}

export function flushSuggestedActionsStreamingText(
  state: SuggestedActionsTextStreamFilterState,
): string {
  return state.insideSuggestedActionsBlock ? "" : state.pendingText;
}

export function parseSuggestedActionsPayload(value: unknown): SuggestedAction[] | null {
  let candidate: unknown = value;

  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (trimmed.length === 0) {
      return null;
    }
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  const rawActions: unknown[] | null = Array.isArray(candidate)
    ? candidate
    : candidate &&
        typeof candidate === "object" &&
        Array.isArray((candidate as Record<string, unknown>).suggestedActions)
      ? ((candidate as Record<string, unknown>).suggestedActions as unknown[])
      : null;

  if (!rawActions) {
    return null;
  }

  const seenIds = new Set<string>();
  const actions: SuggestedAction[] = [];
  for (const rawAction of rawActions.slice(0, 3)) {
    if (!rawAction || typeof rawAction !== "object" || Array.isArray(rawAction)) {
      continue;
    }
    const record = rawAction as Record<string, unknown>;
    const label = normalizedString(record.label, MAX_ACTION_LABEL_LENGTH);
    const description = normalizedString(record.description, MAX_ACTION_DESCRIPTION_LENGTH);
    const kind = normalizeKind(record.kind);
    if (!label || !description || !kind) {
      continue;
    }
    const rawId = normalizedString(record.id, MAX_ACTION_ID_LENGTH) ?? `action-${actions.length + 1}`;
    let id = rawId;
    let suffix = 2;
    while (seenIds.has(id)) {
      id = `${rawId}-${suffix}`;
      suffix += 1;
    }
    seenIds.add(id);
    actions.push({
      id,
      label,
      description,
      kind,
    });
  }

  return actions.length > 0 ? actions : null;
}

export function extractSuggestedActionsFromText(input: {
  readonly text: string;
}): {
  readonly sanitizedText: string;
  readonly suggestedActions: SuggestedAction[] | null;
} {
  let suggestedActions: SuggestedAction[] | null = null;

  const sanitizedText = input.text
    .replace(SUGGESTED_ACTIONS_BLOCK_REGEX, (_match, payloadText: string) => {
      const parsed = parseSuggestedActionsPayload(payloadText);
      if (parsed) {
        suggestedActions = parsed;
      }
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    sanitizedText,
    suggestedActions,
  };
}
