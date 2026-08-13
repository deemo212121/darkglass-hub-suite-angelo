/**
 * Part Order — parts still needing a PO across every one of the company's
 * tickets: status === "Need PO", OR any other status with a blank po_no
 * that isn't already "PO Made"/"Cancelled" (the same "no PO number
 * recorded yet" heuristic this page always used). Reads parts + tickets as
 * two parallel queries and merges client-side - parts.ticket_id -> tickets
 * is a composite FK PostgREST can't embed directly, see partsInventory.ts
 * for the same pattern - instead of looping per-ticket (the previous
 * approach fired up to ~2 requests per company ticket for one page load).
 */

import { supabase } from "./client";

export interface PartOrderRow {
  id: string;
  ticketNo: string;
  status: string;
  partDist: string;
  partNo: string;
  description: string;
  requestQty: number;
  eta: string;
  location: string;
  scheduleDate: string;
  warranty: string;
  repairStatus: string;
}

export async function getPartOrderRows(): Promise<PartOrderRow[]> {
  const [partsRes, ticketsRes] = await Promise.all([
    supabase
      .from("parts")
      .select("id, ticket_id, part_no, part_dist, part_desc, quantity, status, po_no, eta")
      .order("created_at", { ascending: false }),
    supabase.from("tickets").select("id, ticket_no, location, schedule_date, warranty, status"),
  ]);

  if (partsRes.error) {
    console.error("getPartOrderRows parts error:", partsRes.error.message);
    throw new Error(partsRes.error.message);
  }
  if (ticketsRes.error) {
    console.error("getPartOrderRows tickets error:", ticketsRes.error.message);
    throw new Error(ticketsRes.error.message);
  }

  const ticketById = new Map<string, { ticketNo: string; location: string; scheduleDate: string; warranty: string; repairStatus: string }>();
  for (const t of ticketsRes.data ?? []) {
    ticketById.set((t as any).id, {
      ticketNo: (t as any).ticket_no ?? "",
      location: (t as any).location ?? "",
      scheduleDate: (t as any).schedule_date ?? "",
      warranty: (t as any).warranty ?? "",
      repairStatus: (t as any).status ?? "",
    });
  }

  return (partsRes.data ?? [])
    .filter((row: any) => {
      const status = row.status || "";
      const poNo = row.po_no || "";
      return status === "Need PO" || (!poNo && status !== "PO Made" && status !== "Cancelled");
    })
    .map((row: any) => {
      const ticket = ticketById.get(row.ticket_id);
      return {
        id: row.id,
        ticketNo: ticket?.ticketNo ?? "",
        status: row.status || "Need PO",
        partDist: row.part_dist || "",
        partNo: row.part_no || "",
        description: row.part_desc || "",
        requestQty: Number(row.quantity ?? 1),
        eta: row.eta || "",
        location: ticket?.location ?? "",
        scheduleDate: ticket?.scheduleDate ?? "",
        warranty: ticket?.warranty ?? "",
        repairStatus: ticket?.repairStatus ?? "",
      };
    });
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

/** Distinct real tickets.warranty values currently in use, for the Warranty Type filter dropdown. */
export async function getDistinctPartOrderWarranties(): Promise<string[]> {
  const { data, error } = await supabase.from("tickets").select("warranty").not("warranty", "is", null);
  if (error) {
    console.error("getDistinctPartOrderWarranties error:", error.message);
    return [];
  }
  const set = new Set((data ?? []).map((r: any) => r.warranty).filter((v: string) => v && v.trim()));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
