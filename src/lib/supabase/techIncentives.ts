/**
 * Technician incentives (migration 0426) — the rules are in
 * src/lib/techIncentives.ts. HR submits (pending); Accounting approves or
 * rejects. Approving puts the amount on payroll for the pay period it's
 * approved in: a Tech Activity Report custom pay line for the Branch
 * Manager and the technician (tech_custom_pay_items), a payroll adjustment
 * (+) for the HR recruiter (payroll_adjustments — PH payroll). Approving
 * the Branch Manager's incentive also adds the technician's matching one.
 * Undoing an approval takes the payroll lines off again.
 */
import { supabase } from "./client";
import { createNotification } from "./notifications";
import { addTechCustomPayItem, updateTechCustomPayItem, deleteTechCustomPayItem, getTechCustomPayItems } from "./techPayroll";
import { addPayrollAdjustment, deletePayrollAdjustment } from "./payrollAdjustments";
import { getHireDatesByProfileIds, getSeparations, type ProfileRow } from "./users";
import { loadHiringRecords } from "./attendanceStart";
import { getBranchRoles } from "./generalInfo";
import { attendanceStartDate, matchHiringRecords, type AttendanceStartCandidate } from "@/lib/attendanceStart";
import { payPeriodContaining } from "@/lib/payPeriods";
import { findPersonByName } from "@/lib/personName";
import { normalizeRole } from "@/lib/roleLabels";
import { todayISO } from "@/lib/localDate";
import {
  HR_INCENTIVE_RECRUITERS,
  INCENTIVE_AMOUNT,
  INCENTIVE_LABEL,
  INCENTIVE_PROGRAM_START,
  sixMonthDate,
  type IncentiveKind,
} from "@/lib/techIncentives";

/** planned = HR has picked who gets it (or blanked it) but hasn't submitted it yet. */
export type IncentiveStatus = "planned" | "pending" | "approved" | "rejected";

/** One graded pay period in the Branch Manager Incentive's 6-month average. */
export interface IncentiveGradePeriod {
  start: string;
  end: string;
  points: number;
  grade: string;
}

export interface TechIncentive {
  id: string;
  technicianId: string;
  kind: IncentiveKind;
  /** Null only while planned with nobody picked. */
  recipientId: string | null;
  amount: number;
  startDate: string;
  sixMonthDate: string;
  gradePoints: number | null;
  grade: string | null;
  gradePeriods: IncentiveGradePeriod[];
  status: IncentiveStatus;
  submittedById: string | null;
  submittedByName: string | null;
  submittedAt: string;
  reviewedById: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  payLineId: string | null;
  matchOf: string | null;
}

function mapRow(r: any): TechIncentive {
  return {
    id: r.id,
    technicianId: r.technician_id,
    kind: r.kind,
    recipientId: r.recipient_id ?? null,
    amount: Number(r.amount) || 0,
    startDate: r.start_date,
    sixMonthDate: r.six_month_date,
    gradePoints: r.grade_points != null ? Number(r.grade_points) : null,
    grade: r.grade ?? null,
    gradePeriods: Array.isArray(r.grade_periods) ? r.grade_periods : [],
    status: r.status,
    submittedById: r.submitted_by ?? null,
    submittedByName: r.submitted_by_name ?? null,
    submittedAt: r.submitted_at,
    reviewedById: r.reviewed_by ?? null,
    reviewedByName: r.reviewed_by_name ?? null,
    reviewedAt: r.reviewed_at ?? null,
    reviewNote: r.review_note ?? null,
    payPeriodStart: r.pay_period_start ?? null,
    payPeriodEnd: r.pay_period_end ?? null,
    payLineId: r.pay_line_id ?? null,
    matchOf: r.match_of ?? null,
  };
}

const isMissingTable = (message: string) => /tech_incentives/.test(message) && /does not exist|schema cache|relation/i.test(message);

/** Every incentive row, or null when migration 0426 hasn't been run. */
export async function getTechIncentives(): Promise<TechIncentive[] | null> {
  const { data, error } = await supabase.from("tech_incentives").select("*").order("six_month_date", { ascending: true });
  if (error) {
    if (isMissingTable(error.message)) return null;
    throw new Error(error.message);
  }
  return (data ?? []).map(mapRow);
}

// ── Who's in the program ──

/** The few profile fields this page needs. */
export type IncentivePerson = Pick<ProfileRow, "id" | "display_name" | "email" | "role" | "extra_roles" | "assigned_branch" | "manager_name" | "is_active" | "created_at"> & {
  phone_number: string | null;
};

export interface IncentiveCase {
  technician: IncentivePerson;
  startDate: string;
  /** Where the start date came from. */
  startSource: "Hire Date" | "HR Hiring";
  sixMonthDate: string;
  /** Left the company — when and why (deactivated accounts only). */
  separation: { label: string; date: string | null } | null;
  /** The HR recruiter credited by their Hiring record, when it's one of HR_INCENTIVE_RECRUITERS. */
  suggestedRecruiterId: string | null;
  /** Their branch's Branch Manager (General Information), else their own manager. */
  suggestedBranchManagerId: string | null;
}

const BRANCH_MANAGER_ROLES = new Set(["BRANCH_MANAGER", "SENIOR_BRANCH_MANAGER"]);
export const isBranchManagerPerson = (p: Pick<IncentivePerson, "role" | "extra_roles">) =>
  [p.role, ...(p.extra_roles ?? [])].some((r) => BRANCH_MANAGER_ROLES.has(normalizeRole(r)));

type HiringRecord = AttendanceStartCandidate & { created_by: string | null; created_at: string | null };

async function getPeople(): Promise<IncentivePerson[]> {
  const out: IncentivePerson[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, email, phone_number, role, extra_roles, assigned_branch, manager_name, is_active, created_at")
      .neq("role", "SUPERSUPERADMIN")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as unknown as IncentivePerson[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Technicians whose 6-month mark is on or after the program start, with
 * their start date, the recruiter and Branch Manager to suggest, and —
 * for anyone who left — their separation. Plus everyone, for names and
 * the Branch Manager list, and the active technicians with no start date
 * at all (no Hire Date, no HR Hiring date) — the account's creation day
 * isn't used, since many accounts were made in bulk long after people
 * started.
 */
export async function getIncentiveCases(): Promise<{ cases: IncentiveCase[]; people: IncentivePerson[]; missingStartDate: IncentivePerson[] }> {
  const people = await getPeople();
  const technicians = people.filter((p) => normalizeRole(p.role) === "TECHNICIAN");
  const [hireDates, hiring, branchRoles, separations] = await Promise.all([
    getHireDatesByProfileIds(technicians.map((t) => t.id)),
    loadHiringRecords<HiringRecord>(", created_by, created_at").catch(() => [] as HiringRecord[]),
    getBranchRoles().catch(() => []),
    getSeparations(technicians).catch(() => new Map()),
  ]);
  const active = people.filter((p) => p.is_active);
  const branchManagerByBranch = new Map(branchRoles.map((r) => [r.branch.trim().toLowerCase(), r.branchManager]));

  const cases: IncentiveCase[] = [];
  const missingStartDate: IncentivePerson[] = [];
  for (const t of technicians) {
    const records = matchHiringRecords(t, hiring);
    const hiringStarts = records.map((c) => c.training_start_date || c.start_date || null).filter((d): d is string => !!d).sort();
    const hiringStart = hiringStarts.pop() ?? null;
    const hireDate = hireDates.get(t.id) ?? null;
    const startDate = attendanceStartDate(hireDate, hiringStart);
    if (!startDate) {
      if (t.is_active) missingStartDate.push(t);
      continue;
    }
    const six = sixMonthDate(startDate);
    if (six < INCENTIVE_PROGRAM_START) continue;

    // Newest Hiring record first; the first one an HR recruiter created gets the credit.
    const recruiterRecord = [...records]
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
      .find((c) => c.created_by && HR_INCENTIVE_RECRUITERS[c.created_by]);
    const typedBranchManager = branchManagerByBranch.get((t.assigned_branch || "").trim().toLowerCase());
    const branchManager =
      (typedBranchManager ? findPersonByName(typedBranchManager, active) : null) ??
      (t.manager_name ? findPersonByName(t.manager_name, active.filter(isBranchManagerPerson)) : null);
    const sep = separations.get(t.id);
    cases.push({
      technician: t,
      startDate,
      startSource: startDate === hiringStart && hiringStart !== hireDate ? "HR Hiring" : "Hire Date",
      sixMonthDate: six,
      separation: t.is_active ? null : { label: sep?.label ?? "Deactivated", date: sep?.date ?? null },
      suggestedRecruiterId: recruiterRecord?.created_by ?? null,
      suggestedBranchManagerId: branchManager?.id ?? null,
    });
  }
  cases.sort((a, b) => a.sixMonthDate.localeCompare(b.sixMonthDate) || (a.technician.display_name || "").localeCompare(b.technician.display_name || ""));
  missingStartDate.sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));
  return { cases, people, missingStartDate };
}

/**
 * Still with the company at the 6-month mark: active, or they left on or
 * after it. A deactivated account with no separation date doesn't count.
 */
export function retainedAtSixMonths(c: Pick<IncentiveCase, "separation" | "sixMonthDate">): boolean {
  if (!c.separation) return true;
  return !!c.separation.date && c.separation.date >= c.sixMonthDate;
}

// ── HR: pick / submit / withdraw ──

/**
 * HR picks (or blanks) who gets an incentive from the table. Saved as
 * 'planned' until it's submitted; a pending one keeps waiting on Accounting
 * with the new person; a rejected one goes back to planned. An approved
 * one can't change here.
 */
export async function setIncentiveRecipient(input: {
  technicianId: string;
  kind: Exclude<IncentiveKind, "technician_match">;
  recipientId: string | null;
  startDate: string;
  sixMonthDate: string;
  existing?: TechIncentive | null;
}): Promise<void> {
  const ex = input.existing;
  if (ex?.status === "approved") throw new Error("It's already approved — undo the approval first.");
  if (ex?.status === "pending" && !input.recipientId) throw new Error("It's waiting on Accounting — withdraw it first to leave it blank.");
  if (ex) {
    const { error } = await supabase
      .from("tech_incentives")
      .update({ recipient_id: input.recipientId, ...(ex.status === "rejected" ? { status: "planned" } : {}) })
      .eq("id", ex.id);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase.from("tech_incentives").insert({
    technician_id: input.technicianId,
    kind: input.kind,
    recipient_id: input.recipientId,
    amount: INCENTIVE_AMOUNT[input.kind],
    start_date: input.startDate,
    six_month_date: input.sixMonthDate,
    status: "planned",
  });
  if (error) throw new Error(error.message);
}

export async function submitIncentive(input: {
  technicianId: string;
  kind: Exclude<IncentiveKind, "technician_match">;
  recipientId: string;
  startDate: string;
  sixMonthDate: string;
  grade?: { points: number; grade: string; periods: IncentiveGradePeriod[] } | null;
  /** The row being submitted (planned, pending or rejected), if there is one. */
  existing?: TechIncentive | null;
  submittedById: string | null;
  submittedByName: string;
}): Promise<TechIncentive> {
  const fields = {
    recipient_id: input.recipientId,
    amount: INCENTIVE_AMOUNT[input.kind],
    start_date: input.startDate,
    six_month_date: input.sixMonthDate,
    grade_points: input.grade ? Math.round(input.grade.points * 100) / 100 : null,
    grade: input.grade?.grade ?? null,
    grade_periods: input.grade?.periods ?? [],
    status: "pending" as const,
    submitted_by: input.submittedById,
    submitted_by_name: input.submittedByName,
    submitted_at: new Date().toISOString(),
    reviewed_by: null,
    reviewed_by_name: null,
    reviewed_at: null,
    review_note: null,
  };
  const { data, error } = input.existing
    ? await supabase.from("tech_incentives").update(fields).eq("id", input.existing.id).select("*").single()
    : await supabase.from("tech_incentives").insert({ technician_id: input.technicianId, kind: input.kind, ...fields }).select("*").single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

/** HR takes back one that's waiting on Accounting — it's planned again, with the same person picked. */
export async function withdrawIncentive(id: string): Promise<void> {
  const { error } = await supabase.from("tech_incentives").update({ status: "planned", submitted_at: new Date().toISOString() }).eq("id", id).eq("status", "pending");
  if (error) throw new Error(error.message);
}

/**
 * A bell about an incentive — to Accounting (the approvers, from the page's
 * roster) when HR submits, back to whoever submitted when it's decided.
 * HR opens the page under HR, Accounting under Accounting.
 */
export async function notifyAboutIncentive(input: { recipientIds: string[]; senderId: string | null; senderName: string; body: string; linkTo: "/m/accounting/incentives" | "/m/hr/incentives" }): Promise<void> {
  await Promise.all(
    input.recipientIds
      .filter((id) => id !== input.senderId)
      .map((id) => createNotification({ recipientId: id, senderId: input.senderId, senderName: input.senderName, body: input.body, linkTo: input.linkTo }).catch(() => {}))
  );
}

// ── Accounting: approve / reject / undo ──

/** Puts one incentive on payroll for `period`; returns the payroll line's id. */
async function addPayLine(kind: IncentiveKind, recipientId: string, amount: number, period: { start: string; end: string }, description: string, byName: string): Promise<string> {
  if (kind === "hr") {
    const line = await addPayrollAdjustment({ profileId: recipientId, periodStart: period.start, periodEnd: period.end, kind: "reimbursement", description, amount, createdByName: byName });
    return line.id;
  }
  const existing = await getTechCustomPayItems(recipientId, period.start, period.end);
  const line = await addTechCustomPayItem(recipientId, period.start, period.end, existing.length);
  try {
    await updateTechCustomPayItem(line.id, { label: description, value: 1, rate: amount });
  } catch (err) {
    await deleteTechCustomPayItem(line.id).catch(() => {});
    throw err;
  }
  return line.id;
}

async function removePayLine(kind: IncentiveKind, payLineId: string | null): Promise<void> {
  if (!payLineId) return;
  if (kind === "hr") await deletePayrollAdjustment(payLineId);
  else await deleteTechCustomPayItem(payLineId);
}

const payLineDescription = (kind: IncentiveKind, technicianName: string) =>
  kind === "hr"
    ? `${INCENTIVE_LABEL.hr} — ${technicianName} reached 6 months`
    : kind === "branch_manager"
      ? `${INCENTIVE_LABEL.branch_manager} — ${technicianName} reached 6 months`
      : `${INCENTIVE_LABEL.technician_match} — 6 months`;

/**
 * Approve: payroll line(s) for the pay period containing today, then the
 * row(s). A Branch Manager approval adds the technician's matching $500 in
 * the same pay period. If a step fails, the lines already added come off.
 */
export async function approveIncentive(
  inc: TechIncentive,
  ctx: { reviewerId: string | null; reviewerName: string; technicianName: string; incentives: TechIncentive[] }
): Promise<{ period: { start: string; end: string }; match: TechIncentive | null }> {
  if (inc.status !== "pending") throw new Error("Only a pending incentive can be approved.");
  if (!inc.recipientId) throw new Error("Nobody is picked to receive it.");
  const period = payPeriodContaining(todayISO());
  const reviewed = { reviewed_by: ctx.reviewerId, reviewed_by_name: ctx.reviewerName, reviewed_at: new Date().toISOString(), pay_period_start: period.start, pay_period_end: period.end };

  const lineId = await addPayLine(inc.kind, inc.recipientId, inc.amount, period, payLineDescription(inc.kind, ctx.technicianName), ctx.reviewerName);
  const { data: updated, error } = await supabase
    .from("tech_incentives")
    .update({ status: "approved", review_note: null, pay_line_id: lineId, ...reviewed })
    .eq("id", inc.id)
    .eq("status", "pending")
    .select("id");
  // No row changed = someone approved / rejected / withdrew it meanwhile.
  if (error || !updated || updated.length !== 1) {
    await removePayLine(inc.kind, lineId).catch(() => {});
    throw new Error(error?.message ?? "This incentive was changed by someone else — refresh and try again.");
  }
  if (inc.kind !== "branch_manager") return { period, match: null };

  // The technician's matching $500 — one row per technician, so an old one (from an undone approval) is replaced.
  try {
    const old = ctx.incentives.find((x) => x.technicianId === inc.technicianId && x.kind === "technician_match");
    if (old) {
      await removePayLine("technician_match", old.payLineId).catch(() => {});
      await supabase.from("tech_incentives").delete().eq("id", old.id);
    }
    const matchAmount = INCENTIVE_AMOUNT.technician_match;
    const matchLineId = await addPayLine("technician_match", inc.technicianId, matchAmount, period, payLineDescription("technician_match", ctx.technicianName), ctx.reviewerName);
    const { data, error: matchError } = await supabase
      .from("tech_incentives")
      .insert({
        technician_id: inc.technicianId,
        kind: "technician_match",
        recipient_id: inc.technicianId,
        amount: matchAmount,
        start_date: inc.startDate,
        six_month_date: inc.sixMonthDate,
        status: "approved",
        submitted_by: inc.submittedById,
        submitted_by_name: inc.submittedByName,
        pay_line_id: matchLineId,
        match_of: inc.id,
        ...reviewed,
      })
      .select("*")
      .single();
    if (matchError) {
      await removePayLine("technician_match", matchLineId).catch(() => {});
      throw new Error(matchError.message);
    }
    return { period, match: mapRow(data) };
  } catch (err) {
    // Without the match the Branch Manager approval goes back too, so the two always go together.
    await removePayLine(inc.kind, lineId).catch(() => {});
    await supabase.from("tech_incentives").update({ status: "pending", reviewed_by: null, reviewed_by_name: null, reviewed_at: null, pay_period_start: null, pay_period_end: null, pay_line_id: null }).eq("id", inc.id);
    throw new Error(`Couldn't add the Technician Matching Incentive, so nothing was approved: ${err instanceof Error ? err.message : err}`);
  }
}

export async function rejectIncentive(inc: TechIncentive, ctx: { reviewerId: string | null; reviewerName: string; reason: string }): Promise<void> {
  if (!ctx.reason.trim()) throw new Error("Please give a reason for rejecting.");
  const { data, error } = await supabase
    .from("tech_incentives")
    .update({ status: "rejected", review_note: ctx.reason.trim(), reviewed_by: ctx.reviewerId, reviewed_by_name: ctx.reviewerName, reviewed_at: new Date().toISOString() })
    .eq("id", inc.id)
    .eq("status", "pending")
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length !== 1) throw new Error("This incentive was changed by someone else — refresh and try again.");
}

/**
 * Undo an approval: its payroll line comes off and it's pending again. For
 * a Branch Manager incentive the technician's matching one (row and pay
 * line) is removed too.
 */
export async function undoIncentiveApproval(inc: TechIncentive, incentives: TechIncentive[]): Promise<void> {
  if (inc.status !== "approved" || inc.kind === "technician_match") throw new Error("Only an approved HR or Branch Manager incentive can be undone.");
  await removePayLine(inc.kind, inc.payLineId);
  const { error } = await supabase
    .from("tech_incentives")
    .update({ status: "pending", reviewed_by: null, reviewed_by_name: null, reviewed_at: null, review_note: null, pay_period_start: null, pay_period_end: null, pay_line_id: null })
    .eq("id", inc.id);
  if (error) throw new Error(error.message);
  if (inc.kind === "branch_manager") {
    const match = incentives.find((x) => x.matchOf === inc.id || (x.technicianId === inc.technicianId && x.kind === "technician_match"));
    if (match) {
      await removePayLine("technician_match", match.payLineId);
      const { error: delError } = await supabase.from("tech_incentives").delete().eq("id", match.id);
      if (delError) throw new Error(delError.message);
    }
  }
}
