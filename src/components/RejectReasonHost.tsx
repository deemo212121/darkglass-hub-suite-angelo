/**
 * The shared "Reason for rejecting" / "Approval notes" popup (see
 * src/lib/rejectReason.ts). Mounted once at the app root; any Reject or
 * Approve action that has no note yet awaits it. A note is required —
 * Cancel leaves the request untouched.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, XCircle } from "lucide-react";
import { registerRejectReasonAsker, REJECT_CANCELLED_MESSAGE, APPROVE_CANCELLED_MESSAGE, type NoteKind } from "@/lib/rejectReason";

export function RejectReasonHost() {
  const [open, setOpen] = useState<{ title: string; kind: NoteKind } | null>(null);
  const [text, setText] = useState("");
  const resolver = useRef<((v: string | null) => void) | null>(null);

  useEffect(() => {
    registerRejectReasonAsker(
      (title, kind) =>
        new Promise<string | null>((resolve) => {
          resolver.current?.(null); // a previous popup still open counts as cancelled
          resolver.current = resolve;
          setText("");
          setOpen({ title, kind });
        })
    );
    // Screens show save errors with alert(); a cancelled popup isn't an error,
    // so swallow just that message instead of touching every Reject handler.
    const originalAlert = window.alert;
    window.alert = (message?: unknown) => {
      if (typeof message === "string" && (message.includes(REJECT_CANCELLED_MESSAGE) || message.includes(APPROVE_CANCELLED_MESSAGE))) return;
      originalAlert.call(window, message as string);
    };
    return () => {
      registerRejectReasonAsker(null);
      window.alert = originalAlert;
    };
  }, []);

  const finish = (value: string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpen(null);
  };

  if (!open || typeof document === "undefined") return null;
  const trimmed = text.trim();
  const approving = open.kind === "approve";

  return createPortal(
    <div className="fixed inset-0 z-[300] bg-black/70 flex items-center justify-center p-3" onClick={() => finish(null)}>
      <div className="bg-slate-900 border border-white/10 rounded-xl w-full max-w-md p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1">
          {approving ? <CheckCircle2 className="h-5 w-5 text-green-400" /> : <XCircle className="h-5 w-5 text-red-400" />}
          <h2 className="text-base font-bold text-white">{open.title}</h2>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          {approving
            ? "Required — shown under your status on the request."
            : "The employee will see this in their notification and in Employee Self-Service → My Requests."}
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") finish(null);
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && trimmed) finish(trimmed);
          }}
          rows={4}
          placeholder={
            approving
              ? "e.g. Verified against the ticket check-ins — times are correct."
              : "e.g. The times don't match your ticket check-ins — please resubmit with the correct clock-out."
          }
          className={`w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none ${approving ? "focus:border-green-400" : "focus:border-red-400"}`}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => finish(null)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-white/10 hover:bg-white/15 text-slate-200">
            Cancel
          </button>
          <button
            type="button"
            disabled={!trimmed}
            onClick={() => finish(trimmed)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed ${approving ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}`}
          >
            {approving ? "Approve" : "Reject"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
