/**
 * Supabase PTO requests service — Attendance Monitoring "PTO Management" tab
 * and Employee Self-Service "Manage Requests" tab.
 * Rows are keyed by profile_id (see migration 0027), company-scoped by RLS.
 *
 * PTO requests are staged: manager first (see migration 0036), then EITHER
 * HR or Accounting (Finance) gives the final approval — an OR gate, added by
 * migration 0057 (see canReviewPtoStage/reviewPtoStage below), mirroring
 * timecard-correction's manager+(HR or Accounting) pattern.
 * manager_status/hr_status/accounting_status are tracked separately; the
 * overall `status` column is derived from them by a DB trigger (a rejection
 * at any stage immediately denies the whole request).
 */

import { supabase } from "./client";
import { createNotification } from "./notifications";
import { getCompanyUsers } from "./users";

export type PtoType = "vacation" | "sick" | "personal" | "holiday" | "unpaid" | "bereavement";
export type PtoStatus = "pending" | "approved" | "denied" | "cancelled";
export type PtoStageStatus = "pending" | "approved" | "rejected";
export type PtoStage = "manager" | "hr" | "accounting";

/** Sick Leave is always unpaid and never credited to payroll — separate from every other leave type, which defaults to paid unless explicitly `unpaid`. */
export function isPaidPtoType(ptoType: PtoType): boolean {
  return ptoType !== "unpaid" && ptoType !== "sick";
}

/**
 * Employees need 1 year of tenure before they're eligible for PTO. Tenure is
 * measured from profiles.employee_info.hireDate if HR has set one, falling
 * back to the profile's created_at (same fallback ReportHRDaily.tsx uses)
 * since every profile has that regardless of whether hireDate was filled in.
 */
export function ptoEligibleDate(hireDate: string | null | undefined, createdAt: string | null | undefined): string | null {
  const base = (hireDate || createdAt || "").slice(0, 10);
  if (!base) return null;
  const d = new Date(base + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/** True once the employee has reached 1 year of tenure (see ptoEligibleDate). */
export function isEligibleForPto(hireDate: string | null | undefined, createdAt: string | null | undefined): boolean {
  const eligibleDate = ptoEligibleDate(hireDate, createdAt);
  if (!eligibleDate) return true;
  return new Date().toISOString().slice(0, 10) >= eligibleDate;
}

/**
 * Annual PTO allowance by tenure year. Tenure year 1 is the employee's first
 * PTO-eligible year (the year starting at their 1-year hire anniversary) and
 * grants 5 days; each following tenure year adds 1 (year 2 -> 6, year 3 -> 7,
 * ...), uncapped, per HR policy. `unpaid` PTO doesn't draw against this — it
 * exists for time off once the allowance is exhausted.
 */
export function ptoAllowanceForTenureYear(tenureYear: number): number {
  return tenureYear < 1 ? 0 : 4 + tenureYear;
}

/** How many whole years have elapsed from `from` to `to` (anniversary-based, not calendar-year). */
function fullYearsElapsed(from: Date, to: Date): number {
  let years = to.getFullYear() - from.getFullYear();
  const fromMonthDay = from.getMonth() * 100 + from.getDate();
  const toMonthDay = to.getMonth() * 100 + to.getDate();
  if (toMonthDay < fromMonthDay) years -= 1;
  return years;
}

export interface PtoYearWindow {
  tenureYear: number;
  start: string; // "YYYY-MM-DD", inclusive
  end: string; // "YYYY-MM-DD", exclusive — the next anniversary
  allowance: number;
}

/**
 * Which PTO tenure-year `onDate` falls in, anchored to the employee's hire
 * anniversary (not the calendar year) — so the allowance resets on their
 * anniversary each year, not every Jan 1. Returns null before the employee
 * is PTO-eligible (see isEligibleForPto).
 */
export function ptoYearWindow(
  hireDate: string | null | undefined,
  createdAt: string | null | undefined,
  onDate: string = new Date().toISOString().slice(0, 10)
): PtoYearWindow | null {
  const base = (hireDate || createdAt || "").slice(0, 10);
  if (!base) return null;
  const hire = new Date(base + "T00:00:00");
  const target = new Date(onDate + "T00:00:00");
  if (Number.isNaN(hire.getTime()) || Number.isNaN(target.getTime())) return null;

  const tenureYear = fullYearsElapsed(hire, target);
  if (tenureYear < 1) return null;

  const start = new Date(hire);
  start.setFullYear(hire.getFullYear() + tenureYear);
  const end = new Date(hire);
  end.setFullYear(hire.getFullYear() + tenureYear + 1);

  return {
    tenureYear,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    allowance: ptoAllowanceForTenureYear(tenureYear),
  };
}

/**
 * Requests that count against a PTO (vacation) year window — pending or
 * approved, dated inside the window, excluding `unpaid` (which doesn't draw
 * against the allowance) and `sick` (which draws against its own separate
 * Sick Leave allowance instead — see sickRequestsInYear below).
 */
export function ptoRequestsInYear<T extends Pick<PtoRequestRow, "ptoType" | "status" | "startDate" | "hoursRequested">>(
  requests: T[],
  window: Pick<PtoYearWindow, "start" | "end">
): T[] {
  return requests.filter(
    (r) =>
      r.ptoType !== "unpaid" &&
      r.ptoType !== "sick" &&
      r.status !== "denied" &&
      r.status !== "cancelled" &&
      r.startDate >= window.start &&
      r.startDate < window.end
  );
}

/** Days already spoken for (pending or approved) inside a PTO (vacation) year window. */
export function ptoDaysUsed(
  requests: Pick<PtoRequestRow, "ptoType" | "status" | "startDate" | "hoursRequested">[],
  window: Pick<PtoYearWindow, "start" | "end">
): number {
  return ptoRequestsInYear(requests, window).reduce((sum, r) => sum + r.hoursRequested / 8, 0);
}

/**
 * Sick Leave is its own allowance, entirely separate from vacation PTO:
 * available from day 1 of employment (no 1-year wait), flat at 5 days every
 * tenure year (never increments like vacation does), and always unpaid (see
 * isPaidPtoType) — so it's tracked with its own window/allowance/usage
 * functions rather than folding into ptoYearWindow/ptoDaysUsed above.
 */
export const SICK_LEAVE_ANNUAL_ALLOWANCE = 5;

export interface SickYearWindow {
  /** 0 = the employee's first year, 1 = second year, etc. — unlike PtoYearWindow, year 0 is valid since Sick Leave has no eligibility wait. */
  tenureYear: number;
  start: string; // "YYYY-MM-DD", inclusive
  end: string; // "YYYY-MM-DD", exclusive — the next anniversary
  allowance: number;
}

/** Which Sick Leave tenure-year `onDate` falls in, anchored to the employee's hire anniversary. Unlike ptoYearWindow, this never returns null for tenure — only when there's no hire/created date to anchor to at all. */
export function sickYearWindow(
  hireDate: string | null | undefined,
  createdAt: string | null | undefined,
  onDate: string = new Date().toISOString().slice(0, 10)
): SickYearWindow | null {
  const base = (hireDate || createdAt || "").slice(0, 10);
  if (!base) return null;
  const hire = new Date(base + "T00:00:00");
  const target = new Date(onDate + "T00:00:00");
  if (Number.isNaN(hire.getTime()) || Number.isNaN(target.getTime())) return null;

  const tenureYear = Math.max(0, fullYearsElapsed(hire, target));
  const start = new Date(hire);
  start.setFullYear(hire.getFullYear() + tenureYear);
  const end = new Date(hire);
  end.setFullYear(hire.getFullYear() + tenureYear + 1);

  return {
    tenureYear,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    allowance: SICK_LEAVE_ANNUAL_ALLOWANCE,
  };
}

/** Sick Leave requests (pending or approved) dated inside a Sick Leave year window. */
export function sickRequestsInYear<T extends Pick<PtoRequestRow, "ptoType" | "status" | "startDate" | "hoursRequested">>(
  requests: T[],
  window: Pick<SickYearWindow, "start" | "end">
): T[] {
  return requests.filter(
    (r) =>
      r.ptoType === "sick" &&
      r.status !== "denied" &&
      r.status !== "cancelled" &&
      r.startDate >= window.start &&
      r.startDate < window.end
  );
}

/** Sick Leave days already spoken for (pending or approved) inside a Sick Leave year window. */
export function sickDaysUsed(
  requests: Pick<PtoRequestRow, "ptoType" | "status" | "startDate" | "hoursRequested">[],
  window: Pick<SickYearWindow, "start" | "end">
): number {
  return sickRequestsInYear(requests, window).reduce((sum, r) => sum + r.hoursRequested / 8, 0);
}

export interface PtoRequestRow {
  id: string;
  profileId: string;
  ptoType: PtoType;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;
  hoursRequested: number;
  reason: string;
  status: PtoStatus;
  requestedBy: string | null;
  managerId: string | null;
  managerStatus: PtoStageStatus;
  managerReviewedBy: string | null;
  managerReviewedAt: string | null;
  hrStatus: PtoStageStatus;
  hrReviewedBy: string | null;
  hrReviewedAt: string | null;
  accountingStatus: PtoStageStatus;
  accountingReviewedBy: string | null;
  accountingReviewedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

const SELECT_COLUMNS =
  "id, profile_id, pto_type, start_date, end_date, hours_requested, reason, status, requested_by, manager_id, manager_status, manager_reviewed_by, manager_reviewed_at, hr_status, hr_reviewed_by, hr_reviewed_at, accounting_status, accounting_reviewed_by, accounting_reviewed_at, reviewed_by, reviewed_at, review_note, created_at";

function mapRow(row: any): PtoRequestRow {
  return {
    id: row.id,
    profileId: row.profile_id,
    ptoType: row.pto_type,
    startDate: row.start_date,
    endDate: row.end_date,
    hoursRequested: Number(row.hours_requested) || 0,
    reason: row.reason ?? "",
    status: row.status,
    requestedBy: row.requested_by ?? null,
    managerId: row.manager_id ?? null,
    managerStatus: row.manager_status,
    managerReviewedBy: row.manager_reviewed_by ?? null,
    managerReviewedAt: row.manager_reviewed_at ?? null,
    hrStatus: row.hr_status,
    hrReviewedBy: row.hr_reviewed_by ?? null,
    hrReviewedAt: row.hr_reviewed_at ?? null,
    accountingStatus: row.accounting_status,
    accountingReviewedBy: row.accounting_reviewed_by ?? null,
    accountingReviewedAt: row.accounting_reviewed_at ?? null,
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewNote: row.review_note ?? null,
    createdAt: row.created_at,
  };
}

/** All PTO requests for the caller's company (RLS-scoped), newest first. */
export async function getCompanyPtoRequests(): Promise<PtoRequestRow[]> {
  const { data, error } = await supabase
    .from("pto_requests")
    .select(SELECT_COLUMNS)
    .not("profile_id", "is", null)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getCompanyPtoRequests error:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

/**
 * Can `viewerProfileId` (with `viewerRole`) act on the given approval stage?
 * The manager stage is for the specific resolved manager (or anyone with
 * the generic MANAGER role as a stand-in if none was resolved) and is the
 * ONLY stage open while the request is fresh — HR and Accounting can't act
 * (or even see an actionable button) until the manager has approved first;
 * a request the manager hasn't touched yet must not be approvable/rejectable
 * by HR/Accounting just because they also happen to have access to this
 * screen. Once the manager approves, HR and Accounting can each
 * independently approve or reject (an OR gate — whichever acts first
 * decides it, mirroring canReviewCorrectionStage's timecard-correction
 * pattern). Being an ADMIN does NOT grant access to every stage — an admin
 * who happens to be someone's manager can still only act as manager, not
 * also as HR/Accounting. Both SUPERADMIN (a company's own top-tier admin)
 * and SUPERSUPERADMIN (the platform-level role) bypass this entirely — a
 * single approval from either is final, no separate manager+HR/Accounting
 * sign-off needed.
 */
export function canReviewPtoStage(
  request: Pick<PtoRequestRow, "managerId" | "managerStatus">,
  stage: PtoStage,
  viewerProfileId: string | null,
  viewerRole: string | null | undefined,
  viewerExtraRoles?: string[] | null
): boolean {
  // Held roles pile up: a secondary HR/FINANCE/MANAGER role grants that
  // stage's authority just as well as holding it as the primary role.
  const heldRoles = [viewerRole, ...(viewerExtraRoles ?? [])].map((r) => (r || "").toUpperCase()).filter(Boolean);
  const has = (r: string) => heldRoles.includes(r);
  if (has("SUPERADMIN") || has("SUPERSUPERADMIN")) return true;
  if (stage === "manager") {
    if (request.managerId) return request.managerId === viewerProfileId;
    return has("MANAGER");
  }
  if (request.managerStatus !== "approved") return false;
  if (stage === "hr") return has("HR");
  return has("FINANCE");
}

/** Count weekdays (Mon–Fri) in an inclusive date range — used for the default hours estimate. */
export function weekdayCount(startDate: string, endDate: string): number {
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return Math.max(1, count);
}

/** Submit a new PTO request on behalf of an employee (profileId). */
export async function createPtoRequest(input: {
  profileId: string;
  ptoType: PtoType;
  startDate: string;
  endDate: string;
  reason: string;
  requestedBy: string | null;
  managerId?: string | null;
}): Promise<void> {
  const hoursRequested = weekdayCount(input.startDate, input.endDate) * 8;
  const { error } = await supabase.from("pto_requests").insert({
    profile_id: input.profileId,
    pto_type: input.ptoType,
    start_date: input.startDate,
    end_date: input.endDate,
    hours_requested: hoursRequested,
    reason: input.reason || null,
    status: "pending",
    requested_by: input.requestedBy,
    manager_id: input.managerId ?? null,
  });
  if (error) {
    console.error("createPtoRequest error:", error.message);
    throw new Error(error.message);
  }
}

/** Cancel a still-pending PTO request (the employee withdrawing their own request). */
export async function updatePtoRequestStatus(
  id: string,
  status: PtoStatus,
  reviewedBy: string | null,
  reviewNote?: string
): Promise<void> {
  const { error } = await supabase
    .from("pto_requests")
    .update({
      status,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      review_note: reviewNote || null,
    })
    .eq("id", id);
  if (error) {
    console.error("updatePtoRequestStatus error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * Record a manager/HR/Accounting decision on one stage of a PTO request, and
 * notify whoever needs to know next: the employee if this stage rejected it
 * or was the final approval, otherwise HR+Accounting once the manager has
 * approved (so the OR-gate second stage doesn't stall on nobody knowing
 * it's their turn).
 */
export async function reviewPtoStage(
  request: Pick<PtoRequestRow, "id" | "profileId" | "managerId" | "startDate" | "endDate">,
  stage: PtoStage,
  decision: "approved" | "rejected",
  reviewerId: string,
  reviewerName: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  const payload =
    stage === "manager"
      ? { manager_status: decision, manager_reviewed_by: reviewerId, manager_reviewed_at: nowIso }
      : stage === "hr"
        ? { hr_status: decision, hr_reviewed_by: reviewerId, hr_reviewed_at: nowIso }
        : { accounting_status: decision, accounting_reviewed_by: reviewerId, accounting_reviewed_at: nowIso };

  const { data, error } = await supabase
    .from("pto_requests")
    .update(payload)
    .eq("id", request.id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) {
    console.error("reviewPtoStage error:", error.message);
    throw new Error(error.message);
  }
  const updated = mapRow(data);

  const dateRange = `${request.startDate} to ${request.endDate}`;
  const stageLabel = stage === "manager" ? "your manager" : stage === "hr" ? "HR" : "Accounting";

  if (decision === "rejected") {
    await createNotification({
      recipientId: request.profileId,
      senderId: reviewerId,
      senderName: reviewerName,
      body: `❌ Your PTO request (${dateRange}) was rejected by ${stageLabel}.`,
      linkTo: "/m/dashboard/employee-self-service?tab=requests",
    }).catch((err) => console.error("Failed to notify PTO rejection:", err));
    return;
  }

  if (updated.status === "approved") {
    await createNotification({
      recipientId: request.profileId,
      senderId: reviewerId,
      senderName: reviewerName,
      body: `✅ Your PTO request (${dateRange}) has been fully approved!`,
      linkTo: "/m/dashboard/employee-self-service?tab=requests",
    }).catch((err) => console.error("Failed to notify PTO approval:", err));
    return;
  }

  // Manager-only approval so far — ping HR and Accounting that it's their turn.
  if (stage === "manager") {
    try {
      const roster = await getCompanyUsers();
      const requesterName = roster.find((p) => p.id === request.profileId)?.display_name || "An employee";
      // Held roles pile up here too, same as canReviewPtoStage — someone
      // with HR/FINANCE only as a secondary role can still approve this
      // stage, so they need to be notified just as reliably as a primary
      // holder, not silently skipped.
      const recipients = roster.filter((p) => {
        if (p.id === reviewerId || !p.is_active) return false;
        const heldRoles = [p.role, ...(p.extra_roles ?? [])].map((r) => (r || "").toUpperCase());
        return heldRoles.includes("HR") || heldRoles.includes("FINANCE");
      });
      await Promise.all(
        recipients.map((r) =>
          createNotification({
            recipientId: r.id,
            senderId: reviewerId,
            senderName: reviewerName,
            body: `🗓️ PTO request from ${requesterName} (${dateRange}) was approved by the manager — awaiting HR or Accounting review.`,
            linkTo: "/m/dashboard/attendance-monitoring?tab=pto-management",
          })
        )
      );
    } catch (err) {
      console.error("Failed to notify HR/Accounting of pending PTO request:", err);
    }
  }
}
