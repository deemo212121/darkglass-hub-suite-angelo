/**
 * "Enter today's code" before a technician's own Time In (mobile Home and
 * the desktop header clock). The code comes from HR → Clock-In Codes; the
 * database checks it (redeem_clock_in_code, migration 0344) and only then
 * does the caller stamp the punch.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound, Loader2 } from "lucide-react";
import { redeemClockInCode, REDEEM_MESSAGE } from "@/lib/supabase/clockInCodes";

const SELF_MESSAGE: Partial<Record<keyof typeof REDEEM_MESSAGE, string>> = {
  wrong: "That code isn't right. Check today's code with HR and try again.",
  locked: "Too many wrong tries. Ask HR for a new code.",
  no_code: "Ask HR for today's clock-in code, then enter it here.",
};

export function ClockInCodePrompt({
  profileId,
  onVerified,
  onCancel,
}: {
  profileId: string;
  /** Code accepted — stamp the Time In now. The popup shows "Stamping…" until this finishes; the caller closes it. */
  onVerified: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stamping, setStamping] = useState(false);

  const submit = async () => {
    if (code.length !== 4) return;
    setBusy(true);
    setError(null);
    try {
      const result = await redeemClockInCode(profileId, code);
      if (result === "ok") {
        setStamping(true);
        await onVerified();
        return;
      }
      setError(SELF_MESSAGE[result] ?? REDEEM_MESSAGE[result]);
      setCode("");
    } catch {
      setError("Couldn't check the code — you need a connection to Time In. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[300] bg-black/70 flex items-center justify-center p-4" onClick={() => !busy && !stamping && onCancel()}>
      <div className="bg-slate-900 border border-white/10 rounded-xl w-full max-w-sm p-5 shadow-2xl text-left" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1">
          <KeyRound className="h-5 w-5 text-blue-400" />
          <h2 className="text-base font-bold text-white">Enter today's clock-in code</h2>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          {stamping ? "Code accepted — stamping your time in…" : "Today's 4-digit company code from HR. Your time in is stamped once it's accepted."}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={4}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="• • • •"
            className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-3 text-center text-2xl font-mono tracking-[0.6em] text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
          />
          {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onCancel} disabled={busy || stamping} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-slate-200">
              Cancel
            </button>
            <button type="submit" disabled={busy || stamping || code.length !== 4} className="rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50 inline-flex items-center gap-1.5">
              {(busy || stamping) && <Loader2 className="h-4 w-4 animate-spin" />} {stamping ? "Stamping…" : "Time In"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
