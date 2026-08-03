/**
 * Need Cancel / Cancelled tab for Operations Daily Report — a dedicated,
 * company-wide view of the cancellation pipeline: which region/location/
 * brand cancellations are coming from, and (for CL-Cancelled tickets) the
 * real structured reason recorded by BizOps. Reuses the same isNeedCancel/
 * isCancelled status checks as operationsBranchMetrics.ts's per-location
 * table so the numbers always agree with the Overview/regional tabs.
 */

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Download } from "lucide-react";
import { isCancelled, isNeedCancel } from "@/lib/operationsBranchMetrics";
import { REGIONS, REGION_LOCATIONS, locationRegion } from "@/lib/locations";
import type { Ticket } from "@/lib/ticketData";

const CHART_COLORS = ["#3b82f6", "#34d399", "#a78bfa", "#fb923c", "#f472b6", "#facc15", "#60a5fa", "#f87171", "#22d3ee", "#c084fc"];
const TOOLTIP_STYLE = { background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" } as const;
const PAGE_SIZE = 20;

interface SliceDatum { name: string; value: number }

function PieWithLegend({ title, data, emptyLabel }: { title: string; data: SliceDatum[]; emptyLabel: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="panel p-4">
      <p className="text-sm font-semibold mb-4">{title}</p>
      {data.length === 0 ? (
        <p className="text-xs text-muted-foreground py-16 text-center">{emptyLabel}</p>
      ) : (
        <div className="flex gap-3 items-center">
          <ResponsiveContainer width="45%" height={200}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={false} labelLine={false}>
                {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any, n: any) => [v, n]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 min-w-0 flex flex-col justify-start gap-px py-1 max-h-[200px] overflow-y-auto">
            {data.map((entry, i) => {
              const pct = total > 0 ? (entry.value / total) * 100 : 0;
              return (
                <div key={entry.name} className="flex items-center gap-1.5 text-[10px] leading-[1.35]">
                  <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="truncate flex-1" title={entry.name}>{entry.name}</span>
                  <span className="text-muted-foreground shrink-0">{entry.value} · {pct.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function ReportCancellations({ tickets }: { tickets: Ticket[] }) {
  const [regionFilter, setRegionFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "need-cancel" | "cancelled">("");
  const [page, setPage] = useState(1);

  const locationOptions = regionFilter ? REGION_LOCATIONS[regionFilter as keyof typeof REGION_LOCATIONS] : Object.values(REGION_LOCATIONS).flat();

  const cancellationTickets = useMemo(() => tickets.filter((t) => isNeedCancel(t) || isCancelled(t)), [tickets]);

  const filtered = useMemo(() => {
    return cancellationTickets.filter((t) => {
      const region = locationRegion(t.location);
      if (regionFilter && region !== regionFilter) return false;
      if (locationFilter && t.location !== locationFilter) return false;
      if (statusFilter === "need-cancel" && !isNeedCancel(t)) return false;
      if (statusFilter === "cancelled" && !isCancelled(t)) return false;
      return true;
    });
  }, [cancellationTickets, regionFilter, locationFilter, statusFilter]);

  const needCancelCount = filtered.filter(isNeedCancel).length;
  const cancelledCount = filtered.filter(isCancelled).length;

  const byBrand = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of filtered) {
      const key = (t.manufacturer || "Unspecified").trim() || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const byLocation = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of filtered) {
      const key = (t.location || "Unspecified").trim() || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  // Only CL-Cancelled tickets carry a real structured reason (see
  // ticket.$ticketNo.tsx's canSetCancelled) — a CL-Need Cancel ticket is
  // still awaiting BizOps review and has none yet.
  const byReason = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of filtered) {
      if (!isCancelled(t)) continue;
      const reason = (t.cancellationReason || "").trim();
      if (!reason) continue;
      map.set(reason, (map.get(reason) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const pagedRows = filtered
    .slice()
    .sort((a, b) => (b.statusChangedAt || b.created || "").localeCompare(a.statusChangedAt || a.created || ""))
    .slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const exportToXlsx = () => {
    const data = filtered.map((t) => ({
      "Ticket No": t.ticketNo,
      Region: locationRegion(t.location) || "—",
      Location: t.location || "—",
      Brand: t.manufacturer || "—",
      Status: isCancelled(t) ? "Cancelled" : "Need Cancel",
      Reason: t.cancellationReason || "—",
      Customer: t.customer || "—",
      Created: t.created || "—",
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Need Cancel-Cancelled");
    XLSX.writeFile(workbook, `operations-cancellations_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-4">Every currently open CL-Need Cancel ticket and every CL-Cancelled ticket, company-wide — by region, location, brand, and reason.</p>

      <div className="panel mb-6"><div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Region</label>
          <select value={regionFilter} onChange={(e) => { setRegionFilter(e.target.value); setLocationFilter(""); setPage(1); }} className="glass-input text-sm py-1.5 px-3 rounded-md">
            <option value="">All Regions</option>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location</label>
          <select value={locationFilter} onChange={(e) => { setLocationFilter(e.target.value); setPage(1); }} className="glass-input text-sm py-1.5 px-3 rounded-md">
            <option value="">All Locations</option>
            {locationOptions.map((l) => <option key={l} value={l}>{l}</option>)}
          </select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</label>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as any); setPage(1); }} className="glass-input text-sm py-1.5 px-3 rounded-md">
            <option value="">Need Cancel + Cancelled</option>
            <option value="need-cancel">Need Cancel only</option>
            <option value="cancelled">Cancelled only</option>
          </select></div>
        {(regionFilter || locationFilter || statusFilter) && (
          <button onClick={() => { setRegionFilter(""); setLocationFilter(""); setStatusFilter(""); setPage(1); }} className="btn text-sm px-3 mb-0.5">Clear</button>
        )}
        <button onClick={exportToXlsx} className="btn text-sm px-3 mb-0.5 flex items-center gap-1.5">
          <Download className="h-3.5 w-3.5" /> Download XLSX
        </button>
        <span className="text-sm text-muted-foreground mb-0.5">{filtered.length} tickets</span>
      </div></div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {[
          ["Need Cancel", needCancelCount, "text-orange-300"],
          ["Cancelled", cancelledCount, "text-red-300"],
          ["Total", filtered.length, "text-foreground"],
        ].map(([l, v, c]) => (
          <div key={l as string} className="panel p-4 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{l}</p>
            <p className={`text-2xl font-bold ${c}`}>{v}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <PieWithLegend title="By Brand" data={byBrand} emptyLabel="No cancellations in this filter." />
        <PieWithLegend title="By Location" data={byLocation} emptyLabel="No cancellations in this filter." />
        <PieWithLegend title="By Reason (Cancelled only)" data={byReason} emptyLabel="No CL-Cancelled ticket here has a recorded reason yet." />
      </div>

      <div className="panel overflow-x-auto p-0">
        <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex justify-between">
          <span>Ticket Detail</span>
          <span className="text-xs text-muted-foreground">{filtered.length} tickets</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {["Ticket No", "Region", "Location", "Brand", "Status", "Reason", "Customer"].map((h) => (
                <th key={h} className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagedRows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">No tickets match this filter.</td></tr>
            ) : pagedRows.map((t, i) => (
              <tr key={t.ticketNo} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                  <a href={`/ticket/${t.ticketNo}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-300 hover:underline transition">{t.ticketNo}</a>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{locationRegion(t.location) || "—"}</td>
                <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{t.location || "—"}</td>
                <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{t.manufacturer || "—"}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {isCancelled(t)
                    ? <span className="px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-300 border border-red-500/30">Cancelled</span>
                    : <span className="px-2 py-0.5 rounded text-xs bg-orange-500/20 text-orange-300 border border-orange-500/30">Need Cancel</span>}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground max-w-[200px] truncate" title={t.cancellationReason}>{t.cancellationReason || "—"}</td>
                <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{t.customer || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {pageCount > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/10 text-xs text-muted-foreground">
            <span>Page {pageSafe} of {pageCount}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageSafe <= 1} className="btn text-xs px-2 py-1 disabled:opacity-40">Prev</button>
              <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={pageSafe >= pageCount} className="btn text-xs px-2 py-1 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
