/**
 * Part Return — every real part that's actually been received (excludes
 * Need PO/PO Made, see below) and could plausibly need to go back to
 * wherever it came from, joined to its ticket for location/technician.
 * Distinct from Part Return Status, which tracks the RA shipment
 * lifecycle for the 4 real "RA - *" statuses; this page covers a much
 * broader population and is scoped down via its own filters (Part
 * Provider/Location/Aging/Unique ID/Include Returned) instead.
 *
 * claim_to is not filtered on at all here - confirmed against real data
 * that every single Marcone part in production has claim_to blank
 * (Marcone parts generally aren't tied to an insurance claim), so an
 * earlier version requiring claim_to silently excluded 100% of real
 * Marcone returns: population went from 23 rows (claim_to required) to
 * 141 (not required), and real Marcone rows went from 0 to 14.
 *
 * return_status (migration 0070) is reused here for "Include Returned".
 *
 * Aging is days-since-invoice_date (a real distributor return window is
 * usually ~90 days from invoice), NOT tickets.aging - that column tracks
 * how long the *ticket* has been open, an unrelated concept. Confirmed
 * with the user: an invoice_date of 04/29/2026 should show as 84 days
 * aging as of 07/22/2026, which only invoice_date math produces.
 *
 * Excludes status IN ('Need PO', 'PO Made') - claim_to can get set on a
 * ticket before its part is even ordered, but you can't return a part
 * you don't physically have yet. Caught by the user looking at a real
 * "Need PO" row sitting in this list.
 *
 * Part Provider is a fixed 4-option list (Marcone/Encompass/LG/Other),
 * grouped from the real part_dist value via providerGroupOf() in
 * PartReturn.tsx - it's the distributor whose API/process actually
 * handles a return, not the insurance/warranty payer. For Marcone
 * specifically this calls their real POST
 * /returns/requestreturnauthorization (confirmed against Marcone's own
 * Swagger spec) and gets back a real returnAuthorizationNumber, saved
 * into ra_no. Every other provider has no documented/wired return API,
 * so submitting for them only stamps ra_date locally (see
 * submitPartReturnBatch) rather than pretending to submit anything
 * externally.
 *
 * PartReturn.tsx also renders a real reference app's "Inventory" bucket
 * group (Rec'd/In-Review/Defect/PNN/Current/Reserved) computed entirely
 * from fields already here, no separate ledger table:
 *   - Rec'd: return_status !== "NOT RECEIVED" - the DISTRIBUTOR has
 *     confirmed receiving this return (NOT "we received this part" -
 *     that's qty_received on a different page/workflow entirely; this
 *     field name is about the return leg, easy to misread).
 *   - In-Review / Defect / PNN: status === "In Review" / "Defective" /
 *     "PNN" respectively - "Defective" already existed as a real status
 *     app-wide; "In Review" and "PNN" (distinct from the post-RA
 *     "RA - PNN") were added to the shared status vocabulary
 *     (PartManagementPage.tsx, ticket.$ticketNo.tsx) alongside this work.
 *   - Current: quantity - scan_out_qty - on hand and not yet physically
 *     scanned out the door for return (scan_out_qty is written by
 *     ReturnPickupPage.tsx).
 *   - Reserved: always 0 - no "earmarked vs. general stock" concept
 *     exists anywhere in this schema (every parts row already always has
 *     a ticket_id), so this is shown honestly as 0 rather than invented.
 */

import { supabase } from "./client";

const NOT_YET_RECEIVED_STATUSES = ["Need PO", "PO Made"];

export interface PartReturnRow {
  id: string;
  ticketNo: string;
  location: string;
  partNo: string;
  partDist: string;
  description: string;
  poNo: string;
  invoiceNo: string;
  invoiceDate: string;
  quantity: number;
  coreValue: number;
  scanOutQty: number;
  status: string;
  /** Days since invoice_date; null when invoice_date isn't set (aging can't be computed). */
  aging: number | null;
  scheduleDate: string;
  technician: string;
  raNo: string;
  raDate: string;
  claimTo: string;
  returnStatus: string;
  repairStatus: string;
  returnReason: string;
  returnQty: number;
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const then = new Date(dateStr);
  if (Number.isNaN(then.getTime())) return null;
  const today = new Date();
  const utcThen = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  const utcToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((utcToday - utcThen) / 86400000);
}

export async function getPartReturns(): Promise<PartReturnRow[]> {
  const { data, error } = await supabase
    .from("parts")
    .select(
      "id, part_no, part_dist, part_desc, po_no, invoice_no, invoice_date, quantity, core_value, scan_out_qty, status, ra_no, ra_date, claim_to, return_status, return_reason, return_qty, tickets!inner(ticket_no, location, schedule_date, technician, status)"
    )
    .not("status", "in", `(${NOT_YET_RECEIVED_STATUSES.join(",")})`);

  if (error) {
    console.error("getPartReturns error:", error.message);
    throw new Error(error.message);
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    ticketNo: row.tickets?.ticket_no || "",
    location: row.tickets?.location || "",
    partNo: row.part_no || "",
    partDist: row.part_dist || "",
    description: row.part_desc || "",
    poNo: row.po_no || "",
    invoiceNo: row.invoice_no || "",
    invoiceDate: row.invoice_date || "",
    quantity: Number(row.quantity ?? 0),
    coreValue: Number(row.core_value ?? 0),
    scanOutQty: Number(row.scan_out_qty ?? 0),
    status: row.status || "",
    aging: daysSince(row.invoice_date),
    scheduleDate: row.tickets?.schedule_date || "",
    technician: row.tickets?.technician || "",
    raNo: row.ra_no || "",
    raDate: row.ra_date || "",
    claimTo: row.claim_to || "",
    returnStatus: row.return_status || "NOT RECEIVED",
    repairStatus: row.tickets?.status || "",
    returnReason: row.return_reason || "",
    returnQty: row.return_qty !== null && row.return_qty !== undefined ? Number(row.return_qty) : Number(row.quantity ?? 0),
  }));
}

export async function updatePartReturnEntryRow(
  id: string,
  updates: { raNo?: string; raDate?: string; returnReason?: string; returnQty?: number }
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.raNo !== undefined) payload.ra_no = updates.raNo;
  if (updates.raDate !== undefined) payload.ra_date = updates.raDate || null;
  if (updates.returnReason !== undefined) payload.return_reason = updates.returnReason || null;
  if (updates.returnQty !== undefined) payload.return_qty = updates.returnQty;
  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from("parts").update(payload).eq("id", id);
  if (error) {
    console.error("updatePartReturnEntryRow error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * "Return {Provider}" batch confirm — records that staff locally initiated
 * the return for these rows (stamps ra_date to today, only where it isn't
 * already set). Does NOT call any distributor's real return/RMA API - see
 * the file header note. Caller is responsible for restricting `ids` to
 * rows that all share one provider before calling this.
 */
export async function submitPartReturnBatch(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const { data: existing, error: fetchError } = await supabase
    .from("parts")
    .select("id, ra_date")
    .in("id", ids);
  if (fetchError) {
    console.error("submitPartReturnBatch fetch error:", fetchError.message);
    throw new Error(fetchError.message);
  }
  const needsDate = (existing ?? []).filter((r: any) => !r.ra_date).map((r: any) => r.id);
  if (needsDate.length > 0) {
    const { error } = await supabase.from("parts").update({ ra_date: today }).in("id", needsDate);
    if (error) {
      console.error("submitPartReturnBatch error:", error.message);
      throw new Error(error.message);
    }
  }
}
