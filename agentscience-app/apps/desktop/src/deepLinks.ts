export const AGENTSCIENCE_DEEP_LINK_SCHEME = "agentscience:";

export interface PaperOpenDeepLink {
  readonly kind: "paper-open";
  readonly slug: string;
  readonly baseUrl: string;
}

export type AgentScienceDeepLink = PaperOpenDeepLink;

export function parseAgentScienceDeepLink(rawUrl: string): AgentScienceDeepLink | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== AGENTSCIENCE_DEEP_LINK_SCHEME) {
    return null;
  }

  const host = parsed.hostname;
  const pathname = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (host !== "paper" || pathname !== "open") {
    return null;
  }

  const slug = parsed.searchParams.get("slug")?.trim() ?? "";
  if (slug.length === 0) {
    return null;
  }

  const rawBaseUrl = parsed.searchParams.get("baseUrl")?.trim() ?? "";
  if (rawBaseUrl.length === 0) {
    return null;
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    return null;
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    return null;
  }
  baseUrl.hash = "";
  baseUrl.search = "";
  baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "") || "/";

  return {
    kind: "paper-open",
    slug,
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
  };
}

export function deepLinkKey(deepLink: AgentScienceDeepLink): string {
  return `${deepLink.kind}:${deepLink.baseUrl}:${deepLink.slug}`;
}

export function collectAgentScienceDeepLinkUrls(argv: ReadonlyArray<string>): string[] {
  return argv.filter((arg) => {
    if (!arg.toLowerCase().startsWith(AGENTSCIENCE_DEEP_LINK_SCHEME)) {
      return false;
    }
    return parseAgentScienceDeepLink(arg) !== null;
  });
}
