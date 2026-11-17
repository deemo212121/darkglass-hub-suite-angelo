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
  /** The company financially responsible for the claim (tickets.claim_company) —
   * distinct from `warranty`, which is only status (In/Out of Warranty). */
  claimCompany: string;
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
  /** True once a technician has picked this part up (parts.picked_up) — see Part Daily Pickup. */
  pickedUp: boolean;
  /** Date pickedUp was set true; falls back to createdAt when unset. */
  pickedUpDate: string;
  createdAt: string;
  agingDays: number;
}

function agingFrom(dateStr: string): number {
  if (!dateStr) return 0;
  const start = new Date(dateStr).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 86400000));
}

// Supabase caps an unbounded select at 1000 rows — both `parts` and
// `tickets` here are queried with no filter at all. Page through each in
// chunks of 1000 instead.
const PAGE_SIZE = 1000;

const TICKET_COLUMNS = "id, ticket_no, location, technician, warranty, claim_company, aging";
/** Up to this many different tickets are fetched by id (in batches); more than that, the whole table is read as before. */
const TICKETS_BY_ID_LIMIT = 3000;
const TICKETS_BY_ID_BATCH = 200;

/** Every ticket in the company (the old way) — used when the parts point at a great many tickets. */
async function allTicketsForParts(): Promise<any[]> {
  const all: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("tickets")
      .select(TICKET_COLUMNS)
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("getPartsInventoryRows tickets error:", error.message);
      throw new Error(error.message);
    }
    all.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * Only the tickets these parts belong to (was: every ticket in the company, just to label
 * the parts). Same result — a part whose ticket can't be read still shows blank, as before.
 */
async function ticketsForParts(parts: any[]): Promise<any[]> {
  const ids = Array.from(new Set(parts.map((p) => p.ticket_id).filter(Boolean))) as string[];
  if (!ids.length) return [];
  if (ids.length > TICKETS_BY_ID_LIMIT) return allTicketsForParts();
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += TICKETS_BY_ID_BATCH) batches.push(ids.slice(i, i + TICKETS_BY_ID_BATCH));
  const results = await Promise.all(batches.map(async (batch) => {
    const { data, error } = await supabase.from("tickets").select(TICKET_COLUMNS).in("id", batch);
    if (error) {
      console.error("getPartsInventoryRows tickets error:", error.message);
      throw new Error(error.message);
    }
    return data ?? [];
  }));
  return results.flat();
}

/** Get every part-order line item across all of the company's tickets. */
export async function getPartsInventoryRows(): Promise<PartInventoryRow[]> {
  const [partsAll] = await Promise.all([
    (async () => {
      const all: any[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("parts")
          .select("id, ticket_id, part_no, part_dist, part_desc, quantity, part_price, status, po_no, po_date, invoice_no, order_no, eta, ra_no, ra_date, in_tracking, picked_up, picked_up_date, created_at")
          .order("created_at", { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
        if (error) {
          console.error("getPartsInventoryRows parts error:", error.message);
          throw new Error(error.message);
        }
        all.push(...(data ?? []));
        if (!data || data.length < PAGE_SIZE) break;
      }
      return all;
    })(),
  ]);
  const ticketsAll = await ticketsForParts(partsAll);

  const ticketById = new Map<string, { ticketNo: string; location: string; technician: string; warranty: string; claimCompany: string }>();
  for (const t of ticketsAll) {
    ticketById.set((t as any).id, {
      ticketNo: (t as any).ticket_no ?? "",
      location: (t as any).location ?? "",
      technician: (t as any).technician ?? "",
      warranty: (t as any).warranty ?? "",
      claimCompany: (t as any).claim_company ?? "",
    });
  }

  return partsAll.map((row: any) => {
    const ticket = ticketById.get(row.ticket_id);
    return {
      id: row.id,
      ticketNo: ticket?.ticketNo ?? "",
      location: ticket?.location ?? "",
      technician: ticket?.technician ?? "",
      warranty: ticket?.warranty ?? "",
      claimCompany: ticket?.claimCompany ?? "",
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
      pickedUp: row.picked_up === true,
      pickedUpDate: row.picked_up_date || row.created_at || "",
      createdAt: row.created_at ?? "",
      agingDays: agingFrom(row.po_date || row.created_at),
    };
  });
}
