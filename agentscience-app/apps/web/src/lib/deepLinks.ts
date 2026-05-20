import {
  deepLinkPaperOpenRoutePath,
  type DeepLinkPaperOpenResponse,
} from "@agentscience/contracts";

import { resolveServerUrl } from "./utils";

export interface PaperOpenDeepLink {
  readonly kind: "paper-open";
  readonly slug: string;
  readonly baseUrl: string;
}

export async function openPaperDeepLink(
  deepLink: PaperOpenDeepLink,
): Promise<DeepLinkPaperOpenResponse> {
  const response = await fetch(
    new URL(
      deepLinkPaperOpenRoutePath(),
      resolveServerUrl({ protocol: "http", pathname: "/" }),
    ).toString(),
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        slug: deepLink.slug,
        baseUrl: deepLink.baseUrl,
      }),
    },
  );

  let body: DeepLinkPaperOpenResponse | null = null;
  try {
    body = (await response.json()) as DeepLinkPaperOpenResponse;
  } catch {
    body = null;
  }

  if (!body) {
    throw new Error(`Failed to open paper link (${response.status})`);
  }

  return body;
}
