/**
 * Receiving Status — Tickets module, Admin/SuperAdmin only (DASHBOARD_ROLE_GATES
 * "receiving-status"). Company-wide ticket intake summary: every ticket bucketed
 * by Branch x 3rd-party Ticket Provider, showing how many are still "Incoming"
 * (no technician assigned yet) vs. already in progress, and whether each
 * bucket's provider data is Synced or stale (see receivingStatusData.ts —
 * there's no live background sync in this app, so "synced" is a staleness
 * proxy off ticket_claim_details.updated_at, not a real-time provider check).
 *
 * Shows totals only by default; every count is a button that opens a modal
 * listing the actual tickets behind it (same drill-down pattern as
 * OverallStatusPage.tsx's TicketBreakdownModal).
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, X, RefreshCw } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { BrandedLoader } from "@/components/BrandedLoader";
import { getCompanyTickets } from "@/lib/supabase/tickets";
import { getCompanyTicketClaimDetails } from "@/lib/supabase/claimDetails";
import type { Ticket } from "@/lib/ticketData";
import { LOCATIONS } from "@/lib/locations";
import {
  computeReceivingStatusRows,
  SYNC_STALE_HOURS,
  type ReceivingStatusCell,
} from "@/lib/receivingStatusData";

type DrillDown = { title: string; tickets: Ticket[] } | null;

export function ReceivingStatusPage({ mod }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReceivingStatusCell[]>([]);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const [branchFilter, setBranchFilter] = useState("ALL");
  const [providerFilter, setProviderFilter] = useState("ALL");
  const [drillDown, setDrillDown] = useState<DrillDown>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [tickets, claimDetailsByTicketId] = await Promise.all([
        getCompanyTickets(),
        getCompanyTicketClaimDetails(),
      ]);
      setRows(computeReceivingStatusRows(tickets, claimDetailsByTicketId));
      setLastLoadedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Receiving Status.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const providers = useMemo(
    () => Array.from(new Set(rows.map((r) => r.provider))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (branchFilter !== "ALL" && r.branch !== branchFilter) return false;
      if (providerFilter !== "ALL" && r.provider !== providerFilter) return false;
      return true;
    });
  }, [rows, branchFilter, providerFilter]);

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, r) => {
        acc.total += r.total;
        acc.incoming += r.incoming;
        acc.inProgress += r.inProgress;
        acc.synced += r.synced;
        acc.unsynced += r.unsynced;
        return acc;
      },
      { total: 0, incoming: 0, inProgress: 0, synced: 0, unsynced: 0 }
    );
  }, [filteredRows]);

  const openDrillDown = (title: string, tickets: Ticket[]) => {
    if (tickets.length === 0) return;
    setDrillDown({ title, tickets });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-white">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-4 py-3">
        <div className="flex items-center gap-3 mb-2">
          <button type="button" onClick={goBack} className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-slate-800/70 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700">
            <ChevronLeft className="h-3.5 w-3.5" /> {mod.label}
          </button>
        </div>

        <div className="mb-2 text-center">
          <h1 className="text-lg font-bold underline">Receiving Status</h1>
          <p className="mt-0.5 text-[10px] text-slate-400">
            Incoming tickets by Branch and 3rd-party Ticket Provider. "Synced" means the provider's call info was refreshed within the last {SYNC_STALE_HOURS} hours.
          </p>
        </div>

        {/* Filters */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-2 mb-2">
          <div className="flex flex-wrap items-end justify-end gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Branch</label>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="mt-0.5 w-44 rounded-md border border-white/15 bg-slate-950 px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                <option value="ALL">All Branches</option>
                {LOCATIONS.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Provider</label>
              <select
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value)}
                className="mt-0.5 w-44 rounded-md border border-white/15 bg-slate-950 px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                <option value="ALL">All Providers</option>
                {providers.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-slate-800/70 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-rose-400">Error: {error}</p>}
          {lastLoadedAt && !loading && (
            <p className="mt-1 text-right text-[10px] text-slate-500">Last loaded {lastLoadedAt.toLocaleTimeString()}</p>
          )}
        </div>

        {loading ? (
          <div className="py-16"><BrandedLoader /></div>
        ) : (
          <>
            {/* Totals-only summary tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
              {[
                { label: "Total Tickets", value: totals.total, color: "text-white" },
                { label: "Incoming", value: totals.incoming, color: "text-amber-300" },
                { label: "In Progress", value: totals.inProgress, color: "text-blue-300" },
                { label: "Synced", value: totals.synced, color: "text-emerald-300" },
                { label: "Unsynced", value: totals.unsynced, color: "text-rose-300" },
              ].map((tile) => (
                <div key={tile.label} className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
                  <p className={`text-xl font-bold ${tile.color}`}>{tile.value}</p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-slate-400">{tile.label}</p>
                </div>
              ))}
            </div>

            {/* Branch x Provider breakdown — totals only, click a number to see the tickets. */}
            <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-white/5 border-b border-white/10">
                      <th className="px-2 py-1.5 text-left font-semibold text-blue-300">Branch</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-blue-300">Provider</th>
                      <th className="px-2 py-1.5 text-right font-semibold text-blue-300">Total</th>
                      <th className="px-2 py-1.5 text-right font-semibold text-amber-300">Incoming</th>
                      <th className="px-2 py-1.5 text-right font-semibold text-blue-300">In Progress</th>
                      <th className="px-2 py-1.5 text-right font-semibold text-emerald-300">Synced</th>
                      <th className="px-2 py-1.5 text-right font-semibold text-rose-300">Unsynced</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr><td colSpan={7} className="px-2 py-6 text-center text-slate-500">No tickets match these filters.</td></tr>
                    ) : (
                      filteredRows.map((r) => (
                        <tr key={`${r.branch} ${r.provider}`} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                          <td className="px-2 py-1.5 text-slate-200">{r.branch}</td>
                          <td className="px-2 py-1.5 text-slate-300">{r.provider}</td>
                          <CellButton value={r.total} onClick={() => openDrillDown(`${r.branch} — ${r.provider}`, r.tickets)} />
                          <CellButton value={r.incoming} color="text-amber-300" onClick={() => openDrillDown(`${r.branch} — ${r.provider} — Incoming`, r.incomingTickets)} />
                          <CellButton value={r.inProgress} color="text-blue-300" onClick={() => openDrillDown(`${r.branch} — ${r.provider} — In Progress`, r.inProgressTickets)} />
                          <CellButton value={r.synced} color="text-emerald-300" onClick={() => openDrillDown(`${r.branch} — ${r.provider} — Synced`, r.syncedTickets)} />
                          <CellButton value={r.unsynced} color="text-rose-300" onClick={() => openDrillDown(`${r.branch} — ${r.provider} — Unsynced`, r.unsyncedTickets)} />
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>

      {drillDown && <TicketListModal title={drillDown.title} tickets={drillDown.tickets} onClose={() => setDrillDown(null)} />}
    </div>
  );
}

function CellButton({ value, onClick, color = "text-white" }: { value: number; onClick: () => void; color?: string }) {
  if (value === 0) {
    return <td className="px-2 py-1.5 text-right text-slate-600">0</td>;
  }
  return (
    <td className="px-2 py-1.5 text-right">
      <button type="button" onClick={onClick} className={`font-semibold underline decoration-dotted underline-offset-2 hover:opacity-80 ${color}`}>
        {value}
      </button>
    </td>
  );
}

function TicketListModal({ title, tickets, onClose }: { title: string; tickets: Ticket[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-white/10 bg-slate-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            <p className="text-xs text-slate-400">{tickets.length} ticket{tickets.length === 1 ? "" : "s"}</p>
          </div>
          <button className="rounded-md border border-white/15 bg-slate-800/70 p-1.5 text-slate-300 hover:bg-slate-700" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-hidden rounded-lg border border-white/10">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-white/5 border-b border-white/10">
                <th className="px-2 py-1.5 text-left font-semibold text-slate-400">Ticket No</th>
                <th className="px-2 py-1.5 text-left font-semibold text-slate-400">Customer</th>
                <th className="px-2 py-1.5 text-left font-semibold text-slate-400">Technician</th>
                <th className="px-2 py-1.5 text-left font-semibold text-slate-400">Status</th>
                <th className="px-2 py-1.5 text-left font-semibold text-slate-400">Created</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.ticketNo} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                  <td className="px-2 py-1.5">
                    <Link to="/ticket/$ticketNo" params={{ ticketNo: t.ticketNo }} className="font-mono text-blue-400 hover:underline">
                      {t.ticketNo}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 text-slate-300">{t.customer || "—"}</td>
                  <td className="px-2 py-1.5 text-slate-300">{t.technician || "Unassigned"}</td>
                  <td className="px-2 py-1.5 text-slate-300">{t.status}</td>
                  <td className="px-2 py-1.5 text-slate-400">{t.created || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
