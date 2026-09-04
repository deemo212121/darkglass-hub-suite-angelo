/**
 * Trainee pending timecard entries (migration 0216) — a trainee
 * (profiles.employment_type = 'trainee') punches in/out on the exact same
 * screens every other employee uses (TimeClockMenu, My Timecard, mobile
 * Home's ClockCard), but those writes land here instead of the real
 * timecard_entries, until their direct manager approves the day from
 * Attendance Monitoring's "Trainee Attendance" tab (see approveTraineeDay,
 * which then writes onto the real timecard_entries via the existing
 * saveEntry — same reused-not-reimplemented pattern
 * technicianCheckoutProposals.ts's approveCheckoutProposal already uses).
 */
import { supabase } from "./client";
import { getEntryForDate, saveEntry, type UITimeEntry, type PunchField } from "./timecards";
import { getCompanyUsers } from "./users";
import { createNotification } from "./notifications";
import { isAttendanceFullAccessRole, isTraineeFallbackReviewerRole } from "@/lib/roleLabels";

/** Same deep-link convention timecard_corrections' own notifications already
 *  use (see reviewCorrectionStage) — the bell-icon notification list keys
 *  off this exact link_to to know "this is a trainee clock-in", since the
 *  plain notifications table has no separate type/category column. (The
 *  review UI itself — mobile's TraineeAttendanceMobileModal, desktop's
 *  TraineeAttendanceReviewModal — no longer reacts to this notification
 *  directly; both instead trigger off the REVIEWER's own Check Out, see
 *  SELF_CHECKED_OUT_EVENT below.) */
export const TRAINEE_ATTENDANCE_LINK = "/m/dashboard/attendance-monitoring?tab=trainee-attendance";

/**
 * Fired on `window` the instant the CURRENT viewer's own Check Out just
 * saved successfully — from TimeClockMenu.tsx (header widget) and
 * routes/timecard.tsx (My Timecard modal's Save). TraineeAttendanceReviewModal.tsx
 * listens for this to surface any pending trainee day this viewer can
 * approve, right at their own end-of-shift instead of the instant a trainee
 * clocks in — same "review once, at your own sign-out" convention mobile's
 * TraineeAttendanceMobileModal already uses (there it's plain props/state
 * instead of a DOM event, since mobile is one component tree; desktop's
 * two punch surfaces aren't, so a window event is the simplest way for
 * either one to reach the modal mounted in __root.tsx).
 */
export const SELF_CHECKED_OUT_EVENT = "ahs:self-checked-out";

export type TraineeTimecardStatus = "pending" | "approved" | "rejected";

export interface TraineeTimecardEntry {
  id: string;
  profileId: string;
  workDate: string;
  checkIn: string;
  checkOut: string;
  mealStart: string;
  mealEnd: string;
  status: TraineeTimecardStatus;
  managerId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
}

const ROW_COLUMNS = "id, profile_id, work_date, check_in, check_out, meal_start, meal_end, status, manager_id, reviewed_by, reviewed_at, reject_reason";
const PAGE_SIZE = 1000;

function mapRow(r: any): TraineeTimecardEntry {
  return {
    id: r.id,
    profileId: r.profile_id,
    workDate: r.work_date,
    checkIn: r.check_in ?? "",
    checkOut: r.check_out ?? "",
    mealStart: r.meal_start ?? "",
    mealEnd: r.meal_end ?? "",
    status: r.status,
    managerId: r.manager_id ?? null,
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: r.reviewed_at ?? null,
    rejectReason: r.reject_reason ?? null,
  };
}

/** Mirrors getEntryForDate (timecards.ts) — a trainee's own pending day, for their own punch card/modal. */
export async function getTraineeEntryForDate(profileId: string, workDate: string): Promise<TraineeTimecardEntry | null> {
  const { data, error } = await supabase
    .from("trainee_timecard_entries")
    .select(ROW_COLUMNS)
    .eq("profile_id", profileId)
    .eq("work_date", workDate)
    .maybeSingle();
  if (error) {
    console.error("getTraineeEntryForDate error:", error.message);
    throw new Error(error.message);
  }
  return data ? mapRow(data) : null;
}

const PUNCH_COLUMN: Record<PunchField, string> = {
  checkIn: "check_in",
  checkOut: "check_out",
  mealStart: "meal_start",
  mealEnd: "meal_end",
};

/**
 * Stamp ONE punch column for a trainee's day — same single-column-upsert
 * safety as savePunch (timecards.ts): never re-writes the sibling columns
 * from a possibly-stale local copy. `managerId` (resolved via
 * resolveTeamLeadOrManager by the caller) is only ever written on first
 * insert for the day — PostgREST's upsert only touches columns present in
 * the payload, so it's included every call but harmless once already set,
 * since it isn't overwritten to a different value mid-day. Resets status
 * back to "pending" whenever it was "rejected", so a trainee can just
 * re-punch to correct a rejected day instead of a separate "resubmit"
 * action; left alone once "approved" — the day is done, a mistake found
 * after approval goes through the normal Time Correction request instead.
 */
export async function saveTraineePunch(
  profileId: string,
  workDate: string,
  field: PunchField,
  time: string,
  managerId: string | null
): Promise<void> {
  const column = PUNCH_COLUMN[field];
  const existing = await getTraineeEntryForDate(profileId, workDate);
  const { error } = await supabase
    .from("trainee_timecard_entries")
    .upsert(
      {
        profile_id: profileId,
        work_date: workDate,
        [column]: time,
        manager_id: managerId,
        ...(existing?.status === "rejected" ? { status: "pending", reviewed_by: null, reviewed_at: null, reject_reason: null } : {}),
      },
      { onConflict: "profile_id,work_date" }
    );
  if (error) {
    console.error("saveTraineePunch error:", error.message);
    throw new Error(error.message);
  }
  // "Clock in" specifically, not every punch — this is the moment their
  // manager actually needs to know a day exists to review at all. Fire
  // once the write's already committed and best-effort (a notify failure
  // must never make the punch itself look like it failed).
  if (field === "checkIn") void notifyTraineeClockIn(profileId, managerId, workDate).catch((err) => console.error("Failed to notify of trainee clock-in:", err));
}

/**
 * Pings the trainee's resolved direct manager (or, if none resolved yet —
 * manager_name unset/not matched — every active Admin/HR/Finance/SuperAdmin,
 * same fan-out convention timecard_corrections uses when there's nobody
 * more specific to tell) that a trainee day now exists to review. Lands in
 * the bell-icon notification list (keyed off TRAINEE_ATTENDANCE_LINK) for
 * history/audit purposes — the actual review popups no longer watch this
 * table directly, see SELF_CHECKED_OUT_EVENT's doc comment.
 */
async function notifyTraineeClockIn(profileId: string, managerId: string | null, workDate: string): Promise<void> {
  const roster = await getCompanyUsers();
  const trainee = roster.find((p) => p.id === profileId);
  const traineeName = trainee?.display_name || "A trainee";
  const recipients = managerId
    ? roster.filter((p) => p.id === managerId && p.is_active)
    : roster.filter(
        (p) =>
          p.id !== profileId &&
          p.is_active &&
          (isAttendanceFullAccessRole(p.role, p.extra_roles) || isTraineeFallbackReviewerRole(p.role, p.extra_roles))
      );
  await Promise.all(
    recipients.map((r) =>
      createNotification({
        recipientId: r.id,
        senderId: null,
        senderName: null,
        body: `⏱️ ${traineeName} clocked in (${workDate}) — pending your approval on their trainee timecard.`,
        linkTo: TRAINEE_ATTENDANCE_LINK,
      })
    )
  );
}

/**
 * Mirrors saveEntry (timecards.ts) — a full-day upsert, for the desktop My
 * Timecard modal's "Save" button (which stages every punch locally as the
 * technician toggles Time In/Out and Meal In/Out, then persists the whole
 * day at once, unlike TimeClockMenu/mobile's per-punch immediate save).
 * Same "reset a rejected day back to pending" rule as saveTraineePunch.
 */
export async function saveTraineeEntry(
  profileId: string,
  workDate: string,
  entry: UITimeEntry,
  managerId: string | null
): Promise<void> {
  const existing = await getTraineeEntryForDate(profileId, workDate);
  const { error } = await supabase
    .from("trainee_timecard_entries")
    .upsert(
      {
        profile_id: profileId,
        work_date: workDate,
        check_in: entry.checkIn || null,
        check_out: entry.checkOut || null,
        meal_start: entry.mealStart || null,
        meal_end: entry.mealEnd || null,
        manager_id: managerId,
        ...(existing?.status === "rejected" ? { status: "pending", reviewed_by: null, reviewed_at: null, reject_reason: null } : {}),
      },
      { onConflict: "profile_id,work_date" }
    );
  if (error) {
    console.error("saveTraineeEntry error:", error.message);
    throw new Error(error.message);
  }
}

/** Mirrors deleteEntry (timecards.ts) — removes a trainee's own pending day outright (only ever reachable for today, before it's been approved). */
export async function deleteTraineeEntry(profileId: string, workDate: string): Promise<void> {
  const { error } = await supabase
    .from("trainee_timecard_entries")
    .delete()
    .eq("profile_id", profileId)
    .eq("work_date", workDate);
  if (error) {
    console.error("deleteTraineeEntry error:", error.message);
    throw new Error(error.message);
  }
}

/** Mirrors clearPunch (timecards.ts) — reused with the same canEditPunch cascade rule. */
export async function clearTraineePunch(profileId: string, workDate: string, field: PunchField): Promise<void> {
  const column = PUNCH_COLUMN[field];
  const { error } = await supabase
    .from("trainee_timecard_entries")
    .upsert(
      { profile_id: profileId, work_date: workDate, [column]: null },
      { onConflict: "profile_id,work_date" }
    );
  if (error) {
    console.error("clearTraineePunch error:", error.message);
    throw new Error(error.message);
  }
}

/** Every trainee entry for the caller's company (RLS-scoped), optionally bounded by work_date — for the Trainee Attendance tab. */
export async function getCompanyTraineeEntries(dateFrom?: string, dateTo?: string): Promise<TraineeTimecardEntry[]> {
  const all: TraineeTimecardEntry[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from("trainee_timecard_entries").select(ROW_COLUMNS).order("work_date", { ascending: false }).order("id", { ascending: true });
    if (dateFrom) query = query.gte("work_date", dateFrom);
    if (dateTo) query = query.lte("work_date", dateTo);
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("getCompanyTraineeEntries error:", error.message);
      return all;
    }
    all.push(...(data ?? []).map(mapRow));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * Who may Approve/Reject this specific trainee day from the Trainee
 * Attendance TAB — their one resolved direct manager (managerId, stamped at
 * first punch — see saveTraineePunch), or the fallback reviewers for when
 * that manager is out: Admin/HR/SuperAdmin/Finance (isAttendanceFullAccessRole)
 * or Senior Branch Manager (isTraineeFallbackReviewerRole) — same convention
 * timecard_corrections' canReviewCorrectionStage already uses for its own
 * manager stage. RLS itself is deliberately permissive (company-scoped
 * only) — this is the real authorization check, enforced client-side
 * before the Approve/Reject buttons are ever shown.
 *
 * Deliberately WIDER than isDirectTraineeManager below — that one gates the
 * blocking review POPUP, which per the user's explicit call must stay
 * exclusive to the trainee's actual manager so a fallback reviewer is never
 * forced into an unclosable screen for someone else's trainee. Both
 * checks share this same tab as their always-available fallback surface.
 */
export function canApproveTraineeDay(
  entry: Pick<TraineeTimecardEntry, "managerId">,
  viewerProfileId: string | null,
  viewerRole: string | null,
  viewerExtraRoles: string[] | null | undefined
): boolean {
  if (isAttendanceFullAccessRole(viewerRole, viewerExtraRoles)) return true;
  if (isTraineeFallbackReviewerRole(viewerRole, viewerExtraRoles)) return true;
  return !!viewerProfileId && entry.managerId === viewerProfileId;
}

/**
 * Popup-eligibility — narrower than canApproveTraineeDay on purpose. The
 * blocking review popup (mobile's TraineeAttendanceMobileModal, desktop's
 * TraineeAttendanceReviewModal — both trigger off the viewer's own Check
 * Out, see SELF_CHECKED_OUT_EVENT) must interrupt ONLY the trainee's own
 * resolved direct manager. Fallback reviewers (Admin/HR/SuperAdmin/Finance,
 * Senior Branch Manager) can still act from the Trainee Attendance tab when
 * the real manager is out, but must never be forced into an unclosable
 * screen for a trainee that isn't theirs.
 */
export function isDirectTraineeManager(
  entry: Pick<TraineeTimecardEntry, "managerId">,
  viewerProfileId: string | null
): boolean {
  return !!viewerProfileId && entry.managerId === viewerProfileId;
}

/**
 * Approves a trainee's day: copies its punches onto their REAL
 * timecard_entries row via the existing saveEntry (preserving any existing
 * notes on that row untouched), then marks this row approved. Mirrors
 * approveCheckoutProposal (technicianCheckoutProposals.ts) exactly.
 */
export async function approveTraineeDay(entry: TraineeTimecardEntry, approvedByProfileId: string): Promise<void> {
  const existing = await getEntryForDate(entry.profileId, entry.workDate);
  const merged: UITimeEntry = {
    checkIn: entry.checkIn || existing?.checkIn || "",
    checkOut: entry.checkOut || existing?.checkOut || "",
    mealStart: entry.mealStart || existing?.mealStart || "",
    mealEnd: entry.mealEnd || existing?.mealEnd || "",
    notes: existing?.notes ?? "",
  };
  await saveEntry(entry.profileId, entry.workDate, merged);
  const { error } = await supabase
    .from("trainee_timecard_entries")
    .update({ status: "approved", reviewed_by: approvedByProfileId, reviewed_at: new Date().toISOString(), reject_reason: null })
    .eq("id", entry.id);
  if (error) throw new Error(error.message);
}

/** Rejects a trainee's day — does NOT touch the real timecard. The row stays visible with the reason; the trainee re-punching resets it back to "pending" (see saveTraineePunch). */
export async function rejectTraineeDay(entryId: string, reviewedByProfileId: string, reason: string): Promise<void> {
  const { error } = await supabase
    .from("trainee_timecard_entries")
    .update({ status: "rejected", reviewed_by: reviewedByProfileId, reviewed_at: new Date().toISOString(), reject_reason: reason.trim() || null })
    .eq("id", entryId);
  if (error) throw new Error(error.message);
}

/**
 * A manager marking a day rejected THEMSELVES — e.g. "Absent" — for a
 * trainee who never punched at all, so there's no existing row for
 * rejectTraineeDay to update. Used by the Trainee Attendance tab's
 * placeholder rows ("No punch in this date range yet."), which otherwise
 * had no editable status. Creates the row already in "rejected", same
 * reason categories as a normal reject; the trainee re-punching still
 * resets it back to "pending" same as any other rejected day.
 */
export async function recordTraineeDayWithoutPunch(
  profileId: string,
  workDate: string,
  managerId: string | null,
  reviewedByProfileId: string,
  reason: string
): Promise<void> {
  const { error } = await supabase
    .from("trainee_timecard_entries")
    .upsert(
      {
        profile_id: profileId,
        work_date: workDate,
        manager_id: managerId,
        status: "rejected",
        reviewed_by: reviewedByProfileId,
        reviewed_at: new Date().toISOString(),
        reject_reason: reason.trim() || null,
      },
      { onConflict: "profile_id,work_date" }
    );
  if (error) {
    console.error("recordTraineeDayWithoutPunch error:", error.message);
    throw new Error(error.message);
  }
}
