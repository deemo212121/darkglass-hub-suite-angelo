import { useState } from "react";
import { Paperclip } from "lucide-react";
import { AttachmentPreviewModal } from "@/components/AttachmentPreviewModal";
import type { PtoRequestRow } from "@/lib/supabase/pto";

/**
 * The Reason and Photo columns of the PTO Requests tables (Attendance
 * Monitoring and the PTO Management tab) — "—" when the request has none.
 * A long reason shows 3 lines and opens in full on click; the photo opens
 * in AttachmentPreviewModal.
 */
export function PtoReasonCell({ request }: { request: PtoRequestRow }) {
  const [expanded, setExpanded] = useState(false);
  const reason = (request.reason ?? "").trim();
  if (!reason) return <td className="px-3 py-3 text-slate-500">—</td>;
  return (
    <td className="px-3 py-3 min-w-[220px] max-w-[360px] align-middle">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? "Show less" : reason}
        className={`block w-full text-left whitespace-pre-wrap break-words text-xs text-slate-300 hover:text-white ${expanded ? "" : "line-clamp-3"}`}
      >
        {reason}
      </button>
    </td>
  );
}

export function PtoPhotoCell({ request, employeeName }: { request: PtoRequestRow; employeeName: string }) {
  const [previewing, setPreviewing] = useState(false);
  const photo = request.attachmentPath;
  if (!photo) return <td className="px-3 py-3 text-slate-500">—</td>;
  const isPdf = /\.pdf(\?|#|$)/i.test(photo);
  const dates = request.startDate === request.endDate ? request.startDate : `${request.startDate} – ${request.endDate}`;
  return (
    <td className="px-3 py-3">
      <button
        type="button"
        onClick={() => setPreviewing(true)}
        title={isPdf ? "View file" : "View photo"}
        className="block h-12 w-12 overflow-hidden rounded border border-white/10 bg-slate-800 hover:border-blue-500 transition"
      >
        {isPdf ? (
          <span className="flex h-full w-full items-center justify-center text-slate-400"><Paperclip className="h-4 w-4" /></span>
        ) : (
          <img src={photo} alt={`${employeeName} — PTO photo`} loading="lazy" className="h-full w-full object-cover" />
        )}
      </button>
      {previewing && <AttachmentPreviewModal url={photo} title={`${employeeName} — ${dates}`} onClose={() => setPreviewing(false)} />}
    </td>
  );
}
