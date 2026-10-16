/**
 * Draws a PDF's pages as canvases into a container with pdf.js — shared by
 * InlinePdfModal (src/components/InlinePdfViewer.tsx) and the custom forms'
 * "PDF Document" element (src/lib/formElements/pdfDocument.tsx). The file is
 * fetched through this app's own /api/image-proxy (the storage bucket sends
 * no CORS headers, and mobile browsers can't show a PDF in an <iframe>).
 */
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

export async function fetchPdfBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`Couldn't load the PDF (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Renders every page of the PDF at `url` into `holder` (replacing what's
 * there), each `width` CSS px wide. Resolves with the file's bytes once the
 * last page is drawn; `onFirstPage` fires as soon as page 1 is up. `cancel`
 * stops a render that's no longer wanted (the component unmounted).
 */
export function renderPdfPages(
  url: string,
  holder: HTMLElement,
  opts: { width: (holder: HTMLElement) => number; pageClassName: string; onFirstPage?: () => void }
): { done: Promise<Uint8Array | null>; cancel: () => void } {
  let cancelled = false;
  const tasks: { cancel: () => void }[] = [];
  const done = (async () => {
    const [pdfjs, bytes] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), fetchPdfBytes(url)]);
    if (cancelled) return null;
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    // pdf.js takes ownership of the buffer it's given — hand it a copy so callers keep the bytes.
    const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    if (cancelled) return null;
    holder.replaceChildren();
    const width = opts.width(holder);
    const dpr = window.devicePixelRatio || 1;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      if (cancelled) return null;
      const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.className = opts.pageClassName;
      holder.appendChild(canvas);
      const ctx = canvas.getContext("2d")!;
      ctx.scale(dpr, dpr);
      const task = page.render({ canvas, canvasContext: ctx, viewport });
      tasks.push(task);
      await task.promise;
      if (i === 1 && !cancelled) opts.onFirstPage?.();
    }
    return bytes;
  })();
  return {
    done,
    cancel: () => {
      cancelled = true;
      for (const t of tasks) t.cancel();
    },
  };
}
