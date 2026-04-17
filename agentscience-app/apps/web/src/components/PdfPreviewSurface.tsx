import { useEffect, useMemo, useRef, useState } from "react";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist/legacy/build/pdf";
import { CircleAlertIcon, LoaderCircleIcon } from "lucide-react";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.js?url";

import { fetchPaperReviewBytes } from "~/lib/paperReview";

import "./PdfPreviewSurface.css";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PAGE_STACK_GUTTER_PX = 32;

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

function isCancelledPdfRenderError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string" &&
    (error.name === "RenderingCancelledException" || error.name === "AbortException")
  );
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const pdfDocumentRef = useRef<PDFDocumentProxy | null>(null);

  const [documentBytes, setDocumentBytes] = useState<Uint8Array | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingDocument, setIsLoadingDocument] = useState(true);
  const [hasRenderedPages, setHasRenderedPages] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;

    setDocumentDataForNewUrl({
      setDocumentBytes,
      setPageCount,
      setLoadError,
      setIsLoadingDocument,
      setHasRenderedPages,
    });

    void fetchPaperReviewBytes(url)
      .then((data) => {
        if (cancelled) {
          return;
        }
        setDocumentBytes(data);
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
      pdfDocumentRef.current = null;
    };
  }, [url]);

  useEffect(() => {
    if (!documentBytes) {
      return;
    }

    let cancelled = false;
    const loadingTask = getDocument({ data: documentBytes });

    void loadingTask.promise
      .then((pdfDocument) => {
        if (cancelled) {
          void pdfDocument.destroy();
          return;
        }
        pdfDocumentRef.current = pdfDocument;
        setPageCount(pdfDocument.numPages);
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
      const activeDocument = pdfDocumentRef.current;
      pdfDocumentRef.current = null;
      void loadingTask.destroy();
      if (activeDocument) {
        void activeDocument.destroy();
      }
    };
  }, [documentBytes]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    const updateWidth = () => {
      const nextWidth = Math.max(0, Math.floor(container.clientWidth - PAGE_STACK_GUTTER_PX));
      setContainerWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
    };

    updateWidth();

    if (typeof ResizeObserver !== "function") {
      window.addEventListener("resize", updateWidth);
      return () => {
        window.removeEventListener("resize", updateWidth);
      };
    }

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const pdfDocument = pdfDocumentRef.current;
    if (!pdfDocument || pageCount === 0 || containerWidth <= 0) {
      return;
    }

    let cancelled = false;
    const renderTasks = new Set<RenderTask>();

    const renderPages = async () => {
      let renderedPageCount = 0;

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        if (cancelled) {
          return;
        }

        const canvas = canvasRefs.current.get(pageNumber);
        if (!canvas) {
          continue;
        }

        const page = await pdfDocument.getPage(pageNumber);
        if (cancelled) {
          return;
        }

        const baseViewport = page.getViewport({ scale: 1 });
        const pageScale = containerWidth > 0 ? containerWidth / baseViewport.width : 1;
        const cssViewport = page.getViewport({ scale: pageScale });
        const outputScale = window.devicePixelRatio || 1;
        const renderViewport = page.getViewport({ scale: pageScale * outputScale });
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) {
          continue;
        }

        canvas.width = Math.ceil(renderViewport.width);
        canvas.height = Math.ceil(renderViewport.height);
        canvas.style.width = `${Math.ceil(cssViewport.width)}px`;
        canvas.style.height = `${Math.ceil(cssViewport.height)}px`;

        const renderTask = page.render({
          canvasContext: context,
          viewport: renderViewport,
        });
        renderTasks.add(renderTask);

        try {
          await renderTask.promise;
          renderedPageCount += 1;
          if (!cancelled && renderedPageCount === 1) {
            setHasRenderedPages(true);
          }
        } finally {
          renderTasks.delete(renderTask);
        }
      }
    };

    void renderPages().catch((error: unknown) => {
      if (cancelled || isCancelledPdfRenderError(error)) {
        return;
      }
      setLoadError(formatPdfRenderError(error));
    });

    return () => {
      cancelled = true;
      for (const renderTask of renderTasks) {
        renderTask.cancel();
      }
    };
  }, [containerWidth, pageCount]);

  const pages = useMemo(
    () => Array.from({ length: pageCount }, (_value, index) => index + 1),
    [pageCount],
  );

  const showLoader = isLoadingDocument || (!!documentBytes && !loadError && !hasRenderedPages);

  return (
    <div
      className="paper-preview-surface relative flex h-full min-h-0 flex-col overflow-hidden bg-muted/[0.18]"
      aria-label={`${title} preview`}
    >
      {showLoader ? <PaperPreviewLoader /> : null}
      {loadError ? <PaperPreviewError message={loadError} /> : null}

      <div ref={scrollRef} className="paper-preview-scroll flex-1 min-h-0 overflow-auto">
        <div className="paper-preview-stack">
          {pages.map((pageNumber) => (
            <div key={pageNumber} className="paper-preview-page">
              <canvas
                ref={(node) => {
                  if (!node) {
                    canvasRefs.current.delete(pageNumber);
                    return;
                  }
                  canvasRefs.current.set(pageNumber, node);
                }}
                className="paper-preview-canvas"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function setDocumentDataForNewUrl(input: {
  readonly setDocumentBytes: (value: Uint8Array | null) => void;
  readonly setPageCount: (value: number) => void;
  readonly setLoadError: (value: string | null) => void;
  readonly setIsLoadingDocument: (value: boolean) => void;
  readonly setHasRenderedPages: (value: boolean) => void;
}) {
  input.setDocumentBytes(null);
  input.setPageCount(0);
  input.setLoadError(null);
  input.setIsLoadingDocument(true);
  input.setHasRenderedPages(false);
}

export default PdfPreviewSurface;
