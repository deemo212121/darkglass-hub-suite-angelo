/**
 * Shared pdf.js canvas renderer for the Master Independent Contractor
 * Subcontractor Agreement Addendum fill/sign pages — renders the (blank or
 * partly-filled) PDF built by contractorAddendumPdf.ts page-by-page to
 * canvases and lets the caller drop absolutely-positioned input/signature
 * overlays on any page via `renderOverlay`. Same architecture the other
 * overlay HR forms inline per-file; factored out here because four pages
 * (internal/external × fill/sign) render the exact same way.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useResponsivePdfScale } from "@/hooks/useResponsivePdfScale";
import {
  CONTRACTOR_ADDENDUM_PAGE_W as PW,
  CONTRACTOR_ADDENDUM_PAGE_H as PH,
  type Rect,
} from "@/lib/contractorAddendumPdf";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export function rectStyle(r: Rect, scale: number): React.CSSProperties {
  return {
    position: "absolute",
    left: r.x * scale,
    top: (PH - r.y - r.h) * scale,
    width: r.w * scale,
    height: r.h * scale,
  };
}

interface Props {
  /** The PDF to display; null while it's still being built. */
  bytes: Uint8Array | null;
  /** Per-page overlays — `pageIndex` is 0-based. */
  renderOverlay?: (pageIndex: number, scale: number) => React.ReactNode;
}

export function ContractorAddendumCanvas({ bytes, renderOverlay }: Props) {
  const { scale, containerRef } = useResponsivePdfScale(PW);
  const [numPages, setNumPages] = useState(0);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pdfRef = useRef<any>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        // .slice() — pdf.js detaches the buffer it's handed; keep the caller's copy usable.
        const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load the form.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  useEffect(() => {
    if (!numPages || !pdfRef.current) return;
    let cancelled = false;
    (async () => {
      setPageLoading(true);
      try {
        const dpr = window.devicePixelRatio || 1;
        for (let i = 1; i <= numPages; i++) {
          const page = await pdfRef.current.getPage(i);
          const viewport = page.getViewport({ scale });
          const canvas = canvasRefs.current[i - 1];
          if (!canvas || cancelled) return;
          canvas.width = viewport.width * dpr;
          canvas.height = viewport.height * dpr;
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          const ctx = canvas.getContext("2d")!;
          ctx.scale(dpr, dpr);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to render the form.");
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [numPages, scale]);

  return (
    <div ref={containerRef} className="overflow-x-auto flex flex-col items-center bg-white/5 rounded-md p-4 gap-4">
      {error && <p className="text-xs text-red-300">{error}</p>}
      {Array.from({ length: numPages || 1 }, (_, i) => i).map((idx) => (
        <div key={idx} className="relative bg-white shadow-lg" style={{ width: PW * scale, height: PH * scale }}>
          <canvas ref={(el) => { canvasRefs.current[idx] = el; }} className="absolute inset-0" />
          {pageLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {!pageLoading && renderOverlay?.(idx, scale)}
        </div>
      ))}
    </div>
  );
}
