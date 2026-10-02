/**
 * "Clock in <technician>" popup on Part Daily Pickup / Collection. Opens
 * when the Parts Manager picks a technician in the Technician filter — but
 * only if that technician can be clocked in by them (Approval Chain: their
 * own branch) and hasn't clocked in yet today; otherwise it closes on its
 * own and the pick just filters. The Parts Manager types the 4-digit code
 * HR shares for today (HR → Clock-In Codes, one company code per day); the
 * database checks it, then the technician's time in is stamped — server
 * time, branch timezone, "clocked in by" the Parts Manager. Trainees go to
 * the trainee timecard, same as their own punch.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound, Loader2, CheckCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getEntryForDate, getProfileIdByFirebaseUid, saveEntry } from "@/lib/supabase/timecards";
import { getTraineeEntryForDate, saveTraineePunch } from "@/lib/supabase/traineeTimecards";
import { redeemClockInCode, REDEEM_MESSAGE } from "@/lib/supabase/clockInCodes";
import { chainCanClockIn } from "@/lib/approvalDirectory";
import { TECHNICIAN_PAY_ROLES, normalizeRole } from "@/lib/roleLabels";
import { timezoneForBranch, nowInTimezone } from "@/lib/attendanceGrace";
import { getServerNow } from "@/lib/serverTime";
import { logActivity } from "@/lib/supabase/hrActivityLog";

const fmt12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export function ClockInCodeModal({ techName, onClose }: { techName: string; onClose: () => void }) {
  const { uid } = useAuth();
  const [phase, setPhase] = useState<"checking" | "ask" | "done">("checking");
  const [tech, setTech] = useState<ProfileRow | null>(null);
  const [managerId, setManagerId] = useState<string | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stampedAt, setStampedAt] = useState("");

  // Decide quietly whether there's anything to do; if not, close so the pick just filters.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [users, me] = await Promise.all([getCompanyUsers(), uid ? getProfileIdByFirebaseUid(uid) : Promise.resolve(null)]);
      const t = users.find((u) => u.is_active && (u.display_name || "").trim().toLowerCase() === techName.trim().toLowerCase());
      if (!t || !me || !TECHNICIAN_PAY_ROLES.has(normalizeRole(t.role)) || chainCanClockIn(me, t.id) === false) return onClose();
      const { dateISO } = nowInTimezone(timezoneForBranch(t.assigned_branch), await getServerNow());
      const trainee = t.employment_type === "trainee";
      const already = trainee ? (await getTraineeEntryForDate(t.id, dateISO))?.checkIn : (await getEntryForDate(t.id, dateISO))?.checkIn;
      if (already) return onClose();
      if (cancelled) return;
      const mgr = users.find((u) => (u.display_name || "").trim().toLowerCase() === (t.manager_name || "").trim().toLowerCase());
      setTech(t);
      setManagerId(mgr?.id ?? null);
      setMyId(me);
      setPhase("ask");
    })().catch((err) => {
      console.error("ClockInCodeModal: check failed", err);
      onClose();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techName]);

  const submit = async () => {
    if (!tech || !myId || code.length !== 4) return;
    setBusy(true);
    setError(null);
    try {
      const result = await redeemClockInCode(tech.id, code);
      if (result !== "ok") {
        setError(REDEEM_MESSAGE[result]);
        if (result === "wrong") setCode("");
        return;
      }
      const serverNow = await getServerNow();
      const { hhmm, dateISO } = nowInTimezone(timezoneForBranch(tech.assigned_branch), serverNow);
      const time = `${hhmm}:${String(serverNow.getSeconds()).padStart(2, "0")}`;
      if (tech.employment_type === "trainee") {
        await saveTraineePunch(tech.id, dateISO, "checkIn", time, managerId);
      } else {
        await saveEntry(tech.id, dateISO, { checkIn: time, checkOut: "", mealStart: "", mealEnd: "", notes: "" }, { clockedInBy: myId });
      }
      logActivity({ action: "clock_in_with_code", targetType: "clock_in_code", targetId: tech.id, targetLabel: `${tech.display_name} — ${dateISO} ${hhmm}` });
      setStampedAt(fmt12(hhmm));
      setPhase("done");
    } catch (err) {
      setError(`Couldn't clock in: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  if (phase === "checking" || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-slate-900 border border-white/10 rounded-xl w-full max-w-sm p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {phase === "done" ? (
          <div className="text-center py-2">
            <CheckCircle className="h-10 w-10 text-green-400 mx-auto mb-2" />
            <h2 className="text-base font-bold text-white">{tech?.display_name} is clocked in</h2>
            <p className="text-sm text-slate-400 mt-1">Time in: {stampedAt}{tech?.employment_type === "trainee" ? " (trainee day — goes to their manager for review)" : ""}</p>
            <button type="button" onClick={onClose} className="btn mt-4 px-6 bg-blue-600 hover:bg-blue-700 text-white text-sm">Done</button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-1">
              <KeyRound className="h-5 w-5 text-blue-400" />
              <h2 className="text-base font-bold text-white">Clock in {tech?.display_name}?</h2>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Not clocked in yet today. Enter today's 4-digit company code from HR to stamp their time in now.
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
                <button type="button" onClick={onClose} disabled={busy} className="btn text-sm px-3 py-1.5" title="Close and just filter by this technician">
                  Just filter
                </button>
                <button type="submit" disabled={busy || code.length !== 4} className="btn text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />} Clock in
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
