/**
 * Accounting → Payroll → Preview: the payslip exactly as Send would email it
 * (the same page bodies buildPayslipPdfBase64 turns into the PDF — page 1
 * the payslip, page 2 the Tech Activity Report for technicians), so the
 * accountant can check it before it goes out. Prev / Next (or ← / →) step
 * through the employees in the order the table shows them; Send emails the
 * one on screen.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, Loader2, Send, X } from "lucide-react";
import { PAYSLIP_STYLES } from "@/lib/payslipTemplate";

/** The width a page is laid out at before it's scaled to the window (the payslip's own max-width is 900px). */
const DOC_WIDTH = 860;

const fullDoc = (body: string) =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><style>${PAYSLIP_STYLES}</style></head><body>${body}</body></html>`;

/** One page drawn at full width, scaled down to fit its box, as tall as its content. */
function ScaledPage({ body, scale }: { body: string; scale: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1100);
  const measure = () => {
    const doc = ref.current?.contentDocument;
    if (doc) setHeight(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0));
  };
  return (
    <div className="overflow-hidden rounded-lg bg-white shadow-xl" style={{ height: height * scale }}>
      <iframe
        ref={ref}
        title="Payslip page"
        srcDoc={fullDoc(body)}
        onLoad={measure}
        scrolling="no"
        style={{ width: DOC_WIDTH, height, border: 0, transform: `scale(${scale})`, transformOrigin: "top left", display: "block" }}
      />
    </div>
  );
}

export function PayslipPreviewModal({
  name,
  subtitle,
  pages,
  index,
  total,
  onPrev,
  onNext,
  onClose,
  onSend,
  sending,
  sendDisabledReason,
  fileName,
  warning,
}: {
  name: string;
  /** e.g. "Technician · Columbus · 2026-10-25 to 2026-11-07" */
  subtitle: string;
  /** The page bodies; null while building; an Error when it couldn't be built. */
  pages: string[] | Error | null;
  /** 0-based position in the table's order, and how many there are. */
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onSend: () => void;
  sending: boolean;
  /** Why Send can't be used (e.g. Gmail not connected); null = it can. */
  sendDisabledReason: string | null;
  /** Shown above the pages in amber — something to fix before sending. */
  warning?: string | null;
  /** The downloaded PDF's name, e.g. "Payslip_ADejaun_Tyson_2026-10-25_to_2026-11-07.pdf". */
  fileName: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  useEffect(() => setDownloadError(null), [name, index]);
  const hasPrev = index > 0;

  /** Saves the PDF Send would email — built from the same pages shown here. */
  const download = async () => {
    if (!Array.isArray(pages) || downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const { captureHtmlToPdfBlob, captureHtmlPagesToPdfBlob } = await import("@/lib/pdfCapture");
      const blob = pages.length > 1 ? await captureHtmlPagesToPdfBlob(pages, PAYSLIP_STYLES) : await captureHtmlToPdfBlob(pages[0], PAYSLIP_STYLES);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setDownloadError(`Couldn't build the PDF: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setDownloading(false);
    }
  };
  const hasNext = index < total - 1;

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / DOC_WIDTH));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Back to the top for each new person.
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [name, index]);

  // ← / → step through people, Esc closes (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && hasPrev) { e.preventDefault(); onPrev(); }
      else if (e.key === "ArrowRight" && hasNext) { e.preventDefault(); onNext(); }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  const navBtn = "inline-flex items-center gap-1 rounded-lg border border-white/15 bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40";

  return createPortal(
    <div className="fixed inset-0 z-[2147483000] flex items-stretch justify-center bg-black/70 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Payslip preview — ${name}`} className="flex w-full max-w-5xl flex-col overflow-hidden bg-slate-900 sm:rounded-xl sm:border sm:border-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Payslip preview · {index + 1} of {total}</div>
            <div className="truncate text-lg font-bold text-white">{name}</div>
            <div className="truncate text-xs text-slate-400">{subtitle}</div>
          </div>
          <button
            type="button"
            onClick={() => void download()}
            disabled={!Array.isArray(pages) || downloading}
            aria-label="Download PDF"
            title="Download this payslip as a PDF"
            className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {downloading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
          </button>
          <button type="button" onClick={onClose} aria-label="Close preview" className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        {warning && <p className="border-b border-amber-400/30 bg-amber-500/10 px-4 py-2 text-xs font-medium text-amber-200">{warning}</p>}
        {downloadError && <p className="border-b border-white/10 bg-red-500/10 px-4 py-2 text-xs text-red-300">{downloadError}</p>}

        <div ref={scrollRef} className="flex-1 overflow-y-auto bg-slate-950/60 px-3 py-4 sm:px-6">
          <div ref={boxRef} className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
            {pages === null ? (
              <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-300"><Loader2 className="h-4 w-4 animate-spin" /> Building {name}'s payslip…</div>
            ) : pages instanceof Error ? (
              <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">Couldn't build this payslip: {pages.message}</div>
            ) : (
              pages.map((body, i) => (
                <div key={`${name}-${index}-${i}`} className="flex flex-col gap-1">
                  {pages.length > 1 && <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Page {i + 1} of {pages.length}{i === 1 ? " · Tech Activity Report" : ""}</div>}
                  <ScaledPage body={body} scale={scale} />
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3">
          <button type="button" onClick={onPrev} disabled={!hasPrev} className={navBtn} title="Previous employee (←)"><ChevronLeft className="h-4 w-4" /> Prev</button>
          <button type="button" onClick={onNext} disabled={!hasNext} className={navBtn} title="Next employee (→)">Next <ChevronRight className="h-4 w-4" /></button>
          <span className="ml-auto text-xs text-slate-500">{sendDisabledReason ?? "Emails this PDF to the employee."}</span>
          <button
            type="button"
            onClick={onSend}
            disabled={sending || !!sendDisabledReason || !Array.isArray(pages)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
