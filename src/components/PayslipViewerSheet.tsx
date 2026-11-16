/**
 * Full-screen payslip viewer for an employee's own pay period — the same
 * payslip Employee Self Service shows (lib/myPayslipDocument.ts), drawn at
 * its real page width and scaled down to fit a phone, with Download (PDF)
 * at the bottom. Used by the mobile app's Payroll tab and the desktop
 * Timecard → Payroll page in place of the old text-only alert.
 *
 * `extra` renders above the payslip — the mobile app puts a technician's
 * piece-rate breakdown there.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Download, Loader2 } from "lucide-react";
import { renderPayslipFullHtml, type EmployeePayslipData } from "@/lib/payslipTemplate";
import { downloadPayslipPdf } from "@/lib/myPayslipDocument";

/** The width the payslip is laid out at (its own max-width is 900px). */
const DOC_WIDTH = 820;

export function PayslipViewerSheet({
  title,
  status,
  data,
  extra,
  onClose,
}: {
  /** e.g. "10/25/2026 – 11/7/2026" */
  title: string;
  status?: string;
  /** null while it's being built; an Error when it couldn't be. */
  data: EmployeePayslipData | Error | null;
  extra?: ReactNode;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);
  const [docHeight, setDocHeight] = useState(1100);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fit the page's width to the screen.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / DOC_WIDTH));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  // Close on Escape; keep the page behind from scrolling.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const measure = () => {
    const doc = frameRef.current?.contentDocument;
    if (doc) setDocHeight(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0));
  };

  const ready = data && !(data instanceof Error) ? data : null;

  const download = async () => {
    if (!ready || downloading) return;
    setDownloading(true);
    setError(null);
    try {
      await downloadPayslipPdf(ready);
    } catch (e) {
      setError(`Couldn't build the PDF: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setDownloading(false);
    }
  };

  // Portaled to <body> and stacked above everything: inside the mobile app the
  // sheet otherwise opened under the app's header and bottom bar, hiding Back
  // and Download.
  return createPortal(
    <div className="fixed inset-0 z-[2147483000] flex flex-col bg-[#091321] text-white" role="dialog" aria-modal="true" aria-label={`Payslip ${title}`}>
      <div className="flex items-center gap-2 bg-gradient-to-br from-[#3b78f6] to-[#2861d8] px-3 py-3" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <button type="button" onClick={onClose} aria-label="Back to Payroll" className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/15 py-1.5 pl-1.5 pr-3 text-sm font-semibold hover:bg-white/25">
          <ChevronLeft className="h-5 w-5" /> Back
        </button>
        <div className="min-w-0 flex-1 pl-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-white/80">Payslip</div>
          <div className="truncate text-base font-bold">{title}</div>
        </div>
        {status && <span className="shrink-0 rounded-full bg-white/90 px-2.5 py-0.5 text-[11px] font-bold text-[#1d4ed8]">{status}</span>}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {extra && <div className="mx-auto mb-3 max-w-[900px]">{extra}</div>}
        <div ref={boxRef} className="mx-auto w-full max-w-[900px]">
          {data === null ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-white/80"><Loader2 className="h-4 w-4 animate-spin" /> Building your payslip…</div>
          ) : data instanceof Error ? (
            <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-3 text-sm text-red-200">Couldn't build this payslip: {data.message}</div>
          ) : (
            // Laid out at full page width, then scaled to the screen, so the tables read like the printed payslip.
            <div className="overflow-hidden rounded-lg bg-white shadow-lg" style={{ height: docHeight * scale }}>
              <iframe
                ref={frameRef}
                title="Payslip"
                srcDoc={renderPayslipFullHtml(data)}
                onLoad={measure}
                scrolling="no"
                style={{ width: DOC_WIDTH, height: docHeight, border: 0, transform: `scale(${scale})`, transformOrigin: "top left", display: "block" }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-white/10 bg-[#0d1a2e] px-4 py-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        {error && <p className="mb-2 text-xs text-red-300">{error}</p>}
        <div className="mx-auto flex max-w-[900px] gap-3">
          <button type="button" onClick={onClose} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold hover:bg-white/10"><ChevronLeft className="h-4 w-4" /> Back</button>
          <button
            type="button"
            onClick={() => void download()}
            disabled={!ready || downloading}
            className="inline-flex flex-[2] items-center justify-center gap-2 rounded-lg bg-[#22c55e] px-4 py-2.5 text-sm font-bold text-[#052e16] hover:bg-[#16a34a] disabled:opacity-50"
          >
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {downloading ? "Preparing PDF…" : "Download PDF"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
