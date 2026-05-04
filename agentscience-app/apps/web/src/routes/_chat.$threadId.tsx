import { ThreadId } from "@agentscience/contracts";
import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Suspense,
  lazy,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import ChatView from "../components/ChatView";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "../components/DiffPanelShell";
import { useThreadStageState } from "../stages/stageStore";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { fetchPaperReviewSnapshot, paperReviewReadyPdfKey } from "../lib/paperReview";
import {
  PAPER_REVIEW_INLINE_DEFAULT_WIDTH,
  PAPER_REVIEW_INLINE_SIDEBAR_MIN_WIDTH,
  resolvePaperReviewInlineSidebarMaxWidth,
} from "../lib/paperReviewLayout";
import { useStore } from "../store";
import { Sheet, SheetPopup } from "../components/ui/sheet";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";

const DiffPanel = lazy(() => import("../components/DiffPanel"));
const StagePanel = lazy(() =>
  import("../components/stages/StagePanel").then((m) => ({ default: m.StagePanel })),
);
const DIFF_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 1180px)";
const DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_diff_sidebar_width";
const DIFF_INLINE_DEFAULT_WIDTH = "clamp(28rem,48vw,44rem)";
const DIFF_INLINE_SIDEBAR_MIN_WIDTH = 26 * 16;
const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208;
const PAPER_REVIEW_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_paper_review_sidebar_width";

function shouldPreserveUsableComposerWidth({
  nextWidth,
  wrapper,
}: {
  nextWidth: number;
  wrapper: HTMLElement;
}) {
  const composerForm = document.querySelector<HTMLElement>("[data-chat-composer-form='true']");
  if (!composerForm) return true;
  const composerViewport = composerForm.parentElement;
  if (!composerViewport) return true;
  const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
  wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);

  const viewportStyle = window.getComputedStyle(composerViewport);
  const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0;
  const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0;
  const viewportContentWidth = Math.max(
    0,
    composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight,
  );
  const formRect = composerForm.getBoundingClientRect();
  const composerFooter = composerForm.querySelector<HTMLElement>(
    "[data-chat-composer-footer='true']",
  );
  const composerRightActions = composerForm.querySelector<HTMLElement>(
    "[data-chat-composer-actions='right']",
  );
  const composerRightActionsWidth = composerRightActions?.getBoundingClientRect().width ?? 0;
  const composerFooterGap = composerFooter
    ? Number.parseFloat(window.getComputedStyle(composerFooter).columnGap) ||
      Number.parseFloat(window.getComputedStyle(composerFooter).gap) ||
      0
    : 0;
  const minimumComposerWidth =
    COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX + composerRightActionsWidth + composerFooterGap;
  const hasComposerOverflow = composerForm.scrollWidth > composerForm.clientWidth + 0.5;
  const overflowsViewport = formRect.width > viewportContentWidth + 0.5;
  const violatesMinimumComposerWidth = composerForm.clientWidth + 0.5 < minimumComposerWidth;

  if (previousSidebarWidth.length > 0) {
    wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
  } else {
    wrapper.style.removeProperty("--sidebar-width");
  }

  return !hasComposerOverflow && !overflowsViewport && !violatesMinimumComposerWidth;
}

function usePaperReviewSidebarMaxWidth() {
  const [maxWidth, setMaxWidth] = useState(() =>
    typeof window === "undefined"
      ? PAPER_REVIEW_INLINE_SIDEBAR_MIN_WIDTH
      : resolvePaperReviewInlineSidebarMaxWidth(window.innerWidth),
  );

  useEffect(() => {
    const onResize = () => {
      setMaxWidth(resolvePaperReviewInlineSidebarMaxWidth(window.innerWidth));
    };

    onResize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return maxWidth;
}

const DiffPanelSheet = (props: {
  children: ReactNode;
  diffOpen: boolean;
  onCloseDiff: () => void;
}) => {
  return (
    <Sheet
      open={props.diffOpen}
      onOpenChange={(open) => {
        if (!open) {
          props.onCloseDiff();
        }
      }}
    >
      <SheetPopup
        side="right"
        showCloseButton={false}
        keepMounted
        className="w-[min(88vw,820px)] max-w-[820px] p-0"
      >
        {props.children}
      </SheetPopup>
    </Sheet>
  );
};

const DiffLoadingFallback = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
};

const LazyDiffPanel = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense fallback={<DiffLoadingFallback mode={props.mode} />}>
        <DiffPanel mode={props.mode} />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

const PaperReviewLoadingFallback = () => {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading paper review...
    </div>
  );
};

const DiffPanelInlineSidebar = (props: {
  diffOpen: boolean;
  onCloseDiff: () => void;
  onOpenDiff: () => void;
  renderDiffContent: boolean;
}) => {
  const { diffOpen, onCloseDiff, onOpenDiff, renderDiffContent } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpenDiff();
        return;
      }
      onCloseDiff();
    },
    [onCloseDiff, onOpenDiff],
  );

  return (
    <SidebarProvider
      defaultOpen={false}
      open={diffOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": DIFF_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          minWidth: DIFF_INLINE_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: shouldPreserveUsableComposerWidth,
          storageKey: DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        {renderDiffContent ? <LazyDiffPanel mode="sidebar" /> : null}
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};

const StageInlineSidebar = (props: {
  reviewOpen: boolean;
  onCloseReview: () => void;
  onOpenReview: () => void;
  renderReviewContent: boolean;
  threadId: ThreadId;
  paperReviewAvailable: boolean;
}) => {
  const {
    reviewOpen,
    onCloseReview,
    onOpenReview,
    renderReviewContent,
    threadId,
    paperReviewAvailable,
  } = props;
  const maxWidth = usePaperReviewSidebarMaxWidth();
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpenReview();
        return;
      }
      onCloseReview();
    },
    [onCloseReview, onOpenReview],
  );

  return (
    <SidebarProvider
      defaultOpen={false}
      open={reviewOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": PAPER_REVIEW_INLINE_DEFAULT_WIDTH } as CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-background text-foreground"
        resizable={{
          maxWidth,
          minWidth: PAPER_REVIEW_INLINE_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: shouldPreserveUsableComposerWidth,
          storageKey: PAPER_REVIEW_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        {renderReviewContent ? (
          <Suspense fallback={<PaperReviewLoadingFallback />}>
            <StagePanel
              key={threadId}
              threadId={threadId}
              paperReviewAvailable={paperReviewAvailable}
            />
          </Suspense>
        ) : null}
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};

function ChatThreadRouteView() {
  const bootstrapComplete = useStore((store) => store.bootstrapComplete);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const search = Route.useSearch();
  const thread = useStore((store) => store.threadsById[threadId]);
  const draftThreadExists = useComposerDraftStore((store) =>
    Object.hasOwn(store.draftThreadsByThreadId, threadId),
  );
  const routeThreadExists = thread !== undefined || draftThreadExists;
  const diffOpen = search.diff === "1";
  const threadUpdatedAt = thread?.updatedAt ?? null;
  const latestPaperPresentedActivityId = useMemo(() => {
    if (!thread) {
      return null;
    }
    for (let index = thread.activities.length - 1; index >= 0; index -= 1) {
      const activity = thread.activities[index];
      if (activity?.kind === "paper.presented") {
        return activity.id;
      }
    }
    return null;
  }, [thread]);
  // TanStack Router keeps active route components mounted across param-only navigations
  // unless remountDeps are configured, so this stays warm across thread switches.
  const [openedDiffByThreadId, setOpenedDiffByThreadId] = useState<Record<string, true>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [openedReviewByThreadId, setOpenedReviewByThreadId] = useState<Record<string, true>>({});
  const [dismissedReviewByThreadId, setDismissedReviewByThreadId] = useState<Record<string, true>>(
    {},
  );
  const lastHandledPaperPresentationByThreadIdRef = useRef<Record<string, string>>({});
  const lastAutoOpenedPaperReviewByThreadIdRef = useRef<Record<string, string>>({});
  const lastObservedThreadUpdatedAtByThreadIdRef = useRef<Record<string, string | null>>({});
  const paperReviewQuery = useQuery({
    queryKey: ["paper-review", threadId],
    queryFn: () => fetchPaperReviewSnapshot(threadId),
    enabled: routeThreadExists,
    refetchInterval: 5_000,
  });
  const readyPaperReviewKey = paperReviewReadyPdfKey(paperReviewQuery.data);
  // Stage-aware threads always expose the right canvas (it shows the
  // stage-specific artifact preview). Legacy threads keep the old behavior:
  // the canvas only opens when the agent has produced a manuscript.
  const stageState = useThreadStageState(threadId);
  const stageAware = stageState !== null;
  const paperReviewAvailableFromAgent = Boolean(
    paperReviewQuery.data?.reviewRecommended || latestPaperPresentedActivityId,
  );
  const paperReviewAvailable = paperReviewAvailableFromAgent || stageAware;
  const shouldUseDiffSheet = useMediaQuery(DIFF_INLINE_LAYOUT_MEDIA_QUERY) || reviewOpen;
  const closeDiff = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId },
      search: { diff: undefined },
    });
  }, [navigate, threadId]);
  const openDiff = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId },
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1" };
      },
    });
  }, [navigate, threadId]);
  const closeReview = useCallback(() => {
    setReviewOpen(false);
    setDismissedReviewByThreadId((current) => ({
      ...current,
      [threadId]: true,
    }));
  }, [threadId]);
  const openReview = useCallback(() => {
    setReviewOpen(true);
    setOpenedReviewByThreadId((current) =>
      current[threadId]
        ? current
        : {
            ...current,
            [threadId]: true,
          },
    );
    setDismissedReviewByThreadId((current) => {
      if (!current[threadId]) {
        return current;
      }
      const next = { ...current };
      delete next[threadId];
      return next;
    });
  }, [threadId]);

  useEffect(() => {
    if (!latestPaperPresentedActivityId) {
      return;
    }
    if (
      lastHandledPaperPresentationByThreadIdRef.current[threadId] === latestPaperPresentedActivityId
    ) {
      return;
    }
    lastHandledPaperPresentationByThreadIdRef.current[threadId] = latestPaperPresentedActivityId;
    void queryClient.invalidateQueries({ queryKey: ["paper-review", threadId] });
  }, [latestPaperPresentedActivityId, queryClient, threadId]);

  useEffect(() => {
    if (!latestPaperPresentedActivityId || !readyPaperReviewKey) {
      return;
    }
    if (dismissedReviewByThreadId[threadId]) {
      return;
    }

    const autoOpenKey = `${latestPaperPresentedActivityId}:${readyPaperReviewKey}`;
    if (lastAutoOpenedPaperReviewByThreadIdRef.current[threadId] === autoOpenKey) {
      return;
    }

    lastAutoOpenedPaperReviewByThreadIdRef.current[threadId] = autoOpenKey;
    openReview();
  }, [
    dismissedReviewByThreadId,
    latestPaperPresentedActivityId,
    openReview,
    readyPaperReviewKey,
    threadId,
  ]);

  useEffect(() => {
    const previousUpdatedAt = lastObservedThreadUpdatedAtByThreadIdRef.current[threadId];
    lastObservedThreadUpdatedAtByThreadIdRef.current[threadId] = threadUpdatedAt;

    if (
      !reviewOpen ||
      !paperReviewAvailable ||
      !threadUpdatedAt ||
      previousUpdatedAt === undefined ||
      previousUpdatedAt === threadUpdatedAt
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ["paper-review", threadId] });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [paperReviewAvailable, queryClient, reviewOpen, threadId, threadUpdatedAt]);

  useEffect(() => {
    if (diffOpen) {
      setOpenedDiffByThreadId((current) =>
        current[threadId]
          ? current
          : {
              ...current,
              [threadId]: true,
            },
      );
    }
  }, [diffOpen, threadId]);

  useEffect(() => {
    if (!paperReviewAvailable) {
      setReviewOpen(false);
    }
  }, [paperReviewAvailable]);

  useEffect(() => {
    if (!bootstrapComplete) {
      return;
    }

    if (!routeThreadExists) {
      void navigate({ to: "/", replace: true });
      return;
    }
  }, [bootstrapComplete, navigate, routeThreadExists, threadId]);

  if (!bootstrapComplete || !routeThreadExists) {
    return null;
  }

  const shouldRenderDiffContent = diffOpen || Boolean(openedDiffByThreadId[threadId]);
  const shouldRenderReviewContent = reviewOpen || Boolean(openedReviewByThreadId[threadId]);

  return (
    <>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <ChatView
          threadId={threadId}
          paperReviewAvailable={paperReviewAvailable}
          paperReviewOpen={reviewOpen}
          onTogglePaperReview={reviewOpen ? closeReview : openReview}
        />
      </SidebarInset>
      <StageInlineSidebar
        reviewOpen={reviewOpen}
        onCloseReview={closeReview}
        onOpenReview={openReview}
        renderReviewContent={shouldRenderReviewContent}
        threadId={threadId}
        paperReviewAvailable={paperReviewAvailableFromAgent}
      />
      {shouldUseDiffSheet ? (
        <DiffPanelSheet diffOpen={diffOpen} onCloseDiff={closeDiff}>
          {shouldRenderDiffContent ? <LazyDiffPanel mode="sheet" /> : null}
        </DiffPanelSheet>
      ) : (
        <DiffPanelInlineSidebar
          diffOpen={diffOpen}
          onCloseDiff={closeDiff}
          onOpenDiff={openDiff}
          renderDiffContent={shouldRenderDiffContent}
        />
      )}
    </>
  );
}

export const Route = createFileRoute("/_chat/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["diff"])],
  },
  component: ChatThreadRouteView,
});
