import { createPortal } from "react-dom";

/**
 * Lightweight in-app popup for viewing a single attachment (image or PDF) —
 * used by the PTO/HR-Status attachment "View" buttons (AbsentListPage,
 * HrCalendarTab) so clicking View opens a container over the page instead
 * of navigating to a new tab. Not the full zoom/pan lightbox
 * ExpenseTrackingPage/TicketPhotos use for photo galleries — these are one
 * attachment at a time, so a simple centered dialog is enough.
 *
 * Portaled straight to document.body — both call sites can render this from
 * inside a `.panel` (backdrop-filter: blur) ancestor, which creates its own
 * stacking context that traps a plain `position: fixed` child no matter how
 * high its z-index is (same clipping-ancestor issue the Branch Manager
 * combobox hit earlier — see ReportHRDaily.tsx). Without the portal this
 * modal rendered BEHIND the calendar's own edit-modal portal instead of
 * over it.
 */
export function AttachmentPreviewModal({ url, title, onClose }: { url: string; title?: string; onClose: () => void }) {
  const isPdf = /\.pdf(\?|#|$)/i.test(url);

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-neutral-900 border border-white/10 rounded-lg w-full max-w-3xl h-[85vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-white/5 shrink-0">
          <div className="text-sm text-slate-200 truncate">{title ?? "Attachment"}</div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 h-7 rounded bg-blue-600/40 hover:bg-blue-600/60 text-blue-200 text-xs flex items-center"
            >
              Open original ↗
            </a>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded bg-white/10 hover:bg-rose-600/40 text-white text-sm flex items-center justify-center"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 flex items-center justify-center bg-black/40">
          {isPdf ? (
            <iframe src={url} title={title ?? "Attachment"} className="w-full h-full" />
          ) : (
            <img src={url} alt={title ?? "Attachment"} className="max-w-full max-h-full object-contain" />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
