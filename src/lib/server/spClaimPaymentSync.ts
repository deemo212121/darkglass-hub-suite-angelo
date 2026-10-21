/**
 * ServicePower claim payments → CL-Data-Closed.
 *
 * Every hour (server.ts `scheduled`), for each company that has turned it on
 * (companies.settings.spClaimAutoDataClose = true), a batch of CL-Claimed
 * tickets that came from ServicePower is looked up on ServicePower's claim
 * retrieval API — read-only, nothing is filed. A claim ServicePower shows
 * paid (status P, paidTotal over $0) moves the ticket to CL-Data-Closed,
 * unless the Pre-Claim window has a Claim Total for it and ServicePower paid
 * less: that ticket stays CL-Claimed and its claim details say "Short-paid"
 * so Claims can follow up.
 *
 * Claims filed on the ServicePower website have no Claim Total in AHS (no
 * Pre-Claim fees — their parts alone aren't what was claimed), so "paid"
 * alone decides for them (Claims' call, 2026-10-20).
 *
 * Every claim found also has what ServicePower paid saved onto its claim
 * details (migration 0397) for the Claim List — closed or not.
 *
 * The status change is a plain tickets update with the service key, so
 * trg_ticket_audit logs it as a system change (changed_by NULL), the same as
 * the ServicePower/NSA syncs, and stamps status_changed_at.
 *
 * Looking a claim up needs the call's own ServiceCenter (getCallInfo) and
 * the name ServicePower files the claim under — see spClaimLookup.ts, which
 * the Claim List's Sync Status shares.
 */
import { handleServicePowerRequest } from "./servicePowerBridge";
import { isClaimablePart } from "../servicePowerClaimPayload";
import {
  isShortPaid,
  isSpClaimPaid,
  isWrongManufacturerName,
  latestSpClaim,
  SP_PAID_COLUMNS_0397,
  spClaimDetailsColumns,
  spClaimLookupNames,
  spClaimPaid,
  type SpRetrievedClaim,
} from "../spClaimLookup";

export const SP_PAID_CLOSED_STATUS = "CL-Data-Closed";
const CLAIMED_STATUS = "CL-Claimed";
/** Tickets looked up per hourly run (each takes 2–4 ServicePower calls); the window moves on every hour. */
const HOURLY_BATCH = 40;

export interface SpClaimDecision {
  ticketNo: string;
  ticketId: string;
  outcome: "close" | "short-paid" | "not-paid" | "not-found" | "error";
  /** ServicePower's claim status, e.g. "P Approved for Payment". */
  spStatus: string;
  paidTotal: number | null;
  /** YYYY-MM-DD */
  paymentDate: string | null;
  /** The Pre-Claim window's Claim Total, when the ticket has Pre-Claim fees. */
  claimTotal: number | null;
  detail: string;
  /** Whether the change was written (false on a preview). */
  applied: boolean;
}

export interface SpClaimPaymentSummary {
  companies: number;
  candidates: number;
  checked: number;
  closed: number;
  shortPaid: number;
  errors: string[];
  decisions: SpClaimDecision[];
}

interface Ctx {
  url: string;
  headers: Record<string, string>;
  env: Record<string, string | undefined>;
  companyId: string;
}

interface TicketRow {
  id: string;
  ticket_no: string;
  manufacturer: string | null;
}

function resolveCreds(env: Record<string, string | undefined>) {
  const g = globalThis as any;
  const supabaseUrl =
    (g.__SUPABASE_URL__ && g.__SUPABASE_URL__ !== "" ? g.__SUPABASE_URL__ : undefined) ?? env.VITE_SUPABASE_URL;
  const supabaseServiceKey =
    (g.__SUPABASE_SERVICE_KEY__ && g.__SUPABASE_SERVICE_KEY__ !== "" ? g.__SUPABASE_SERVICE_KEY__ : undefined) ??
    env.SUPABASE_SERVICE_KEY;
  return { supabaseUrl, supabaseServiceKey };
}

async function rest<T = any>(ctx: Ctx, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ctx.url}/rest/v1/${path}`, {
    ...init,
    headers: { ...ctx.headers, ...((init?.headers as Record<string, string>) ?? {}) },
  });
  if (!res.ok) throw new Error(`${path.split("?")[0]}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  if (res.status === 204) return null as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** The ServicePower bridge in-process — same credentials (Account Management) and endpoints as /api/servicepower. */
async function sp(ctx: Ctx, action: "getCallInfo" | "retrieveClaim", params: Record<string, unknown>): Promise<any> {
  const res = await handleServicePowerRequest(
    new Request("https://internal/api/servicepower", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, params, companyId: ctx.companyId }),
    }),
    ctx.env,
  );
  return res.json();
}

const xmlTag = (xml: string, name: string) =>
  (xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, "i"))?.[1] ?? "").trim();

const money = (n: number) => `$${n.toFixed(2)}`;

/** The company's CL-Claimed tickets that came from ServicePower (SP login account, or a GE / SP source). */
async function claimedSpTickets(ctx: Ctx): Promise<TicketRow[]> {
  const out: TicketRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const rows = await rest<TicketRow[]>(
      ctx,
      `tickets?select=id,ticket_no,manufacturer` +
        `&company_id=eq.${ctx.companyId}&status=eq.${encodeURIComponent(CLAIMED_STATUS)}` +
        `&or=(account.ilike.GSL*,account.eq.GE,ticket_source.eq.SP,ticket_source.eq.GE)` +
        `&order=id.asc&limit=${PAGE}&offset=${offset}`,
    );
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Pre-Claim Claim Total per ticket id — only for tickets with Pre-Claim fees (same sum as PreClaimModal's claimTotal). */
async function preClaimTotals(ctx: Ctx, ticketIds: string[]): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  for (let i = 0; i < ticketIds.length; i += 100) {
    const ids = ticketIds.slice(i, i + 100).join(",");
    const details = await rest<any[]>(
      ctx,
      `ticket_claim_details?select=ticket_id,labor_fee,other_fee,shipping_fee,extra_mile_fee,mileage_fee&ticket_id=in.(${ids})`,
    );
    const withFees = details.filter(
      (d) => (Number(d.labor_fee) || 0) + (Number(d.other_fee) || 0) + (Number(d.shipping_fee) || 0) + (Number(d.extra_mile_fee) || 0) + (Number(d.mileage_fee) || 0) > 0,
    );
    if (withFees.length === 0) continue;
    const parts = await rest<any[]>(
      ctx,
      `parts?select=ticket_id,part_price,markup,status&ticket_id=in.(${withFees.map((d) => d.ticket_id).join(",")})`,
    );
    for (const d of withFees) {
      const partFee = parts
        .filter((p) => p.ticket_id === d.ticket_id && isClaimablePart(p))
        .reduce((s, p) => s + (Number(p.part_price) || 0) * (1 + (Number(p.markup) || 0) / 100), 0);
      const fees = (Number(d.labor_fee) || 0) + (Number(d.other_fee) || 0) + (Number(d.shipping_fee) || 0) + (Number(d.extra_mile_fee) || 0) + (Number(d.mileage_fee) || 0);
      totals.set(d.ticket_id, Math.round((fees + partFee) * 100) / 100);
    }
  }
  return totals;
}

/** Looks the ticket's claim up on ServicePower and decides what should happen — no writes. */
async function decide(ctx: Ctx, t: TicketRow, claimTotal: number | null): Promise<SpClaimDecision & { claim?: SpRetrievedClaim }> {
  const base = { ticketNo: t.ticket_no, ticketId: t.id, spStatus: "", paidTotal: null, paymentDate: null, claimTotal, applied: false };
  const call = await sp(ctx, "getCallInfo", { callNo: t.ticket_no });
  const xml = String(call?.xml ?? "");
  const center = xmlTag(xml, "ServiceCenter");
  if (!center) return { ...base, outcome: "not-found", detail: "Call not found on ServicePower" };
  const names = spClaimLookupNames(xmlTag(xml, "MfgId"), t.ticket_no, t.manufacturer, xmlTag(xml, "SPBrandDesc"));

  let claims: SpRetrievedClaim[] = [];
  let lastMessage = "";
  for (const manufacturerName of names) {
    const r = await sp(ctx, "retrieveClaim", { manufacturerName, serviceCenterNumber: center, claimNumber: t.ticket_no });
    if (Array.isArray(r?.claims) && r.claims.length > 0) {
      claims = r.claims;
      break;
    }
    lastMessage = (r?.messages ?? []).map((m: { message: string }) => m.message).join("; ") || String(r?.error ?? "");
    if (!isWrongManufacturerName(lastMessage)) break;
  }
  const claim = latestSpClaim(claims);
  if (!claim) return { ...base, outcome: "not-found", detail: lastMessage || "No claim on ServicePower" };

  const spStatus = `${claim.claimStatusCode ?? ""} ${claim.claimStatusDescription ?? ""}`.trim();
  const paid = spClaimPaid(claim);
  const found = { ...base, spStatus, paidTotal: paid.total, paymentDate: paid.paymentDate, claim };

  if (!isSpClaimPaid(claim)) return { ...found, outcome: "not-paid", detail: "Not paid yet" };
  if (isShortPaid(paid.total, claimTotal)) {
    return { ...found, outcome: "short-paid", detail: `ServicePower paid ${money(paid.total)} of ${money(claimTotal ?? 0)} claimed` };
  }
  return {
    ...found,
    outcome: "close",
    detail: claimTotal != null ? `Paid ${money(paid.total)} = Claim Total ${money(claimTotal)}` : `Paid ${money(paid.total)} (no Pre-Claim Claim Total to compare)`,
  };
}

/** Saves what ServicePower has on the claim; moves "close" decisions to CL-Data-Closed (only if still CL-Claimed). */
async function apply(ctx: Ctx, d: SpClaimDecision & { claim?: SpRetrievedClaim }): Promise<void> {
  if (!d.claim) return;
  const columns: Record<string, unknown> = { ticket_id: d.ticketId, company_id: ctx.companyId, ...spClaimDetailsColumns(d.claim, new Date().toISOString()) };
  const write = (body: Record<string, unknown>) =>
    rest(ctx, `ticket_claim_details?on_conflict=ticket_id`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(body),
    });
  try {
    await write(columns);
  } catch (err) {
    // Migration 0397 not run yet: keep the status/batch columns, drop the paid amounts.
    if (!/sp_paid_|sp_payment_date|sp_received_date|sp_claim_checked_at/.test(String(err))) throw err;
    for (const c of SP_PAID_COLUMNS_0397) delete columns[c];
    await write(columns);
  }
  if (d.outcome !== "close") {
    if (d.outcome === "short-paid") d.applied = true;
    return;
  }
  const updated = await rest<any[]>(
    ctx,
    `tickets?id=eq.${d.ticketId}&status=eq.${encodeURIComponent(CLAIMED_STATUS)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ status: SP_PAID_CLOSED_STATUS }),
    },
  );
  if (updated.length === 0) d.detail += " — status had already changed, left alone";
  else d.applied = true;
}

async function runForCompany(
  ctx: Ctx,
  summary: SpClaimPaymentSummary,
  opts: { apply: boolean; limit: number; rotate: boolean; concurrency: number; ticketNos?: string[] },
): Promise<void> {
  let tickets = await claimedSpTickets(ctx);
  if (opts.ticketNos?.length) {
    const want = new Set(opts.ticketNos);
    tickets = tickets.filter((t) => want.has(t.ticket_no));
  }
  summary.candidates += tickets.length;
  if (tickets.length === 0) return;

  // Hourly runs take the next window of tickets each hour, so every claimed
  // ticket gets looked at every few hours without one run doing them all.
  let batch = tickets;
  if (opts.rotate && tickets.length > opts.limit) {
    const start = (Math.floor(Date.now() / 3_600_000) * opts.limit) % tickets.length;
    batch = [...tickets.slice(start), ...tickets.slice(0, start)].slice(0, opts.limit);
  } else {
    batch = tickets.slice(0, opts.limit);
  }

  const totals = await preClaimTotals(ctx, batch.map((t) => t.id));
  let next = 0;
  const worker = async () => {
    while (next < batch.length) {
      const t = batch[next++];
      try {
        const d = await decide(ctx, t, totals.get(t.id) ?? null);
        if (opts.apply) await apply(ctx, d);
        delete d.claim;
        summary.checked++;
        if (d.outcome === "close" && (d.applied || !opts.apply)) summary.closed++;
        if (d.outcome === "short-paid") summary.shortPaid++;
        summary.decisions.push(d);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        summary.errors.push(`${t.ticket_no}: ${message}`);
        summary.decisions.push({ ticketNo: t.ticket_no, ticketId: t.id, outcome: "error", spStatus: "", paidTotal: null, paymentDate: null, claimTotal: totals.get(t.id) ?? null, detail: message, applied: false });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
}

/**
 * `apply: false` is a preview: every lookup runs, nothing is written. With
 * `companyId` it runs for that company whether or not it's turned on (the
 * preview); without, only for companies with settings.spClaimAutoDataClose.
 * Hourly runs look at HOURLY_BATCH tickets (`rotate`); `limit` overrides.
 */
export async function runSpClaimPaymentSync(
  env: Record<string, string | undefined>,
  opts: { apply?: boolean; companyId?: string; limit?: number; rotate?: boolean; concurrency?: number; ticketNos?: string[] } = {},
): Promise<SpClaimPaymentSummary> {
  const summary: SpClaimPaymentSummary = { companies: 0, candidates: 0, checked: 0, closed: 0, shortPaid: 0, errors: [], decisions: [] };
  const { supabaseUrl, supabaseServiceKey } = resolveCreds(env);
  if (!supabaseUrl || !supabaseServiceKey) {
    summary.errors.push("Missing Supabase URL/service key — cannot run.");
    return summary;
  }
  const headers = { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}` };
  const base = { url: supabaseUrl, headers, env };

  const companyIds = opts.companyId
    ? [opts.companyId]
    : (
        await rest<{ id: string }[]>({ ...base, companyId: "" }, `companies?select=id&settings->>spClaimAutoDataClose=eq.true`)
      ).map((c) => c.id);

  for (const companyId of companyIds) {
    summary.companies++;
    try {
      await runForCompany({ ...base, companyId }, summary, {
        apply: opts.apply ?? false,
        limit: opts.limit ?? HOURLY_BATCH,
        rotate: opts.rotate ?? !opts.companyId,
        concurrency: opts.concurrency ?? 1,
        ticketNos: opts.ticketNos,
      });
    } catch (err) {
      summary.errors.push(`company ${companyId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary;
}
