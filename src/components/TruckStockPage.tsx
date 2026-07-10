/**
 * Parts → Truck Stock panel — embedded as the "Truck Stock" tab inside
 * PartInventory.tsx (previously its own routed submodule, merged in so both
 * live under one Part Inventory page).
 *
 * Lists every part currently in-house, grouped by branch, with a
 * branch-or-all filter. The same row also shows cross-branch availability
 * so a tech can see at a glance whether another location already has the
 * part before placing a new PO.
 *
 * Wired to the `truck_stock` table via src/lib/supabase/truckStock.ts.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, Pencil, Trash2, Save, X, Upload } from "lucide-react";
import {
  getTruckStock,
  upsertTruckStockRow,
  deleteTruckStockRow,
  bulkUpsertTruckStock,
  type TruckStockRow,
  type TruckStockStatus,
} from "@/lib/supabase/truckStock";
import { getLocations, type LocationRow } from "@/lib/supabase/locationManagement";
import { resolveTruckStockBranch } from "@/lib/truckStockBranchMap";
import { getPartTransactionsByPartNo, type PartUsageRow } from "@/lib/supabase/tickets";

const PAGE_SIZE_OPTIONS = [25, 50, 75, 100, 125] as const;

function formatDateAdded(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

/** Days since the row was added — how long a part has been sitting in stock. */
function agingDays(iso?: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

function agingClass(days: number): string {
  if (days >= 90) return "text-red-300 font-semibold";
  if (days >= 30) return "text-amber-300 font-semibold";
  return "text-slate-300";
}

const emptyDraft = (): TruckStockRow => ({
  id: "",
  branch: "",
  partNo: "",
  description: "",
  manufacturer: "",
  quantity: 1,
  storageLocation: "",
  notes: "",
  status: "in_stock",
});

export function TruckStockPanel() {
  const [rows, setRows] = useState<TruckStockRow[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | TruckStockStatus>("");
  // Page size: a real number of rows per page, or "all" to show every row —
  // same convention as TicketList.tsx. Truck Stock can have thousands of
  // rows across every branch, and rendering them all at once is what was
  // causing the lag.
  const [pageSize, setPageSize] = useState<number | "all">(100);
  const [currentPage, setCurrentPage] = useState(1);
  const [draft, setDraft] = useState<TruckStockRow | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [usagePartNo, setUsagePartNo] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const [stock, locs] = await Promise.all([getTruckStock(), getLocations().catch(() => [])]);
        if (!alive) return;
        setRows(stock);
        setLocations(locs);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Branches = union of saved Location records + any branches already
  // present on a truck_stock row (handles rows entered before a Location
  // record exists). Sorted alphabetically.
  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    locations.forEach((l) => l.location && set.add(l.location));
    rows.forEach((r) => r.branch && set.add(r.branch));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [locations, rows]);

  // Aggregate quantity per part across all branches — drives the
  // "cross-branch availability" chip on each row.
  const totalsByPart = useMemo(() => {
    const map = new Map<string, { total: number; branches: { branch: string; qty: number }[] }>();
    rows.forEach((r) => {
      const key = r.partNo.toLowerCase();
      if (!map.has(key)) map.set(key, { total: 0, branches: [] });
      const entry = map.get(key)!;
      entry.total += r.quantity;
      entry.branches.push({ branch: r.branch, qty: r.quantity });
    });
    return map;
  }, [rows]);

  const filteredRows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (branchFilter && r.branch !== branchFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (!s) return true;
      return (
        r.partNo.toLowerCase().includes(s) ||
        r.description.toLowerCase().includes(s) ||
        r.manufacturer.toLowerCase().includes(s) ||
        r.storageLocation.toLowerCase().includes(s)
      );
    });
  }, [rows, search, branchFilter, statusFilter]);

  // Any filter changing invalidates whatever page we were on.
  useEffect(() => {
    setCurrentPage(1);
  }, [search, branchFilter, statusFilter]);

  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedRows = useMemo(() => {
    if (pageSize === "all") return filteredRows;
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePage, pageSize]);

  const groupedByBranch = useMemo(() => {
    const map = new Map<string, TruckStockRow[]>();
    pagedRows.forEach((r) => {
      const key = r.branch || "Unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [pagedRows]);

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.branch.trim() || !draft.partNo.trim()) {
      alert("Branch and Part No are required.");
      return;
    }
    setBusy(true);
    try {
      const saved = await upsertTruckStockRow(draft);
      setRows((prev) => {
        const idx = prev.findIndex((r) => r.id === saved.id);
        if (idx >= 0) {
          const next = prev.slice();
          next[idx] = saved;
          return next;
        }
        return [...prev, saved];
      });
      setDraft(null);
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (row: TruckStockRow) => {
    if (!confirm(`Remove ${row.partNo} from ${row.branch}?`)) return;
    setBusy(true);
    try {
      await deleteTruckStockRow(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!confirm(
      "Import the company inventory workbook?\n\n" +
      "This will bulk-load every Truck Stock part from the PROJECT A USAPP " +
      "inventory spreadsheet across every branch. Existing rows are merged " +
      "(quantities update) rather than duplicated.",
    )) return;
    setImportBusy(true);
    setImportResult(null);
    setImportProgress({ done: 0, total: 0 });
    try {
      const mod = await import("@/lib/truckStockSeed.json");
      const rawSeed = (mod.default ?? mod) as Array<Omit<TruckStockRow, "id" | "updatedAt">>;
      // Translate the spreadsheet's 2-3 letter branch codes (AV, ATL, BM,
      // …) to the full city names from src/lib/locations.ts so the rows
      // show up grouped under recognisable labels.
      const seed = rawSeed.map((r) => ({
        ...r,
        branch: resolveTruckStockBranch(r.branch),
      }));
      setImportProgress({ done: 0, total: seed.length });
      const { inserted, errors } = await bulkUpsertTruckStock(seed, {
        chunkSize: 500,
        onProgress: (done, total) => setImportProgress({ done, total }),
      });
      if (errors.length > 0) {
        setImportResult(`Imported ${inserted} rows with ${errors.length} chunk error(s). First: ${errors[0]}`);
      } else {
        setImportResult(`Imported ${inserted} rows from the workbook.`);
      }
      // Reload the page data so the imported rows show up.
      const fresh = await getTruckStock();
      setRows(fresh);
    } catch (err) {
      setImportResult(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleImport}
          disabled={importBusy || busy}
          title="Bulk-import the PROJECT A USAPP inventory workbook"
          className="inline-flex items-center gap-1 rounded-md border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-sm font-medium text-amber-200 hover:bg-amber-500/25 disabled:opacity-40"
        >
          <Upload className="h-4 w-4" />
          {importBusy
            ? importProgress
              ? `Importing… ${importProgress.done}/${importProgress.total}`
              : "Importing…"
            : "Import workbook"}
        </button>
        <button
          type="button"
          onClick={() => setDraft(emptyDraft())}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" /> Add stock
        </button>
      </div>

      {importResult ? (
          <div className="rounded border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
            {importResult}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search part #, description, brand, or bin"
            className="min-w-[240px] flex-1 rounded border border-white/15 bg-slate-950 px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          />
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="rounded border border-white/15 bg-slate-950 px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">All branches</option>
            {branchOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <select
            title="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value === "in_use" ? "in_use" : e.target.value === "in_stock" ? "in_stock" : "")}
            className="rounded border border-white/15 bg-slate-950 px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">All statuses</option>
            <option value="in_stock">In Stock</option>
            <option value="in_use">In Use</option>
          </select>
          <div className="text-xs text-slate-400">
            {filteredRows.length} of {rows.length} rows · {branchOptions.length} branches
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
          <span>
            {filteredRows.length === 0
              ? "Showing 0 rows"
              : pageSize === "all"
              ? `Showing all ${filteredRows.length} of ${filteredRows.length} rows`
              : `Showing ${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, filteredRows.length)} of ${filteredRows.length} rows`}
          </span>
          <div className="flex items-center gap-1.5">
            <span>Show:</span>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => { setPageSize(size); setCurrentPage(1); }}
                className={`px-2 py-1 rounded border transition-colors ${pageSize === size ? "border-blue-500/40 bg-blue-500/15 text-blue-300" : "border-white/10 bg-white/5 hover:bg-white/10 text-slate-400"}`}
              >
                {size}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setPageSize("all"); setCurrentPage(1); }}
              className={`px-2 py-1 rounded border transition-colors ${pageSize === "all" ? "border-blue-500/40 bg-blue-500/15 text-blue-300" : "border-white/10 bg-white/5 hover:bg-white/10 text-slate-400"}`}
            >
              All
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        {/* Only a genuinely new row (no id yet) uses the top form — editing an
            existing row happens inline, in its own place in the table below,
            so there's no need to scroll back up just to change a field. */}
        {draft && !draft.id ? <DraftEditor draft={draft} setDraft={setDraft} onSave={handleSave} onCancel={() => setDraft(null)} branchOptions={branchOptions} busy={busy} /> : null}

        {loading ? (
          <div className="rounded border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-400">
            Loading…
          </div>
        ) : groupedByBranch.length === 0 ? (
          <div className="rounded border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-400">
            No stock rows yet. Click "Add stock" to register the first part.
          </div>
        ) : (
          groupedByBranch.map(([branch, branchRows]) => (
            <BranchSection
              key={branch}
              branch={branch}
              rows={branchRows}
              totalsByPart={totalsByPart}
              editingRow={draft && draft.id ? draft : null}
              setEditingRow={setDraft}
              onEdit={(r) => setDraft({ ...r })}
              onDelete={handleDelete}
              onShowUsage={setUsagePartNo}
              onSaveEdit={handleSave}
              onCancelEdit={() => setDraft(null)}
              branchOptions={branchOptions}
              busy={busy}
            />
          ))
        )}

        {pageSize !== "all" && totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="rounded border border-white/15 px-3 py-1.5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <span className="text-xs">Page {safePage} of {totalPages}</span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="rounded border border-white/15 px-3 py-1.5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}

        {usagePartNo ? <PartUsageModal partNo={usagePartNo} onClose={() => setUsagePartNo(null)} /> : null}
    </div>
  );
}

function BranchSection({
  branch,
  rows,
  totalsByPart,
  editingRow,
  setEditingRow,
  onEdit,
  onDelete,
  onSaveEdit,
  onCancelEdit,
  onShowUsage,
  branchOptions,
  busy,
}: {
  branch: string;
  rows: TruckStockRow[];
  totalsByPart: Map<string, { total: number; branches: { branch: string; qty: number }[] }>;
  editingRow: TruckStockRow | null;
  setEditingRow: (r: TruckStockRow | null) => void;
  onEdit: (r: TruckStockRow) => void;
  onDelete: (r: TruckStockRow) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onShowUsage: (partNo: string) => void;
  branchOptions: string[];
  busy: boolean;
}) {
  const branchTotal = rows.reduce((sum, r) => sum + r.quantity, 0);
  return (
    <div className="rounded-xl border border-white/10 bg-white/5">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
        <h2 className="text-sm font-semibold text-white">{branch}</h2>
        <span className="text-xs text-slate-400">{rows.length} parts · {branchTotal} units</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-white">
          <thead className="bg-slate-900/60 text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">Part No</th>
              <th className="px-3 py-2 text-left">Stored At</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-left">Brand</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Other branches</th>
              <th className="px-3 py-2 text-left">Notes</th>
              <th className="px-3 py-2 text-left">Date Added</th>
              <th className="px-3 py-2 text-left">Aging</th>
              <th className="px-3 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = row.partNo.toLowerCase();
              const totals = totalsByPart.get(key);
              const elsewhere = (totals?.branches || []).filter((b) => b.branch !== row.branch && b.qty > 0);
              const isEditing = editingRow?.id === row.id;

              if (isEditing) {
                const d = editingRow;
                const setField = <K extends keyof TruckStockRow>(k: K, v: TruckStockRow[K]) =>
                  setEditingRow({ ...d, [k]: v });
                return (
                  <tr key={row.id} className="border-t border-blue-400/30 bg-blue-500/10">
                    <td className="px-2 py-1.5">
                      <input value={d.partNo} onChange={(e) => setField("partNo", e.target.value)} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 font-mono text-white focus:outline-none focus:border-blue-500" placeholder="Part No" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={d.storageLocation} onChange={(e) => setField("storageLocation", e.target.value)} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="Shelf A-1, TS-3, …" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={d.description} onChange={(e) => setField("description", e.target.value)} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="Description" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={d.manufacturer} onChange={(e) => setField("manufacturer", e.target.value)} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="Brand" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min={0} title="Quantity" value={d.quantity} onChange={(e) => setField("quantity", Number(e.target.value) || 0)} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-right text-white focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="px-2 py-1.5">
                      <select title="Status" value={d.status} onChange={(e) => setField("status", e.target.value === "in_use" ? "in_use" : "in_stock")} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500">
                        <option value="in_stock">In Stock</option>
                        <option value="in_use">In Use</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {elsewhere.length === 0 ? (
                        <span className="text-slate-500">— only here</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {elsewhere.map((e) => (
                            <span key={e.branch} className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-200" title={`${e.qty} available at ${e.branch}`}>
                              {e.branch} · {e.qty}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={d.notes} onChange={(e) => setField("notes", e.target.value)} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="Notes" />
                    </td>
                    <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{formatDateAdded(row.createdAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {(() => {
                        const days = agingDays(row.createdAt);
                        if (days === null) return <span className="text-slate-500">—</span>;
                        return <span className={agingClass(days)}>{days}d</span>;
                      })()}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={onSaveEdit} disabled={busy} className="rounded p-1 text-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-200 disabled:opacity-40" title="Save">
                          <Save className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={onCancelEdit} disabled={busy} className="rounded p-1 text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-40" title="Cancel">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={row.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2 font-mono">
                    <button
                      type="button"
                      onClick={() => onShowUsage(row.partNo)}
                      className="underline decoration-dotted underline-offset-2 hover:text-blue-300"
                      title="See every ticket using this part"
                    >
                      {row.partNo}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    {row.storageLocation ? (
                      <span className="inline-flex items-center rounded border border-sky-400/30 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-200">
                        {row.storageLocation}
                      </span>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{row.description || "—"}</td>
                  <td className="px-3 py-2">{row.manufacturer || "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold">{row.quantity}</td>
                  <td className="px-3 py-2">
                    {row.status === "in_use" ? (
                      <span className="inline-flex items-center rounded-full border border-amber-400/30 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                        In Use
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
                        In Stock
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {elsewhere.length === 0 ? (
                      <span className="text-slate-500">— only here</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {elsewhere.map((e) => (
                          <span
                            key={e.branch}
                            className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-200"
                            title={`${e.qty} available at ${e.branch}`}
                          >
                            {e.branch} · {e.qty}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{row.notes || ""}</td>
                  <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{formatDateAdded(row.createdAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {(() => {
                      const days = agingDays(row.createdAt);
                      if (days === null) return <span className="text-slate-500">—</span>;
                      return <span className={agingClass(days)}>{days}d</span>;
                    })()}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onEdit(row)}
                        disabled={!!editingRow}
                        className="rounded p-1 text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-40"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(row)}
                        disabled={!!editingRow}
                        className="rounded p-1 text-rose-300 hover:bg-rose-500/15 hover:text-rose-200 disabled:opacity-40"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DraftEditor({
  draft,
  setDraft,
  onSave,
  onCancel,
  branchOptions,
  busy,
}: {
  draft: TruckStockRow;
  setDraft: (d: TruckStockRow | null) => void;
  onSave: () => void;
  onCancel: () => void;
  branchOptions: string[];
  busy: boolean;
}) {
  const isEdit = !!draft.id;
  return (
    <div className="rounded-xl border border-blue-400/30 bg-blue-500/10 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-blue-100">
          {isEdit ? "Edit truck stock row" : "Add truck stock row"}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-1 text-slate-300 hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 text-xs">
        <label className="md:col-span-2 flex flex-col gap-1">
          <span className="text-slate-300">Branch *</span>
          <select
            value={draft.branch}
            onChange={(e) => setDraft({ ...draft, branch: e.target.value })}
            className="rounded border border-white/15 bg-slate-950 px-2 py-1.5 text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">Select branch</option>
            {branchOptions.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </label>
        <label className="md:col-span-2 flex flex-col gap-1">
          <span className="text-slate-300">Part No *</span>
          <input
            value={draft.partNo}
            onChange={(e) => setDraft({ ...draft, partNo: e.target.value })}
            placeholder="WH16X27179"
            className="rounded border border-white/15 bg-slate-950 px-2 py-1.5 font-mono text-white focus:outline-none focus:border-blue-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-300">Quantity</span>
          <input
            type="number"
            min={0}
            value={draft.quantity}
            onChange={(e) => setDraft({ ...draft, quantity: Number(e.target.value) || 0 })}
            className="rounded border border-white/15 bg-slate-950 px-2 py-1.5 text-white focus:outline-none focus:border-blue-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-300">Status</span>
          <select
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value === "in_use" ? "in_use" : "in_stock" })}
            className="rounded border border-white/15 bg-slate-950 px-2 py-1.5 text-white focus:outline-none focus:border-blue-500"
          >
            <option value="in_stock">In Stock</option>
            <option value="in_use">In Use</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-300">Stored At</span>
          <input
            value={draft.storageLocation}
            onChange={(e) => setDraft({ ...draft, storageLocation: e.target.value })}
            placeholder="Shelf A-1, Box 2, TS-3, …"
            className="rounded border border-white/15 bg-slate-950 px-2 py-1.5 text-white focus:outline-none focus:border-blue-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-300">Brand</span>
          <input
            value={draft.manufacturer}
            onChange={(e) => setDraft({ ...draft, manufacturer: e.target.value })}
            placeholder="GE, Whirlpool, …"
            className="rounded border border-white/15 bg-slate-950 px-2 py-1.5 text-white focus:outline-none focus:border-blue-500"
          />
        </label>
        <label className="md:col-span-3 flex flex-col gap-1">
          <span className="text-slate-300">Description</span>
          <input
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="DOOR LOCK, DRAIN PUMP, …"
            className="rounded border border-white/15 bg-slate-950 px-2 py-1.5 text-white focus:outline-none focus:border-blue-500"
          />
        </label>
        <label className="md:col-span-3 flex flex-col gap-1">
          <span className="text-slate-300">Notes</span>
          <input
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="Bin location, condition, …"
            className="rounded border border-white/15 bg-slate-950 px-2 py-1.5 text-white focus:outline-none focus:border-blue-500"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-white/15 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          <Save className="h-3.5 w-3.5" /> {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

const PART_STATUS_BADGE: Record<string, string> = {
  Claimed: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
  "PO Made": "bg-sky-500/15 text-sky-200 border-sky-400/30",
  Cancelled: "bg-rose-500/15 text-rose-200 border-rose-400/30",
};

function PartUsageModal({ partNo, onClose }: { partNo: string; onClose: () => void }) {
  const [rows, setRows] = useState<PartUsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getPartTransactionsByPartNo(partNo);
        if (alive) setRows(data);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [partNo]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-xl border border-white/10 bg-slate-950 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 rounded-t-xl bg-white/5 px-5 py-3 border-b border-white/10">
          <div>
            <h2 className="text-base font-semibold font-mono">{partNo}</h2>
            <p className="text-xs text-slate-400">Every ticket where this part number was actually pulled from Truck Stock (approved requests only)</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-300 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[65vh] overflow-y-auto">
          {loading ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400">Looking up part usage…</div>
          ) : error ? (
            <div className="px-5 py-4 text-sm text-rose-300">{error}</div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400">This part hasn't been pulled from Truck Stock on any ticket yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-900/60 text-slate-300 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Ticket</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-left font-semibold">Source / PO No</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2 text-left font-semibold">Responsible</th>
                  <th className="px-3 py-2 text-left font-semibold">Added</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pulledFromTruckStock = r.partDist.startsWith("In-House (");
                  return (
                    <tr key={r.id} className="border-t border-white/5 hover:bg-white/5">
                      <td className="px-3 py-2 font-mono">
                        {r.ticketNo ? (
                          <Link to="/ticket/$ticketNo" params={{ ticketNo: r.ticketNo }} className="text-blue-400 hover:text-blue-300 hover:underline">
                            {r.ticketNo}
                          </Link>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${PART_STATUS_BADGE[r.status] || "bg-slate-500/15 text-slate-300 border-slate-400/30"}`}>
                          {r.status || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {pulledFromTruckStock ? (
                          <span className="text-emerald-300">{r.partDist}</span>
                        ) : (
                          r.partDist || r.poNo || "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">{r.quantity || "—"}</td>
                      <td className="px-3 py-2 text-slate-300">
                        {r.pulledBy || (pulledFromTruckStock ? <span className="text-slate-500">Unknown</span> : <span className="text-slate-500">—</span>)}
                      </td>
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                        {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
