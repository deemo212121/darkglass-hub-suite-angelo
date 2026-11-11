/**
 * Marcone & Encompass Parts — Claims module (custom: "distributor-parts-claims").
 * Every part on a ticket that was ordered from Marcone or Encompass and has
 * an invoice # (i.e. charged to our account there), one month at a time
 * (invoice date, or the part's order date while the invoice date is blank):
 * part #, invoice, amount, when the ticket was claimed, and whether
 * ServicePower has paid it and the distributor has credited it. A part used
 * on a job that's done but was never claimed is flagged at the top. Each
 * invoice is also looked up live on Marcone's / Encompass's API
 * (distributorInvoiceCheck.ts) to confirm the part is on it and at what
 * price. Rules: distributorPartClaims.ts.
 *
 * Claim Date is when the ticket last turned CL-Claimed (ticket history, same
 * as Claim List); Claim # and paid come from the claim details ServicePower
 * sends back (migration 0397); Credited is the distributor credit the hourly
 * check stamps on the part (migration 0406 — Marcone only for now).
 * Same location access rule as Ticket List (allowedLocations).
 */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import * as XLSX from "xlsx";
import { AlertTriangle, ChevronLeft, Download, RefreshCw } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useSmartBack } from "@/hooks/useSmartBack";
import { useAuth } from "@/lib/auth";
import { BrandedLoader } from "@/components/BrandedLoader";
import { supabase } from "@/lib/supabase/client";
import { getCompanyTickets, invalidateCompanyTicketsCache } from "@/lib/supabase/tickets";
import { getCompanyTicketClaimDetails, getTicketClaimedBy } from "@/lib/supabase/claimDetails";
import { formatISODate, localISODate, todayISO } from "@/lib/localDate";
import {
  distributorInvoiceRef,
  distributorOf,
  matchInvoiceLine,
  partClaimState,
  PART_CLAIM_STATE_LABEL,
  type DistributorInvoiceLine,
  type PartClaimState,
  type PartDistributor,
} from "@/lib/distributorPartClaims";
import { forgetDistributorInvoices, lookupDistributorInvoice, type DistributorInvoice } from "@/lib/distributorInvoiceCheck";

const PAGE_SIZES = [10, 20, 50, 100, 500];
const STATE_ORDER: PartClaimState[] = ["not-claimed", "job-open", "claimed", "paid", "credited", "returned", "not-used"];
const STATE_CHIP: Record<PartClaimState, string> = {
  "not-claimed": "bg-rose-500/20 text-rose-200 border-rose-500/40",
  "job-open": "bg-slate-500/20 text-slate-300 border-slate-400/30",
  claimed: "bg-amber-500/20 text-amber-200 border-amber-500/30",
  paid: "bg-blue-500/20 text-blue-200 border-blue-500/30",
  credited: "bg-emerald-500/20 text-emerald-200 border-emerald-500/30",
  returned: "bg-violet-500/20 text-violet-200 border-violet-500/30",
  "not-used": "bg-white/5 text-slate-400 border-white/15",
};
/** How many invoices are looked up on the APIs at once. */
const CHECK_CONCURRENCY = 4;

interface PartDbRow {
  id: string;
  ticket_id: string;
  part_no: string | null;
  part_desc: string | null;
  part_dist: string | null;
  quantity: number | null;
  part_price: number | null;
  invoice_no: string | null;
  invoice_date: string | null;
  status: string | null;
  credit_no: string | null;
  credited_at: string | null;
  credit_source: string | null;
  created_at: string | null;
}

interface Row {
  id: string;
  ticketNo: string;
  ticketStatus: string;
  branch: string;
  dist: PartDistributor;
  partNo: string;
  desc: string;
  qty: number;
  amount: number;
  invoiceNo: string;
  invoiceDate: string;
  /** YYYY-MM — the invoice date's month, or the order date's while the invoice date is blank. */
  month: string;
  partStatus: string;
  /** "Marcone|78397586" — what the distributor's API is asked for; "" when the invoice # can't be looked up. */
  checkKey: string;
  claimDate: string;
  claimNo: string;
  creditNo: string;
  state: PartClaimState;
  /** Tooltip on the status chip: when it was paid / credited. */
  detail: string;
}

type InvoiceCheck = { loading: true } | { loading: false; invoice: DistributorInvoice };

/** What the distributor's API says about one row: the matching invoice line, or why there isn't one. */
interface ApiVerdict {
  kind: "none" | "loading" | "error" | "not-found" | "not-on-invoice" | "on-invoice";
  text: string;
  detail: string;
  line: DistributorInvoiceLine | null;
  invoice: DistributorInvoice | null;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const usDate = (iso: string) => (iso ? formatISODate(iso) : "");
const monthLabel = (ym: string) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

async function loadDistributorParts(): Promise<PartDbRow[]> {
  const out: PartDbRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("parts")
      .select("id, ticket_id, part_no, part_desc, part_dist, quantity, part_price, invoice_no, invoice_date, status, credit_no, credited_at, credit_source, created_at")
      .or("part_dist.ilike.*marcone*,part_dist.ilike.*encompass*")
      .not("invoice_no", "is", null)
      .neq("invoice_no", "")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as PartDbRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function verdictFor(r: Row, checks: Record<string, InvoiceCheck>): ApiVerdict {
  const none = (text: string, detail = ""): ApiVerdict => ({ kind: "none", text, detail, line: null, invoice: null });
  if (!r.checkKey) return none("—", `This invoice # isn't in ${r.dist}'s format, so it can't be looked up`);
  const c = checks[r.checkKey];
  if (!c) return none("Not checked");
  if (c.loading) return { kind: "loading", text: "Checking…", detail: "", line: null, invoice: null };
  const inv = c.invoice;
  if (inv.transient) return { kind: "error", text: "Couldn't check", detail: inv.error || "", line: null, invoice: inv };
  if (!inv.found) return { kind: "not-found", text: "Invoice not found", detail: inv.error || "", line: null, invoice: inv };
  const line = matchInvoiceLine(inv.lines, r.partNo);
  if (!line) {
    const onIt = inv.lines.map((l) => l.partNumbers[0]).filter(Boolean).join(", ");
    return { kind: "not-on-invoice", text: "Not on this invoice", detail: `${r.dist} invoice ${inv.invoiceNumber || r.checkKey.split("|")[1]} has: ${onIt || "no lines"}`, line: null, invoice: inv };
  }
  const bits = [`${line.qty} × ${line.unitPrice == null ? "?" : money(line.unitPrice)}`, line.status || inv.status, line.returned ? `${line.returned} returned` : ""].filter(Boolean);
  return { kind: "on-invoice", text: "On invoice", detail: bits.join(" · "), line, invoice: inv };
}

const VERDICT_TEXT: Record<ApiVerdict["kind"], string> = {
  none: "text-slate-500",
  loading: "text-slate-400",
  error: "text-orange-300",
  "not-found": "text-rose-300",
  "not-on-invoice": "text-amber-300",
  "on-invoice": "text-emerald-300",
};

const COLUMNS: { label: string; value: (r: Row) => string; align?: "right" }[] = [
  { label: "Ticket No", value: (r) => r.ticketNo },
  { label: "Branch", value: (r) => r.branch },
  { label: "Dist", value: (r) => r.dist },
  { label: "Part No", value: (r) => r.partNo },
  { label: "Description", value: (r) => r.desc },
  { label: "Qty", value: (r) => String(r.qty), align: "right" },
  { label: "Part Status", value: (r) => r.partStatus },
  { label: "Invoice No", value: (r) => r.invoiceNo },
  { label: "Invoice Date", value: (r) => usDate(r.invoiceDate) },
  { label: "Amount", value: (r) => money(r.amount), align: "right" },
  { label: "Claim Date", value: (r) => usDate(r.claimDate) },
  { label: "Claim #", value: (r) => r.claimNo },
  { label: "Credit #", value: (r) => r.creditNo },
  { label: "Ticket Status", value: (r) => r.ticketStatus },
  { label: "Status", value: (r) => PART_CLAIM_STATE_LABEL[r.state] },
];

export function DistributorPartsClaimsPage({ mod }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { allowedLocations } = useAuth();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [month, setMonth] = useState(() => todayISO().slice(0, 7));
  const [checks, setChecks] = useState<Record<string, InvoiceCheck>>({});
  const [dist, setDist] = useState<"" | PartDistributor>("");
  const [branch, setBranch] = useState("");
  const [stateFilter, setStateFilter] = useState<"" | PartClaimState>("");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const load = async (fresh = false) => {
    try {
      setLoading(true);
      setError(null);
      if (fresh) invalidateCompanyTicketsCache();
      const [parts, tickets, details] = await Promise.all([loadDistributorParts(), getCompanyTickets(), getCompanyTicketClaimDetails()]);
      const ticketById = new Map(tickets.map((t) => [String((t as { _id?: string })._id ?? ""), t]));
      const ticketIds = Array.from(new Set(parts.map((p) => p.ticket_id)));
      const claimedBy = await getTicketClaimedBy(ticketIds).catch((err) => {
        console.warn("[DistributorParts] claimed dates failed:", err);
        return {} as Record<string, { at: string; by: string }>;
      });
      const next: Row[] = [];
      for (const p of parts) {
        const t = ticketById.get(p.ticket_id);
        const d = distributorOf(p.part_dist);
        if (!t || !d) continue;
        const det = details.get(p.ticket_id);
        const ticketStatus = String(t.status ?? "").trim();
        const state = partClaimState({
          partStatus: String(p.status ?? ""),
          ticketStatus,
          creditedAt: p.credited_at ?? "",
          spSubmittedAt: det?.spSubmittedAt ?? "",
          spPaymentDate: det?.spPaymentDate ?? "",
          spClaimStatusCode: det?.spClaimStatusCode ?? "",
          spPaidTotal: det?.spPaidTotal ?? null,
        });
        const qty = Number(p.quantity) > 0 ? Number(p.quantity) : 1;
        const invoiceDate = String(p.invoice_date ?? "");
        const ref = distributorInvoiceRef(d, p.invoice_no);
        const batch = det?.spClaimBatchNumber && det.spClaimBatchNumber !== "0" ? det.spClaimBatchNumber : "";
        const claimDate = claimedBy[p.ticket_id]?.at || (det?.spSubmittedAt ? localISODate(new Date(det.spSubmittedAt)) : "");
        const detail =
          state === "credited"
            ? `Credited ${usDate(localISODate(new Date(p.credited_at!)))}${p.credit_source ? ` by ${p.credit_source}` : ""}`
            : state === "paid"
              ? det?.spPaymentDate ? `ServicePower paid ${usDate(det.spPaymentDate)}${det.spPaidParts != null ? ` · parts ${money(det.spPaidParts)}` : ""}` : "Marked PAID on the part"
              : state === "claimed"
                ? `Claimed${claimDate ? ` ${usDate(claimDate)}` : ""} — waiting on ServicePower payment / ${d} credit`
                : state === "not-claimed"
                  ? `Used, and the ticket is ${ticketStatus || "—"} — but it was never claimed`
                  : state === "job-open"
                    ? `Used — the ticket is still ${ticketStatus || "open"}, nothing to claim yet`
                    : state === "returned"
                      ? `${String(p.status ?? "").trim()} — sent back to ${d}, no credit found yet`
                      : `${String(p.status ?? "").trim() || "No status"} — not used on the job yet`;
        next.push({
          id: p.id,
          ticketNo: t.ticketNo,
          ticketStatus,
          branch: t.location || "",
          dist: d,
          partNo: String(p.part_no ?? ""),
          desc: String(p.part_desc ?? ""),
          qty,
          amount: Math.round((Number(p.part_price) || 0) * qty * 100) / 100,
          invoiceNo: String(p.invoice_no ?? ""),
          invoiceDate,
          month: invoiceDate.slice(0, 7) || (p.created_at ? localISODate(new Date(p.created_at)).slice(0, 7) : ""),
          partStatus: String(p.status ?? "").trim(),
          checkKey: ref ? `${d}|${ref}` : "",
          claimDate,
          claimNo: batch ? `${batch}${String(det?.spClaimSequenceNumber ?? "").padStart(6, "0")}` : "",
          creditNo: String(p.credit_no ?? ""),
          state,
          detail,
        });
      }
      // Alerts first, then newest invoice first.
      next.sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || b.invoiceDate.localeCompare(a.invoiceDate) || a.ticketNo.localeCompare(b.ticketNo));
      setRows(next);
      setLastLoadedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load parts.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const allowed = useMemo(
    () => rows.filter((r) => allowedLocations === null || allowedLocations.includes(r.branch)),
    [rows, allowedLocations],
  );
  const months = useMemo(() => {
    const set = new Set(allowed.map((r) => r.month).filter(Boolean));
    set.add(todayISO().slice(0, 7));
    return Array.from(set).sort().reverse();
  }, [allowed]);
  const visible = useMemo(() => (month ? allowed.filter((r) => r.month === month) : allowed), [allowed, month]);

  // Look each of this month's invoices up on Marcone's / Encompass's API once
  // (not for "All months" — that's well over a thousand invoices).
  const inFlight = useRef(new Set<string>());
  const runChecks = async (keys: string[]) => {
    // Marcone first — Encompass is looked up one at a time (rate limit), so it's the slow part.
    const todo = keys.filter((k) => !inFlight.current.has(k)).sort((a, b) => Number(a.startsWith("Encompass")) - Number(b.startsWith("Encompass")));
    if (todo.length === 0) return;
    todo.forEach((k) => inFlight.current.add(k));
    setChecks((prev) => ({ ...prev, ...Object.fromEntries(todo.map((k) => [k, { loading: true } as InvoiceCheck])) }));
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const key = todo[next++];
        const [d, ref] = key.split("|") as [PartDistributor, string];
        const invoice = await lookupDistributorInvoice(d, ref);
        inFlight.current.delete(key);
        setChecks((prev) => ({ ...prev, [key]: { loading: false, invoice } }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, todo.length) }, worker));
  };
  const monthKeys = useMemo(() => Array.from(new Set(visible.map((r) => r.checkKey).filter(Boolean))), [visible]);
  useEffect(() => {
    if (!month || loading) return;
    void runChecks(monthKeys.filter((k) => !checks[k]));
    // checks: read only to skip invoices already looked up — re-running on every result would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, monthKeys, loading]);
  const recheck = () => {
    forgetDistributorInvoices(monthKeys);
    setChecks((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !monthKeys.includes(k))));
    void runChecks(monthKeys);
  };
  const verdicts = useMemo(() => new Map(visible.map((r) => [r.id, verdictFor(r, checks)])), [visible, checks]);
  const verdictCounts = useMemo(() => {
    const c: Record<ApiVerdict["kind"], number> = { none: 0, loading: 0, error: 0, "not-found": 0, "not-on-invoice": 0, "on-invoice": 0 };
    for (const v of verdicts.values()) c[v.kind]++;
    return c;
  }, [verdicts]);
  const branches = useMemo(() => Array.from(new Set(visible.map((r) => r.branch).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [visible]);

  // Everything but the status filter — the chips count within it.
  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visible.filter(
      (r) =>
        (!dist || r.dist === dist) &&
        (!branch || r.branch === branch) &&
        (!q || COLUMNS.some((c) => c.value(r).toLowerCase().includes(q))),
    );
  }, [visible, dist, branch, search]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(STATE_ORDER.map((s) => [s, { n: 0, amount: 0 }])) as Record<PartClaimState, { n: number; amount: number }>;
    for (const r of scoped) {
      c[r.state].n++;
      c[r.state].amount += r.amount;
    }
    return c;
  }, [scoped]);
  const filtered = useMemo(() => (stateFilter ? scoped.filter((r) => r.state === stateFilter) : scoped), [scoped, stateFilter]);
  const filteredTotal = useMemo(() => filtered.reduce((s, r) => s + r.amount, 0), [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(page, pageCount);
  const pagedRows = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  // The distributor's price for OUR qty — one invoice line can cover several AHS part rows.
  const distAmountOf = (r: Row, v: ApiVerdict | undefined) =>
    v?.line?.unitPrice != null ? Math.round(v.line.unitPrice * r.qty * 100) / 100 : v?.line?.amount ?? null;

  const exportToXlsx = () => {
    const data = filtered.map((r) => {
      const v = verdicts.get(r.id);
      return Object.fromEntries(
        COLUMNS.flatMap((c) => {
          const cell: [string, unknown] = [c.label, c.label === "Amount" ? r.amount : c.label === "Qty" ? r.qty : c.value(r)];
          return c.label === "Amount"
            ? [cell, ["Marcone / Encompass", v ? [v.text, v.detail].filter(Boolean).join(" — ") : ""], ["Dist. Amount", distAmountOf(r, v) ?? ""]]
            : [cell];
        }),
      );
    });
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Marcone & Encompass Parts");
    XLSX.writeFile(workbook, `marcone-encompass-parts_${todayISO()}.xlsx`);
  };

  const notClaimed = counts["not-claimed"];

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-white">
      <main className="flex-1 max-w-[1700px] mx-auto w-full px-4 py-3">
        <div className="flex items-center gap-3 mb-2">
          <button type="button" onClick={goBack} className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-slate-800/70 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700">
            <ChevronLeft className="h-3.5 w-3.5" /> {mod.label}
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">Marcone &amp; Encompass Parts</h1>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Parts on tickets bought from Marcone or Encompass with an invoice # (charged to our account), by month: each invoice is checked on Marcone&apos;s / Encompass&apos;s API, with the claim date and whether it&apos;s been paid by ServicePower and credited by the distributor.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {error && <p className="mb-2 text-xs text-rose-400">Error: {error}</p>}

        {!loading && notClaimed.n > 0 && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-500/50 bg-rose-500/15 px-3 py-2 text-sm text-rose-100">
            <span className="inline-flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-300" />
              <span>
                <strong>{notClaimed.n} part{notClaimed.n === 1 ? " has" : "s have"} been used but not claimed</strong> ({money(notClaimed.amount)}) — the job is done or cancelled, but the ticket was never claimed.
              </span>
            </span>
            {stateFilter !== "not-claimed" && (
              <button type="button" onClick={() => { setStateFilter("not-claimed"); setPage(1); }} className="rounded-md border border-rose-300/40 bg-rose-600/40 px-2.5 py-1 text-xs font-semibold hover:bg-rose-600/60">
                Show them
              </button>
            )}
          </div>
        )}

        <div className="rounded-xl border border-white/10 bg-white/5">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-white/10">
            <button
              type="button"
              onClick={() => { setStateFilter(""); setPage(1); }}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${stateFilter === "" ? "border-blue-400 bg-blue-600 text-white" : "border-white/15 text-slate-300 hover:bg-white/5"}`}
            >
              All {scoped.length}
            </button>
            {STATE_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setStateFilter(stateFilter === s ? "" : s); setPage(1); }}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${STATE_CHIP[s]} ${stateFilter === s ? "ring-2 ring-white/60" : "opacity-80 hover:opacity-100"}`}
              >
                {s === "not-claimed" && <AlertTriangle className="mr-1 inline h-3 w-3" />}
                {PART_CLAIM_STATE_LABEL[s]} {counts[s].n}
              </button>
            ))}
          </div>

          {month ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 border-b border-white/10 text-xs text-slate-300">
              <span>
                Checked on Marcone / Encompass ({monthLabel(month)}):{" "}
                <span className="text-emerald-300">{verdictCounts["on-invoice"]} on the invoice</span>
                {verdictCounts["not-on-invoice"] > 0 && <> · <span className="text-amber-300">{verdictCounts["not-on-invoice"]} not on their invoice</span></>}
                {verdictCounts["not-found"] > 0 && <> · <span className="text-rose-300">{verdictCounts["not-found"]} invoice not found</span></>}
                {verdictCounts.error > 0 && <> · <span className="text-orange-300">{verdictCounts.error} couldn&apos;t be checked (try Check again)</span></>}
                {verdictCounts.none > 0 && <> · <span className="text-slate-500">{verdictCounts.none} can&apos;t be looked up</span></>}
                {verdictCounts.loading > 0 && <> · <span className="text-slate-400">checking {verdictCounts.loading}…</span></>}
              </span>
              <button type="button" onClick={recheck} disabled={verdictCounts.loading > 0 || monthKeys.length === 0} className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-slate-800/70 px-2 py-0.5 text-slate-200 hover:bg-slate-700 disabled:opacity-40">
                <RefreshCw className={`h-3 w-3 ${verdictCounts.loading > 0 ? "animate-spin" : ""}`} /> Check again
              </button>
            </div>
          ) : (
            <div className="px-3 py-1.5 border-b border-white/10 text-xs text-slate-500">Pick a month to check its invoices on Marcone / Encompass.</div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-white/10">
            <span className="text-sm">
              <span className="font-semibold text-blue-300">{filtered.length}</span> parts · <span className="font-semibold text-blue-300">{money(filteredTotal)}</span>
              {lastLoadedAt && !loading && <span className="ml-2 text-[10px] text-slate-500">Loaded {lastLoadedAt.toLocaleTimeString()}</span>}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <select value={month} onChange={(e) => { setMonth(e.target.value); setPage(1); }} title="Invoice month (the order date's month while the invoice date is blank)" className="rounded-md border border-white/15 bg-slate-950 px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500">
                {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
                <option value="">All months</option>
              </select>
              <select value={dist} onChange={(e) => { setDist(e.target.value as "" | PartDistributor); setPage(1); }} className="rounded-md border border-white/15 bg-slate-950 px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500">
                <option value="">Marcone &amp; Encompass</option>
                <option value="Marcone">Marcone</option>
                <option value="Encompass">Encompass</option>
              </select>
              <select value={branch} onChange={(e) => { setBranch(e.target.value); setPage(1); }} className="rounded-md border border-white/15 bg-slate-950 px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500">
                <option value="">All branches</option>
                {branches.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <button type="button" onClick={exportToXlsx} disabled={filtered.length === 0} title="Download Excel" className="rounded-md border border-white/15 bg-slate-800/70 p-1.5 text-slate-200 hover:bg-slate-700 disabled:opacity-40">
                <Download className="h-3.5 w-3.5" />
              </button>
              <input
                type="search"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="ticket, part, invoice…"
                className="w-52 rounded-md border border-white/15 bg-slate-950 px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {loading && rows.length === 0 ? (
            <div className="py-12"><BrandedLoader label="Loading parts…" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-white/5 border-b border-white/10">
                    {COLUMNS.map((c) => (
                      <Fragment key={c.label}>
                        <th className={`px-2 py-2 font-semibold text-slate-400 whitespace-nowrap ${c.align === "right" ? "text-right" : "text-left"}`}>{c.label}</th>
                        {c.label === "Amount" && (
                          <>
                            <th className="px-2 py-2 font-semibold text-slate-400 whitespace-nowrap text-left" title="What Marcone's / Encompass's API has on this invoice">Marcone / Encompass</th>
                            <th className="px-2 py-2 font-semibold text-slate-400 whitespace-nowrap text-right" title="The line's amount on the distributor's invoice">Dist. Amount</th>
                          </>
                        )}
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.length === 0 ? (
                    <tr>
                      <td colSpan={COLUMNS.length + 2} className="px-4 py-12 text-center text-slate-400">
                        {rows.length === 0 ? "No invoiced Marcone or Encompass parts yet." : "No parts match these filters."}
                      </td>
                    </tr>
                  ) : (
                    pagedRows.map((r, i) => {
                      const v = verdicts.get(r.id);
                      const distAmount = distAmountOf(r, v);
                      const amountOff = distAmount != null && Math.abs(distAmount - r.amount) > 0.01;
                      const ahsUnit = r.qty ? r.amount / r.qty : r.amount;
                      return (
                        <tr
                          key={r.id}
                          className={`border-b border-white/5 hover:bg-white/5 ${r.state === "not-claimed" ? "bg-rose-500/10" : i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}
                        >
                          {COLUMNS.map((c, ci) => (
                            <Fragment key={c.label}>
                              <td className={`px-2 py-1.5 whitespace-nowrap ${c.align === "right" ? "text-right" : ""} ${ci === 0 ? "" : "text-slate-300"} ${c.label === "Description" ? "max-w-[220px] truncate" : ""}`} title={c.label === "Description" ? r.desc : undefined}>
                                {ci === 0 ? (
                                  <Link to="/ticket/$ticketNo" params={{ ticketNo: r.ticketNo }} className="font-mono text-blue-400 hover:underline">
                                    {r.ticketNo}
                                  </Link>
                                ) : c.label === "Status" ? (
                                  <span title={r.detail} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATE_CHIP[r.state]}`}>
                                    {r.state === "not-claimed" && <AlertTriangle className="h-3 w-3" />}
                                    {PART_CLAIM_STATE_LABEL[r.state]}
                                  </span>
                                ) : c.label === "Invoice Date" && !r.invoiceDate && v?.invoice?.invoiceDate ? (
                                  <span className="italic text-slate-400" title={`Blank in AHS — this is ${r.dist}'s invoice date`}>{usDate(v.invoice.invoiceDate)}</span>
                                ) : (
                                  c.value(r) || "—"
                                )}
                              </td>
                              {c.label === "Amount" && (
                                <>
                                  <td className={`px-2 py-1.5 whitespace-nowrap ${VERDICT_TEXT[v?.kind ?? "none"]}`} title={v?.detail || undefined}>
                                    {v?.text ?? "—"}
                                    {v?.kind === "on-invoice" && v.detail && <span className="ml-1 text-[10px] text-slate-400">{v.detail}</span>}
                                  </td>
                                  <td className={`px-2 py-1.5 whitespace-nowrap text-right ${amountOff ? "text-amber-300" : "text-slate-300"}`} title={amountOff ? `${r.dist}'s price is ${money(v!.line!.unitPrice ?? distAmount!)} each — AHS has ${money(ahsUnit)} each` : undefined}>
                                    {distAmount == null ? "—" : money(distAmount)}
                                  </td>
                                </>
                              )}
                            </Fragment>
                          ))}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-white/10 text-xs text-slate-400">
            <div className="flex items-center gap-1">
              {PAGE_SIZES.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => { setPageSize(n); setPage(1); }}
                  className={`rounded px-2 py-0.5 ${pageSize === n ? "bg-blue-600 text-white" : "text-blue-300 hover:bg-white/5"}`}
                >
                  {n}
                </button>
              ))}
            </div>
            {pageCount > 1 && (
              <div className="flex items-center gap-2">
                <span>Page {pageSafe} of {pageCount}</span>
                <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageSafe <= 1} className="rounded border border-white/15 px-2 py-0.5 disabled:opacity-40">Prev</button>
                <button type="button" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={pageSafe >= pageCount} className="rounded border border-white/15 px-2 py-0.5 disabled:opacity-40">Next</button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
