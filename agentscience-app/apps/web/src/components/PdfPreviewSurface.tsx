import { useCallback, useEffect, useRef, useState } from "react";
import {
  AnnotationEditorType,
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf";
import {
  EventBus,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/legacy/web/pdf_viewer";
import {
  CircleAlertIcon,
  LoaderCircleIcon,
  MinusIcon,
  PlusIcon,
  RotateCcwIcon,
} from "lucide-react";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.js?url";

import { fetchPaperReviewBytes } from "~/lib/paperReview";
import { cn } from "~/lib/utils";

import "pdfjs-dist/legacy/web/pdf_viewer.css";
import "./PdfPreviewSurface.css";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const DEFAULT_SCALE_VALUE = "page-width";
const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const WHEEL_PIXELS_PER_ZOOM_STEP = 30;
const SMOOTH_REDRAW_DELAY_MS = 400;
const KEYBOARD_ZOOM_FACTOR = 1.15;
const DOUBLE_CLICK_ZOOM_FACTOR = 1.6;
const DOUBLE_CLICK_FIT_THRESHOLD = 1.35;

type PdfViewerInstance = InstanceType<typeof PDFViewer>;
type PdfLinkServiceInstance = InstanceType<typeof PDFLinkService>;

function clearPdfViewerDocument(input: {
  readonly pdfViewer: PdfViewerInstance | null;
  readonly linkService: PdfLinkServiceInstance | null;
}) {
  try {
    input.pdfViewer?.setDocument(null as never);
  } catch (error) {
    console.warn("Failed to release PDF preview viewer document.", error);
  }

  input.linkService?.setDocument(null as never);
}

function formatPdfRenderError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }

  return "The manuscript preview could not be rendered.";
}

function formatScaleLabel(scale: number | null): string {
  if (!Number.isFinite(scale) || scale === null || scale <= 0) {
    return "";
  }

  return `${Math.round(scale * 100)}%`;
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function accumulateScaleFactor(input: {
  readonly previousScale: number;
  readonly factor: number;
  readonly unusedFactor: number;
}): { readonly factor: number; readonly unusedFactor: number } {
  if (input.factor === 1) {
    return { factor: 1, unusedFactor: input.unusedFactor };
  }

  let unusedFactor = input.unusedFactor;
  if ((unusedFactor > 1 && input.factor < 1) || (unusedFactor < 1 && input.factor > 1)) {
    unusedFactor = 1;
  }

  const factor =
    Math.floor(input.previousScale * input.factor * unusedFactor * 100) /
    (100 * input.previousScale);

  return {
    factor,
    unusedFactor: input.factor / factor,
  };
}

function accumulateWheelTicks(input: {
  readonly ticks: number;
  readonly unusedTicks: number;
}): { readonly ticks: number; readonly unusedTicks: number } {
  let unusedTicks = input.unusedTicks;
  if ((unusedTicks > 0 && input.ticks < 0) || (unusedTicks < 0 && input.ticks > 0)) {
    unusedTicks = 0;
  }

  unusedTicks += input.ticks;
  const wholeTicks = Math.trunc(unusedTicks);
  return {
    ticks: wholeTicks,
    unusedTicks: unusedTicks - wholeTicks,
  };
}

function wheelEventToTicks(event: WheelEvent): number {
  const delta = Math.hypot(event.deltaX, event.deltaY);
  const angle = Math.atan2(event.deltaY, event.deltaX);
  const signedDelta = -0.25 * Math.PI < angle && angle < 0.75 * Math.PI ? -delta : delta;

  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return Math.abs(signedDelta) >= 1 ? Math.sign(signedDelta) : signedDelta;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return Math.sign(signedDelta);
  }

  return signedDelta / WHEEL_PIXELS_PER_ZOOM_STEP;
}

function isTrackpadPinchZoom(event: WheelEvent, isControlKeyDown: boolean): boolean {
  if (!event.ctrlKey || isControlKeyDown || event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
    return false;
  }

  const scaleFactor = Math.exp(-event.deltaY / 100);
  return event.deltaX === 0 && event.deltaZ === 0 && Math.abs(scaleFactor - 1) < 0.15;
}

function shouldUseReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getIntersectionArea(first: DOMRect, second: DOMRect): number {
  const left = Math.max(first.left, second.left);
  const right = Math.min(first.right, second.right);
  const top = Math.max(first.top, second.top);
  const bottom = Math.min(first.bottom, second.bottom);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function getSquaredDistanceToRect(input: {
  readonly x: number;
  readonly y: number;
  readonly rect: DOMRect;
}): number {
  const dx = Math.max(input.rect.left - input.x, 0, input.x - input.rect.right);
  const dy = Math.max(input.rect.top - input.y, 0, input.y - input.rect.bottom);
  return dx * dx + dy * dy;
}

function getVisiblePageRects(input: {
  readonly container: HTMLDivElement;
  readonly viewerElement: HTMLDivElement | null;
}): DOMRect[] {
  const containerRect = input.container.getBoundingClientRect();
  const pageRects: DOMRect[] = [];

  const pages = input.viewerElement?.querySelectorAll<HTMLElement>(".page") ?? [];
  for (const page of pages) {
    const pageRect = page.getBoundingClientRect();
    const area = getIntersectionArea(containerRect, pageRect);
    if (area > 0) {
      pageRects.push(pageRect);
    }
  }

  return pageRects;
}

function getMostVisiblePageRect(input: {
  readonly container: HTMLDivElement;
  readonly viewerElement: HTMLDivElement | null;
}): DOMRect | null {
  const containerRect = input.container.getBoundingClientRect();
  const pageRects = getVisiblePageRects(input);
  let bestPageRect: DOMRect | null = null;
  let bestPageArea = 0;

  for (const pageRect of pageRects) {
    const area = getIntersectionArea(containerRect, pageRect);
    if (area > bestPageArea) {
      bestPageArea = area;
      bestPageRect = pageRect;
    }
  }

  return bestPageRect;
}

function getVisiblePageCenterZoomOrigin(input: {
  readonly container: HTMLDivElement;
  readonly viewerElement: HTMLDivElement | null;
}): { readonly x: number; readonly y: number } {
  const containerRect = input.container.getBoundingClientRect();
  const bestPageRect = getMostVisiblePageRect(input);

  if (!bestPageRect) {
    return {
      x: containerRect.left + containerRect.width / 2,
      y: containerRect.top + containerRect.height / 2,
    };
  }

  return {
    x: clamp(
      bestPageRect.left + bestPageRect.width / 2,
      containerRect.left,
      containerRect.right,
    ),
    y: clamp(
      bestPageRect.top + bestPageRect.height / 2,
      containerRect.top,
      containerRect.bottom,
    ),
  };
}

function getPointerZoomOrigin(input: {
  readonly container: HTMLDivElement;
  readonly viewerElement: HTMLDivElement | null;
  readonly x: number;
  readonly y: number;
}): { readonly x: number; readonly y: number } {
  const containerRect = input.container.getBoundingClientRect();
  const fallback = getVisiblePageCenterZoomOrigin(input);

  if (
    !Number.isFinite(input.x) ||
    !Number.isFinite(input.y) ||
    input.x < containerRect.left ||
    input.x > containerRect.right ||
    input.y < containerRect.top ||
    input.y > containerRect.bottom
  ) {
    return fallback;
  }

  const pageRects = getVisiblePageRects(input);
  if (pageRects.length === 0) {
    return {
      x: clamp(input.x, containerRect.left, containerRect.right),
      y: clamp(input.y, containerRect.top, containerRect.bottom),
    };
  }

  const firstPageRect = pageRects[0];
  if (!firstPageRect) {
    return fallback;
  }

  let closestPageRect = firstPageRect;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const pageRect of pageRects) {
    if (
      input.x >= pageRect.left &&
      input.x <= pageRect.right &&
      input.y >= pageRect.top &&
      input.y <= pageRect.bottom
    ) {
      return { x: input.x, y: input.y };
    }

    const distance = getSquaredDistanceToRect({
      x: input.x,
      y: input.y,
      rect: pageRect,
    });
    if (distance < closestDistance) {
      closestDistance = distance;
      closestPageRect = pageRect;
    }
  }

  return {
    x: clamp(
      input.x,
      Math.max(containerRect.left, closestPageRect.left),
      Math.min(containerRect.right, closestPageRect.right),
    ),
    y: clamp(
      input.y,
      Math.max(containerRect.top, closestPageRect.top),
      Math.min(containerRect.bottom, closestPageRect.bottom),
    ),
  };
}

function getCurrentPageWidthScale(input: {
  readonly container: HTMLDivElement;
  readonly viewerElement: HTMLDivElement | null;
  readonly currentScale: number;
}): number | null {
  if (!Number.isFinite(input.currentScale) || input.currentScale <= 0) {
    return null;
  }

  const viewerElement = input.viewerElement;
  const page = viewerElement?.querySelector<HTMLElement>(".page") ?? null;
  if (!viewerElement || !page) {
    return null;
  }

  const viewerStyle = window.getComputedStyle(viewerElement);
  const horizontalPadding =
    Number.parseFloat(viewerStyle.paddingLeft) + Number.parseFloat(viewerStyle.paddingRight);
  const availableWidth = input.container.clientWidth - horizontalPadding;
  const currentPageWidth = page.getBoundingClientRect().width;

  if (
    !Number.isFinite(availableWidth) ||
    !Number.isFinite(currentPageWidth) ||
    availableWidth <= 0 ||
    currentPageWidth <= 0
  ) {
    return null;
  }

  return clampScale(input.currentScale * (availableWidth / currentPageWidth));
}

function PaperPreviewLoader() {
  return (
    <div className="paper-preview-overlay">
      <div className="paper-preview-pill">
        <LoaderCircleIcon className="size-4 animate-spin" />
        Loading paper preview...
      </div>
    </div>
  );
}

function PaperPreviewError({ message }: { message: string }) {
  return (
    <div className="paper-preview-empty-state">
      <div>
        <CircleAlertIcon className="mx-auto size-4 text-destructive" />
        <p className="mt-3 font-display text-[1.4rem] text-foreground">
          Couldn&apos;t render the paper preview
        </p>
        <p className="mt-2 max-w-[24rem] text-sm leading-relaxed text-muted-foreground">
          {message}
        </p>
      </div>
    </div>
  );
}

interface PdfPreviewSurfaceProps {
  title: string;
  url: string;
}

export function PdfPreviewSurface({ title, url }: PdfPreviewSurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerElementRef = useRef<HTMLDivElement | null>(null);
  const pdfViewerRef = useRef<PdfViewerInstance | null>(null);
  const linkServiceRef = useRef<PdfLinkServiceInstance | null>(null);
  const pdfDocumentRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const isControlKeyDownRef = useRef(false);
  const wheelUnusedFactorRef = useRef(1);
  const wheelUnusedTicksRef = useRef(0);
  const isAutoFitScaleRef = useRef(true);
  const lastAutoFitScaleRef = useRef<number | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingDocument, setIsLoadingDocument] = useState(true);
  const [hasRenderedPages, setHasRenderedPages] = useState(false);
  const [scaleLabel, setScaleLabel] = useState("");

  const applyAutoFitScale = useCallback((origin?: { x: number; y: number }) => {
    const container = containerRef.current;
    const pdfViewer = pdfViewerRef.current;
    if (!container || !pdfViewer || !pdfViewer.pdfDocument) {
      return;
    }

    const previousScale = pdfViewer.currentScale;
    const hasPreviousScale = Number.isFinite(previousScale) && previousScale > 0;

    const rect = container.getBoundingClientRect();
    const center = origin ?? getVisiblePageCenterZoomOrigin({
      container,
      viewerElement: viewerElementRef.current,
    });

    pdfViewer.currentScaleValue = DEFAULT_SCALE_VALUE;

    const actualScale = pdfViewer.currentScale;
    if (!Number.isFinite(actualScale) || actualScale <= 0) {
      return;
    }

    const scaleDiff = hasPreviousScale ? actualScale / previousScale - 1 : 0;
    if (scaleDiff !== 0) {
      container.scrollLeft += (center.x - rect.left) * scaleDiff;
      container.scrollTop += (center.y - rect.top) * scaleDiff;
    }

    isAutoFitScaleRef.current = true;
    lastAutoFitScaleRef.current = actualScale;
    setScaleLabel(formatScaleLabel(actualScale));
  }, []);

  const zoomByFactor = useCallback((
    scaleFactor: number,
    origin?: { x: number; y: number },
    options?: { readonly keepAutoFitMode?: boolean },
  ) => {
    const container = containerRef.current;
    const pdfViewer = pdfViewerRef.current;
    if (!container || !pdfViewer || !pdfViewer.pdfDocument) {
      return;
    }

    const previousScale = pdfViewer.currentScale;
    if (!Number.isFinite(previousScale) || previousScale <= 0) {
      return;
    }

    const nextScale = clampScale(previousScale * scaleFactor);
    const effectiveScaleFactor = nextScale / previousScale;
    if (Math.abs(effectiveScaleFactor - 1) < 0.001) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const center = origin ?? {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    const drawingDelay = shouldUseReducedMotion() ? -1 : SMOOTH_REDRAW_DELAY_MS;

    if (effectiveScaleFactor > 1) {
      pdfViewer.increaseScale({ scaleFactor: effectiveScaleFactor, drawingDelay });
    } else {
      pdfViewer.decreaseScale({ scaleFactor: effectiveScaleFactor, drawingDelay });
    }

    const actualScale = pdfViewer.currentScale;
    if (!Number.isFinite(actualScale) || actualScale <= 0) {
      return;
    }

    const scaleDiff = actualScale / previousScale - 1;
    if (scaleDiff !== 0) {
      container.scrollLeft += (center.x - rect.left) * scaleDiff;
      container.scrollTop += (center.y - rect.top) * scaleDiff;
    }

    if (!options?.keepAutoFitMode) {
      isAutoFitScaleRef.current = false;
    }
    setScaleLabel(formatScaleLabel(actualScale));
  }, []);

  const zoomByWheelTicks = useCallback((ticks: number, origin?: { x: number; y: number }) => {
    if (ticks === 0) {
      return;
    }

    zoomByFactor(Math.pow(KEYBOARD_ZOOM_FACTOR, ticks), origin);
  }, [zoomByFactor]);

  const resetZoom = useCallback(() => {
    applyAutoFitScale();
  }, [applyAutoFitScale]);

  const handleDoubleClickZoom = useCallback((event: MouseEvent) => {
    const container = containerRef.current;
    const pdfViewer = pdfViewerRef.current;
    if (!container || !pdfViewer || !pdfViewer.pdfDocument) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    container.focus({ preventScroll: true });

    const origin = getPointerZoomOrigin({
      container,
      viewerElement: viewerElementRef.current,
      x: event.clientX,
      y: event.clientY,
    });
    const currentScale = pdfViewer.currentScale;
    if (!Number.isFinite(currentScale) || currentScale <= 0) {
      return;
    }

    const autoFitScale =
      getCurrentPageWidthScale({
        container,
        viewerElement: viewerElementRef.current,
        currentScale,
      }) ?? lastAutoFitScaleRef.current;
    if (
      event.shiftKey ||
      (autoFitScale !== null && currentScale > autoFitScale * DOUBLE_CLICK_FIT_THRESHOLD)
    ) {
      if (autoFitScale !== null && !event.shiftKey) {
        zoomByFactor(autoFitScale / currentScale, origin, { keepAutoFitMode: true });
        isAutoFitScaleRef.current = true;
        return;
      }

      zoomByFactor(1 / DOUBLE_CLICK_ZOOM_FACTOR, origin);
      return;
    }

    zoomByFactor(DOUBLE_CLICK_ZOOM_FACTOR, origin);
  }, [zoomByFactor]);

  useEffect(() => {
    const container = containerRef.current;
    const viewerElement = viewerElementRef.current;
    if (!container || !viewerElement) {
      return;
    }

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const pdfViewer = new PDFViewer({
      container,
      viewer: viewerElement,
      eventBus,
      linkService,
      annotationEditorMode: AnnotationEditorType.DISABLE,
      removePageBorders: true,
    });

    linkService.setViewer(pdfViewer);
    pdfViewerRef.current = pdfViewer;
    linkServiceRef.current = linkService;

    const handlePagesInit = () => {
      applyAutoFitScale();
    };
    const handlePageRendered = (event: { cssTransform?: boolean }) => {
      if (!event.cssTransform) {
        setHasRenderedPages(true);
      }
    };
    const handleScaleChanging = (event: { scale?: number }) => {
      setScaleLabel(formatScaleLabel(event.scale ?? pdfViewer.currentScale));
    };

    eventBus.on("pagesinit", handlePagesInit);
    eventBus.on("pagerendered", handlePageRendered);
    eventBus.on("scalechanging", handleScaleChanging);

    return () => {
      eventBus.off("pagesinit", handlePagesInit);
      eventBus.off("pagerendered", handlePageRendered);
      eventBus.off("scalechanging", handleScaleChanging);
      clearPdfViewerDocument({ pdfViewer, linkService });
      pdfViewerRef.current = null;
      linkServiceRef.current = null;
    };
  }, [applyAutoFitScale]);

  useEffect(() => {
    let cancelled = false;

    setLoadError(null);
    setIsLoadingDocument(true);
    setHasRenderedPages(false);
    setScaleLabel("");
    isAutoFitScaleRef.current = true;
    lastAutoFitScaleRef.current = null;

    clearPdfViewerDocument({
      pdfViewer: pdfViewerRef.current,
      linkService: linkServiceRef.current,
    });
    loadingTaskRef.current?.destroy();
    loadingTaskRef.current = null;

    const activeDocument = pdfDocumentRef.current;
    pdfDocumentRef.current = null;
    if (activeDocument) {
      void activeDocument.destroy();
    }

    void fetchPaperReviewBytes(url)
      .then((data) => {
        if (cancelled) {
          return;
        }

        const loadingTask = getDocument({ data });
        loadingTaskRef.current = loadingTask;
        return loadingTask.promise;
      })
      .then((pdfDocument) => {
        if (!pdfDocument || cancelled) {
          if (pdfDocument) {
            void pdfDocument.destroy();
          }
          return;
        }

        pdfDocumentRef.current = pdfDocument;
        linkServiceRef.current?.setDocument(pdfDocument, null);
        pdfViewerRef.current?.setDocument(pdfDocument);
        setLoadError(null);
        setIsLoadingDocument(false);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setLoadError(formatPdfRenderError(error));
        setIsLoadingDocument(false);
      });

    return () => {
      cancelled = true;
      const loadingTask = loadingTaskRef.current;
      loadingTaskRef.current = null;
      void loadingTask?.destroy();
      const activeDocument = pdfDocumentRef.current;
      pdfDocumentRef.current = null;
      if (activeDocument) {
        void activeDocument.destroy();
      }
    };
  }, [url]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      const isPinchZoom = isTrackpadPinchZoom(event, isControlKeyDownRef.current);
      if (!isPinchZoom && !event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (isPinchZoom) {
        const pdfViewer = pdfViewerRef.current;
        const previousScale = pdfViewer?.currentScale ?? 0;
        if (!Number.isFinite(previousScale) || previousScale <= 0) {
          return;
        }

        const result = accumulateScaleFactor({
          previousScale,
          factor: Math.exp(-event.deltaY / 100),
          unusedFactor: wheelUnusedFactorRef.current,
        });
        wheelUnusedFactorRef.current = result.unusedFactor;
        zoomByFactor(
          result.factor,
          getPointerZoomOrigin({
            container,
            viewerElement: viewerElementRef.current,
            x: event.clientX,
            y: event.clientY,
          }),
        );
        return;
      }

      const result = accumulateWheelTicks({
        ticks: wheelEventToTicks(event),
        unusedTicks: wheelUnusedTicksRef.current,
      });
      wheelUnusedTicksRef.current = result.unusedTicks;
      zoomByWheelTicks(
        result.ticks,
        getPointerZoomOrigin({
          container,
          viewerElement: viewerElementRef.current,
          x: event.clientX,
          y: event.clientY,
        }),
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Control") {
        isControlKeyDownRef.current = true;
      }

      if (!event.metaKey && !event.ctrlKey) {
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomByWheelTicks(1);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomByWheelTicks(-1);
      } else if (event.key === "0") {
        event.preventDefault();
        resetZoom();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control") {
        isControlKeyDownRef.current = false;
      }
    };
    const handleWindowBlur = () => {
      isControlKeyDownRef.current = false;
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    container.addEventListener("dblclick", handleDoubleClickZoom);
    container.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("dblclick", handleDoubleClickZoom);
      container.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [handleDoubleClickZoom, resetZoom, zoomByFactor, zoomByWheelTicks]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }

    let animationFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        if (isAutoFitScaleRef.current) {
          applyAutoFitScale();
        }
      });
    });

    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [applyAutoFitScale]);

  const showLoader = isLoadingDocument || (!loadError && !hasRenderedPages);
  const controlsDisabled = !!loadError || isLoadingDocument;

  return (
    <div
      className="paper-preview-surface relative flex h-full min-h-0 flex-col overflow-hidden bg-muted/[0.18]"
      aria-label={`${title} preview`}
      style={{ minHeight: 1 }}
    >
      <PaperPreviewControls
        disabled={controlsDisabled}
        scaleLabel={scaleLabel}
        onZoomIn={() => zoomByFactor(KEYBOARD_ZOOM_FACTOR)}
        onZoomOut={() => zoomByFactor(1 / KEYBOARD_ZOOM_FACTOR)}
        onReset={resetZoom}
      />

      {showLoader ? <PaperPreviewLoader /> : null}
      {loadError ? <PaperPreviewError message={loadError} /> : null}

      <div
        ref={containerRef}
        className={cn(
          "paper-preview-scroll absolute inset-0 overflow-auto",
          loadError ? "invisible" : undefined,
        )}
        style={{ position: "absolute", inset: 0 }}
        tabIndex={0}
      >
        <div ref={viewerElementRef} className="pdfViewer paper-preview-viewer" />
      </div>
    </div>
  );
}

function PaperPreviewControls({
  disabled,
  scaleLabel,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  readonly disabled: boolean;
  readonly scaleLabel: string;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onReset: () => void;
}) {
  return (
    <div className="paper-preview-controls" aria-label="Paper preview zoom controls">
      <button
        type="button"
        className="paper-preview-control-button"
        onClick={onZoomOut}
        disabled={disabled}
        aria-label="Zoom out"
        title="Zoom out"
      >
        <MinusIcon className="size-3.5" aria-hidden />
      </button>
      <span className="paper-preview-scale-label" aria-live="polite">
        {scaleLabel || "Fit"}
      </span>
      <button
        type="button"
        className="paper-preview-control-button"
        onClick={onZoomIn}
        disabled={disabled}
        aria-label="Zoom in"
        title="Zoom in"
      >
        <PlusIcon className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        className="paper-preview-control-button"
        onClick={onReset}
        disabled={disabled}
        aria-label="Fit to width"
        title="Fit to width"
      >
        <RotateCcwIcon className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

export default PdfPreviewSurface;
