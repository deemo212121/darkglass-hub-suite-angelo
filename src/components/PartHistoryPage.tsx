import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { searchPartHistory, type PartHistorySnapshotRow } from "@/lib/supabase/partHistory";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";

export function PartHistoryPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [uniqueIdFilter, setUniqueIdFilter] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [rows, setRows] = useState<PartHistorySnapshotRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  // Other Parts pages link here as ?uniqueId=<id> (e.g. "View History" on
  // Part Inventory / Part Daily Pickup) expecting the search to run
  // automatically, matching the original page's own behavior.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const uniqueId = params.get("uniqueId");
    if (uniqueId) setUniqueIdFilter(uniqueId);
  }, []);

  // Auto-search as the user types, debounced so a fast typist doesn't fire
  // a Supabase query per keystroke.
  useEffect(() => {
    const query = uniqueIdFilter.trim();
    if (!query) {
      setRows([]);
      setSearched(false);
      setLoadError(null);
      return;
    }
    setSearched(true);
    setLoading(true);
    setLoadError(null);
    const timeout = window.setTimeout(() => {
      searchPartHistory(query)
        .then(setRows)
        .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false));
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [uniqueIdFilter]);

  const filteredRows = useMemo(() => {
    const search = historySearch.trim().toLowerCase();
    if (!search) return rows;
    return rows.filter((row) => {
      const blob = [row.partNo, row.description, row.partDist, row.status, row.poNo, row.invoiceNo, row.raNo, row.ticketNo, row.location, row.ticketStatus, row.technician].join(" ").toLowerCase();
      return blob.includes(search);
    });
  }, [rows, historySearch]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <style>{`
          .history-panel {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            padding: 1rem;
            color: #fff;
            backdrop-filter: blur(10px);
            width: 100%;
          }
          .page-title { font-size: 1.1rem; font-weight: 700; margin: 0 0 0.8rem; color: #dbeafe; }
          .top-controls { display: flex; align-items: end; gap: 0.6rem; margin-bottom: 0.7rem; }
          .field { display: flex; flex-direction: column; gap: 0.25rem; }
          .field label { font-size: 0.78rem; font-weight: 600; color: #e5e7eb; letter-spacing: 0.02em; }
          .field input { width: 100%; min-width: 280px; padding: 0.55rem 0.65rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.85rem; font-family: inherit; }
          .field input:focus { outline: none; border-color: #60a5fa; box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.16); }
          .meta-row { display: flex; align-items: center; justify-content: space-between; gap: 0.8rem; flex-wrap: wrap; margin: 0.8rem 0 0.6rem; }
          .record-count { font-size: 0.88rem; font-weight: 700; color: #bfdbfe; }
          .search-inline input { padding: 0.45rem 0.6rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.84rem; min-width: 210px; }
          .table-wrap { overflow-x: auto; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px; background: #fff; }
          table.history-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; color: #111827; min-width: 1300px; }
          .history-table th, .history-table td { border: 1px solid #d1d5db; padding: 0.45rem 0.6rem; text-align: left; vertical-align: top; white-space: nowrap; }
          .history-table thead th { background: #1f2937; color: #f9fafb; }
          .history-table tbody tr:nth-child(even) { background: #f9fafb; }
          .qty { text-align: right; }
          .no-records { text-align: center; color: #6b7280; padding: 1rem; }
          .ticket-link { color: #2563eb; text-decoration: none; font-weight: 600; }
          .ticket-link:hover { text-decoration: underline; }
          .history-summary-panel { margin-top: 0.8rem; font-size: 0.8rem; color: #94a3b8; line-height: 1.6; }
          .history-summary-panel p { margin: 0 0 0.3rem; }
          .history-summary-panel p:last-child { margin-bottom: 0; }
          @media (max-width: 900px) { .top-controls { flex-direction: column; align-items: stretch; } }
        `}</style>

        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> Parts
            </Link>
          </div>
          <h1 className="text-4xl font-display font-bold tracking-tight mb-2">{sub.title}</h1>
          <p className="text-lg text-muted-foreground">{sub.description}</p>
        </div>

        <div className="history-panel">
          <h3 className="page-title">Part In/Out History</h3>

          <div className="top-controls">
            <div className="field">
              <label htmlFor="uniqueIdFilter">Unique ID</label>
              <input
                id="uniqueIdFilter"
                type="text"
                value={uniqueIdFilter}
                onChange={(event) => setUniqueIdFilter(event.target.value)}
                placeholder="Unique ID, Part #, Invoice #, or PO #"
              />
            </div>
          </div>

          {loadError ? (
            <p className="text-sm text-red-400 px-2 py-6">Failed to search: {loadError}</p>
          ) : loading ? (
            <p className="text-sm text-muted-foreground px-2 py-6">Searching…</p>
          ) : !searched ? (
            <p className="text-sm text-muted-foreground px-2 py-6">Enter a Unique ID (or part #, invoice #, PO #) to search.</p>
          ) : (
          <>
          <div className="meta-row">
            <div className="record-count">{filteredRows.length} records found</div>
            <div className="search-inline">
              <input type="text" placeholder="search in result" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} />
            </div>
          </div>

          <div ref={tableScrollRef} className="table-wrap">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Ticket No</th>
                  <th>Repair Status</th>
                  <th>Technician</th>
                  <th>Schedule Date</th>
                  <th>Part #</th>
                  <th>Description</th>
                  <th>Dist</th>
                  <th>PO #</th>
                  <th>Invoice #</th>
                  <th>Qty</th>
                  <th>Qty Received</th>
                  <th>Received Date</th>
                  <th>Status</th>
                  <th>RA #</th>
                  <th>RA Date</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr><td colSpan={16} className="no-records">No records found.</td></tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.location || "—"}</td>
                      <td>
                        {row.ticketNo ? <Link className="ticket-link" to="/ticket/$ticketNo" params={{ ticketNo: row.ticketNo }} target="_blank" rel="noreferrer">{row.ticketNo}</Link> : "—"}
                      </td>
                      <td>{row.ticketStatus || "—"}</td>
                      <td>{row.technician || "—"}</td>
                      <td>{row.scheduleDate || "—"}</td>
                      <td>{row.partNo || "—"}</td>
                      <td>{row.description || "—"}</td>
                      <td>{row.partDist || "—"}</td>
                      <td>{row.poNo || "—"}</td>
                      <td>{row.invoiceNo || "—"}</td>
                      <td className="qty">{row.quantity}</td>
                      <td className="qty">{row.qtyReceived}</td>
                      <td>{row.receivedDate || "—"}</td>
                      <td>{row.status || "—"}</td>
                      <td>{row.raNo || "—"}</td>
                      <td>{row.raDate || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <FloatingHorizontalScrollbar targetRef={tableScrollRef} />
          </>
          )}
        </div>

        <div className="history-panel history-summary-panel">
          <p><strong>*Note:</strong> This shows the part's current real state (ticket, PO #, status, RA # if returned) — it isn't a chronological event log. No per-event history is recorded anywhere in this app yet, so a full in/out timeline isn't available.</p>
        </div>
      </main>
    </div>
  );
}
