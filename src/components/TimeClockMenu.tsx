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
 * Once a step is punched, its recorded time is stamped permanently
 * underneath that button (read straight from the saved entry, not a
 * transient toast) — so it stays visible/correct even after a refresh.
 */
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { getMyProfileSchedule, getEntryForDate, saveEntry, resolveScheduledShiftHours, type UITimeEntry } from "@/lib/supabase/timecards";
import { getCompanyPtoRequests } from "@/lib/supabase/pto";

const EMPTY_ENTRY: UITimeEntry = { checkIn: "", checkOut: "", mealStart: "", mealEnd: "", notes: "" };

function todayKey(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

function nowTime(): string {
  const t = new Date();
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
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
    });
    return () => { cancelled = true; };
  }, [ready, uid]);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    getEntryForDate(profileId, todayKey())
      .then((e) => { if (!cancelled) setEntry(e ?? EMPTY_ENTRY); })
      .catch((err) => console.error("Failed to load today's timecard entry:", err));
    return () => { cancelled = true; };
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

  const persist = async (next: UITimeEntry) => {
    if (!profileId) return;
    setSaving(true);
    setEntry(next);
    try {
      await saveEntry(profileId, todayKey(), next);
    } catch (err) {
      console.error("Failed to save time punch:", err);
      alert(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
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
    withLock(() => void persist({ ...entry, checkIn: nowTime() }));
  };

  const handleTimeOut = () => {
    if (!entry.checkIn || entry.checkOut) return;
    if (onApprovedPtoToday) {
      alert(ptoBlockMessage);
      return;
    }
    withLock(() => void persist({ ...entry, checkOut: nowTime() }));
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
    withLock(() => void persist({ ...entry, mealStart: nowTime() }));
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
    withLock(() => void persist({ ...entry, mealEnd: nowTime() }));
  };

  const btnClass =
    "rounded-full px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-30";
  // Stamps are absolutely positioned (not stacked in normal flow) so this
  // component's box stays exactly h-9, same as every other header icon.
  // ModuleNavigator.tsx (and the mobile ticket page's tab strip) both
  // hardcode an assumed header height and float/stick relative to it — if
  // this grew the header's actual rendered height, those would silently
  // start overlapping the header on every page.
  const stampClass = "pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold";

  return (
    <div className="flex h-9 items-center gap-1 rounded-full border border-[var(--color-panel-border)] bg-[var(--color-panel)] px-1">
      <div className="relative">
        <button
          type="button"
          onClick={handleTimeIn}
          disabled={saving || locked || !!entry.checkIn || onApprovedPtoToday}
          title={onApprovedPtoToday ? "You have an approved PTO for today" : undefined}
          className={`${btnClass} text-green-300 hover:bg-green-500/15`}
        >
          Time In
        </button>
        {entry.checkIn && <span className={`${stampClass} text-green-300/80`}>{fmtTime(entry.checkIn)}</span>}
        {!entry.checkIn && onApprovedPtoToday && <span className={`${stampClass} text-purple-300/80`}>On PTO</span>}
      </div>
      {mealEligible && (
        <div className="relative">
          <button
            type="button"
            onClick={handleMealIn}
            disabled={saving || locked || !entry.checkIn || !!entry.checkOut || !!entry.mealStart || onApprovedPtoToday}
            title={onApprovedPtoToday ? "You have an approved PTO for today" : undefined}
            className={`${btnClass} text-orange-300 hover:bg-orange-500/15`}
          >
            Meal In
          </button>
          {entry.mealStart && <span className={`${stampClass} text-orange-300/80`}>{fmtTime(entry.mealStart)}</span>}
        </div>
      )}
      {mealEligible && (
        <div className="relative">
          <button
            type="button"
            onClick={handleMealOut}
            disabled={saving || locked || !!entry.checkOut || !entry.mealStart || !!entry.mealEnd || onApprovedPtoToday}
            title={onApprovedPtoToday ? "You have an approved PTO for today" : undefined}
            className={`${btnClass} text-orange-300 hover:bg-orange-500/15`}
          >
            Meal Out
          </button>
          {entry.mealEnd && <span className={`${stampClass} text-orange-300/80`}>{fmtTime(entry.mealEnd)}</span>}
        </div>
      )}
      <div className="relative">
        <button
          type="button"
          onClick={handleTimeOut}
          disabled={saving || locked || !entry.checkIn || !!entry.checkOut || onApprovedPtoToday}
          title={onApprovedPtoToday ? "You have an approved PTO for today" : undefined}
          className={`${btnClass} text-red-300 hover:bg-red-500/15`}
        >
          Time Out
        </button>
        {entry.checkOut && <span className={`${stampClass} text-red-300/80`}>{fmtTime(entry.checkOut)}</span>}
      </div>
    </div>
  );
}
