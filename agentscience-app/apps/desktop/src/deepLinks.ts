import type { DesktopDeepLink } from "@agentscience/contracts";

const AGENTSCIENCE_PROTOCOL = "agentscience:";
const PAPER_OPEN_HOST = "paper";
const PAPER_OPEN_PATH = "/open";
const MAX_SLUG_LENGTH = 120;
const PAPER_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export type DeepLinkParseResult =
  | { readonly ok: true; readonly deepLink: DesktopDeepLink }
  | { readonly ok: false; readonly reason: string };

function normalizeBaseUrl(rawBaseUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.origin === "null") {
    return null;
  }
  if (
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    return null;
  }

  return parsed.origin;
}

export function parseAgentScienceDeepLink(rawUrl: string): DeepLinkParseResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  if (url.protocol !== AGENTSCIENCE_PROTOCOL) {
    return { ok: false, reason: "invalid-protocol" };
  }
  if (url.hostname !== PAPER_OPEN_HOST || url.pathname !== PAPER_OPEN_PATH) {
    return { ok: false, reason: "unsupported-action" };
  }

  const slug = url.searchParams.get("slug")?.trim() ?? "";
  if (
    slug.length === 0 ||
    slug.length > MAX_SLUG_LENGTH ||
    !PAPER_SLUG_PATTERN.test(slug)
  ) {
    return { ok: false, reason: "invalid-slug" };
  }

  const rawBaseUrl = url.searchParams.get("baseUrl");
  if (rawBaseUrl === null || rawBaseUrl.trim().length === 0) {
    return { ok: true, deepLink: { type: "paper-open", slug } };
  }

  const baseUrl = normalizeBaseUrl(rawBaseUrl.trim());
  if (!baseUrl) {
    return { ok: false, reason: "invalid-base-url" };
  }

  return { ok: true, deepLink: { type: "paper-open", slug, baseUrl } };
}

export function extractAgentScienceDeepLinkUrls(argv: readonly string[]): string[] {
  return argv.filter((arg) => arg.startsWith("agentscience://"));
}
