/**
 * Distributor credits → Part Transaction, from the hourly cron.
 *
 * Marcone: one GET /returns/findreturnauthorization ByDateRange (last 120
 * days) covers every return on the account, including ones made on
 * Marcone's own site — each item carries its invoice #, part #, credit memo
 * and approval / reject reason. Matched to a Marcone part row by invoice +
 * part number (our invoice_no carries suffixes Marcone's doesn't, so only
 * its leading digits are compared — see marconeInvoiceKey).
 *
 * Encompass: OFF for now (ENCOMPASS_CREDITS_ENABLED). Its only lookup is
 * orderStatus, one reference at a time, and on 10/23 it rejected every RA #
 * on our parts ("-208 invalid referenceNumber" — AHS's Encompass RA #s are
 * typed in by staff, not filed through returnRequest) while the original
 * invoice # only returned the original ORDER line. The code below is ready
 * for when we know which reference returns a return's RETURN / CREDIT line
 * (status ISSUED = "credit has been issued"). Separately, the live Worker
 * got a 403 challenge page from encompass.com for every call that day (not
 * a general Cloudflare block — a test Worker reached it fine); the loop
 * stops on a 403 and reports it.
 *
 * A credited part gets credited_at + credit_source (migration 0406), and
 * its Credit # filled with the memo only when Credit # is empty — a number
 * typed by hand is never overwritten. Parts already credited are skipped.
 */
import { marconeServerRequest } from "./marconeBridge";
import { encompassServerRequest } from "./encompassBridge";

export interface CreditPartRow {
  id: string;
  part_no: string | null;
  part_dist: string | null;
  invoice_no: string | null;
  ra_no: string | null;
  credit_no: string | null;
  credited_at: string | null;
  return_reject_reason: string | null;
  return_status: string | null;
  credit_checked_at: string | null;
}

export interface MarconeRaItem {
  invoiceNumber?: number | string | null;
  partNumber?: string | null;
  creditMemo?: string | null;
  rejectReason?: string | null;
}

export interface PartCreditUpdate {
  id: string;
  patch: Record<string, unknown>;
  label: string;
}

const ENCOMPASS_CREDITS_ENABLED = false;
const MARCONE_LOOKBACK_DAYS = 120;
const ENCOMPASS_RECHECK_MS = 6 * 60 * 60 * 1000;
const ENCOMPASS_MAX_PER_RUN = 40;

const normPart = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const isMarcone = (dist: string | null) => /marcone/i.test(dist ?? "");
const isEncompass = (dist: string | null) => /encompass/i.test(dist ?? "");
const has = (s: unknown) => String(s ?? "").trim() !== "";

/** Marcone's invoice number inside ours: "74445360-1" / "75268496-1007618260-10" → "74445360" / "75268496". */
export function marconeInvoiceKey(invoiceNo: string | null | undefined): string {
  return String(invoiceNo ?? "").trim().match(/^\d{6,}/)?.[0] ?? "";
}

/** What Marcone's return authorizations change on our Marcone parts. */
export function marconeCreditUpdates(parts: CreditPartRow[], items: MarconeRaItem[], nowIso: string): PartCreditUpdate[] {
  const byKey = new Map<string, MarconeRaItem[]>();
  for (const item of items) {
    const key = `${String(item.invoiceNumber ?? "").trim()}|${normPart(item.partNumber)}`;
    const list = byKey.get(key);
    if (list) list.push(item);
    else byKey.set(key, [item]);
  }
  const updates: PartCreditUpdate[] = [];
  for (const p of parts) {
    if (!isMarcone(p.part_dist) || p.credited_at) continue;
    const invoice = marconeInvoiceKey(p.invoice_no);
    if (!invoice || !has(p.part_no)) continue;
    const hits = byKey.get(`${invoice}|${normPart(p.part_no)}`);
    if (!hits) continue;
    const credited = hits.find((i) => has(i.creditMemo));
    if (credited) {
      const memo = String(credited.creditMemo).trim();
      updates.push({
        id: p.id,
        label: `${p.part_no} (invoice ${p.invoice_no}) credited — Marcone memo ${memo}`,
        patch: { credited_at: nowIso, credit_source: "Marcone", return_reject_reason: null, ...(has(p.credit_no) ? {} : { credit_no: memo }) },
      });
      continue;
    }
    const rejected = hits.find((i) => has(i.rejectReason));
    if (rejected) {
      const reason = String(rejected.rejectReason).trim();
      if (reason !== (p.return_reject_reason ?? "")) {
        updates.push({ id: p.id, label: `${p.part_no} (invoice ${p.invoice_no}) return rejected — ${reason}`, patch: { return_reject_reason: reason } });
      }
    }
  }
  return updates;
}

interface EncompassRecord {
  invoiceNumber?: string;
  parts?: { type?: string; status?: string; partNumber?: string; originalPartNumber?: string }[];
}

/** What one Encompass orderStatus answer (looked up by the part's RA #) changes on that part. */
export function encompassCreditUpdate(p: CreditPartRow, records: EncompassRecord[], nowIso: string): PartCreditUpdate {
  const want = normPart(p.part_no);
  const lines = records.flatMap((r) => (r.parts ?? []).map((line) => ({ ...line, recordInvoice: r.invoiceNumber })));
  const returnLines = lines.filter(
    (l) => ["RETURN", "CREDIT", "CORE RETURN"].includes(String(l.type ?? "").trim().toUpperCase()) && (normPart(l.partNumber) === want || normPart(l.originalPartNumber) === want)
  );
  const issued = returnLines.find((l) => String(l.status ?? "").trim().toUpperCase() === "ISSUED");
  if (issued) {
    const memo = String(issued.recordInvoice ?? "").trim();
    return {
      id: p.id,
      label: `${p.part_no} (RA ${p.ra_no}) credited — Encompass${memo ? ` ${memo}` : ""}`,
      patch: { credited_at: nowIso, credit_source: "Encompass", return_status: "ISSUED", credit_checked_at: nowIso, ...(has(p.credit_no) || !memo ? {} : { credit_no: memo }) },
    };
  }
  const status = String(returnLines[0]?.status ?? "").trim().toUpperCase();
  return {
    id: p.id,
    label: `${p.part_no} (RA ${p.ra_no}) ${status || "no return line found"}`,
    patch: { credit_checked_at: nowIso, ...(status && status !== (p.return_status ?? "") ? { return_status: status } : {}) },
  };
}

export interface PartCreditSyncSummary {
  candidates: number;
  marconeItems: number;
  credited: string[];
  rejected: string[];
  encompassChecked: number;
  errors: string[];
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export async function runPartCreditSync(env: Record<string, string | undefined>): Promise<PartCreditSyncSummary> {
  const summary: PartCreditSyncSummary = { candidates: 0, marconeItems: 0, credited: [], rejected: [], encompassChecked: 0, errors: [] };
  const g = globalThis as any;
  const supabaseUrl = (g.__SUPABASE_URL__ || undefined) ?? env.VITE_SUPABASE_URL;
  const serviceKey = (g.__SUPABASE_SERVICE_KEY__ || undefined) ?? env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    summary.errors.push("Missing Supabase URL/service key.");
    return summary;
  }
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  // Every not-yet-credited Marcone / Encompass part (all companies — the API accounts are the company's own).
  const parts: CreditPartRow[] = [];
  const cols = "id,part_no,part_dist,invoice_no,ra_no,credit_no,credited_at,return_reject_reason,return_status,credit_checked_at";
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${supabaseUrl}/rest/v1/parts?select=${cols}&credited_at=is.null&or=(part_dist.ilike.*marcone*,part_dist.ilike.*encompass*)&order=id`, {
      headers: { ...headers, Range: `${from}-${from + 999}` },
    });
    if (!res.ok) {
      summary.errors.push(`parts: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      return summary;
    }
    const page = (await res.json()) as CreditPartRow[];
    parts.push(...page);
    if (page.length < 1000) break;
  }
  summary.candidates = parts.length;
  const nowIso = new Date().toISOString();
  const updates: PartCreditUpdate[] = [];

  // ── Marcone ──
  if (parts.some((p) => isMarcone(p.part_dist) && marconeInvoiceKey(p.invoice_no))) {
    const custNo = Number((import.meta as any).env?.VITE_MARCONE_ACCOUNT_NUMBER || env.VITE_MARCONE_ACCOUNT_NUMBER || env.VITE_MARCONE_CUST_NO || 0) || undefined;
    const end = new Date();
    const start = new Date(end.getTime() - MARCONE_LOOKBACK_DAYS * 86400000);
    const result = await marconeServerRequest(env, {
      method: "POST",
      path: "/returns/findreturnauthorization",
      body: { custNo, lookupType: "ByDateRange", startDate: isoDay(start), endDate: isoDay(end) },
    });
    if (!result.success) {
      summary.errors.push(`Marcone: ${result.error || `HTTP ${result.status}`}`);
    } else {
      const results = ((result.data as { results?: { returnAuthorizationItems?: MarconeRaItem[] }[] })?.results ?? []);
      const items = results.flatMap((r) => r.returnAuthorizationItems ?? []);
      summary.marconeItems = items.length;
      updates.push(...marconeCreditUpdates(parts, items, nowIso));
    }
  }

  // ── Encompass (one RA at a time, paced) ──
  const due = !ENCOMPASS_CREDITS_ENABLED
    ? []
    : parts
        .filter((p) => isEncompass(p.part_dist) && has(p.ra_no) && has(p.part_no) && (!p.credit_checked_at || Date.now() - new Date(p.credit_checked_at).getTime() > ENCOMPASS_RECHECK_MS))
        .slice(0, ENCOMPASS_MAX_PER_RUN);
  for (const p of due) {
    const result = await encompassServerRequest(env, { path: "/restfulservice/orderStatus", data: { referenceNumber: String(p.ra_no).trim() } });
    if (result.status === 403) {
      summary.errors.push("Encompass: blocked by encompass.com (HTTP 403) — skipped this run.");
      break;
    }
    const envelope = result.data as { status?: { errorCode?: string; errorMessage?: string }; data?: { records?: EncompassRecord[] } } | undefined;
    if (!result.success || String(envelope?.status?.errorCode ?? "").trim() !== "100") {
      // "Not found" is an answer too — note the check so it isn't retried every hour.
      updates.push({ id: p.id, label: `${p.part_no} (RA ${p.ra_no}) Encompass: ${envelope?.status?.errorMessage || result.error || `HTTP ${result.status}`}`, patch: { credit_checked_at: nowIso } });
      continue;
    }
    summary.encompassChecked++;
    updates.push(encompassCreditUpdate(p, envelope?.data?.records ?? [], nowIso));
  }

  for (const u of updates) {
    const res = await fetch(`${supabaseUrl}/rest/v1/parts?id=eq.${u.id}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(u.patch) });
    if (!res.ok) {
      summary.errors.push(`${u.label}: HTTP ${res.status}`);
      continue;
    }
    if ("credited_at" in u.patch) summary.credited.push(u.label);
    else if ("return_reject_reason" in u.patch) summary.rejected.push(u.label);
  }
  return summary;
}
