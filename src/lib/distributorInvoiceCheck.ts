/**
 * Looks one invoice up on the distributor's own API, for Marcone & Encompass
 * Parts — read-only order-status calls through the /api/marcone and
 * /api/encompass bridges (nothing is ordered or changed):
 *
 *   Marcone   POST /orders/orderstatus by order number — Marcone's invoice #
 *             (its leading digits) is the order number.
 *   Encompass POST /restfulservice/orderStatus by referenceNumber — the
 *             invoice # without our line ending.
 *
 * Neither API can list every order on the account (Marcone rejects every
 * date-range lookup type; Encompass needs a reference number), so this only
 * checks invoices AHS already has. See distributorPartClaims.ts for the refs.
 */
import { marconeRequest } from "@/lib/marconeApi";
import { encompassOrderStatus } from "@/lib/encompassApi";
import type { DistributorInvoiceLine, PartDistributor } from "@/lib/distributorPartClaims";

export interface DistributorInvoice {
  found: boolean;
  /** Why it wasn't found / couldn't be checked ("Order not found.", a 403, …). */
  error?: string;
  /** Couldn't be checked right now (rate limit, network) — worth asking again, not an answer. */
  transient?: boolean;
  invoiceNumber: string;
  /** YYYY-MM-DD */
  invoiceDate: string;
  status: string;
  lines: DistributorInvoiceLine[];
}

const day = (v: unknown) => String(v ?? "").slice(0, 10);
const num = (v: unknown): number | null => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
};
const notFound = (error: string): DistributorInvoice => ({ found: false, error, invoiceNumber: "", invoiceDate: "", status: "", lines: [] });

interface MarconeOrderRaw {
  orderNumber?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  status?: string;
  orderItems?: Array<{
    partNumber?: string;
    originalPartNumber?: string;
    price?: number;
    billedPrice?: number;
    ordered?: number;
    shipped?: number;
    returned?: number;
    status?: string;
  }>;
}

async function lookupMarcone(ref: string): Promise<DistributorInvoice> {
  const env = (import.meta as any).env || {};
  const custNo = Number(env.VITE_MARCONE_ACCOUNT_NUMBER || env.VITE_MARCONE_CUST_NO || 0);
  if (!custNo) return notFound("Marcone customer number not configured.");
  // trackHealth: false — "Order not found." is an answer here, not an outage.
  const result = await marconeRequest<{ orderResults?: MarconeOrderRaw[]; errorMessage?: string }>("/orders/orderstatus", {
    method: "POST",
    body: { custNo, orderNumber: ref, orderNumbers: [ref] },
    trackHealth: false,
  });
  const data = result.data as { orderResults?: MarconeOrderRaw[]; errorMessage?: string } | undefined;
  if (!result.success) {
    // "Order not found." is Marcone's answer; anything else (network, auth, 5xx) isn't.
    const answered = /not found/i.test(data?.errorMessage ?? "");
    return { ...notFound(data?.errorMessage || result.error || `HTTP ${result.status ?? "?"}`), transient: !answered };
  }
  const orders = data?.orderResults ?? [];
  const o = orders.find((x) => x.invoiceNumber === ref || x.orderNumber === ref) ?? orders[0];
  if (!o) return notFound("Order not found.");
  return {
    found: true,
    invoiceNumber: String(o.invoiceNumber ?? ""),
    invoiceDate: day(o.invoiceDate),
    status: String(o.status ?? ""),
    lines: (o.orderItems ?? []).map((it) => {
      const qty = Number(it.shipped) || Number(it.ordered) || 0;
      const unitPrice = num(it.billedPrice) ?? num(it.price);
      return {
        partNumbers: [it.partNumber, it.originalPartNumber].filter((v): v is string => !!v),
        qty,
        unitPrice,
        amount: unitPrice == null ? null : Math.round(unitPrice * qty * 100) / 100,
        status: String(it.status ?? ""),
        returned: Number(it.returned) || 0,
      };
    }),
  };
}

// encompass.com answers HTTP 429 after ~25 quick lookups (tested 11/11: one
// call a second stays under it), so Encompass calls go one at a time, spaced
// out, and a 429 waits and asks again.
const ENCOMPASS_GAP_MS = 1100;
const ENCOMPASS_429_WAIT_MS = 10_000;
const ENCOMPASS_TRIES = 3;
let encompassQueue: Promise<unknown> = Promise.resolve();
function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = encompassQueue.then(fn);
  encompassQueue = run.catch(() => undefined).then(() => new Promise((r) => setTimeout(r, ENCOMPASS_GAP_MS)));
  return run;
}

async function lookupEncompass(ref: string): Promise<DistributorInvoice> {
  let result = await paced(() => encompassOrderStatus({ referenceNumber: ref }));
  for (let tries = 1; result.httpStatus === 429 && tries < ENCOMPASS_TRIES; tries++) {
    await new Promise((r) => setTimeout(r, ENCOMPASS_429_WAIT_MS));
    result = await paced(() => encompassOrderStatus({ referenceNumber: ref }));
  }
  if (!result.success) {
    // "-208 invalid referenceNumber" is Encompass saying it has no such invoice; anything else isn't an answer.
    const answered = /invalid referenceNumber/i.test(result.error ?? "");
    return { ...notFound(result.error || "Encompass lookup failed."), transient: !answered };
  }
  const r = result.records.find((x) => x.invoiceNumber === ref) ?? result.records[0];
  if (!r) return notFound("Invoice not found.");
  return {
    found: true,
    invoiceNumber: String(r.invoiceNumber ?? ""),
    invoiceDate: day(r.invoiceDate),
    // Encompass's status is per line (SHIPPED, …).
    status: "",
    lines: r.parts
      .filter((p) => !p.type || p.type.toUpperCase() === "ORDER")
      .map((p) => {
        const qty = p.shipQuantity ?? p.orderQuantity ?? 0;
        const unitPrice = p.unitPrice ?? null;
        return {
          partNumbers: [p.partNumber, p.originalPartNumber].filter((v): v is string => !!v),
          qty,
          unitPrice,
          amount: p.extendedPrice ?? (unitPrice == null ? null : Math.round(unitPrice * qty * 100) / 100),
          status: String(p.status ?? ""),
          returned: 0,
        };
      }),
  };
}

/** Answers kept for the session, so coming back to the page doesn't ask again (Encompass rate-limits). */
const answers = new Map<string, DistributorInvoice>();

export async function lookupDistributorInvoice(dist: PartDistributor, ref: string): Promise<DistributorInvoice> {
  const key = `${dist}|${ref}`;
  const cached = answers.get(key);
  if (cached) return cached;
  let invoice: DistributorInvoice;
  try {
    invoice = dist === "Marcone" ? await lookupMarcone(ref) : await lookupEncompass(ref);
  } catch (err) {
    invoice = { ...notFound(err instanceof Error ? err.message : String(err)), transient: true };
  }
  if (!invoice.transient) answers.set(key, invoice);
  return invoice;
}

/** Forget these answers so the next lookup asks the distributor again ("Check again"). */
export function forgetDistributorInvoices(keys: string[]): void {
  for (const k of keys) answers.delete(k);
}
