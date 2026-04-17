export const PAPER_PRESENTATION_TAG = "present_manuscript" as const;
export const PAPER_PRESENTED_ACTIVITY_KIND = "paper.presented" as const;

export interface PresentedManuscriptManifest {
  readonly workspaceRoot?: string;
  readonly source?: string;
  readonly pdf?: string;
  readonly bibliography?: string;
  readonly notes?: string;
  readonly publishManifest?: string;
}

const PRESENT_MANUSCRIPT_BLOCK_REGEX =
  /<present_manuscript>\s*([\s\S]*?)\s*<\/present_manuscript>/gi;

function normalizeManifestPath(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parsePresentedManuscriptPayload(
  value: unknown,
): PresentedManuscriptManifest | null {
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

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const workspaceRoot = normalizeManifestPath(record.workspaceRoot);
  const source = normalizeManifestPath(record.source);
  const pdf = normalizeManifestPath(record.pdf);
  const bibliography = normalizeManifestPath(record.bibliography);
  const notes = normalizeManifestPath(record.notes);
  const publishManifest = normalizeManifestPath(record.publishManifest);

  if (!workspaceRoot && !source && !pdf) {
    return null;
  }

  return {
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(source ? { source } : {}),
    ...(pdf ? { pdf } : {}),
    ...(bibliography ? { bibliography } : {}),
    ...(notes ? { notes } : {}),
    ...(publishManifest ? { publishManifest } : {}),
  };
}

export function extractPresentedManuscriptFromText(input: {
  readonly text: string;
}): {
  readonly sanitizedText: string;
  readonly presentation: PresentedManuscriptManifest | null;
} {
  let presentation: PresentedManuscriptManifest | null = null;

  const sanitizedText = input.text
    .replace(PRESENT_MANUSCRIPT_BLOCK_REGEX, (_match, payloadText: string) => {
      const parsed = parsePresentedManuscriptPayload(payloadText);
      if (parsed) {
        presentation = parsed;
      }
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    sanitizedText,
    presentation,
  };
}
