import type { DesktopDeepLink } from "@agentscience/contracts";

import type { LocalPaper } from "./papers";

export type PaperOpenDeepLinkHandlerResult = "opened" | "missing" | "failed";

export interface PaperOpenDeepLinkHandlerDependencies {
  resolvePublishedPaper: (
    slug: string,
    baseUrl?: string | undefined,
  ) => Promise<LocalPaper | null>;
  cachePaper: (paper: LocalPaper) => void;
  navigateToPaper: (paperId: string) => Promise<void>;
  notifyMissing: (slug: string) => void;
  notifyFailed: (error: unknown) => void;
}

export async function handlePaperOpenDeepLink(
  deepLink: Extract<DesktopDeepLink, { type: "paper-open" }>,
  dependencies: PaperOpenDeepLinkHandlerDependencies,
): Promise<PaperOpenDeepLinkHandlerResult> {
  try {
    const paper = await dependencies.resolvePublishedPaper(deepLink.slug, deepLink.baseUrl);
    if (!paper) {
      dependencies.notifyMissing(deepLink.slug);
      return "missing";
    }

    dependencies.cachePaper(paper);
    await dependencies.navigateToPaper(paper.id);
    return "opened";
  } catch (error) {
    dependencies.notifyFailed(error);
    return "failed";
  }
}
