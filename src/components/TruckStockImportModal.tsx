/**
 * Truck Stock → Import preview. First the user picks what happens to parts
 * Truck Stock already has (update them, leave them, or clear the file's
 * branches first) and, when the file has parts that look like ones already
 * there, ticks through that checklist; then every change is shown with a tick
 * box so a row the file has wrong (say, a part pulled in the app since the
 * sheet was last updated) can be left out. Saving is the parent's job.
 */
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Copy, Upload, X } from "lucide-react";
import type { TruckStockRow } from "@/lib/supabase/truckStock";
import { planTruckStockImport, type ImportMode, type ParsedImport, type StockChange, type StockFields } from "@/lib/truckStockFile";

const SHOWN_ROWS = 300;

const changeKey = (c: StockChange) => `${c.kind}:${c.before?.id ?? `${c.after.branch}\u0000${c.after.partNo}`}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export type ImportSave = {
  upserts: StockFields[];
  removeIds: string[];
  added: number;
  updated: number;
  /** Clear first: what the file's branches hold now, downloaded before anything is saved. */
  backup: { branches: string[]; rows: TruckStockRow[] } | null;
};

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
  onApply: (save: ImportSave, onProgress: (done: number, total: number) => void) => Promise<void>;
  onClose: () => void;
}) {
  const needsBranch = parsed.parts.some((p) => !p.branch);
  const [fallbackBranch, setFallbackBranch] = useState("");
  const [mode, setMode] = useState<ImportMode>("update");
  /** Possible duplicates the user unticked: add them as their own part. */
  const [separate, setSeparate] = useState<Set<string>>(() => new Set());
  const [step, setStep] = useState<"duplicates" | "changes">("duplicates");
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plan = useMemo(
    () => planTruckStockImport(parsed.parts, existing, { fallbackBranch, mode, separate }),
    [parsed, existing, fallbackBranch, mode, separate],
  );
  const dups = plan.duplicates;
  const showDuplicates = step === "duplicates" && dups.length > 0;
  const selected = plan.changes.filter((c) => !excluded.has(changeKey(c)));
  const count = (kind: StockChange["kind"], list: StockChange[]) => list.filter((c) => c.kind === kind).length;
  const multiBranch = plan.branches.length > 1;
  const branchLabel = multiBranch ? `these ${plan.branches.length} branches` : plan.branches[0] ?? "this branch";
  const skipped = Object.entries(parsed.skipped)
    .filter(([why]) => why !== "Not a part number")
    .sort((a, b) => b[1] - a[1]);
  const notParts = parsed.skipped["Not a part number"] ?? 0;
  const allOn = selected.length === plan.changes.length;
  const sameCount = dups.filter((d) => !separate.has(d.key)).length;
  const waitingForBranch = needsBranch && !fallbackBranch;

  const toggleIn = (set: (f: (prev: Set<string>) => Set<string>) => void, key: string) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const handleImport = async () => {
    const removing = count("remove", selected);
    if (
      mode === "clear" &&
      !confirm(
        `Clear first: ${plural(removing, "part")} at ${multiBranch ? plan.branches.join(", ") : branchLabel} that ${removing === 1 ? "isn't" : "aren't"} in the file will be removed, and the rest take the file's values.\n\nA copy of the ${plural(plan.atBranches, "part")} there now downloads first. Continue?`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const branches = new Set(plan.branches.map((b) => b.toLowerCase()));
      await onApply(
        {
          upserts: selected.filter((c) => c.kind !== "remove").map((c) => c.after),
          removeIds: selected.filter((c) => c.kind === "remove" && c.before).map((c) => c.before!.id),
          added: count("add", selected),
          updated: count("update", selected),
          backup: mode === "clear" ? { branches: plan.branches, rows: existing.filter((r) => branches.has(r.branch.toLowerCase())) } : null,
        },
        (done, total) => setProgress({ done, total }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
      setProgress(null);
    }
  };

  const modes: { id: ImportMode; title: string; detail: string; tone: string }[] = [
    { id: "update", title: "Overwrite", detail: "Parts we have take the file's Qty, bin and details. Blank cells keep ours.", tone: "amber" },
    { id: "addOnly", title: "Add new only", detail: "Parts we have stay as they are; only parts we don't have are added.", tone: "amber" },
    {
      id: "clear",
      title: "Clear first",
      detail: `Empty ${branchLabel}${plan.branches.length ? ` (${plural(plan.atBranches, "part")} now)` : ""} and load the file in its place. A copy downloads first.`,
      tone: "rose",
    },
  ];

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

          <fieldset disabled={busy} className={waitingForBranch ? "hidden" : ""}>
            <legend className="mb-1.5 text-slate-300">Parts already in Truck Stock:</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {modes.map((m) => {
                const on = mode === m.id;
                const ring = m.tone === "rose" ? "border-rose-400/60 bg-rose-500/10" : "border-amber-400/60 bg-amber-500/10";
                return (
                  <label key={m.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${on ? ring : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
                    <input type="radio" name="truck-stock-import-mode" checked={on} onChange={() => setMode(m.id)} className="mt-0.5" />
                    <span>
                      <span className={`block font-semibold ${m.tone === "rose" ? "text-rose-200" : "text-white"}`}>{m.title}</span>
                      <span className="block text-[11px] text-slate-400">{m.detail}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {showDuplicates ? (
            <>
              <div className="rounded border border-amber-400/25 bg-amber-500/5 px-3 py-2 text-amber-100">
                <p className="flex items-center gap-1.5 font-semibold">
                  <Copy className="h-3.5 w-3.5" /> {plural(dups.length, "possible duplicate")}
                </p>
                <p className="mt-0.5 text-amber-100/80">
                  These parts in the file look like ones already there: the same number apart from spaces, dashes, leading zeros or words after it. Ticked = the same part, so
                  it updates that one instead of being added again. Untick a row to add it as its own part.
                </p>
              </div>
              <div className="max-h-[48vh] overflow-auto rounded border border-white/10">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-900 text-slate-300">
                    <tr>
                      <th className="w-8 px-2 py-2">
                        <input
                          type="checkbox"
                          title={sameCount === dups.length ? "Add every one as its own part" : "Treat every one as the same part"}
                          checked={sameCount === dups.length}
                          onChange={() => setSeparate(sameCount === dups.length ? new Set(dups.map((d) => d.key)) : new Set())}
                        />
                      </th>
                      {multiBranch ? <th className="px-2 py-2 text-left">Branch</th> : null}
                      <th className="px-2 py-2 text-left">In the file</th>
                      <th className="px-2 py-2 text-left">Looks like</th>
                      <th className="px-2 py-2 text-left">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dups.map((d) => {
                      const same = !separate.has(d.key);
                      return (
                        <tr key={d.key} className="border-t border-white/5 align-top">
                          <td className="px-2 py-1.5 text-center">
                            <input type="checkbox" checked={same} onChange={() => toggleIn(setSeparate, d.key)} aria-label={`${d.part.partNo} is the same part as ${d.like.partNo}`} />
                          </td>
                          {multiBranch ? <td className="px-2 py-1.5 text-slate-300">{d.branch}</td> : null}
                          <td className="px-2 py-1.5">
                            <div className="font-mono">{d.part.partNo}</div>
                            <div className="text-[11px] text-slate-400">
                              Qty {d.part.quantity}
                              {d.part.storageLocation ? ` · ${d.part.storageLocation}` : ""}
                            </div>
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="font-mono">{d.like.partNo}</div>
                            <div className="text-[11px] text-slate-400">
                              {d.kind === "ours" ? "In Truck Stock" : "Also in this file"} · Qty {d.like.quantity}
                              {d.like.storageLocation ? ` · ${d.like.storageLocation}` : ""}
                            </div>
                          </td>
                          <td className="px-2 py-1.5">
                            {same ? (
                              <span className="text-sky-200">
                                Same part: {d.kind === "ours" ? (mode === "addOnly" ? "leave ours as it is" : "update ours") : "count them together"}
                              </span>
                            ) : (
                              <span className="text-emerald-200">Add as a new part</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <div className={`flex flex-wrap gap-2 ${plan.branches.length === 0 ? "hidden" : ""}`}>
                <span className="rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-1 text-emerald-200">{count("add", plan.changes).toLocaleString()} new</span>
                {mode !== "addOnly" ? (
                  <span className="rounded-full border border-sky-400/30 bg-sky-500/15 px-2.5 py-1 text-sky-200">{count("update", plan.changes).toLocaleString()} updated</span>
                ) : null}
                {mode === "clear" ? (
                  <span className="rounded-full border border-rose-400/30 bg-rose-500/15 px-2.5 py-1 text-rose-200">{count("remove", plan.changes).toLocaleString()} removed</span>
                ) : null}
                {mode === "addOnly" ? (
                  <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-slate-300">{plan.kept.toLocaleString()} we have (left as is)</span>
                ) : (
                  <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-slate-300">{plan.unchanged.toLocaleString()} already match</span>
                )}
              </div>

              {plan.branches.length > 0 ? (
                dups.length > 0 ? (
                  <p className="text-slate-400">
                    Possible duplicates: {sameCount} treated as the same part{dups.length - sameCount > 0 ? `, ${dups.length - sameCount} added as new` : ""}.{" "}
                    <button type="button" onClick={() => setStep("duplicates")} className="text-amber-300 underline-offset-2 hover:underline">
                      Check them
                    </button>
                  </p>
                ) : (
                  <p className="text-slate-500">No possible duplicates: nothing in the file looks like a part already there under another spelling.</p>
                )
              ) : null}

              {skipped.length > 0 ? (
                <p className="text-slate-400">
                  Not counted (off the shelf): {skipped.map(([why, n]) => `${n} ${why}`).join(", ")}.{" "}
                  {mode === "clear"
                    ? "A part that's only listed this way is removed."
                    : mode === "addOnly"
                      ? "A part that's only listed this way isn't added."
                      : "A part the app has that's only listed this way goes to 0; one it doesn't have isn't added."}
                </p>
              ) : null}
              {notParts > 0 ? <p className="text-slate-500">{plural(notParts, "cell")} in the Part # column weren't part numbers and were skipped.</p> : null}
              {parsed.ignored.length > 0 ? <p className="text-slate-500">Passed over (no branch or no Truck Stock / Part # column): {parsed.ignored.join(", ")}</p> : null}
              {plan.missing > 0 && mode !== "clear" ? (
                <p className="text-slate-400">
                  {plural(plan.missing, "part")} at {branchLabel} {plan.missing === 1 ? "isn't" : "aren't"} in this file and stay as {plan.missing === 1 ? "it is" : "they are"}. Pick Clear
                  first to remove them.
                </p>
              ) : null}

              {plan.changes.length === 0 ? (
                <div className="rounded border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-400">
                  {waitingForBranch
                    ? "Pick the branch to see what would change."
                    : mode === "addOnly"
                      ? "Nothing to add: Truck Stock already has every part in this file."
                      : "Nothing to change: Truck Stock already matches this file."}
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
                              <input type="checkbox" checked={on} onChange={() => toggleIn(setExcluded, changeKey(c))} aria-label={`Include ${c.after.partNo}`} />
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
                      …and {plural(plan.changes.length - SHOWN_ROWS, "more change")} not shown (included).
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}

          {error ? <div className="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-rose-200">{error}</div> : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-5 py-3">
          {!showDuplicates && dups.length > 0 ? (
            <button
              type="button"
              onClick={() => setStep("duplicates")}
              disabled={busy}
              className="mr-auto inline-flex items-center gap-1 rounded border border-white/15 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-40"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Duplicates
            </button>
          ) : null}
          <button type="button" onClick={onClose} disabled={busy} className="rounded border border-white/15 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-40">
            Cancel
          </button>
          {showDuplicates ? (
            <button
              type="button"
              onClick={() => setStep("changes")}
              className="inline-flex items-center gap-1 rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
            >
              Next: review changes <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleImport}
              disabled={busy || selected.length === 0 || waitingForBranch}
              className={`inline-flex items-center gap-1 rounded px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 ${mode === "clear" ? "bg-rose-600 hover:bg-rose-500" : "bg-amber-600 hover:bg-amber-500"}`}
            >
              <Upload className="h-3.5 w-3.5" />
              {busy
                ? progress && progress.total > 0
                  ? `Saving… ${progress.done}/${progress.total}`
                  : "Saving…"
                : `${mode === "clear" ? "Clear and import" : "Import"} ${plural(selected.length, "change")}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
