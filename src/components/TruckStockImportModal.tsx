/**
 * Truck Stock → Import preview. Shows what the picked file would add, update
 * and (optionally) remove before anything is saved; every change has a tick
 * box so a row the file has wrong (say, a part pulled in the app since the
 * sheet was last updated) can be left out. Saving is the parent's job.
 */
import { useMemo, useState } from "react";
import { Upload, X } from "lucide-react";
import type { TruckStockRow } from "@/lib/supabase/truckStock";
import { planTruckStockImport, type ParsedImport, type StockChange, type StockFields } from "@/lib/truckStockFile";

const SHOWN_ROWS = 300;

const changeKey = (c: StockChange) => `${c.kind}:${c.before?.id ?? `${c.after.branch}\u0000${c.after.partNo}`}`;

export function TruckStockImportModal({
  fileName,
  parsed,
  existing,
  branchOptions,
  onApply,
  onClose,
}: {
  fileName: string;
  parsed: ParsedImport;
  existing: TruckStockRow[];
  branchOptions: string[];
  onApply: (
    save: { upserts: StockFields[]; removeIds: string[]; added: number; updated: number },
    onProgress: (done: number, total: number) => void,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const needsBranch = parsed.parts.some((p) => !p.branch);
  const [fallbackBranch, setFallbackBranch] = useState("");
  const [removeMissing, setRemoveMissing] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plan = useMemo(
    () => planTruckStockImport(parsed.parts, existing, { fallbackBranch, removeMissing }),
    [parsed, existing, fallbackBranch, removeMissing],
  );
  const selected = plan.changes.filter((c) => !excluded.has(changeKey(c)));
  const count = (kind: StockChange["kind"], list: StockChange[]) => list.filter((c) => c.kind === kind).length;
  const multiBranch = plan.branches.length > 1;
  const skipped = Object.entries(parsed.skipped)
    .filter(([why]) => why !== "Not a part number")
    .sort((a, b) => b[1] - a[1]);
  const notParts = parsed.skipped["Not a part number"] ?? 0;
  const allOn = selected.length === plan.changes.length;

  const toggle = (c: StockChange) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      const k = changeKey(c);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const handleImport = async () => {
    setBusy(true);
    setError(null);
    try {
      await onApply(
        {
          upserts: selected.filter((c) => c.kind !== "remove").map((c) => c.after),
          removeIds: selected.filter((c) => c.kind === "remove" && c.before).map((c) => c.before!.id),
          added: count("add", selected),
          updated: count("update", selected),
        },
        (done, total) => setProgress({ done, total }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={busy ? undefined : onClose}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-xl border border-white/10 bg-slate-950 text-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 rounded-t-xl border-b border-white/10 bg-white/5 px-5 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Upload className="h-4 w-4 text-amber-300" /> Import Truck Stock
            </h2>
            <p className="truncate text-xs text-slate-400" title={fileName}>
              {fileName}
              {parsed.read.length > 1 ? ` · ${parsed.read.length} tabs read` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded p-1 text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-40" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-3 overflow-y-auto p-5 text-xs">
          {needsBranch ? (
            <label className="flex flex-wrap items-center gap-2">
              <span className="text-slate-300">Which branch is this file for? *</span>
              <select
                value={fallbackBranch}
                onChange={(e) => setFallbackBranch(e.target.value)}
                className="rounded border border-white/15 bg-slate-900 px-2 py-1.5 text-white focus:border-amber-500 focus:outline-none"
              >
                <option value="">Select branch</option>
                {branchOptions.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {plan.branches.length > 0 && (!needsBranch || multiBranch) ? (
            <p className="text-slate-300">
              {multiBranch ? `Branches (${plan.branches.length}): ` : "Branch: "}
              <span className="text-white">{plan.branches.join(", ")}</span>
            </p>
          ) : null}

          <div className={`flex flex-wrap gap-2 ${plan.branches.length === 0 ? "hidden" : ""}`}>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-1 text-emerald-200">{count("add", plan.changes)} new</span>
            <span className="rounded-full border border-sky-400/30 bg-sky-500/15 px-2.5 py-1 text-sky-200">{count("update", plan.changes)} updated</span>
            {removeMissing ? (
              <span className="rounded-full border border-rose-400/30 bg-rose-500/15 px-2.5 py-1 text-rose-200">{count("remove", plan.changes)} removed</span>
            ) : null}
            <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-slate-300">{plan.unchanged} already match</span>
          </div>

          {skipped.length > 0 ? (
            <p className="text-slate-400">
              Not counted (off the shelf): {skipped.map(([why, n]) => `${n} ${why}`).join(", ")}. A part the app has that's only listed this way goes to 0; one it doesn't have isn't added.
            </p>
          ) : null}
          {notParts > 0 ? <p className="text-slate-500">{notParts} cell{notParts === 1 ? "" : "s"} in the Part # column weren't part numbers and were skipped.</p> : null}
          {parsed.ignored.length > 0 ? <p className="text-slate-500">Passed over (no branch or no Truck Stock / Part # column): {parsed.ignored.join(", ")}</p> : null}

          {plan.missing > 0 ? (
            <label className="flex items-start gap-2 rounded border border-rose-400/20 bg-rose-500/5 px-3 py-2 text-rose-100">
              <input type="checkbox" checked={removeMissing} onChange={(e) => setRemoveMissing(e.target.checked)} className="mt-0.5" />
              <span>
                Also remove the {plan.missing} part{plan.missing === 1 ? "" : "s"} at {multiBranch ? "these branches" : plan.branches[0]} that {plan.missing === 1 ? "isn't" : "aren't"} in this file
              </span>
            </label>
          ) : null}

          {plan.changes.length === 0 ? (
            <div className="rounded border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-400">
              {needsBranch && !fallbackBranch ? "Pick the branch to see what would change." : "Nothing to change — Truck Stock already matches this file."}
            </div>
          ) : (
            <div className="max-h-[48vh] overflow-auto rounded border border-white/10">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-900 text-slate-300">
                  <tr>
                    <th className="w-8 px-2 py-2">
                      <input
                        type="checkbox"
                        title={allOn ? "Leave every change out" : "Include every change"}
                        checked={allOn}
                        onChange={() => setExcluded(allOn ? new Set(plan.changes.map(changeKey)) : new Set())}
                      />
                    </th>
                    <th className="px-2 py-2 text-left">Change</th>
                    {multiBranch ? <th className="px-2 py-2 text-left">Branch</th> : null}
                    <th className="px-2 py-2 text-left">Part No</th>
                    <th className="px-2 py-2 text-left">Stored At</th>
                    <th className="px-2 py-2 text-left">Description</th>
                    <th className="px-2 py-2 text-right">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.changes.slice(0, SHOWN_ROWS).map((c) => {
                    const on = !excluded.has(changeKey(c));
                    const qtyChanged = c.kind === "update" && c.changed.includes("Qty");
                    const locChanged = c.kind === "update" && c.changed.includes("Stored At");
                    return (
                      <tr key={changeKey(c)} className={`border-t border-white/5 ${on ? "" : "opacity-40"}`}>
                        <td className="px-2 py-1.5 text-center">
                          <input type="checkbox" checked={on} onChange={() => toggle(c)} aria-label={`Include ${c.after.partNo}`} />
                        </td>
                        <td className="px-2 py-1.5">
                          {c.kind === "add" ? (
                            <span className="rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-200">New</span>
                          ) : c.kind === "remove" ? (
                            <span className="rounded-full border border-rose-400/30 bg-rose-500/15 px-2 py-0.5 text-[11px] text-rose-200">Remove</span>
                          ) : (
                            <span className="whitespace-nowrap">
                              <span className="rounded-full border border-sky-400/30 bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-200">Updated</span>
                              <span className="ml-1.5 text-[11px] text-slate-400">{c.changed.join(", ")}</span>
                            </span>
                          )}
                        </td>
                        {multiBranch ? <td className="px-2 py-1.5 text-slate-300">{c.after.branch}</td> : null}
                        <td className="px-2 py-1.5 font-mono">{c.after.partNo}</td>
                        <td className="px-2 py-1.5">
                          {c.after.storageLocation || <span className="text-slate-500">—</span>}
                          {locChanged && c.before?.storageLocation ? <div className="text-[11px] text-slate-500">was {c.before.storageLocation}</div> : null}
                        </td>
                        <td className="max-w-[260px] truncate px-2 py-1.5 text-slate-300" title={c.after.description}>
                          {c.after.description || <span className="text-slate-500">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold">
                          {qtyChanged ? (
                            <>
                              <span className="font-normal text-slate-400">{c.before?.quantity}</span> → {c.after.quantity}
                            </>
                          ) : c.kind === "remove" ? (
                            <span className="font-normal text-slate-400">{c.after.quantity}</span>
                          ) : (
                            c.after.quantity
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {plan.changes.length > SHOWN_ROWS ? (
                <div className="border-t border-white/10 px-3 py-2 text-slate-400">
                  …and {plan.changes.length - SHOWN_ROWS} more change{plan.changes.length - SHOWN_ROWS === 1 ? "" : "s"} not shown (included).
                </div>
              ) : null}
            </div>
          )}

          {error ? <div className="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-rose-200">{error}</div> : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-3">
          <button type="button" onClick={onClose} disabled={busy} className="rounded border border-white/15 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-40">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={busy || selected.length === 0 || (needsBranch && !fallbackBranch)}
            className="inline-flex items-center gap-1 rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
          >
            <Upload className="h-3.5 w-3.5" />
            {busy
              ? progress && progress.total > 0
                ? `Saving… ${progress.done}/${progress.total}`
                : "Saving…"
              : `Import ${selected.length} change${selected.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
