/**
 * GH Tracker (CsrGhTracker.tsx) — replaces the old CSR Self Service "+1"
 * counter with a real per-CSR log of phone numbers called/attempted for a
 * day, matching the reference spreadsheet's one-column-per-agent layout.
 * See migration 0317 for why this table's RLS is row-scoped (agents can
 * only ever see/write their own rows) rather than the "any company member"
 * pattern the rest of csr_daily_report_entries/csr_mistake_log_entries use.
 *
 * getGhCountsByProfileForRange feeds CSRTeamDailyReport.tsx's GH column —
 * GH is just how many numbers a CSR logged that day, no separate stored
 * total (same "computed, not typed" convention Schedule/Update/Total on
 * that page now follow).
 */

import { supabase } from "./client";

export interface CsrGhTrackerEntry {
  id: string;
  profileId: string;
  entryDate: string; // "YYYY-MM-DD"
  phoneNumber: string;
  note: string | null;
  createdAt: string;
}

const SELECT = "id, profile_id, entry_date, phone_number, note, created_at";

function fromRow(r: any): CsrGhTrackerEntry {
  return {
    id: r.id,
    profileId: r.profile_id,
    entryDate: r.entry_date,
    phoneNumber: r.phone_number,
    note: r.note,
    createdAt: r.created_at,
  };
}

/** One CSR's own entries for one date (the agent-facing "simple" view). */
export async function getMyGhTrackerEntries(profileId: string, entryDate: string): Promise<CsrGhTrackerEntry[]> {
  const { data, error } = await supabase
    .from("csr_gh_tracker_entries")
    .select(SELECT)
    .eq("profile_id", profileId)
    .eq("entry_date", entryDate)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow);
}

/**
 * Every CSR's entries for a date range — RLS silently narrows this to just
 * the caller's own rows unless they're CSR_MANAGER/Admin/company-superadmin
 * (see migration 0317), so this same call is safe to reuse from both the
 * manager's aggregated view and anywhere else that might need it; a plain
 * agent calling it just gets their own rows back, same as
 * getMyGhTrackerEntries would.
 */
export async function getCompanyGhTrackerEntries(startDate: string, endDate: string): Promise<CsrGhTrackerEntry[]> {
  const { data, error } = await supabase
    .from("csr_gh_tracker_entries")
    .select(SELECT)
    .gte("entry_date", startDate)
    .lte("entry_date", endDate)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow);
}

/** GH = count of entries per CSR for the range — what CSRTeamDailyReport.tsx's GH column reads. */
/**
 * Comparable form of a logged phone number: digits only, with a leading US
 * country code "1" dropped from 11-digit numbers — so "(901) 555-0101",
 * "901.555.0101" and "+1 901 555 0101" all match as the same number.
 */
export function normalizeGhPhone(phone: string): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

/** GH per CSR = every number they logged in the range — duplicates included (they're only flagged on GH Tracker, not dropped). */
export async function getGhCountsByProfileForRange(startDate: string, endDate: string): Promise<Map<string, number>> {
  const rows = await getCompanyGhTrackerEntries(startDate, endDate);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.profileId, (counts.get(r.profileId) ?? 0) + 1);
  return counts;
}

export async function addGhTrackerEntry(profileId: string, entryDate: string, phoneNumber: string, note: string | null): Promise<CsrGhTrackerEntry> {
  const { data, error } = await supabase
    .from("csr_gh_tracker_entries")
    .insert({ profile_id: profileId, entry_date: entryDate, phone_number: phoneNumber, note: note || null })
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  return fromRow(data);
}

export async function updateGhTrackerEntry(id: string, fields: { phoneNumber?: string; note?: string | null }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if ("phoneNumber" in fields) patch.phone_number = fields.phoneNumber;
  if ("note" in fields) patch.note = fields.note;
  const { error } = await supabase.from("csr_gh_tracker_entries").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteGhTrackerEntry(id: string): Promise<void> {
  const { error } = await supabase.from("csr_gh_tracker_entries").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
