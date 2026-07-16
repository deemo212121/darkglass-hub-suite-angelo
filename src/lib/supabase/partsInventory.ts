/**
 * Supabase-backed Part Inventory data layer.
 *
 * The Part Inventory page shows the real parts ordered on real tickets
 * (the `parts` table), not a standalone stock list — so this reads `parts`
 * joined (client-side, since ticket_id -> tickets is a composite FK that
 * PostgREST can't embed) against `tickets` for ticket_no/location/aging.
 */

import { supabase } from "./client";

export type PartInventoryStatus =
  | "Need PO"
  | "PO Made"
  | "Back Order"
  | "Part Ready"
  | "Tech Pickup"
  | "Claimed"
  | "Used"
  | "Cancelled";

export const PART_INVENTORY_STATUSES: PartInventoryStatus[] = [
  "Need PO",
  "PO Made",
  "Back Order",
  "Part Ready",
  "Tech Pickup",
  "Claimed",
  "Used",
  "Cancelled",
];

export interface PartInventoryRow {
  id: string;
  ticketNo: string;
  location: string;
  technician: string;
  warranty: string;
  partNo: string;
  partDist: string;
  partDesc: string;
  quantity: number;
  partPrice: number;
  status: string;
  poNo: string;
  poDate: string;
  invoiceNo: string;
  orderNo: string;
  eta: string;
  /** Return-authorization number — non-empty once an RA has been created for this part. */
  raNo: string;
  /** Date the RA was created; falls back to createdAt when unset. */
  raDate: string;
  /** Inbound tracking number — non-empty once the part has been received/tracked in. */
  inTracking: string;
  createdAt: string;
  agingDays: number;
}

function agingFrom(dateStr: string): number {
  if (!dateStr) return 0;
  const start = new Date(dateStr).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 86400000));
}

/** Get every part-order line item across all of the company's tickets. */
export async function getPartsInventoryRows(): Promise<PartInventoryRow[]> {
  const [partsRes, ticketsRes] = await Promise.all([
    supabase
      .from("parts")
      .select("id, ticket_id, part_no, part_dist, part_desc, quantity, part_price, status, po_no, po_date, invoice_no, order_no, eta, ra_no, ra_date, in_tracking, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("tickets").select("id, ticket_no, location, technician, warranty, aging"),
  ]);

  if (partsRes.error) {
    console.error("getPartsInventoryRows parts error:", partsRes.error.message);
    throw new Error(partsRes.error.message);
  }
  if (ticketsRes.error) {
    console.error("getPartsInventoryRows tickets error:", ticketsRes.error.message);
    throw new Error(ticketsRes.error.message);
  }

  const ticketById = new Map<string, { ticketNo: string; location: string; technician: string; warranty: string }>();
  for (const t of ticketsRes.data ?? []) {
    ticketById.set((t as any).id, {
      ticketNo: (t as any).ticket_no ?? "",
      location: (t as any).location ?? "",
      technician: (t as any).technician ?? "",
      warranty: (t as any).warranty ?? "",
    });
  }

  return (partsRes.data ?? []).map((row: any) => {
    const ticket = ticketById.get(row.ticket_id);
    return {
      id: row.id,
      ticketNo: ticket?.ticketNo ?? "",
      location: ticket?.location ?? "",
      technician: ticket?.technician ?? "",
      warranty: ticket?.warranty ?? "",
      partNo: row.part_no ?? "",
      partDist: row.part_dist ?? "",
      partDesc: row.part_desc ?? "",
      quantity: row.quantity != null ? Number(row.quantity) : 0,
      partPrice: row.part_price != null ? Number(row.part_price) : 0,
      status: row.status ?? "",
      poNo: row.po_no ?? "",
      poDate: row.po_date ?? "",
      invoiceNo: row.invoice_no ?? "",
      orderNo: row.order_no ?? "",
      eta: row.eta ?? "",
      raNo: row.ra_no ?? "",
      raDate: row.ra_date ?? "",
      inTracking: row.in_tracking ?? "",
      createdAt: row.created_at ?? "",
      agingDays: agingFrom(row.po_date || row.created_at),
    };
  });
}
