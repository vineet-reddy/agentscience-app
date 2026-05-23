import type { SuggestedAction } from "@agentscience/contracts";

export const SUGGESTED_ACTIONS_TAG = "suggested_actions" as const;

const SUGGESTED_ACTIONS_BLOCK_REGEX =
  /<suggested_actions>\s*([\s\S]*?)\s*<\/suggested_actions>/gi;

function normalizedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeKind(value: unknown): SuggestedAction["kind"] | null {
  return value === "send" || value === "compose" ? value : null;
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
    const label = normalizedString(record.label);
    const description = normalizedString(record.description);
    const kind = normalizeKind(record.kind);
    if (!label || !description || !kind) {
      continue;
    }
    const rawId = normalizedString(record.id) ?? `action-${actions.length + 1}`;
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
