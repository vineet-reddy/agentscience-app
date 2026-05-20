import type { DesktopDeepLink } from "@agentscience/contracts";

import type { LocalPaper } from "./papers";

export type PaperOpenDeepLinkHandlerResult = "opened" | "missing" | "failed";

export interface PaperOpenDeepLinkHandlerDependencies {
  loadPapers: () => Promise<ReadonlyArray<LocalPaper>>;
  cachePapers: (papers: ReadonlyArray<LocalPaper>) => void;
  navigateToPaper: (paperId: string) => Promise<void>;
  notifyMissing: (slug: string) => void;
  notifyFailed: (error: unknown) => void;
}

export function findLocalPaperForPublishedSlug(
  papers: ReadonlyArray<LocalPaper>,
  slug: string,
): LocalPaper | null {
  return papers.find((paper) => paper.publication?.slug === slug) ?? null;
}

export async function handlePaperOpenDeepLink(
  deepLink: Extract<DesktopDeepLink, { type: "paper-open" }>,
  dependencies: PaperOpenDeepLinkHandlerDependencies,
): Promise<PaperOpenDeepLinkHandlerResult> {
  try {
    const papers = await dependencies.loadPapers();
    dependencies.cachePapers(papers);
    const paper = findLocalPaperForPublishedSlug(papers, deepLink.slug);
    if (!paper) {
      dependencies.notifyMissing(deepLink.slug);
      return "missing";
    }

    await dependencies.navigateToPaper(paper.id);
    return "opened";
  } catch (error) {
    dependencies.notifyFailed(error);
    return "failed";
  }
}
