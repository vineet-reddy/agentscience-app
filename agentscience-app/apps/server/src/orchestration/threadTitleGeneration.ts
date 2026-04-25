import { type ModelSelection, type ProviderKind } from "@agentscience/contracts";

import { sanitizeThreadTitle } from "../git/Utils.ts";

const THREAD_TITLE_GENERATION_MODEL_BY_PROVIDER: Record<ProviderKind, string> = {
  codex: "gpt-5.4-mini",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeProviderLabel(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[._/-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
    : "";
}

function providerItemRole(record: Record<string, unknown>): string {
  const role = normalizeProviderLabel(record.role);
  if (role.length > 0) {
    return role;
  }

  const author = asRecord(record.author);
  const authorRole = normalizeProviderLabel(author?.role);
  if (authorRole.length > 0) {
    return authorRole;
  }

  const message = asRecord(record.message);
  return normalizeProviderLabel(message?.role);
}

function isAssistantMessageType(type: string): boolean {
  return (
    type === "" ||
    type === "message" ||
    type === "assistant" ||
    type === "agent" ||
    type.includes("assistant message") ||
    type.includes("agent message")
  );
}

function isExplicitAssistantMessageType(type: string): boolean {
  return (
    type === "assistant" ||
    type === "agent" ||
    type.includes("assistant message") ||
    type.includes("agent message")
  );
}

function isAssistantProviderMessage(record: Record<string, unknown>): boolean {
  const role = providerItemRole(record);
  const type = normalizeProviderLabel(record.type ?? record.kind ?? record.itemType);
  if (!isAssistantMessageType(type)) {
    return false;
  }

  return role === "assistant" || role === "agent" || isExplicitAssistantMessageType(type);
}

function textFromProviderContentPart(part: unknown): string[] {
  if (typeof part === "string") {
    return [part];
  }

  const record = asRecord(part);
  if (!record) {
    return [];
  }

  const type = normalizeProviderLabel(record.type);
  if (type.length > 0 && (type.includes("input") || !type.includes("text"))) {
    return [];
  }

  return [record.text, record.content].filter(
    (entry): entry is string => typeof entry === "string",
  );
}

function assistantTextValues(record: Record<string, unknown>): string[] {
  const values: string[] = [];
  if (typeof record.text === "string") {
    values.push(record.text);
  }
  if (typeof record.content === "string") {
    values.push(record.content);
  } else if (Array.isArray(record.content)) {
    values.push(...record.content.flatMap(textFromProviderContentPart));
  } else {
    const contentRecord = asRecord(record.content);
    if (contentRecord) {
      values.push(...textFromProviderContentPart(contentRecord));
    }
  }

  if (typeof record.message === "string") {
    values.push(record.message);
  } else {
    const messageRecord = asRecord(record.message);
    if (messageRecord && isAssistantProviderMessage(messageRecord)) {
      values.push(...assistantTextValues(messageRecord));
    }
  }

  return values;
}

function extractAssistantTextFromProviderItem(item: unknown): string | null {
  const record = asRecord(item);
  if (!record || !isAssistantProviderMessage(record)) {
    return null;
  }

  const text = assistantTextValues(record)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

function parseGeneratedThreadTitle(rawText: string): string {
  const trimmed = rawText.trim();
  const fencedJson = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed)?.[1]?.trim();
  const candidates = [fencedJson, trimmed, /\{[\s\S]*\}/.exec(trimmed)?.[0]].filter(
    (candidate): candidate is string => Boolean(candidate && candidate.trim().length > 0),
  );

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const title = asRecord(parsed)?.title;
      if (typeof title === "string") {
        return sanitizeThreadTitle(title);
      }
    } catch {
      // Fall through to plain text sanitization.
    }
  }

  return sanitizeThreadTitle(trimmed);
}

export function extractGeneratedThreadTitleFromProviderItems(
  items: ReadonlyArray<unknown>,
): string | null {
  const assistantText = items
    .map(extractAssistantTextFromProviderItem)
    .find((text): text is string => text !== null);
  return assistantText ? parseGeneratedThreadTitle(assistantText) : null;
}

export function selectThreadTitleModelSelection(modelSelection: ModelSelection): ModelSelection {
  const model = modelSelection.model.trim().toLowerCase();
  const titleModel =
    model.includes("mini") || model.includes("nano")
      ? modelSelection.model
      : THREAD_TITLE_GENERATION_MODEL_BY_PROVIDER[modelSelection.provider];

  return {
    ...modelSelection,
    model: titleModel,
    options: {
      ...modelSelection.options,
      reasoningEffort: "low",
      fastMode: true,
    },
  };
}
