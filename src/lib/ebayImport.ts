/**
 * Reads the eBay team's Google Sheets / Excel workbook for Parts → Parts
 * Daily Report eBAY → Import Excel (EbayImportModal).
 *
 * Their workbook, as-is (no template needed):
 *   - "ALL SALES": several sales tables stacked on one tab, each with the
 *     header  Order I.D | Part# | Quantity | Status | Order Earnings |
 *     Order date | Sales ACC | Location | Notes,  a red date line above it
 *     and a total row under it.                              → eBay Orders
 *   - one tab per branch group (ATL & JS LISTINGS, CT LISTINGS, …) with
 *     DATE | PART# | EBAY ACC | LOCATION | PRICE | QTY#, days separated by
 *     green blank rows.                                      → eBay Listings
 *
 * Every tab is scanned for those header rows (by name, so column order and
 * spacer columns don't matter); the rows under a header are read until the
 * next header. Blank rows, date lines and total rows are skipped. Each row
 * comes back as ready / warning (imports, but worth a look) / error (won't
 * import) / duplicate (already in AHS or earlier in the file).
 */
import * as XLSX from "xlsx";
import { LOCATIONS } from "@/lib/locations";
import { EBAY_ORDER_STATUSES } from "@/lib/supabase/partDailyReportEbay";

export type ImportRowState = "ready" | "warning" | "error" | "duplicate";

export interface ParsedOrder {
  sheet: string;
  row: number; // 1-based, as in Excel
  state: ImportRowState;
  messages: string[];
  orderExtId: string;
  partNo: string;
  quantity: number;
  status: string;
  orderEarnings: number;
  orderDate: string;
  salesAccount: string;
  branch: string;
  notes: string;
}

export interface ParsedListing {
  sheet: string;
  row: number;
  state: ImportRowState;
  messages: string[];
  partNo: string;
  ebayAccount: string;
  branch: string;
  price: number;
  quantity: number;
  listedDate: string;
  status: string;
}

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9#]/g, "");

// Header names → field. Matched loosely (case, spaces, dots ignored).
const ORDER_HEADERS: Record<string, keyof ParsedOrder> = {
  orderid: "orderExtId", orderno: "orderExtId", order: "orderExtId", "order#": "orderExtId",
  "part#": "partNo", partno: "partNo", part: "partNo", partnumber: "partNo",
  quantity: "quantity", qty: "quantity", "qty#": "quantity",
  status: "status",
  orderearnings: "orderEarnings", earnings: "orderEarnings",
  orderdate: "orderDate", date: "orderDate",
  salesacc: "salesAccount", salesaccount: "salesAccount", ebayacc: "salesAccount", account: "salesAccount",
  location: "branch", branch: "branch",
  notes: "notes", note: "notes",
};
const LISTING_HEADERS: Record<string, keyof ParsedListing> = {
  date: "listedDate", listeddate: "listedDate", listingdate: "listedDate",
  "part#": "partNo", partno: "partNo", part: "partNo", partnumber: "partNo",
  ebayacc: "ebayAccount", ebayaccount: "ebayAccount", account: "ebayAccount", salesacc: "ebayAccount",
  location: "branch", branch: "branch",
  price: "price",
  "qty#": "quantity", qty: "quantity", quantity: "quantity",
  status: "status",
};

/** "Order I.D" → "orderid", "PART#" → "part#" */
const headerKey = norm;

function headerMap<T>(row: unknown[], names: Record<string, T>): Map<T, number> {
  const m = new Map<T, number>();
  row.forEach((cell, i) => {
    const f = names[headerKey(cell)];
    if (f !== undefined && !m.has(f)) m.set(f, i);
  });
  return m;
}

const isOrdersHeader = (row: unknown[]) => {
  const keys = row.map(headerKey);
  return keys.some((k) => k === "orderid" || k === "order#" || k === "orderno") && keys.some((k) => ORDER_HEADERS[k] === "partNo");
};
const isListingsHeader = (row: unknown[]) => {
  const keys = row.map(headerKey);
  return keys.some((k) => LISTING_HEADERS[k] === "listedDate") && keys.some((k) => LISTING_HEADERS[k] === "partNo") && keys.some((k) => k === "price");
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Excel serial, Date, "8/6/2026", "2026-08-06" → "2026-08-06"; null if it isn't a date. */
function toISODate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : null;
  }
  if (v instanceof Date && !isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  const s = String(v).trim();
  let m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const mo = Number(m[1]);
    const d = Number(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
    return null;
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  return null;
}

/** "$1,234.50" / "-26.75" / 12.5 → number; null if it isn't a number (e.g. "$xx"). */
function toMoney(v: unknown): number | null {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || s.includes("-");
  const digits = s.replace(/[^0-9.]/g, "");
  if (!digits || isNaN(Number(digits))) return null;
  return (neg ? -1 : 1) * Number(digits);
}

/** Part numbers stay text — 5304536448 must not become 5.3E+9. */
function toPartNo(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v ?? "").trim();
}

const BRANCH_BY_KEY = new Map(LOCATIONS.map((l) => [norm(l), l]));
// Short names the team uses that aren't the branch's own name.
const BRANCH_ALIASES: Record<string, string> = { jacksonms: "Jackson, MS", jacksontn: "Jackson, TN" };

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** Branch as in AHS. A near-miss (e.g. "SANANNAH") is matched with a warning; anything else is an error. */
function matchBranch(v: unknown): { branch: string; warning?: string; error?: string } {
  const raw = String(v ?? "").trim();
  if (!raw) return { branch: "", error: "No location" };
  const k = norm(raw);
  const exact = BRANCH_BY_KEY.get(k) ?? BRANCH_ALIASES[k];
  if (exact) return { branch: exact };
  let best: { name: string; d: number } | null = null;
  for (const [key, name] of BRANCH_BY_KEY) {
    const d = editDistance(k, key);
    if (!best || d < best.d) best = { name, d };
  }
  if (best && best.d <= 2) return { branch: best.name, warning: `Location "${raw}" read as ${best.name}` };
  return { branch: raw, error: `Unknown location "${raw}"` };
}

function matchFromList(v: unknown, list: readonly string[]): string | null {
  const k = norm(v);
  return list.find((x) => norm(x) === k) ?? null;
}

const finish = <T extends { state: ImportRowState; messages: string[] }>(r: T, errors: string[], warnings: string[]): T => {
  r.messages = [...errors, ...warnings];
  r.state = errors.length ? "error" : warnings.length ? "warning" : "ready";
  return r;
};

export function parseEbayWorkbook(data: ArrayBuffer, accounts: string[]): { orders: ParsedOrder[]; listings: ParsedListing[]; sheetsRead: string[] } {
  const wb = XLSX.read(data, { type: "array", cellDates: false });
  const orders: ParsedOrder[] = [];
  const listings: ParsedListing[] = [];
  const sheetsRead: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: true, defval: "", blankrows: true });
    let mode: "orders" | "listings" | null = null;
    let oCols = new Map<keyof ParsedOrder, number>();
    let lCols = new Map<keyof ParsedListing, number>();
    let used = false;

    rows.forEach((row, idx) => {
      if (isOrdersHeader(row)) {
        mode = "orders";
        oCols = headerMap(row, ORDER_HEADERS);
        return;
      }
      if (isListingsHeader(row)) {
        mode = "listings";
        lCols = headerMap(row, LISTING_HEADERS);
        return;
      }
      if (!mode) return;
      const at = <K,>(cols: Map<K, number>, f: K) => (cols.has(f) ? row[cols.get(f)!] : "");

      if (mode === "orders") {
        const orderExtId = toPartNo(at(oCols, "orderExtId"));
        // Blank rows, date lines and total rows have no order id.
        if (!orderExtId || toISODate(orderExtId)) return;
        used = true;
        const errors: string[] = [];
        const warnings: string[] = [];
        const partNo = toPartNo(at(oCols, "partNo"));
        if (!partNo) warnings.push("No part #");
        const qRaw = at(oCols, "quantity");
        const quantity = qRaw === "" ? 1 : Number(qRaw);
        if (!Number.isFinite(quantity) || quantity < 0) errors.push(`Quantity "${qRaw}" isn't a number`);
        const status = matchFromList(at(oCols, "status"), EBAY_ORDER_STATUSES);
        if (!status) errors.push(`Unknown status "${at(oCols, "status")}"`);
        const eRaw = at(oCols, "orderEarnings");
        let orderEarnings = toMoney(eRaw);
        if (orderEarnings === null) {
          if (String(eRaw).trim()) warnings.push(`Earnings "${eRaw}" saved as $0`);
          orderEarnings = 0;
        }
        const orderDate = toISODate(at(oCols, "orderDate"));
        if (!orderDate) errors.push(`Order date "${at(oCols, "orderDate")}" isn't a date`);
        const salesAccount = matchFromList(at(oCols, "salesAccount"), accounts);
        if (!salesAccount) errors.push(`Unknown sales account "${at(oCols, "salesAccount")}"`);
        const b = matchBranch(at(oCols, "branch"));
        if (b.error) errors.push(b.error);
        if (b.warning) warnings.push(b.warning);
        let notes = String(at(oCols, "notes") ?? "").trim();
        if (norm(notes) === "notes") notes = "";
        orders.push(
          finish(
            {
              sheet: sheetName, row: idx + 1, state: "ready", messages: [],
              orderExtId, partNo, quantity: Number.isFinite(quantity) ? quantity : 0, status: status ?? String(at(oCols, "status")),
              orderEarnings, orderDate: orderDate ?? "", salesAccount: salesAccount ?? String(at(oCols, "salesAccount")), branch: b.branch, notes,
            },
            errors,
            warnings
          )
        );
      } else {
        const partNo = toPartNo(at(lCols, "partNo"));
        const dateRaw = at(lCols, "listedDate");
        // Green separator rows / blank rows: no part and no date.
        if (!partNo && !String(dateRaw).trim()) return;
        used = true;
        const errors: string[] = [];
        const warnings: string[] = [];
        if (!partNo) errors.push("No part #");
        const listedDate = toISODate(dateRaw);
        if (!listedDate) errors.push(`Date "${dateRaw}" isn't a date`);
        const ebayAccount = matchFromList(at(lCols, "ebayAccount"), accounts);
        if (!ebayAccount) errors.push(`Unknown eBay account "${at(lCols, "ebayAccount")}"`);
        const b = matchBranch(at(lCols, "branch"));
        if (b.error) errors.push(b.error);
        if (b.warning) warnings.push(b.warning);
        const price = toMoney(at(lCols, "price"));
        if (price === null) errors.push(`Price "${at(lCols, "price")}" isn't a number`);
        const qRaw = at(lCols, "quantity");
        const quantity = qRaw === "" ? 1 : Number(qRaw);
        if (!Number.isFinite(quantity) || quantity < 0) errors.push(`Qty "${qRaw}" isn't a number`);
        const statusRaw = at(lCols, "status");
        const status = statusRaw === "" ? "Listed" : matchFromList(statusRaw, ["Listed", "Sold"]);
        if (!status) errors.push(`Unknown status "${statusRaw}"`);
        listings.push(
          finish(
            {
              sheet: sheetName, row: idx + 1, state: "ready", messages: [],
              partNo, ebayAccount: ebayAccount ?? String(at(lCols, "ebayAccount")), branch: b.branch, price: price ?? 0,
              quantity: Number.isFinite(quantity) ? quantity : 0, listedDate: listedDate ?? "", status: status ?? String(statusRaw),
            },
            errors,
            warnings
          )
        );
      }
    });
    if (used) sheetsRead.push(sheetName);
  }
  return { orders, listings, sheetsRead };
}

export const listingKey = (r: { listedDate: string; partNo: string; branch: string; ebayAccount: string; price: number }) =>
  `${r.listedDate}|${r.partNo.trim().toLowerCase()}|${r.branch}|${r.ebayAccount}|${Number(r.price).toFixed(2)}`;

/** Mark rows already in AHS (or repeated earlier in the file) as duplicates. Errors stay errors. */
export function markDuplicates(
  orders: ParsedOrder[],
  listings: ParsedListing[],
  existingOrderIds: Set<string>,
  existingListingKeys: Set<string>
): void {
  const seenOrders = new Set<string>();
  for (const o of orders) {
    if (o.state === "error") continue;
    if (existingOrderIds.has(o.orderExtId)) {
      o.state = "duplicate";
      o.messages = ["Already in AHS"];
    } else if (seenOrders.has(o.orderExtId)) {
      o.state = "duplicate";
      o.messages = ["Same order ID earlier in the file"];
    }
    seenOrders.add(o.orderExtId);
  }
  const seenListings = new Set<string>();
  for (const l of listings) {
    if (l.state === "error") continue;
    const k = listingKey(l);
    if (existingListingKeys.has(k)) {
      l.state = "duplicate";
      l.messages = ["Already in AHS"];
    } else if (seenListings.has(k)) {
      l.state = "duplicate";
      l.messages = ["Same listing earlier in the file"];
    }
    seenListings.add(k);
  }
}
