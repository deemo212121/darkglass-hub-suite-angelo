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
  /** tickets.status_changed_by — a profiles.id (UUID), stamped automatically by a Postgres audit trigger whenever tickets.status changes. Resolve against a profiles list for a display name; null for a row nothing has ever changed the status of. */
  statusChangedBy: string | null;
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
          .select("id, ticket_no, location, schedule_date, warranty, status, status_changed_by")
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
    const statusChangedBy = t.status_changed_by ?? null;
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
        statusChangedBy,
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
        statusChangedBy,
      });
    }
  }
  return rows;
}

export interface PendingPoAsOfRow {
  ticketNo: string;
  location: string;
  scheduleDate: string;
  /** The ticket's status right now — may differ from "TR-Need PO" if it was processed after the cutoff. */
  currentStatus: string;
  /** Current status_changed_by, not reconstructed-as-of-cutoff — accurate
   *  for the common case (nothing's changed since), but for a ticket that
   *  moved off TR-Need PO again sometime after the cutoff, this reflects
   *  that LATER change instead of whoever actually set it to TR-Need PO
   *  historically. Good enough for "who to follow up with", not a legal
   *  record. */
  statusChangedBy: string | null;
}

/**
 * Every ticket whose Repair Status, reconstructed AS OF the exact instant
 * `cutoffIso`, was "TR-Need PO" — the real "unprocessed POs before 2PM
 * CST" the PO Team's Daily Report spec calls for (see ReportPartsDaily.tsx),
 * not just "whatever's TR-Need PO right now" (getPartOrderRows above),
 * which drifts as PO staff work through the queue over the course of the
 * day.
 *
 * Reconstructed from ticket_audit_log (a Postgres trigger logs every
 * tickets.status change with a timestamp, see getTicketAuditLog in
 * tickets.ts): a ticket's status at the cutoff is its CURRENT status,
 * UNLESS at least one status change happened strictly AFTER the cutoff —
 * in which case it's the before_value of the EARLIEST such change (the
 * status right before the first change that happened after the moment
 * being asked about). A cutoff in the future (e.g. today before 2PM CST
 * has actually arrived) naturally has no "after cutoff" changes yet, so
 * this gracefully degrades to "current status" — the best available
 * answer for a moment that hasn't happened yet.
 */
export async function getPendingPoTicketsAsOf(cutoffIso: string): Promise<PendingPoAsOfRow[]> {
  const [ticketsAll, laterChanges] = await Promise.all([
    (async () => {
      const all: any[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("tickets")
          .select("id, ticket_no, location, schedule_date, status, status_changed_by")
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) {
          console.error("getPendingPoTicketsAsOf tickets error:", error.message);
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
          .from("ticket_audit_log")
          .select("ticket_id, before_value, created_at")
          .eq("field", "status")
          .gt("created_at", cutoffIso)
          .order("created_at", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) {
          console.error("getPendingPoTicketsAsOf audit log error:", error.message);
          throw new Error(error.message);
        }
        all.push(...(data ?? []));
        if (!data || data.length < PAGE_SIZE) break;
      }
      return all;
    })(),
  ]);

  // laterChanges is sorted ascending by created_at, so the first entry
  // seen per ticket_id is the earliest AFTER-cutoff change — its
  // before_value is exactly the status at the cutoff.
  const statusAtCutoffByTicketId = new Map<string, string>();
  for (const c of laterChanges as any[]) {
    if (!statusAtCutoffByTicketId.has(c.ticket_id)) statusAtCutoffByTicketId.set(c.ticket_id, c.before_value ?? "");
  }

  return (ticketsAll as any[])
    .map((t) => ({
      ticketNo: t.ticket_no ?? "",
      location: t.location ?? "",
      scheduleDate: t.schedule_date ?? "",
      currentStatus: t.status ?? "",
      statusChangedBy: t.status_changed_by ?? null,
      statusAtCutoff: statusAtCutoffByTicketId.get(t.id) ?? (t.status ?? ""),
    }))
    .filter((t) => t.statusAtCutoff === "TR-Need PO")
    .map(({ statusAtCutoff, ...rest }) => rest);
}

const IN_CHUNK = 200;

/**
 * Who entered each PO number, from ticket_audit_log — parts.created_by is
 * never populated, but the ticket page logs every part save with the
 * user's id. A PO counts as "processed" by whoever first saved it: an
 * "Added part transaction" entry whose snapshot carries `PO No: X`, or an
 * "Updated part transaction" entry on the PO No field. Returns a map keyed
 * `${ticketNo}|${poNo}` → profiles.id.
 */
export async function getPoProcessors(ticketNos: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const uniqueNos = Array.from(new Set(ticketNos.filter(Boolean)));
  if (uniqueNos.length === 0) return result;

  const ticketNoById = new Map<string, string>();
  for (let i = 0; i < uniqueNos.length; i += IN_CHUNK) {
    const { data, error } = await supabase.from("tickets").select("id, ticket_no").in("ticket_no", uniqueNos.slice(i, i + IN_CHUNK));
    if (error) throw new Error(error.message);
    for (const t of data ?? []) ticketNoById.set(t.id, t.ticket_no);
  }

  const ids = Array.from(ticketNoById.keys());
  const entries: any[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from("ticket_audit_log")
      .select("ticket_id, action, field, after_value, changed_by, created_at")
      .in("ticket_id", ids.slice(i, i + IN_CHUNK))
      .in("action", ["Added part transaction", "Updated part transaction"])
      .not("changed_by", "is", null)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    entries.push(...(data ?? []));
  }
  entries.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  for (const e of entries) {
    let poNo = "";
    if (e.action === "Updated part transaction" && e.field === "PO No") {
      poNo = String(e.after_value ?? "");
    } else if (e.action === "Added part transaction") {
      poNo = /PO No: (.*?) \|/.exec(String(e.after_value ?? ""))?.[1] ?? "";
    }
    poNo = poNo.trim();
    if (!poNo || poNo === "—") continue;
    const key = `${ticketNoById.get(e.ticket_id)}|${poNo}`;
    if (!result.has(key)) result.set(key, e.changed_by);
  }
  return result;
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
