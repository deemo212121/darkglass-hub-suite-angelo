/**
 * ServicePower auto-pull — every hour (server.ts `scheduled`).
 *
 * For each company that turned it on (companies.settings.spAutoPull, set on
 * Data Migration or by migration 0475), ServicePower's open calls (Accepted
 * / Open — never Claimed, Completed, Cancelled or Rejected) from the chosen
 * sources (e.g. GE, SQUARE TRADE, ELECTROLUX) that aren't tickets in AHS
 * yet are added. Same rules as the Data Migration button: a ticket already
 * in AHS is never changed (re-updating one from ServicePower overwrote its
 * technician and cleared its check-ins).
 *
 * Each run looks at calls received in the last AUTO_PULL_LOOKBACK_DAYS days
 * (never before settings.from), so a call that only turns Accepted a few
 * days after it was received is still picked up.
 *
 * Tickets are built with the app's own code (convertCallToTicket +
 * buildServicePowerPayloads) and written with the service key, with the
 * company set explicitly (set_company_id keeps it for the service role,
 * migration 0203). The branch comes from that company's Location
 * Management ZIPs, the same as for a signed-in user. Every ticket added
 * gets an sp_pull_log row (mode "auto") for Data Migration's list.
 */
import { handleServicePowerRequest } from "./servicePowerBridge";
import { parseGetCallInfoResponse } from "../servicePowerSoapParser";
import { convertCallToTicket, isOpenCall } from "../servicePowerSync";
import { clearZipCoverageOverrides, registerZipCoverage } from "../zipCoverage";
import { buildServicePowerPayloads, parseScheduleDateForSql } from "../servicePowerPayloads";
import {
  autoPullWindows,
  centralTodayIso,
  isAutoPullSource,
  readSpAutoPullSettings,
  spWindowDate,
  type SpAutoPullSettings,
} from "../servicePowerAutoPullRules";

export interface SpAutoPullCompanyResult {
  companyId: string;
  sources: string[];
  windows: Array<{ from: string; to: string }>;
  calls: number;
  /** Open calls from the chosen sources. */
  matching: number;
  alreadyInAhs: number;
  added: string[];
  /** Dry run only: what would have been added. */
  wouldAdd: Array<{ ticketNo: string; source: string; callDate: string; branch: string; status: string }>;
  errors: string[];
}

export interface SpAutoPullSummary {
  companies: number;
  added: number;
  errors: string[];
  results: SpAutoPullCompanyResult[];
}

interface Ctx {
  url: string;
  headers: Record<string, string>;
  env: Record<string, string | undefined>;
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

class RestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

async function rest<T = any>(ctx: Ctx, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ctx.url}/rest/v1/${path}`, {
    ...init,
    headers: { ...ctx.headers, ...((init?.headers as Record<string, string>) ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    let code = "";
    try { code = JSON.parse(text)?.code ?? ""; } catch { /* not json */ }
    throw new RestError(`${path.split("?")[0]}: ${res.status} ${text.slice(0, 200)}`, res.status, code);
  }
  if (res.status === 204) return null as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

const inList = (values: string[]) => `(${values.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(",")})`;

/** This company's Location Management ZIPs, registered for branch lookups (like ensureCompanyZipCoverage). */
async function loadCompanyCoverage(ctx: Ctx, companyId: string): Promise<number> {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await rest<any[]>(
      ctx,
      `location_mgmt_coverage?select=zip_code,location,city,self_schedule,tier_code&company_id=eq.${companyId}&order=zip_code.asc&limit=1000&offset=${offset}`,
    );
    rows.push(...page);
    if (page.length < 1000) break;
  }
  clearZipCoverageOverrides();
  registerZipCoverage(rows.map((r) => ({
    zipCode: r.zip_code ?? "",
    location: r.location ?? "",
    city: r.city ?? "",
    selfSchedule: r.self_schedule ?? "",
    tierCode: r.tier_code ?? "",
  })));
  return rows.length;
}

async function existingTicketNos(ctx: Ctx, companyId: string, ticketNos: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < ticketNos.length; i += 100) {
    const chunk = ticketNos.slice(i, i + 100);
    const rows = await rest<{ ticket_no: string }[]>(
      ctx,
      `tickets?select=ticket_no&company_id=eq.${companyId}&ticket_no=in.${encodeURIComponent(inList(chunk))}`,
    );
    for (const r of rows) found.add(String(r.ticket_no).trim());
  }
  return found;
}

/** Adds one ticket (customer first). "exists" when someone added it a moment ago. */
async function insertNewTicket(ctx: Ctx, companyId: string, input: ReturnType<typeof convertCallToTicket>): Promise<{ outcome: "added" | "exists"; ticketId?: string }> {
  const ticketNo = String(input.ticketNo ?? "").trim();
  const { customerPayload, ticketPayload } = buildServicePowerPayloads({ ...input, ticketNo });
  const [cust] = await rest<{ id: string }[]>(ctx, "customers?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...customerPayload, company_id: companyId }),
  });
  try {
    const [ticket] = await rest<{ id: string }[]>(ctx, "tickets?select=id", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ticket_no: ticketNo, customer_id: cust.id, ...ticketPayload, company_id: companyId }),
    });
    return { outcome: "added", ticketId: ticket?.id };
  } catch (err) {
    // Don't leave the customer row made for this ticket behind.
    await rest(ctx, `customers?id=eq.${cust.id}`, { method: "DELETE" }).catch(() => undefined);
    if (err instanceof RestError && (err.code === "23505" || err.status === 409)) return { outcome: "exists" };
    throw err;
  }
}

async function spCalls(ctx: Ctx, companyId: string, window: { from: string; to: string }): Promise<any[]> {
  const res = await handleServicePowerRequest(
    new Request("https://internal/api/servicepower", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "getCallInfo",
        params: { fromDate: spWindowDate(window.from, false), toDate: spWindowDate(window.to, true) },
        companyId,
      }),
    }),
    ctx.env,
  );
  const body: any = await res.json().catch(() => ({}));
  const parsed = body?.xml ? parseGetCallInfoResponse(body.xml) : { success: false, error: body?.error ?? body, calls: [] };
  if (!parsed.success) {
    const msg = typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error ?? "no response");
    throw new Error(`ServicePower ${window.from}..${window.to}: ${msg.slice(0, 200)}`);
  }
  return parsed.calls ?? [];
}

async function pullForCompany(
  ctx: Ctx,
  companyId: string,
  settings: SpAutoPullSettings,
  opts: { apply: boolean; today: string },
): Promise<SpAutoPullCompanyResult> {
  const result: SpAutoPullCompanyResult = {
    companyId,
    sources: settings.sources,
    windows: autoPullWindows(opts.today, settings.from),
    calls: 0,
    matching: 0,
    alreadyInAhs: 0,
    added: [],
    wouldAdd: [],
    errors: [],
  };
  if (result.windows.length === 0) return result;

  await loadCompanyCoverage(ctx, companyId);

  const calls = new Map<string, any>();
  for (const w of result.windows) {
    try {
      for (const c of await spCalls(ctx, companyId, w)) {
        const no = String(c?.callNumber ?? "").trim();
        if (no) calls.set(no, c);
      }
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  result.calls = calls.size;

  const matching = [...calls.values()]
    .filter(isOpenCall)
    .map((c) => convertCallToTicket(c))
    .filter((t) => isAutoPullSource(t.ticketSource, settings.sources));
  result.matching = matching.length;
  if (matching.length === 0) return result;

  const existing = await existingTicketNos(ctx, companyId, matching.map((t) => String(t.ticketNo).trim()));
  const missing = matching.filter((t) => !existing.has(String(t.ticketNo).trim()));
  result.alreadyInAhs = matching.length - missing.length;

  const logRows: Record<string, unknown>[] = [];
  for (const t of missing) {
    const ticketNo = String(t.ticketNo).trim();
    const callDate = parseScheduleDateForSql(t.callReceivedDate) ?? "";
    if (!opts.apply) {
      result.wouldAdd.push({ ticketNo, source: t.ticketSource ?? "", callDate, branch: t.location ?? "", status: t.status ?? "" });
      continue;
    }
    try {
      const r = await insertNewTicket(ctx, companyId, t);
      if (r.outcome === "exists") {
        result.alreadyInAhs += 1;
        continue;
      }
      result.added.push(ticketNo);
      logRows.push({
        company_id: companyId,
        ticket_no: ticketNo,
        ticket_id: r.ticketId ?? null,
        source: t.ticketSource ?? null,
        call_date: callDate || null,
        branch: t.location || null,
        mode: "auto",
        pulled_by_name: "Auto pull",
      });
    } catch (err) {
      result.errors.push(`${ticketNo}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (logRows.length > 0) {
    // The log is for the Data Migration list only — never fail the pull over it
    // (e.g. migration 0475 not run yet).
    await rest(ctx, "sp_pull_log", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(logRows) })
      .catch((err) => result.errors.push(`pull log not written: ${err instanceof Error ? err.message : String(err)}`));
  }
  return result;
}

/**
 * Runs the auto-pull for every company that turned it on. `apply: false`
 * is a dry run (reads ServicePower and AHS, writes nothing). `override`
 * runs one company with the given settings instead (dry runs / testing).
 */
export async function runServicePowerAutoPull(
  env: Record<string, string | undefined>,
  opts: { apply: boolean; today?: string; override?: { companyId: string; settings: SpAutoPullSettings } } = { apply: true },
): Promise<SpAutoPullSummary> {
  const summary: SpAutoPullSummary = { companies: 0, added: 0, errors: [], results: [] };
  const { supabaseUrl, supabaseServiceKey } = resolveCreds(env);
  if (!supabaseUrl || !supabaseServiceKey) {
    summary.errors.push("Supabase URL / service key not configured");
    return summary;
  }
  const ctx: Ctx = {
    url: supabaseUrl,
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      "Content-Type": "application/json",
    },
    env,
  };
  const today = opts.today ?? centralTodayIso();

  let targets: Array<{ companyId: string; settings: SpAutoPullSettings }>;
  if (opts.override) {
    targets = [opts.override];
  } else {
    const companies = await rest<{ id: string; settings: unknown }[]>(ctx, "companies?select=id,settings");
    targets = companies
      .map((c) => ({ companyId: c.id, settings: readSpAutoPullSettings(c.settings) }))
      .filter((c): c is { companyId: string; settings: SpAutoPullSettings } => c.settings !== null);
  }

  // One company at a time: the ZIP-to-branch lookups are registered per company.
  for (const t of targets) {
    summary.companies += 1;
    try {
      const r = await pullForCompany(ctx, t.companyId, t.settings, { apply: opts.apply, today });
      summary.results.push(r);
      summary.added += r.added.length;
      summary.errors.push(...r.errors.map((e) => `${t.companyId.slice(0, 8)}: ${e}`));
    } catch (err) {
      summary.errors.push(`${t.companyId.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary;
}
