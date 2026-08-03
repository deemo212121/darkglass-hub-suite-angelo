/**
 * Part Footprint — where received parts currently stand. Real subset only:
 * a dedicated part_transactions ledger table exists in the schema for a
 * fuller Received/Issued/Returned/Adjusted history, but nothing in the app
 * writes to it, so there's no real data to aggregate from it yet. This
 * reads directly off parts (qty_received/received_date from migration
 * 0071, plus ra_no) joined to its ticket for location/aging/brand/model.
 */

import { supabase } from "./client";

export interface PartFootprintRow {
  id: string;
  receiveDate: string;
  partNo: string;
  description: string;
  received: number;
  price: number;
  total: number;
  status: string;
  ticketNo: string;
  aging: number;
  brand: string;
  modelCode: string;
  raNo: string;
  location: string;
}

export async function getPartFootprint(): Promise<PartFootprintRow[]> {
  const { data, error } = await supabase
    .from("parts")
    .select(
      "id, received_date, part_no, part_desc, qty_received, part_price, quantity, status, ra_no, tickets!inner(ticket_no, location, aging, manufacturer, model)"
    )
    .gt("qty_received", 0);

  if (error) {
    console.error("getPartFootprint error:", error.message);
    throw new Error(error.message);
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    receiveDate: row.received_date || "",
    partNo: row.part_no || "",
    description: row.part_desc || "",
    received: Number(row.qty_received ?? 0),
    price: Number(row.part_price ?? 0),
    total: Number(row.part_price ?? 0) * Number(row.quantity ?? 0),
    status: row.status || "",
    ticketNo: row.tickets?.ticket_no || "",
    aging: Number(row.tickets?.aging ?? 0),
    brand: row.tickets?.manufacturer || "",
    modelCode: row.tickets?.model || "",
    raNo: row.ra_no || "",
    location: row.tickets?.location || "",
  }));
}
