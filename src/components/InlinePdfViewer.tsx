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
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

async function fetchPdfBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`Couldn't load the PDF (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

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
    let cancelled = false;
    const tasks: { cancel: () => void }[] = [];
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [pdfjs, bytes] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), fetchPdfBytes(url)]);
        if (cancelled) return;
        bytesRef.current = bytes;
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        // pdf.js takes ownership of the buffer it's given — hand it a copy so Download still has the bytes.
        const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        const holder = holderRef.current;
        if (cancelled || !holder) return;
        holder.replaceChildren();
        const width = Math.min(holder.clientWidth - 16, 900);
        const dpr = window.devicePixelRatio || 1;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width * dpr;
          canvas.height = viewport.height * dpr;
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          canvas.className = "block mx-auto mb-3 bg-white rounded-sm shadow-lg";
          holder.appendChild(canvas);
          const ctx = canvas.getContext("2d")!;
          ctx.scale(dpr, dpr);
          const task = page.render({ canvas, canvasContext: ctx, viewport });
          tasks.push(task);
          await task.promise;
          if (i === 1 && !cancelled) setLoading(false);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load the PDF.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      for (const t of tasks) t.cancel();
      holderRef.current?.replaceChildren();
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
