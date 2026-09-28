/**
 * Part Order — one row per ticket whose Repair Status (tickets.status, the
 * same "TR-Need PO"/"OP-Waiting for Part"/etc value shown on the Ticket
 * List) is exactly "TR-Need PO", driven off the TICKET not the part: every
 * ticket at that status shows up here even before anyone has logged a part
 * for it in Service Tracking (blank Part No/Description/Part Dist./ETA
 * until they do) — a ticket previously vanished from this page entirely
 * unless a `parts` row already existed for it, which silently hid most of
 * a company's TR-Need PO backlog (confirmed: dozens of tickets sitting at
 * TR-Need PO on the Ticket List, only one showing up here). A ticket that
 * does have one or more logged parts gets one row per part instead of the
 * single blank placeholder row. Reads parts + tickets as two parallel
 * queries and merges client-side - parts.ticket_id -> tickets is a
 * composite FK PostgREST can't embed directly, see partsInventory.ts for
 * the same pattern - instead of looping per-ticket (the previous approach
 * fired up to ~2 requests per company ticket for one page load).
 */

import { supabase } from "./client";

export interface PartOrderRow {
  id: string;
  ticketNo: string;
  /** The ticket's Repair Status (tickets.status) — always "TR-Need PO" here, same value shown on the Ticket List, NOT the part row's own status. */
  status: string;
  partDist: string;
  partNo: string;
  description: string;
  requestQty: number;
  eta: string;
  location: string;
  scheduleDate: string;
  warranty: string;
  /** Same value as `status` above (kept for callers that read it by this name) — the ticket's overall Repair Status. */
  repairStatus: string;
}

// Supabase caps an unbounded select at 1000 rows — both `parts` and
// `tickets` here are queried with no filter at all before the "Need PO"
// filter is applied client-side. Page through each in chunks of 1000.
const PAGE_SIZE = 1000;

export async function getPartOrderRows(): Promise<PartOrderRow[]> {
  const [partsAll, ticketsAll] = await Promise.all([
    (async () => {
      const all: any[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        // created_at is NOT unique (bulk-imported rows can share a
        // timestamp) — id is the stable tiebreaker range()-paging needs, same
        // reasoning tickets.ts's own getCompanyTickets comment gives; without
        // it, paging past 1000 parts can silently drop/duplicate rows.
        const { data, error } = await supabase
          .from("parts")
          .select("id, ticket_id, part_no, part_dist, part_desc, quantity, status, po_no, eta")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
        if (error) {
          console.error("getPartOrderRows parts error:", error.message);
          throw new Error(error.message);
        }
        all.push(...(data ?? []));
        if (!data || data.length < PAGE_SIZE) break;
      }
      return all;
    })(),
    (async () => {
      const all: any[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("tickets")
          .select("id, ticket_no, location, schedule_date, warranty, status")
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) {
          console.error("getPartOrderRows tickets error:", error.message);
          throw new Error(error.message);
        }
        all.push(...(data ?? []));
        if (!data || data.length < PAGE_SIZE) break;
      }
      return all;
    })(),
  ]);

  const partsByTicketId = new Map<string, any[]>();
  for (const p of partsAll as any[]) {
    const arr = partsByTicketId.get(p.ticket_id);
    if (arr) arr.push(p);
    else partsByTicketId.set(p.ticket_id, [p]);
  }

  const rows: PartOrderRow[] = [];
  for (const t of ticketsAll as any[]) {
    if (t.status !== "TR-Need PO") continue;
    const ticketNo = t.ticket_no ?? "";
    const location = t.location ?? "";
    const scheduleDate = t.schedule_date ?? "";
    const warranty = t.warranty ?? "";
    const parts = partsByTicketId.get(t.id) ?? [];
    if (parts.length === 0) {
      // No part logged for this ticket yet in Service Tracking — still
      // show it (blank part columns) so it isn't silently dropped from
      // logistics' view of what needs a PO.
      rows.push({
        id: `ticket-${t.id}`,
        ticketNo,
        status: "TR-Need PO",
        partDist: "",
        partNo: "",
        description: "",
        requestQty: 0,
        eta: "",
        location,
        scheduleDate,
        warranty,
        repairStatus: "TR-Need PO",
      });
      continue;
    }
    for (const row of parts) {
      rows.push({
        id: row.id,
        ticketNo,
        status: "TR-Need PO",
        partDist: row.part_dist || "",
        partNo: row.part_no || "",
        description: row.part_desc || "",
        requestQty: Number(row.quantity ?? 1),
        eta: row.eta || "",
        location,
        scheduleDate,
        warranty,
        repairStatus: "TR-Need PO",
      });
    }
  }
  return rows;
}

/** Distinct real part_dist values currently in use, for the Part Dist. filter dropdown. */
export async function getDistinctPartOrderDistributors(): Promise<string[]> {
  const { data, error } = await supabase.from("parts").select("part_dist").not("part_dist", "is", null);
  if (error) {
    console.error("getDistinctPartOrderDistributors error:", error.message);
    return [];
  }
  const set = new Set((data ?? []).map((r: any) => r.part_dist).filter((v: string) => v && v.trim()));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
