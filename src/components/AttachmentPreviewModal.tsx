import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";

/**
 * Lightweight in-app popup for viewing a single attachment (image or PDF) —
 * used by the PTO/HR-Status attachment "View" buttons (AbsentListPage,
 * HrCalendarTab) and Exception Reports, so clicking View opens a container
 * over the page instead of navigating to a new tab.
 *
 * Portaled straight to document.body — call sites can render this from
 * inside a `.panel` (backdrop-filter: blur) ancestor, which creates its own
 * stacking context that traps a plain `position: fixed` child.
 *
 * PDFs are loaded through /api/image-proxy into a blob URL typed
 * application/pdf, not embedded straight from Firebase Storage: a direct
 * iframe of the Storage URL rendered blank (Storage can serve these as a
 * download / generic binary, which a browser won't draw inline), which is
 * why "Open original" was the only way to read them. Same proxy
 * downloadSignableDocumentPdf.ts uses, for the same CORS reason.
 */
export function AttachmentPreviewModal({ url, title, onClose }: { url: string; title?: string; onClose: () => void }) {
  const isPdf = /\.pdf(\?|#|$)/i.test(url);
  const [pdfSrc, setPdfSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!isPdf) return;
    let cancelled = false;
    let blobUrl: string | null = null;
    fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        blobUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        setPdfSrc(blobUrl);
      })
      .catch(() => {
        if (!cancelled) setPdfSrc(url);
      });
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [url, isPdf]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-3" onClick={onClose}>
      <div
        className="bg-neutral-900 border border-white/10 rounded-lg w-full max-w-[min(1200px,96vw)] h-[94vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-white/5 shrink-0">
          <div className="text-sm text-slate-200 truncate">{title ?? "Attachment"}</div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 h-7 rounded text-slate-400 hover:text-slate-200 text-xs flex items-center"
            >
              Open in new tab ↗
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-7 h-7 rounded bg-white/10 hover:bg-rose-600/40 text-white text-sm flex items-center justify-center"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 flex items-center justify-center bg-black/40">
          {isPdf ? (
            pdfSrc ? (
              <iframe src={pdfSrc} title={title ?? "Attachment"} className="w-full h-full bg-white" />
            ) : (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading PDF…
              </div>
            )
          ) : (
            <img src={url} alt={title ?? "Attachment"} className="max-w-full max-h-full object-contain" />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
