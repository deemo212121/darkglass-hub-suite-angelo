/**
 * "PDF Document" — shows a PDF's pages right in the form, so the person
 * reads (and signs) the actual document instead of a retyped copy: e.g. an
 * agreement the other party already signed on paper, scanned. Pair it with
 * a Document Template source PDF (DocumentTemplate.sourcePdf) so the saved
 * document is that same PDF with the signatures stamped on.
 */
import { useEffect, useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import type { ElementDefinition } from "./types";
import { uploadCustomFormAsset } from "@/lib/firebase/storage";
import { useAuth } from "@/lib/auth";
import { renderPdfPages } from "@/lib/pdfPages";

function PdfDocumentPages({ url, caption }: { url: string; caption?: string }) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || !url) return;
    setLoading(true);
    setError(null);
    const run = renderPdfPages(url, holder, {
      width: (h) => Math.max(h.clientWidth, 280),
      pageClassName: "block w-full mb-3 bg-white border border-slate-300 shadow-sm",
      onFirstPage: () => setLoading(false),
    });
    run.done.catch((err) => setError(err instanceof Error ? err.message : "Couldn't load the PDF.")).finally(() => setLoading(false));
    return () => {
      run.cancel();
      holder.replaceChildren();
    };
  }, [url]);

  return (
    <figure>
      {caption && <figcaption className="text-xs text-slate-500 mb-2">{caption}</figcaption>}
      {loading && !error && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the document…
        </div>
      )}
      {error && <p className="py-6 text-center text-sm text-red-500">{error}</p>}
      <div ref={holderRef} className="w-full" />
    </figure>
  );
}

export const pdfDocumentElement: ElementDefinition = {
  type: "pdfDocument",
  label: "PDF Document",
  icon: FileText,
  category: "basicInputs",
  kind: "structural",
  defaultConfig: () => ({ url: "", caption: "" }),
  CanvasPreview: ({ config }) => (
    <div className="w-full h-24 rounded-md border border-dashed border-slate-300 flex items-center justify-center gap-2 text-xs text-slate-400">
      <FileText className="h-4 w-4" /> {config.url ? "PDF set — shown page by page in the form" : "No PDF set"}
    </div>
  ),
  PropertiesPanel: ({ field, onChange }) => {
    const { companyId } = useAuth();
    const [uploading, setUploading] = useState(false);
    const set = (patch: Record<string, any>) => onChange({ ...field, config: { ...field.config, ...patch } });
    const handleUpload = async (file: File) => {
      if (!companyId) return;
      setUploading(true);
      try {
        const { url } = await uploadCustomFormAsset(companyId, file);
        set({ url });
      } finally {
        setUploading(false);
      }
    };
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Upload PDF</label>
          <input type="file" accept="application/pdf,.pdf" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }} className="text-xs" />
          {uploading && <span className="text-[10px] text-muted-foreground">Uploading…</span>}
        </div>
        <div className="flex flex-col gap-1.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Or PDF URL</label><input type="text" value={field.config.url ?? ""} onChange={(e) => set({ url: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></div>
        <div className="flex flex-col gap-1.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Caption</label><input type="text" value={field.config.caption ?? ""} onChange={(e) => set({ caption: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></div>
      </div>
    );
  },
  FillInput: ({ field }) => (field.config.url ? <PdfDocumentPages url={field.config.url} caption={field.config.caption} /> : null),
  isEmptyValue: () => false,
};
