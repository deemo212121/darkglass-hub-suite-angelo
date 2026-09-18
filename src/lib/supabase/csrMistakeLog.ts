/**
 * CSR Daily Report — the Mistake Log at the bottom of the page (a running,
 * company-wide list of incidents, not scoped to one report date). See
 * migration 0272.
 */

import { supabase } from "./client";

export interface CsrMistakeLogEntry {
  id: string;
  profileId: string;
  occurredDate: string | null;
  reason: string | null;
  actionTaken: string | null;
  createdAt: string;
}

const SELECT = "id, profile_id, occurred_date, reason, action_taken, created_at";

function fromRow(r: any): CsrMistakeLogEntry {
  return {
    id: r.id,
    profileId: r.profile_id,
    occurredDate: r.occurred_date,
    reason: r.reason,
    actionTaken: r.action_taken,
    createdAt: r.created_at,
  };
}

/** Every mistake logged company-wide, newest first. */
export async function getCsrMistakeLogEntries(): Promise<CsrMistakeLogEntry[]> {
  const { data, error } = await supabase
    .from("csr_mistake_log_entries")
    .select(SELECT)
    .order("occurred_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow);
}

export async function createCsrMistakeLogEntry(profileId: string, occurredDate: string | null, reason: string, actionTaken: string): Promise<string> {
  const { data, error } = await supabase
    .from("csr_mistake_log_entries")
    .insert({ profile_id: profileId, occurred_date: occurredDate, reason: reason || null, action_taken: actionTaken || null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export type CsrMistakeLogEntryFields = Partial<Pick<CsrMistakeLogEntry, "profileId" | "occurredDate" | "reason" | "actionTaken">>;

export async function updateCsrMistakeLogEntry(id: string, fields: CsrMistakeLogEntryFields): Promise<void> {
  const patch: Record<string, unknown> = {};
  if ("profileId" in fields) patch.profile_id = fields.profileId;
  if ("occurredDate" in fields) patch.occurred_date = fields.occurredDate;
  if ("reason" in fields) patch.reason = fields.reason || null;
  if ("actionTaken" in fields) patch.action_taken = fields.actionTaken || null;
  const { error } = await supabase.from("csr_mistake_log_entries").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteCsrMistakeLogEntry(id: string): Promise<void> {
  const { error } = await supabase.from("csr_mistake_log_entries").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
