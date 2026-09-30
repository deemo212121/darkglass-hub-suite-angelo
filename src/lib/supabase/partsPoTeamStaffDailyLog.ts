import { supabase } from "./client";

/**
 * Per-PO-staffer daily tally for the Staff Changes Counter — PO Team
 * roster (migration 0322). Tickets Ordered/Parts Ordered/Pending Tickets
 * have no live per-person data source (parts.created_by isn't populated),
 * so a lead enters all three by hand per (staffer, day) — same manual-
 * tally pattern parts_daily_issues_log uses per (branch, day). Internal
 * Note here is per-person, distinct from parts_po_team_daily_log's
 * (removed) company-wide note.
 */
export interface PartsPoTeamStaffDailyEntry {
  profileId: string;
  date: string;
  ticketsOrdered: number;
  partsOrdered: number;
  pendingTickets: number;
  internalNote: string;
}

export async function getPartsPoTeamStaffDailyLog(startDate: string, endDate: string): Promise<PartsPoTeamStaffDailyEntry[]> {
  const { data, error } = await supabase
    .from("parts_po_team_staff_daily_log")
    .select("profile_id, entry_date, tickets_ordered, parts_ordered, pending_tickets, internal_note")
    .gte("entry_date", startDate)
    .lte("entry_date", endDate);
  if (error) throw error;
  return (data || []).map((r: any) => ({
    profileId: r.profile_id,
    date: r.entry_date,
    ticketsOrdered: r.tickets_ordered ?? 0,
    partsOrdered: r.parts_ordered ?? 0,
    pendingTickets: r.pending_tickets ?? 0,
    internalNote: r.internal_note ?? "",
  }));
}

export async function upsertPartsPoTeamStaffDailyEntry(
  profileId: string,
  date: string,
  patch: Partial<Pick<PartsPoTeamStaffDailyEntry, "ticketsOrdered" | "partsOrdered" | "pendingTickets" | "internalNote">>
): Promise<void> {
  const payload: Record<string, unknown> = { profile_id: profileId, entry_date: date };
  if (patch.ticketsOrdered !== undefined) payload.tickets_ordered = patch.ticketsOrdered;
  if (patch.partsOrdered !== undefined) payload.parts_ordered = patch.partsOrdered;
  if (patch.pendingTickets !== undefined) payload.pending_tickets = patch.pendingTickets;
  if (patch.internalNote !== undefined) payload.internal_note = patch.internalNote;
  const { error } = await supabase.from("parts_po_team_staff_daily_log").upsert(payload, { onConflict: "company_id,profile_id,entry_date" });
  if (error) throw error;
}
