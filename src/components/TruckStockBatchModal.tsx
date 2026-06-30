/**
 * Truck Stock batch modal.
 *
 * Opens when the user clicks the Truck Stock button next to Submit POs.
 * Scans every Need PO part on the ticket, looks up which branches have
 * matching stock in `truck_stock`, and lets the user pick a source
 * branch per part with one click. Confirming decrements those branches'
 * stock atomically and reports the new PO Made rows back to the host so
 * it can stamp poNo / status on each part.
 *
 * Shape contract:
 *   - `parts` is the pre-filtered list of "needs sourcing" rows the host
 *     wants to consider. Rows with no in-house hit are still surfaced
 *     so the user understands why a particular Need PO line can't be
 *     fulfilled from truck stock.
 *   - `onConfirm` receives the final selections; the host applies them
 *     to its PartTransactionRow array.
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Truck, X } from "lucide-react";
import type { TruckStockRow } from "@/lib/supabase/truckStock";

export interface TruckStockBatchPartLine {
  id: string;
  partNo: string;
  partDesc: string;
  quantity: string;
}

export interface TruckStockBatchSelection {
  partId: string;
  branch: string;
  quantity: number;
  storageLocation: string;
}

export interface TruckStockBatchModalProps {
  open: boolean;
  onClose: () => void;
  parts: TruckStockBatchPartLine[];
  ticketNo: string;
  /**
   * Async lookup the modal calls once when it opens — kept as an
   * injected dependency so this component stays pure and testable.
   * Returns every in-house row across every branch for the given part
   * numbers (>=1 quantity).
   */
  fetchStock: (partNos: string[]) => Promise<TruckStockRow[]>;
  /** Host applies these selections; modal exits on success. */
  onConfirm: (selections: TruckStockBatchSelection[]) => Promise<void>;
}

type RowState = {
  part: TruckStockBatchPartLine;
  /** Branches that currently have stock for this part. */
  options: Array<{ branch: string; quantity: number; storageLocation: string }>;
  /** Selected branch slug or "" for "skip / order normally". */
  branch: string;
};

export function TruckStockBatchModal({
  open,
  onClose,
  parts,
  ticketNo,
  fetchStock,
  onConfirm,
}: TruckStockBatchModalProps) {
  const [rows, setRows] = useState<RowState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reload stock options every time the modal opens so quantities
  // reflect what was decremented by other tabs in the meantime.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const partNos = parts.map((p) => p.partNo);
        const stock = await fetchStock(partNos);
        if (!alive) return;
        const byPart = new Map<string, Array<{ branch: string; quantity: number; storageLocation: string }>>();
        stock.forEach((s) => {
          const key = s.partNo.toLowerCase();
          if (!byPart.has(key)) byPart.set(key, []);
          byPart.get(key)!.push({
            branch: s.branch,
            quantity: s.quantity,
            storageLocation: s.storageLocation || "",
          });
        });
        setRows(parts.map((p) => {
          const options = (byPart.get(p.partNo.toLowerCase()) || [])
            .filter((o) => o.quantity > 0)
            .sort((a, b) => b.quantity - a.quantity);
          // Auto-select the branch with the most stock so the user can
          // just click Confirm if the defaults look good.
          return {
            part: p,
            options,
            branch: options[0]?.branch || "",
          };
        }));
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, parts, fetchStock]);

  const selections = useMemo<TruckStockBatchSelection[]>(() => {
    return rows
      .filter((r) => r.branch)
      .map((r) => {
        const opt = r.options.find((o) => o.branch === r.branch)!;
        const qtyNeeded = Math.max(1, Number(r.part.quantity) || 1);
        return {
          partId: r.part.id,
          branch: r.branch,
          quantity: Math.min(qtyNeeded, opt.quantity),
          storageLocation: opt.storageLocation,
        };
      });
  }, [rows]);

  const totalAvailable = rows.filter((r) => r.options.length > 0).length;
  const totalSelected = selections.length;
  const totalMissing = rows.filter((r) => r.options.length === 0).length;

  const handleConfirm = async () => {
    if (selections.length === 0) {
      alert("Pick at least one part to source from truck stock, or close the modal.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(selections);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-4xl rounded-xl border border-emerald-400/30 bg-slate-950 text-white shadow-2xl">
        <header className="flex items-center justify-between gap-4 rounded-t-xl bg-emerald-600/20 px-5 py-3 border-b border-emerald-400/30">
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-emerald-300" />
            <div>
              <h2 className="text-base font-semibold">Truck Stock — fulfill parts in-house</h2>
              <p className="text-xs text-emerald-200/80">Ticket {ticketNo} · pick a branch per part</p>
            </div>
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

        <div className="px-5 py-3 border-b border-white/10 text-xs flex flex-wrap items-center gap-4 text-slate-300">
          <span>
            <span className="text-emerald-300 font-semibold">{totalSelected}</span> selected to pull
          </span>
          <span>
            <span className="text-slate-100 font-semibold">{totalAvailable}</span> have stock somewhere
          </span>
          {totalMissing > 0 ? (
            <span>
              <span className="text-rose-300 font-semibold">{totalMissing}</span> not in any branch (order from vendor)
            </span>
          ) : null}
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400">Looking up truck stock…</div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-400">No Need PO parts on this ticket.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-900/60 text-slate-300 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Part No</th>
                  <th className="px-3 py-2 text-left font-semibold">Description</th>
                  <th className="px-3 py-2 text-right font-semibold">Need</th>
                  <th className="px-3 py-2 text-left font-semibold">Source branch</th>
                  <th className="px-3 py-2 text-left font-semibold">Stored at</th>
                  <th className="px-3 py-2 text-right font-semibold">Available</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const qtyNeeded = Math.max(1, Number(r.part.quantity) || 1);
                  const selectedOpt = r.options.find((o) => o.branch === r.branch);
                  const noStock = r.options.length === 0;
                  return (
                    <tr key={r.part.id} className={`border-t border-white/5 ${noStock ? "bg-rose-500/5" : ""}`}>
                      <td className="px-3 py-2 font-mono">{r.part.partNo}</td>
                      <td className="px-3 py-2 text-slate-300">{r.part.partDesc || "—"}</td>
                      <td className="px-3 py-2 text-right font-semibold">{qtyNeeded}</td>
                      <td className="px-3 py-2">
                        {noStock ? (
                          <span className="italic text-rose-300">— not in stock —</span>
                        ) : (
                          <select
                            value={r.branch}
                            onChange={(e) =>
                              setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, branch: e.target.value } : row)))
                            }
                            className="rounded border border-white/15 bg-slate-900 px-2 py-1 text-white focus:outline-none focus:border-emerald-400"
                          >
                            <option value="">Skip (order from vendor)</option>
                            {r.options.map((o) => (
                              <option key={o.branch} value={o.branch}>
                                {o.branch} · {o.quantity}{o.storageLocation ? ` @ ${o.storageLocation}` : ""}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {selectedOpt?.storageLocation || (noStock ? "—" : "")}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {selectedOpt ? (
                          <span className={selectedOpt.quantity < qtyNeeded ? "text-amber-300" : "text-emerald-300"}>
                            {selectedOpt.quantity}
                            {selectedOpt.quantity < qtyNeeded ? ` (need ${qtyNeeded})` : ""}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {error ? (
          <div className="px-5 py-2 border-t border-rose-500/40 bg-rose-500/10 text-xs text-rose-200">
            {error}
          </div>
        ) : null}

        <footer className="flex items-center justify-between gap-3 rounded-b-xl border-t border-white/10 px-5 py-3 bg-slate-900/40">
          <p className="text-[11px] text-slate-400">
            Confirming will decrement Truck Stock at the chosen branch and mark each part PO Made with an
            auto-generated <span className="font-mono">INH-…</span> PO number.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-white/15 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy || loading || totalSelected === 0}
              className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {busy ? "Pulling…" : `Pull ${totalSelected} part${totalSelected === 1 ? "" : "s"}`}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
