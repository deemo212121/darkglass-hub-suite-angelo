import { supabase } from "./client";

/**
 * "PO Team's Daily Report" section of the Part Daily Report Overview tab
 * (migration 0309) — one row per (company, day), NOT per branch (unlike
 * parts_daily_issues_log). No. of Tickets Ordered/Parts Ordered are
 * computed live from parts.po_date in ReportPartsDaily.tsx, not stored
 * here; Pending Tickets and Internal Note have no live data source, so
 * the PO Team enters both by hand.
 */
export interface PartsPoTeamDailyEntry {
  date: string;
  pendingTickets: number;
  internalNote: string;
}

export async function getPartsPoTeamDailyLog(startDate: string, endDate: string): Promise<PartsPoTeamDailyEntry[]> {
  const { data, error } = await supabase
    .from("parts_po_team_daily_log")
    .select("entry_date, pending_tickets, internal_note")
    .gte("entry_date", startDate)
    .lte("entry_date", endDate);
  if (error) throw error;
  return (data || []).map((r: any) => ({
    date: r.entry_date,
    pendingTickets: r.pending_tickets ?? 0,
    internalNote: r.internal_note ?? "",
  }));
}

export async function upsertPartsPoTeamDailyEntry(
  date: string,
  patch: Partial<Pick<PartsPoTeamDailyEntry, "pendingTickets" | "internalNote">>
): Promise<void> {
  const payload: Record<string, unknown> = { entry_date: date };
  if (patch.pendingTickets !== undefined) payload.pending_tickets = patch.pendingTickets;
  if (patch.internalNote !== undefined) payload.internal_note = patch.internalNote;
  const { error } = await supabase.from("parts_po_team_daily_log").upsert(payload, { onConflict: "company_id,entry_date" });
  if (error) throw error;
}
