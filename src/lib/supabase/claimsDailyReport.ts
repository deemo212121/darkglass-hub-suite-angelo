/**
 * Claims Daily Report — replaces the team's manual spreadsheet with real
 * tables (migration 0293): a company-managed brand list + a per-day Open/
 * Claim/Pend count per brand, a company-managed "Remaining" reason list +
 * a per-day count per reason, a per-day report header (snapshot label,
 * overview/general notes, training count), a per-day staff roster entry
 * per real employee, and a per-day Pre-Authorization/Back Orders/
 * Data-Closed tracker per named assignee.
 *
 * Everything here is scoped to ONE report_date at a time (not a range) —
 * this is a daily snapshot, not a rollup like the eBay report.
 */
import { supabase } from "./client";

// ── Brand list (company-managed) ────────────────────────────────────────
export interface ClaimsBrand {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

function fromBrandRow(r: any): ClaimsBrand {
  return { id: r.id, name: r.name, sortOrder: r.sort_order, active: r.active };
}

export async function getClaimsBrands(): Promise<ClaimsBrand[]> {
  const { data, error } = await supabase
    .from("claims_brands")
    .select("id, name, sort_order, active")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromBrandRow);
}

export async function addClaimsBrand(name: string): Promise<void> {
  const { error } = await supabase.from("claims_brands").upsert(
    { name: name.trim(), active: true },
    { onConflict: "company_id,name" }
  );
  if (error) throw new Error(error.message);
}

export async function removeClaimsBrand(id: string): Promise<void> {
  const { error } = await supabase.from("claims_brands").update({ active: false }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── "Remaining" reason list (company-managed) ───────────────────────────
export interface ClaimsRemainingReason {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

function fromReasonRow(r: any): ClaimsRemainingReason {
  return { id: r.id, name: r.name, sortOrder: r.sort_order, active: r.active };
}

export async function getClaimsRemainingReasons(): Promise<ClaimsRemainingReason[]> {
  const { data, error } = await supabase
    .from("claims_remaining_reasons")
    .select("id, name, sort_order, active")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromReasonRow);
}

export async function addClaimsRemainingReason(name: string): Promise<void> {
  const { error } = await supabase.from("claims_remaining_reasons").upsert(
    { name: name.trim(), active: true },
    { onConflict: "company_id,name" }
  );
  if (error) throw new Error(error.message);
}

export async function removeClaimsRemainingReason(id: string): Promise<void> {
  const { error } = await supabase.from("claims_remaining_reasons").update({ active: false }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Report header (one per day) ──────────────────────────────────────────
export interface ClaimsDailyReportHeader {
  reportDate: string;
  snapshotLabel: string;
  overviewNote: string;
  trainingCount: number;
  generalNote: string;
}

const EMPTY_HEADER = (reportDate: string): ClaimsDailyReportHeader => ({
  reportDate, snapshotLabel: "", overviewNote: "", trainingCount: 0, generalNote: "",
});

export async function getClaimsDailyReportHeader(reportDate: string): Promise<ClaimsDailyReportHeader> {
  const { data, error } = await supabase
    .from("claims_daily_reports")
    .select("report_date, snapshot_label, overview_note, training_count, general_note")
    .eq("report_date", reportDate)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return EMPTY_HEADER(reportDate);
  return {
    reportDate: data.report_date,
    snapshotLabel: data.snapshot_label || "",
    overviewNote: data.overview_note || "",
    trainingCount: data.training_count ?? 0,
    generalNote: data.general_note || "",
  };
}

export async function upsertClaimsDailyReportHeader(
  reportDate: string,
  patch: Partial<Pick<ClaimsDailyReportHeader, "snapshotLabel" | "overviewNote" | "trainingCount" | "generalNote">>
): Promise<void> {
  const payload: Record<string, unknown> = { report_date: reportDate };
  if (patch.snapshotLabel !== undefined) payload.snapshot_label = patch.snapshotLabel || null;
  if (patch.overviewNote !== undefined) payload.overview_note = patch.overviewNote || null;
  if (patch.trainingCount !== undefined) payload.training_count = patch.trainingCount;
  if (patch.generalNote !== undefined) payload.general_note = patch.generalNote || null;
  const { error } = await supabase.from("claims_daily_reports").upsert(payload, { onConflict: "company_id,report_date" });
  if (error) throw new Error(error.message);
}

// ── Per-brand Open/Claim/Pend counts (one row per brand per day) ────────
export interface ClaimsBrandCount {
  brand: string;
  openCount: number;
  claimCount: number;
  pendCount: number;
}

export async function getClaimsBrandCounts(reportDate: string): Promise<ClaimsBrandCount[]> {
  const { data, error } = await supabase
    .from("claims_daily_brand_counts")
    .select("brand, open_count, claim_count, pend_count")
    .eq("report_date", reportDate);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ brand: r.brand, openCount: r.open_count, claimCount: r.claim_count, pendCount: r.pend_count }));
}

export async function upsertClaimsBrandCount(
  reportDate: string,
  brand: string,
  patch: Partial<Pick<ClaimsBrandCount, "openCount" | "claimCount" | "pendCount">>
): Promise<void> {
  const payload: Record<string, unknown> = { report_date: reportDate, brand };
  if (patch.openCount !== undefined) payload.open_count = patch.openCount;
  if (patch.claimCount !== undefined) payload.claim_count = patch.claimCount;
  if (patch.pendCount !== undefined) payload.pend_count = patch.pendCount;
  const { error } = await supabase.from("claims_daily_brand_counts").upsert(payload, { onConflict: "company_id,report_date,brand" });
  if (error) throw new Error(error.message);
}

// ── Per-reason "Remaining" counts (one row per reason per day) ──────────
export interface ClaimsRemainingCount {
  reason: string;
  count: number;
}

export async function getClaimsRemainingCounts(reportDate: string): Promise<ClaimsRemainingCount[]> {
  const { data, error } = await supabase
    .from("claims_daily_remaining_counts")
    .select("reason, count")
    .eq("report_date", reportDate);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ reason: r.reason, count: r.count }));
}

export async function upsertClaimsRemainingCount(reportDate: string, reason: string, count: number): Promise<void> {
  const { error } = await supabase
    .from("claims_daily_remaining_counts")
    .upsert({ report_date: reportDate, reason, count }, { onConflict: "company_id,report_date,reason" });
  if (error) throw new Error(error.message);
}

// ── Staff roster entries (one row per employee per day) ─────────────────
// Performance flag (Warning/Low Performance/Good/Great) is NOT stored —
// it's computed live from claimedCount by the UI (see ClaimsDailyReport.tsx's
// computeFlagFromClaimed), so there's nothing here to drift out of sync
// with a threshold rule that might change later.
export interface ClaimsStaffEntry {
  profileId: string;
  claimedCount: number;
  coveredBrands: string;
  remarks: string;
  warnings: number;
}

export async function getClaimsStaffEntries(reportDate: string): Promise<ClaimsStaffEntry[]> {
  const { data, error } = await supabase
    .from("claims_daily_staff_entries")
    .select("profile_id, claimed_count, covered_brands, remarks, warnings")
    .eq("report_date", reportDate);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    profileId: r.profile_id,
    claimedCount: r.claimed_count ?? 0,
    coveredBrands: r.covered_brands || "",
    remarks: r.remarks || "",
    warnings: r.warnings ?? 0,
  }));
}

export async function upsertClaimsStaffEntry(
  reportDate: string,
  profileId: string,
  patch: Partial<Omit<ClaimsStaffEntry, "profileId">>
): Promise<void> {
  const payload: Record<string, unknown> = { report_date: reportDate, profile_id: profileId };
  if (patch.claimedCount !== undefined) payload.claimed_count = patch.claimedCount;
  if (patch.coveredBrands !== undefined) payload.covered_brands = patch.coveredBrands || null;
  if (patch.remarks !== undefined) payload.remarks = patch.remarks || null;
  if (patch.warnings !== undefined) payload.warnings = patch.warnings;
  const { error } = await supabase.from("claims_daily_staff_entries").upsert(payload, { onConflict: "company_id,report_date,profile_id" });
  if (error) throw new Error(error.message);
}

// ── Pre-Authorization / Back Orders / Data-Closed tracker ───────────────
export type ClaimsTask = "Pre-Authorization" | "Back Orders" | "Data-Closed";

export interface ClaimsTaskEntry {
  id: string;
  task: ClaimsTask;
  assigneeName: string;
  pendingCount: number;
  handledCount: number;
  movedCount: number;
}

export async function getClaimsTaskEntries(reportDate: string): Promise<ClaimsTaskEntry[]> {
  const { data, error } = await supabase
    .from("claims_daily_task_entries")
    .select("id, task, assignee_name, pending_count, handled_count, moved_count")
    .eq("report_date", reportDate)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    task: r.task,
    assigneeName: r.assignee_name,
    pendingCount: r.pending_count,
    handledCount: r.handled_count,
    movedCount: r.moved_count,
  }));
}

export async function addClaimsTaskEntry(reportDate: string, task: ClaimsTask, assigneeName: string): Promise<string> {
  const { data, error } = await supabase
    .from("claims_daily_task_entries")
    .insert({ report_date: reportDate, task, assignee_name: assigneeName.trim() })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function updateClaimsTaskEntry(
  id: string,
  patch: Partial<Pick<ClaimsTaskEntry, "assigneeName" | "pendingCount" | "handledCount" | "movedCount">>
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.assigneeName !== undefined) payload.assignee_name = patch.assigneeName;
  if (patch.pendingCount !== undefined) payload.pending_count = patch.pendingCount;
  if (patch.handledCount !== undefined) payload.handled_count = patch.handledCount;
  if (patch.movedCount !== undefined) payload.moved_count = patch.movedCount;
  const { error } = await supabase.from("claims_daily_task_entries").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteClaimsTaskEntry(id: string): Promise<void> {
  const { error } = await supabase.from("claims_daily_task_entries").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
