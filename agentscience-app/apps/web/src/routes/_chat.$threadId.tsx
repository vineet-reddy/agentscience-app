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
import { useComposerDraftStore } from "../composerDraftStore";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { fetchPaperReviewSnapshot } from "../lib/paperReview";
import { useStore } from "../store";
import { Sheet, SheetPopup } from "../components/ui/sheet";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";

const DiffPanel = lazy(() => import("../components/DiffPanel"));
const PaperReviewPanel = lazy(() => import("../components/PaperReviewPanel"));
const DIFF_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 1180px)";
const DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_diff_sidebar_width";
const DIFF_INLINE_DEFAULT_WIDTH = "clamp(28rem,48vw,44rem)";
const DIFF_INLINE_SIDEBAR_MIN_WIDTH = 26 * 16;
const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208;
const PAPER_REVIEW_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_paper_review_sidebar_width";
const PAPER_REVIEW_INLINE_DEFAULT_WIDTH = "clamp(30rem,44vw,54rem)";
const PAPER_REVIEW_INLINE_SIDEBAR_MIN_WIDTH = 28 * 16;

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
  const shouldAcceptInlineSidebarWidth = useCallback(
    ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
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
    },
    [],
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
          shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
          storageKey: DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        {renderDiffContent ? <LazyDiffPanel mode="sidebar" /> : null}
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};

const PaperReviewInlineSidebar = (props: {
  reviewOpen: boolean;
  onCloseReview: () => void;
  onOpenReview: () => void;
  renderReviewContent: boolean;
  threadId: ThreadId;
}) => {
  const { reviewOpen, onCloseReview, onOpenReview, renderReviewContent, threadId } = props;
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
          minWidth: PAPER_REVIEW_INLINE_SIDEBAR_MIN_WIDTH,
          storageKey: PAPER_REVIEW_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        {renderReviewContent ? (
          <Suspense fallback={<PaperReviewLoadingFallback />}>
            <PaperReviewPanel key={threadId} threadId={threadId} />
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
  const [dismissedReviewByThreadId, setDismissedReviewByThreadId] = useState<Record<string, true>>({});
  const lastHandledPaperPresentationByThreadIdRef = useRef<Record<string, string>>({});
  const lastObservedThreadUpdatedAtByThreadIdRef = useRef<Record<string, string | null>>({});
  const paperReviewQuery = useQuery({
    queryKey: ["paper-review", threadId],
    queryFn: () => fetchPaperReviewSnapshot(threadId),
    enabled: routeThreadExists,
    refetchInterval: 5_000,
  });
  const paperReviewAvailable = Boolean(
    paperReviewQuery.data?.reviewRecommended || latestPaperPresentedActivityId,
  );
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
    openReview();
    void queryClient.invalidateQueries({ queryKey: ["paper-review", threadId] });
  }, [latestPaperPresentedActivityId, openReview, queryClient, threadId]);

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
      return;
    }
    setOpenedReviewByThreadId((current) =>
      current[threadId]
        ? current
        : {
            ...current,
            [threadId]: true,
          },
    );
    if (dismissedReviewByThreadId[threadId]) {
      return;
    }
    setReviewOpen(true);
  }, [dismissedReviewByThreadId, paperReviewAvailable, threadId]);

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
      <PaperReviewInlineSidebar
        reviewOpen={reviewOpen}
        onCloseReview={closeReview}
        onOpenReview={openReview}
        renderReviewContent={shouldRenderReviewContent}
        threadId={threadId}
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
