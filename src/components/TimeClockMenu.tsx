/**
 * TimeClockButtons — quick Time In / Meal In / Meal Out / Time Out punch
 * clock in AppHeader, same level as Announcements/Notifications/Messages.
 * Mirrors the toggle logic in routes/timecard.tsx's day modal
 * (handleTimeToggle / handleMealToggle) but punches instantly against
 * today's row instead of opening the full calendar day modal — same
 * underlying timecard_entries row, so it stays in sync with My Timecard.
 *
 * Each step gates the next: Meal In needs Time In, Meal Out needs Meal In.
 * Time Out is NOT blocked by an unfinished meal — an eligible employee who
 * times out without completing Meal In + Meal Out is simply recorded as
 * "missing-meal" in getAttendanceForRange (see timecards.ts) for HR/managers
 * to see, rather than being stopped from clocking out. Time Out still locks
 * Meal In/Out once it's punched, so a meal break can't start or resume after
 * the day is already closed out. Employees whose scheduled shift is 6 hours
 * or less (or has no schedule set at all) aren't eligible for a meal break
 * at all (same rule as the full timecard page), so they only ever see Time
 * In / Time Out.
 *
 * Once a step is punched, its button's own label swaps to the recorded time
 * (read straight from the saved entry, not a transient toast) — so it stays
 * visible/correct even after a refresh. That swap happens in place, inside
 * the button's own normal-flow box, rather than as a label stamped below it:
 * this row sits in the header's icon strip, which scrolls horizontally on
 * narrow viewports (see Header.tsx) via overflow-x-auto — and overflow-x
 * auto forces overflow-y to compute to auto too, clipping anything that
 * pokes out of a child's own box. Keeping the punched state inside the
 * button avoids that entirely, and keeps this row exactly h-9 like every
 * other header icon (see the height note on ModuleNavigator.tsx and the
 * mobile ticket page's tab strip, which both assume that).
 */
import { useEffect, useRef, useState } from "react";
import { X, Clock3 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getMyProfileSchedule, getEntryForDate, saveEntry, clearPunch as sbClearPunch, canEditPunch, resolveScheduledShiftHours, type UITimeEntry, type PunchField } from "@/lib/supabase/timecards";
import { getTraineeEntryForDate, saveTraineePunch, clearTraineePunch, getPendingTraineeReviewCount, SELF_CHECKED_OUT_EVENT, type TraineeTimecardStatus } from "@/lib/supabase/traineeTimecards";
import { getCompanyUsers } from "@/lib/supabase/users";
import { resolveTeamLeadOrManager } from "@/lib/notifyRouting";
import { getCompanyPtoRequests } from "@/lib/supabase/pto";
import { getServerNow, zonedDateKey, zonedTimeString, type ScheduleTimezone } from "@/lib/serverTime";
import { isTabVisible, onTabVisible } from "@/lib/pageVisibility";

const EMPTY_ENTRY: UITimeEntry = { checkIn: "", checkOut: "", mealStart: "", mealEnd: "", notes: "" };

// Local-clock approximation — fine for non-punch bookkeeping (which day's
// entry to load, whether to re-poll after a tab regains focus), but never
// used to stamp an actual punch. See handlePunch() below for that.
function todayKey(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

function fmtTime(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export function TimeClockButtons() {
  const { uid, ready } = useAuth();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [requiredCheckIn, setRequiredCheckIn] = useState("");
  const [requiredCheckOut, setRequiredCheckOut] = useState("");
  const [workingHours, setWorkingHours] = useState<number | null>(null);
  const [mealMinutes, setMealMinutes] = useState<number | null>(null);
  const [scheduleTimezone, setScheduleTimezone] = useState<ScheduleTimezone>("CST");
  const [entry, setEntry] = useState<UITimeEntry>(EMPTY_ENTRY);
  const [saving, setSaving] = useState(false);
  // Time In/Meal In/Meal Out/Time Out sit right next to each other — `saving`
  // alone only disables the row for the duration of the network round-trip,
  // which on a fast connection can be well under a second, so two adjacent
  // buttons clicked in one quick motion (or an accidental double-click) could
  // both land before the first punch's disabled state is even visible. This
  // adds a floor: once any punch fires, every button in the row stays
  // disabled for a couple seconds regardless of how fast the save itself
  // finishes, so two punches can never register as one near-instant motion.
  const [locked, setLocked] = useState(false);
  const lockRef = useRef(false);
  const withLock = (fn: () => void) => {
    if (lockRef.current) return;
    lockRef.current = true;
    setLocked(true);
    fn();
    setTimeout(() => {
      lockRef.current = false;
      setLocked(false);
    }, 2000);
  };
  const [onApprovedPtoToday, setOnApprovedPtoToday] = useState(false);
  // "trainee" (profiles.employment_type — migration 0152) punches on this
  // exact same widget, but every read/write below is redirected to
  // trainee_timecard_entries instead of the real timecard_entries, until
  // their direct manager approves the day from Attendance Monitoring's
  // "Trainee Attendance" tab. directManagerId is resolved once (via
  // resolveTeamLeadOrManager, the same helper every other approval flow in
  // this app uses) and stamped onto the day's row at first punch.
  const [employmentType, setEmploymentType] = useState<"trainee" | "regular">("regular");
  const [directManagerId, setDirectManagerId] = useState<string | null>(null);
  const [traineeStatus, setTraineeStatus] = useState<TraineeTimecardStatus | null>(null);
  // Which punch (if any) a clear/remove request is currently in flight for —
  // disables just its own X, not the other three slots'.
  const [clearingField, setClearingField] = useState<PunchField | null>(null);
  // Which punch's pill is currently showing its inline "Remove? Yes/No"
  // prompt — armed by the X, cleared by Yes/No. That Yes tap IS the
  // confirmation; no separate native confirm() on top of it.
  const [confirmClearField, setConfirmClearField] = useState<PunchField | null>(null);

  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    getMyProfileSchedule(uid).then((s) => {
      if (cancelled) return;
      setProfileId(s.profileId);
      setRequiredCheckIn(s.requiredCheckIn);
      setRequiredCheckOut(s.requiredCheckOut);
      setWorkingHours(s.workingHours);
      setMealMinutes(s.mealMinutes);
      setScheduleTimezone(s.scheduleTimezone);
      setEmploymentType(s.employmentType);
    });
    return () => { cancelled = true; };
  }, [ready, uid]);

  // Resolve the trainee's own direct manager once — only ever needed for a
  // trainee (a regular employee's punches never touch manager_id at all),
  // so this extra company-wide roster fetch is skipped entirely for the
  // common case.
  useEffect(() => {
    if (employmentType !== "trainee" || !profileId) return;
    let cancelled = false;
    getCompanyUsers()
      .then((all) => {
        if (cancelled) return;
        const me = all.find((p) => p.id === profileId);
        if (!me) return;
        return resolveTeamLeadOrManager(me, all).then((mgr) => { if (!cancelled) setDirectManagerId(mgr?.id ?? null); });
      })
      .catch((err) => console.error("Failed to resolve direct manager:", err));
    return () => { cancelled = true; };
  }, [employmentType, profileId]);

  // Which calendar day `entry` was loaded for — tracked separately from
  // `entry` itself so a stale in-memory entry can never get persisted under
  // a NEW day's work_date. Without this, a tab left open across midnight
  // would still hold yesterday's checkIn in state; clicking Time Out the
  // next morning would then save {yesterday's checkIn, today's checkOut}
  // under TODAY's row (todayKey() is recomputed fresh at click time, but
  // `entry` wasn't) — producing a checkOut-before-checkIn row with no
  // warning. persist() below re-checks this immediately before every save.
  const loadedDateKeyRef = useRef<string>(todayKey());

  const loadToday = (pid: string) => {
    const dateKey = todayKey();
    loadedDateKeyRef.current = dateKey;
    setConfirmClearField(null);
    if (employmentType === "trainee") {
      getTraineeEntryForDate(pid, dateKey)
        .then((e) => {
          setEntry(e ? { checkIn: e.checkIn, checkOut: e.checkOut, mealStart: e.mealStart, mealEnd: e.mealEnd, notes: "" } : EMPTY_ENTRY);
          setTraineeStatus(e?.status ?? null);
        })
        .catch((err) => console.error("Failed to load today's trainee timecard entry:", err));
      return;
    }
    getEntryForDate(pid, dateKey)
      .then((e) => setEntry(e ?? EMPTY_ENTRY))
      .catch((err) => console.error("Failed to load today's timecard entry:", err));
  };

  useEffect(() => {
    if (!profileId) return;
    loadToday(profileId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, employmentType]);

  // Re-sync whenever the tab regains attention or on a slow poll, so a tab
  // left open overnight reflects the new day's (empty) state on its own,
  // not just when the persist() guard below happens to catch a stale save.
  useEffect(() => {
    if (!profileId) return;
    const check = () => {
      if (todayKey() !== loadedDateKeyRef.current) loadToday(profileId);
    };
    // visibilitychange is handled by onTabVisible below (also gates the
    // interval itself, which used to keep ticking every 60s in every
    // background tab). focus stays as a belt-and-suspenders extra — it
    // catches a same-tab-visible-different-window-focus edge case
    // visibilitychange alone won't (e.g. alt-tabbing between two windows on
    // a multi-monitor setup without the document itself losing visibility).
    window.addEventListener("focus", check);
    const interval = setInterval(() => { if (isTabVisible()) check(); }, 60000);
    const unsubVisible = onTabVisible(check);
    return () => {
      window.removeEventListener("focus", check);
      clearInterval(interval);
      unsubVisible();
    };
  }, [profileId]);

  // An approved PTO day needs no punches at all — block Time In outright so
  // a manager approving PTO after the fact (or the employee clocking in
  // before it's approved) can't both happen for the same day going forward.
  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    const today = todayKey();
    getCompanyPtoRequests()
      .then((all) => {
        if (cancelled) return;
        setOnApprovedPtoToday(
          all.some((r) => r.profileId === profileId && r.status === "approved" && today >= r.startDate && today <= r.endDate)
        );
      })
      .catch((err) => console.error("Failed to load PTO status:", err));
    return () => { cancelled = true; };
  }, [profileId]);

  // Same rule as the full timecard page's handleMealToggle: eligibility is
  // based on the SCHEDULED shift length, not actual hours worked. Shifts of
  // 6 hours or less have no meal break at all.
  const scheduledShift = resolveScheduledShiftHours(requiredCheckIn, requiredCheckOut, workingHours, mealMinutes);
  const mealEligible = scheduledShift > 6;

  // Stamps `field` with the server's own current instant (never the
  // browser's clock — see src/lib/serverTime.ts) converted into this
  // employee's own scheduled timezone, then saves it under the matching
  // server-verified calendar date. If getServerNow() fails, the punch is
  // NOT saved with a fallback local time — that would just re-open the
  // hole this exists to close — the employee sees an error and can retry.
  const persistPunch = async (field: keyof Pick<UITimeEntry, "checkIn" | "checkOut" | "mealStart" | "mealEnd">) => {
    if (!profileId) return;
    // Reviewing a trainee now takes priority over this viewer's own sign-
    // out completing — if they still have a trainee day pending, Time Out
    // itself is held (not saved) until every one of those is Approved or
    // Rejected. Dispatching the event here pops TraineeAttendanceReviewModal
    // right away to make that actionable.
    if (field === "checkOut") {
      try {
        const pendingCount = await getPendingTraineeReviewCount(profileId);
        if (pendingCount > 0) {
          window.dispatchEvent(new CustomEvent(SELF_CHECKED_OUT_EVENT));
          alert(`You have ${pendingCount} trainee day${pendingCount === 1 ? "" : "s"} awaiting your review — resolve ${pendingCount === 1 ? "it" : "them"} before you can time out.`);
          return;
        }
      } catch (err) {
        // Fail OPEN — a network hiccup checking for pending trainees must
        // never itself block a legitimate checkout.
        console.error("Failed to check pending trainee review before checkout:", err);
      }
    }
    setSaving(true);
    try {
      const serverNow = await getServerNow();
      const workDate = zonedDateKey(serverNow, scheduleTimezone);
      const time = zonedTimeString(serverNow, scheduleTimezone);
      // Belt-and-suspenders against the visibilitychange/focus/interval resync
      // above missing a same-second day rollover: refuse to write a punch
      // computed from a stale day's entry under the new day's work_date.
      if (workDate !== loadedDateKeyRef.current) {
        loadToday(profileId);
        alert("It's now a new day — your punch state was refreshed. Please try again.");
        return;
      }
      const next = { ...entry, [field]: time };
      setEntry(next);
      if (employmentType === "trainee") {
        await saveTraineePunch(profileId, workDate, field, time, directManagerId);
        setTraineeStatus((prev) => (prev === "rejected" ? "pending" : prev ?? "pending"));
      } else {
        await saveEntry(profileId, workDate, next);
      }
      // Tied specifically to THIS viewer's own Time Out, once it actually
      // saved — see TraineeAttendanceReviewModal.tsx, which listens for this
      // to surface any pending trainee day this viewer can approve.
      if (field === "checkOut") window.dispatchEvent(new CustomEvent(SELF_CHECKED_OUT_EVENT));
    } catch (err) {
      console.error("Failed to save time punch:", err);
      alert(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const PUNCH_LABEL: Record<PunchField, string> = { checkIn: "Time In", checkOut: "Time Out", mealStart: "Meal In", mealEnd: "Meal Out" };

  // Self-correct an accidental punch — only reachable when canEditPunch says
  // this is the most-recently-made one (see its doc comment for the chain
  // rule). Always operates on today's own row (loadedDateKeyRef), same as
  // every punch this widget makes — there's no past-day path here to guard
  // against. Only reachable via the pill's own inline "Remove? Yes/No"
  // prompt (confirmClearField above), which is itself the confirmation —
  // no separate native confirm() on top of that.
  const handleClearPunch = (field: PunchField) => {
    if (!profileId || saving || clearingField) return;
    setConfirmClearField(null);
    setClearingField(field);
    (async () => {
      try {
        if (employmentType === "trainee") {
          await clearTraineePunch(profileId, loadedDateKeyRef.current, field);
        } else {
          await sbClearPunch(profileId, loadedDateKeyRef.current, field);
        }
        setEntry((prev) => ({ ...prev, [field]: "" }));
      } catch (err) {
        console.error("Failed to clear punch:", err);
        alert(`Failed to remove: ${err instanceof Error ? err.message : "Unknown error"}`);
      } finally {
        setClearingField(null);
      }
    })();
  };

  // An approved PTO day is greyed out entirely — no punch of any kind is
  // meaningful for it, not just Time In (an employee who already clocked in
  // before the request was approved shouldn't then be able to Meal/Time Out
  // either, since HR/managers reviewing the day want it to read as pure PTO).
  const ptoBlockMessage = "You have an approved PTO for today, so time punches are disabled.";

  const handleTimeIn = () => {
    if (entry.checkIn) return;
    if (onApprovedPtoToday) {
      alert(ptoBlockMessage);
      return;
    }
    withLock(() => void persistPunch("checkIn"));
  };

  const handleTimeOut = () => {
    if (!entry.checkIn || entry.checkOut) return;
    if (onApprovedPtoToday) {
      alert(ptoBlockMessage);
      return;
    }
    withLock(() => void persistPunch("checkOut"));
  };

  const handleMealIn = () => {
    if (!entry.checkIn) {
      alert("Please time in first.");
      return;
    }
    if (entry.checkOut) {
      alert("You've already timed out for the day.");
      return;
    }
    if (entry.mealStart) return;
    if (onApprovedPtoToday) {
      alert(ptoBlockMessage);
      return;
    }
    if (!mealEligible) {
      alert(
        (requiredCheckIn && requiredCheckOut) || workingHours
          ? `Meal break is only available for scheduled shifts of more than 6 hours. Your scheduled shift is ${scheduledShift.toFixed(1)} hours.`
          : "No scheduled shift is set for your account. Contact your admin to set your required schedule."
      );
      return;
    }
    withLock(() => void persistPunch("mealStart"));
  };

  const handleMealOut = () => {
    if (entry.checkOut) {
      alert("You've already timed out for the day.");
      return;
    }
    if (!entry.mealStart || entry.mealEnd) return;
    if (onApprovedPtoToday) {
      alert(ptoBlockMessage);
      return;
    }
    withLock(() => void persistPunch("mealEnd"));
  };

  const btnClass = "rounded-full px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed whitespace-nowrap";
  // Dimming (disabled:opacity-30) only belongs on a button that's blocked
  // and hasn't recorded anything yet (e.g. Meal Out before Meal In) — once a
  // step is actually punched, its time should stay fully legible instead of
  // fading like an unavailable button.
  const blockedDim = "disabled:opacity-30";

  // Once a step is punched, its slot becomes a plain (non-button) pill with
  // the recorded time — plus a small X to self-correct a stray tap, shown
  // only while canEditPunch(entry, field) says it's still the most-recently
  // -made punch (see that function's doc comment for the chain rule). Not a
  // <button> itself since a real button can't nest the X's own button.
  // Tapping the X doesn't remove it immediately — it swaps the pill to an
  // inline "Remove? Yes/No" prompt; that Yes tap is the real confirmation.
  const renderPunchedPill = (field: PunchField, time: string, colorClass: string, title: string) => {
    if (confirmClearField === field) {
      return (
        <span className={`${btnClass} ${colorClass} inline-flex items-center gap-1`}>
          Remove?
          <button
            type="button"
            onClick={() => handleClearPunch(field)}
            disabled={clearingField !== null}
            className="rounded-full bg-black/25 px-1.5 py-0.5 text-[11px] font-bold hover:bg-black/35 disabled:opacity-50"
          >
            {clearingField === field ? "…" : "Yes"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmClearField(null)}
            className="rounded-full px-1.5 py-0.5 text-[11px] font-bold opacity-70 hover:bg-black/20 hover:opacity-100"
          >
            No
          </button>
        </span>
      );
    }
    return (
      <span className={`${btnClass} ${colorClass} inline-flex items-center gap-1`} title={title}>
        {fmtTime(time)}
        {canEditPunch(entry, field) && (
          <button
            type="button"
            onClick={() => setConfirmClearField(field)}
            disabled={clearingField !== null}
            title={`Remove ${PUNCH_LABEL[field]}`}
            aria-label={`Remove ${PUNCH_LABEL[field]}`}
            className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full opacity-60 transition-opacity hover:bg-black/20 hover:opacity-100 disabled:opacity-30"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </span>
    );
  };

  return (
    <div className="flex h-9 items-center gap-1 rounded-full border border-[var(--color-panel-border)] bg-[var(--color-panel)] px-1">
      {entry.checkIn ? (
        renderPunchedPill("checkIn", entry.checkIn, "text-green-300", `Timed in at ${fmtTime(entry.checkIn)}`)
      ) : (
        <button
          type="button"
          onClick={handleTimeIn}
          disabled={saving || locked || onApprovedPtoToday}
          title={onApprovedPtoToday ? "You have an approved PTO for today" : "Time In"}
          className={`${btnClass} text-green-300 hover:bg-green-500/15 ${blockedDim}`}
        >
          {onApprovedPtoToday ? "On PTO" : "Time In"}
        </button>
      )}
      {mealEligible && (
        entry.mealStart ? (
          renderPunchedPill("mealStart", entry.mealStart, "text-orange-300", `Meal started at ${fmtTime(entry.mealStart)}`)
        ) : (
          <button
            type="button"
            onClick={handleMealIn}
            disabled={saving || locked || !entry.checkIn || !!entry.checkOut || onApprovedPtoToday}
            title={onApprovedPtoToday ? "You have an approved PTO for today" : "Meal In"}
            className={`${btnClass} text-orange-300 hover:bg-orange-500/15 ${blockedDim}`}
          >
            Meal In
          </button>
        )
      )}
      {mealEligible && (
        entry.mealEnd ? (
          renderPunchedPill("mealEnd", entry.mealEnd, "text-orange-300", `Meal ended at ${fmtTime(entry.mealEnd)}`)
        ) : (
          <button
            type="button"
            onClick={handleMealOut}
            disabled={saving || locked || !!entry.checkOut || !entry.mealStart || onApprovedPtoToday}
            title={onApprovedPtoToday ? "You have an approved PTO for today" : "Meal Out"}
            className={`${btnClass} text-orange-300 hover:bg-orange-500/15 ${blockedDim}`}
          >
            Meal Out
          </button>
        )
      )}
      {entry.checkOut ? (
        renderPunchedPill("checkOut", entry.checkOut, "text-red-300", `Timed out at ${fmtTime(entry.checkOut)}`)
      ) : (
        <button
          type="button"
          onClick={handleTimeOut}
          disabled={saving || locked || !entry.checkIn || onApprovedPtoToday}
          title={onApprovedPtoToday ? "You have an approved PTO for today" : "Time Out"}
          className={`${btnClass} text-red-300 hover:bg-red-500/15 ${blockedDim}`}
        >
          Time Out
        </button>
      )}
      {employmentType === "trainee" && traineeStatus && traineeStatus !== "approved" && (
        <span
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${
            traineeStatus === "rejected" ? "bg-red-500/20 text-red-300" : "bg-sky-500/20 text-sky-300"
          }`}
          title={
            traineeStatus === "rejected"
              ? "Your manager sent this day back — check the reason on Attendance Monitoring and punch again to resubmit."
              : "Trainee timecard — pending your manager's approval before it counts as your actual timecard."
          }
        >
          <Clock3 className="h-3.5 w-3.5" />
        </span>
      )}
    </div>
  );
}
