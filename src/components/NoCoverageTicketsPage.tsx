/**
 * No-Coverage Tickets — Tickets module (custom: "no-coverage-tickets"), the
 * AHS version of the legacy USAPP screen of the same name. Lists every open
 * ticket whose customer ZIP isn't in AHS's coverage: lookupZip, i.e.
 * Location Management's coverage table merged over the built-in map — the
 * same check that picks a ticket's branch when it syncs. Such a ticket can't
 * be routed to a branch by ZIP, and one with no branch never shows up for
 * branch-limited staff on Ticket List, so this is where they get noticed:
 * add the ZIP in Location Management, or cancel the ticket ("OUT OF
 * COVERAGE" / "NOT COVERED").
 *
 * Same location access rule as Ticket List (allowedLocations). Coverage is
 * re-read on every load so a ZIP just added in Location Management drops off
 * on Refresh — the copy loaded at sign-in can be stale.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import * as XLSX from "xlsx";
import { ChevronLeft, Download, Printer, RefreshCw } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useSmartBack } from "@/hooks/useSmartBack";
import { useAuth } from "@/lib/auth";
import { BrandedLoader } from "@/components/BrandedLoader";
import { getCompanyTickets, invalidateCompanyTicketsCache } from "@/lib/supabase/tickets";
import { isZipCovered } from "@/lib/zipCoverage";
import { ensureCompanyZipCoverage } from "@/lib/zipCoverageLoader";
import { isPendingStatus, type Ticket } from "@/lib/ticketData";
import { formatISODate, todayISO } from "@/lib/localDate";

const PAGE_SIZES = [10, 20, 50, 100, 500];

const COLUMNS: { label: string; value: (t: Ticket) => string; align?: "right" }[] = [
  { label: "Ticket No", value: (t) => t.ticketNo },
  { label: "Src/Acct", value: (t) => t.ticketSource || t.account || t.manufacturer || "" },
  { label: "Cx Name", value: (t) => t.customer },
  { label: "City", value: (t) => t.city },
  { label: "State", value: (t) => t.state || "" },
  { label: "Zip", value: (t) => t.zip || "" },
  { label: "Phone", value: (t) => t.phone },
  { label: "Job Date", value: (t) => (t.schedule ? formatISODate(t.schedule) : "") },
  { label: "Product", value: (t) => t.productType || "" },
  { label: "Models", value: (t) => t.model },
  { label: "Aging", value: (t) => String(t.aging ?? ""), align: "right" },
  { label: "Created", value: (t) => (t.created ? formatISODate(t.created) : "") },
  { label: "Location", value: (t) => t.location || "" },
  { label: "Status", value: (t) => t.status },
];

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function NoCoverageTicketsPage({ mod }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { allowedLocations } = useAuth();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const load = async (fresh = false) => {
    try {
      setLoading(true);
      setError(null);
      if (fresh) invalidateCompanyTicketsCache();
      const [rows] = await Promise.all([
        getCompanyTickets(),
        // Best-effort: without it the lookup still has the built-in map plus
        // whatever coverage was loaded at sign-in.
        ensureCompanyZipCoverage(true).catch((err) => {
          console.warn("No-Coverage Tickets: coverage reload skipped:", err);
        }),
      ]);
      setTickets(rows);
      setLastLoadedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tickets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Newest first, like the legacy screen.
  const noCoverage = useMemo(
    () =>
      tickets
        .filter((t) => isPendingStatus(t.status) && !isZipCovered(t.zip))
        .filter((t) => allowedLocations === null || allowedLocations.includes(t.location))
        .sort((a, b) => (b.created || "").localeCompare(a.created || "") || a.ticketNo.localeCompare(b.ticketNo)),
    // lastLoadedAt: coverage is re-registered on each load, which this memo can't see otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickets, allowedLocations, lastLoadedAt],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return noCoverage;
    return noCoverage.filter((t) => COLUMNS.some((c) => c.value(t).toLowerCase().includes(q)));
  }, [noCoverage, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(page, pageCount);
  const pagedRows = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  const exportToXlsx = () => {
    const data = filtered.map((t) => Object.fromEntries(COLUMNS.map((c) => [c.label, c.value(t)])));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "No-Coverage Tickets");
    XLSX.writeFile(workbook, `no-coverage-tickets_${todayISO()}.xlsx`);
  };

  const printList = () => {
    const th = (s: string) => `<th style="background:#1e40af;color:white;border:1px solid #1e40af;padding:5px;font-size:10px;text-align:left;">${escapeHtml(s)}</th>`;
    const td = (s: string) => `<td style="border:1px solid #e5e7eb;padding:5px;font-size:10px;">${escapeHtml(s)}</td>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>No-Coverage Tickets</title></head>
<body style="font-family:Arial,sans-serif;margin:16px;color:#111827;">
<h2 style="margin:0 0 4px;">No-Coverage Tickets</h2>
<p style="margin:0 0 12px;font-size:11px;color:#4b5563;">${filtered.length} records · printed ${escapeHtml(new Date().toLocaleString())}</p>
<table style="border-collapse:collapse;width:100%;"><thead><tr>${COLUMNS.map((c) => th(c.label)).join("")}</tr></thead>
<tbody>${filtered.map((t) => `<tr>${COLUMNS.map((c) => td(c.value(t))).join("")}</tr>`).join("")}</tbody></table>
</body></html>`;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.onload = () => {
      win.focus();
      win.print();
    };
    win.onafterprint = () => win.close();
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-white">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-4 py-3">
        <div className="flex items-center gap-3 mb-2">
          <button type="button" onClick={goBack} className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-slate-800/70 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700">
            <ChevronLeft className="h-3.5 w-3.5" /> {mod.label}
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">No-Coverage Tickets</h1>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Open tickets whose ZIP isn&apos;t in our coverage (Location Management). Add the ZIP there, or cancel the ticket as Out of Coverage / Not Covered.
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

        <div className="rounded-xl border border-white/10 bg-white/5">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-white/10">
            <span className="text-sm">
              <span className="font-semibold text-blue-300">{filtered.length}</span> records found
              {lastLoadedAt && !loading && <span className="ml-2 text-[10px] text-slate-500">Loaded {lastLoadedAt.toLocaleTimeString()}</span>}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={printList} disabled={filtered.length === 0} title="Print" className="rounded-md border border-white/15 bg-slate-800/70 p-1.5 text-slate-200 hover:bg-slate-700 disabled:opacity-40">
                <Printer className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={exportToXlsx} disabled={filtered.length === 0} title="Download Excel" className="rounded-md border border-white/15 bg-slate-800/70 p-1.5 text-slate-200 hover:bg-slate-700 disabled:opacity-40">
                <Download className="h-3.5 w-3.5" />
              </button>
              <input
                type="search"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="search in result"
                className="w-56 rounded-md border border-white/15 bg-slate-950 px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {loading && tickets.length === 0 ? (
            <div className="py-12"><BrandedLoader label="Loading tickets…" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-white/5 border-b border-white/10">
                    {COLUMNS.map((c) => (
                      <th key={c.label} className={`px-2 py-2 font-semibold text-slate-400 whitespace-nowrap ${c.align === "right" ? "text-right" : "text-left"}`}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.length === 0 ? (
                    <tr>
                      <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-slate-400">
                        {search.trim() ? "No tickets match this search." : "Every open ticket's ZIP is covered."}
                      </td>
                    </tr>
                  ) : (
                    pagedRows.map((t, i) => (
                      <tr key={t.ticketNo} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                        {COLUMNS.map((c, ci) => (
                          <td key={c.label} className={`px-2 py-1.5 whitespace-nowrap ${c.align === "right" ? "text-right" : ""} ${ci === 0 ? "" : "text-slate-300"}`}>
                            {ci === 0 ? (
                              <Link to="/ticket/$ticketNo" params={{ ticketNo: t.ticketNo }} className="font-mono text-blue-400 hover:underline">
                                {t.ticketNo}
                              </Link>
                            ) : (
                              c.value(t) || "—"
                            )}
                          </td>
                        ))}
                      </tr>
                    ))
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
