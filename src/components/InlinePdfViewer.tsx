/**
 * Opens a signed document's PDF inside the current page instead of a new
 * browser tab. The file is fetched through this app's own /api/image-proxy
 * (never the raw Firebase Storage address, which a new tab would show in
 * its address bar) and drawn page by page with pdf.js, so it looks the same
 * on phones — mobile browsers can't show a PDF inside an <iframe> — and on
 * desktop. Used by every fill/sign page's "View the completed PDF" link.
 */
import { useEffect, useRef, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { renderPdfPages } from "@/lib/pdfPages";

/** "…/o/companies%2F…%2F1760000000000-Kyong-Shin.pdf?alt=media…" → "Kyong-Shin.pdf" (the stored file's own name, minus its upload-time prefix). */
function fileNameFromUrl(url: string): string {
  try {
    const objectPath = decodeURIComponent(new URL(url).pathname.split("/o/")[1] ?? "");
    const name = objectPath.split("/").pop()?.replace(/^\d{10,}-/, "") ?? "";
    return name.toLowerCase().endsWith(".pdf") ? name : "document.pdf";
  } catch {
    return "document.pdf";
  }
}

/** A link-styled button that opens the PDF in an in-page viewer. */
export function InlinePdfLink({ url, label, className, fileName }: { url: string; label: string; className?: string; fileName?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </button>
      {open && <InlinePdfModal url={url} title={label} fileName={fileName} onClose={() => setOpen(false)} />}
    </>
  );
}

export function InlinePdfModal({ url, title, fileName, onClose }: { url: string; title: string; fileName?: string; onClose: () => void }) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const bytesRef = useRef<Uint8Array | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const run = renderPdfPages(url, holder, {
      width: (h) => Math.min(h.clientWidth - 16, 900),
      pageClassName: "block mx-auto mb-3 bg-white rounded-sm shadow-lg",
      onFirstPage: () => setLoading(false),
    });
    run.done
      .then((bytes) => { if (bytes && !cancelled) bytesRef.current = bytes; })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load the PDF."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      run.cancel();
      holder.replaceChildren();
    };
  }, [url]);

  const handleDownload = () => {
    if (!bytesRef.current) return;
    const blobUrl = URL.createObjectURL(new Blob([bytesRef.current as unknown as BlobPart], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName || fileNameFromUrl(url);
    a.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/75 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-900 border-b border-white/10" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-semibold truncate">{title}</p>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={handleDownload} disabled={!bytesRef.current || loading} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 disabled:opacity-50">
            <Download className="h-3.5 w-3.5" /> Download
          </button>
          <button type="button" onClick={onClose} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1" aria-label="Close">
            <X className="h-3.5 w-3.5" /> Close
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-2 sm:p-4" onClick={(e) => e.stopPropagation()}>
        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading PDF…
          </div>
        )}
        {error && <p className="py-16 text-center text-sm text-red-300">{error}</p>}
        <div ref={holderRef} className="w-full max-w-[920px] mx-auto" />
      </div>
    </div>
  );
}
