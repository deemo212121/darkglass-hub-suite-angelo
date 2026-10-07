import { supabase } from "./client";
import { getFilteredPartOrders } from "./partOrders";
import type { PartInventoryRow } from "./partsInventory";
import type { StoredPartOrder } from "./partOrders";

export type PoStatusRow = StoredPartOrder & {
  usedOnTickets?: string[];
  rowKey: string;
  standalone: boolean;
  location?: string;
  branch?: string;
  progressStatus?: "Pending" | "In progress" | "Completed";
  invoiced: boolean | null;
};

export async function getPoStatusRows(): Promise<PoStatusRow[]> {
  const orders = await getFilteredPartOrders({});
  const rows: PoStatusRow[] = orders.map(o => ({
    ...o, rowKey: `local:${o.poNo}`, standalone: false,
    invoiced: o.invoiceNo || o.itemStatus === "Invoiced" ? true : o.itemStatus === "No-Invoice" ? false : null,
  }));
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("po_status_imports")
      .select("id, data").order("id").range(offset, offset + 999);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      rows.push({ ...row.data, rowKey: `import:${row.id}`, standalone: true });
    }
    if ((data?.length ?? 0) < 1000) break;
  }
  return rows;
}

/** Match recorded usage, never infer usage from a ticket's repair status. */
export function attachRecordedUsage(rows: PoStatusRow[], parts: PartInventoryRow[]): PoStatusRow[] {
  const key = (po: string, part: string) => JSON.stringify([po.trim(), part.trim()]);
  const byKey = new Map<string, PartInventoryRow[]>();
  for (const part of parts) {
    if (part.status !== "Used" || !part.poNo.trim() || !part.partNo.trim() || !part.ticketNo.trim()) continue;
    const matchKey = key(part.poNo, part.partNo);
    byKey.set(matchKey, [...(byKey.get(matchKey) || []), part]);
  }
  return rows.map(row => {
    const candidates = (byKey.get(key(row.poNo, row.partNo)) || []).filter(part =>
      // Conflicting order numbers must never link two separate purchases.
      !(row.orderNo?.trim() && part.orderNo.trim() && row.orderNo.trim() !== part.orderNo.trim())
    );
    // Repeated PO/part lines cannot be attributed to a particular imported line.
    const siblings = rows.filter(other => key(other.poNo, other.partNo) === key(row.poNo, row.partNo)
      && !(row.orderNo?.trim() && other.orderNo?.trim() && row.orderNo.trim() !== other.orderNo.trim()));
    return { ...row, usedOnTickets: siblings.length === 1
      ? [...new Set(candidates.map(part => part.ticketNo.trim()))].sort() : [] };
  });
}
