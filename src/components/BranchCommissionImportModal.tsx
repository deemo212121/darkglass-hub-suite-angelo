/**
 * Accounting → Branch Commission → Import: Finance's weekly commission sheet
 * (src/lib/branchCommissionImport.ts reads it). Shows every line as Ready /
 * Check / Won't import / Skipped first; saves only when Import is clicked:
 * each matched tech's Completion % and LTP % for that week, and the
 * branch's tickets, Flash tech, Damages, Total damage, note and Paid.
 * Monitoring only — nothing goes to payroll.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FileSpreadsheet, Loader2, Upload, CheckCircle2, X, Undo2 } from "lucide-react";
import { readWorkbook, planImport, type ImportContext, type ImportLine, type ImportLineState } from "@/lib/branchCommissionImport";
import { upsertTechCommissionTally } from "@/lib/supabase/branchCommissionTech";
import { upsertBranchPeriod, getBranchPeriodsInRange } from "@/lib/supabase/branchCommissionBranchPeriod";
import { upsertCommissionPeriodLabel, type CommissionPeriod } from "@/lib/supabase/branchManagerCommissionPeriods";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { ImportRecorder, saveImportRecord, getImportRecords, revertImport, type BranchCommissionImport } from "@/lib/supabase/branchCommissionImports";

const STATE_STYLE: Record<ImportLineState, { label: string; cls: string }> = {
  ready: { label: "Ready", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  warning: { label: "Check", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  error: { label: "Won't import", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
  skipped: { label: "Skipped", cls: "bg-white/5 text-slate-400 border-white/10" },
};
const importable = (s: ImportLineState) => s === "ready" || s === "warning";
const shortDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return y ? `${Number(m)}/${Number(d)}` : iso;
};
const money = (n: number | null) => (n === null ? "—" : `$${n.toFixed(2)}`);
const yesNo = (v: boolean | null) => (v === null ? "—" : v ? "Yes" : "No");

export function BranchCommissionImportModal(props: {
  onClose: () => void;
  /** Built fresh when a file is picked, so it reflects the tab right now (minus paidKeys, fetched here). */
  context: () => Omit<ImportContext, "paidKeys">;
  periods: CommissionPeriod[];
  importerName: string;
  /** Set when saving can't work yet (a migration not run) — the preview still shows. */
  saveBlocked?: string | null;
  /** Called after an import, so the tab reloads. */
  onImported: (firstWeek: { start: string; end: string } | null) => void;
}) {
  const { onClose, context, periods, importerName, onImported, saveBlocked } = props;
  const [lines, setLines] = useState<ImportLine[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ lines: number; techs: number; failed: string[] } | null>(null);
  const [filter, setFilter] = useState<ImportLineState | "all">("all");
  // Past imports, each with Revert (puts back exactly what that import wrote over).
  const [records, setRecords] = useState<BranchCommissionImport[]>([]);
  const [lastImportId, setLastImportId] = useState<string | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);
  const loadRecords = () => {
    getImportRecords()
      .then(setRecords)
      .catch(() => setRecords([]));
  };
  useEffect(loadRecords, []);

  const doRevert = async (rec: BranchCommissionImport) => {
    if (
      !confirm(
        `Revert the import of ${rec.fileName || "this sheet"} (${new Date(rec.importedAt).toLocaleString()})?\n\n` +
          `Every technician and branch row it wrote goes back to what it was before — rows it created are removed, ` +
          `including any Paid it set. Changes made to those rows after the import are lost too.`
      )
    )
      return;
    setReverting(rec.id);
    setError(null);
    try {
      const failed = await revertImport(rec, importerName);
      void logActivity({
        action: "branch_commission_import_reverted",
        targetType: "branch_commission_imports",
        targetId: rec.id,
        targetLabel: `Branch Commission import — ${rec.fileName}`,
        details: { technicians: rec.snapshot.techs.length, branches: rec.snapshot.branches.length, failed: failed.length },
      });
      if (failed.length > 0) setError(`Reverted, but ${failed.length} row(s) couldn't be put back: ${failed.slice(0, 5).join("; ")}`);
      if (rec.id === lastImportId) setResult(null);
      loadRecords();
      onImported(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReverting(null);
    }
  };

  const pickFile = async (file: File) => {
    setReading(true);
    setError(null);
    setResult(null);
    setFileName(file.name);
    try {
      const sheets = readWorkbook(await file.arrayBuffer());
      const ctx = context();
      // Which branch-weeks are already Paid in the app (those lines won't import).
      const firstPass = planImport(sheets, { ...ctx, paidKeys: new Set() });
      const dates = firstPass.filter((l) => l.periodStart && l.periodEnd);
      let paidKeys = new Set<string>();
      if (dates.length > 0) {
        const start = dates.reduce((m, l) => (l.periodStart < m ? l.periodStart : m), dates[0].periodStart);
        const end = dates.reduce((m, l) => (l.periodEnd > m ? l.periodEnd : m), dates[0].periodEnd);
        const existing = await getBranchPeriodsInRange(start, end).catch(() => []);
        paidKeys = new Set(existing.filter((r) => r.paidAt).map((r) => `${r.branchKey}|${r.periodStart}|${r.periodEnd}`));
      }
      const planned = planImport(sheets, { ...ctx, paidKeys });
      if (planned.length === 0) setError("No Branch Commission table found — the sheet needs headers like Week Start, Week End and Commission Branch.");
      setLines(planned);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLines(null);
    } finally {
      setReading(false);
    }
  };

  const toImport = (lines ?? []).filter((l) => importable(l.state));
  const counts = (lines ?? []).reduce((acc, l) => ({ ...acc, [l.state]: (acc[l.state] ?? 0) + 1 }), {} as Partial<Record<ImportLineState, number>>);

  const runImport = async () => {
    if (toImport.length === 0) return;
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    let techs = 0;
    let linesDone = 0;
    const total = toImport.reduce((n, l) => n + l.techs.length + 1, 0);
    let done = 0;
    setProgress({ done, total });
    const savedPeriods = new Set(periods.map((p) => `${p.periodStart}|${p.periodEnd}`));
    const now = new Date().toISOString();
    const recorder = new ImportRecorder();
    for (const l of toImport) {
      const where = `${l.branchLabel} ${l.week || shortDate(l.periodStart)} (row ${l.row})`;
      try {
        const pk = `${l.periodStart}|${l.periodEnd}`;
        if (!savedPeriods.has(pk)) {
          await upsertCommissionPeriodLabel(l.periodStart, l.periodEnd, `${l.week ? `${l.week} · ` : ""}${shortDate(l.periodStart)}–${shortDate(l.periodEnd)}`);
          recorder.periodCreated(l.periodStart, l.periodEnd);
          savedPeriods.add(pk);
        }
        for (const t of l.techs) {
          await recorder.tech(t.profileId, l.periodStart, l.periodEnd);
          await upsertTechCommissionTally(t.profileId, l.periodStart, l.periodEnd, {
            completionPct: t.completionPct,
            ltpPct: l.ltpPct ?? 0,
            isTrainee: false,
          });
          techs++;
          setProgress({ done: ++done, total });
        }
        await recorder.branch(l.branchLabel, l.periodStart, l.periodEnd);
        await upsertBranchPeriod(l.branchLabel, l.periodStart, l.periodEnd, {
          flashTech: l.flashTech,
          damages: l.damages,
          damageCount: l.damageCount,
          ticketsOverride: l.tickets,
          note: l.note,
          ...(l.paid ? { paidAt: now, paidBy: null, paidByName: `Imported by ${importerName || "someone"}` } : {}),
        });
        linesDone++;
        setProgress({ done: ++done, total });
      } catch (err) {
        failed.push(`${where}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    try {
      const id = await saveImportRecord(fileName, importerName, linesDone, recorder.snapshot);
      setLastImportId(id);
    } catch (err) {
      failed.push(`Saving the undo record failed (${err instanceof Error ? err.message : String(err)}) — this import can't be reverted from here.`);
    }
    loadRecords();
    void logActivity({
      action: "branch_commission_imported",
      targetType: "branch_commission_branch_period",
      targetId: fileName || "import",
      targetLabel: `Branch Commission import — ${fileName}`,
      details: { lines: linesDone, technicians: techs, failed: failed.length },
    });
    setResult({ lines: linesDone, techs, failed });
    setBusy(false);
    const first = [...toImport].sort((a, b) => a.periodStart.localeCompare(b.periodStart))[0];
    onImported(first ? { start: first.periodStart, end: first.periodEnd } : null);
  };

  const shown = (lines ?? []).filter((l) => filter === "all" || l.state === filter);

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-slate-900 border border-white/10 rounded-xl w-full max-w-7xl max-h-[90vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-white/10">
          <FileSpreadsheet className="h-5 w-5 text-green-400" />
          <h2 className="text-base font-bold text-white">Import Branch Commission sheet</h2>
          <button type="button" onClick={onClose} disabled={busy} className="ml-auto text-slate-400 hover:text-white disabled:opacity-40">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-white/10 flex items-center gap-3 flex-wrap">
          <label className={`btn text-xs px-3 py-1.5 inline-flex items-center gap-1.5 cursor-pointer ${busy ? "opacity-40 pointer-events-none" : ""}`}>
            <Upload className="h-3.5 w-3.5" /> {fileName ? "Pick another file" : "Pick the sheet (.xlsx / .csv)"}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void pickFile(f);
              }}
            />
          </label>
          {fileName && <span className="text-xs text-slate-400 truncate max-w-xs">{fileName}</span>}
          {reading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          {lines && (
            <div className="flex items-center gap-1.5 flex-wrap ml-auto">
              {(["all", "ready", "warning", "error", "skipped"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFilter(s)}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${filter === s ? "ring-1 ring-white/40" : ""} ${s === "all" ? "border-white/15 text-slate-300" : STATE_STYLE[s].cls}`}
                >
                  {s === "all" ? `All ${lines.length}` : `${STATE_STYLE[s].label} ${counts[s] ?? 0}`}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 pt-3 text-[11px] text-muted-foreground">
          Imports each listed technician's Completion % and the line's LTP % for that week, and the branch's Tickets (from Original
          Calculation), Flash tech, Damages, Total damage, Review status (as a note) and Status ✔ (as Paid). The BM isn't changed —
          a different BM is only flagged. Monitoring only; nothing goes to payroll.
        </div>
        {saveBlocked && <p className="mx-5 mt-3 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">{saveBlocked}</p>}
        {error && <p className="mx-5 mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">{error}</p>}
        {result && (
          <div className="mx-5 mt-3 text-xs text-emerald-200 bg-emerald-500/10 border border-emerald-500/30 rounded-md px-3 py-2">
            <div className="flex items-center gap-1.5 font-semibold">
              <CheckCircle2 className="h-4 w-4" /> Imported {result.lines} line{result.lines === 1 ? "" : "s"} · {result.techs} technician entries.
              {lastImportId && records.find((r) => r.id === lastImportId && !r.revertedAt) && (
                <button
                  type="button"
                  onClick={() => void doRevert(records.find((r) => r.id === lastImportId)!)}
                  disabled={reverting !== null}
                  className="btn text-[11px] py-0.5 px-2.5 ml-auto inline-flex items-center gap-1 disabled:opacity-40"
                >
                  {reverting === lastImportId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />} Undo this import
                </button>
              )}
            </div>
            {result.failed.length > 0 && (
              <ul className="mt-1 text-red-300 list-disc pl-5">{result.failed.map((f) => <li key={f}>{f}</li>)}</ul>
            )}
          </div>
        )}

        <div className="flex-1 overflow-auto px-5 py-3">
          {!lines ? (
            <div>
              <p className="text-sm text-muted-foreground py-8 text-center">Pick the sheet to see what would be imported. Nothing is saved until you click Import.</p>
              {records.length > 0 && (
                <div className="rounded-lg border border-white/10">
                  <div className="px-3 py-2 border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Past imports</div>
                  <table className="w-full text-xs">
                    <tbody>
                      {records.map((r) => (
                        <tr key={r.id} className="border-b border-white/5 last:border-b-0">
                          <td className="px-3 py-2">{r.fileName || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{new Date(r.importedAt).toLocaleString()} · {r.importedByName || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.lines} line{r.lines === 1 ? "" : "s"}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {r.revertedAt ? (
                              <span className="text-slate-400" title={`Reverted by ${r.revertedByName || "—"} on ${new Date(r.revertedAt).toLocaleString()}`}>Reverted</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void doRevert(r)}
                                disabled={reverting !== null || busy}
                                className="btn text-[11px] py-0.5 px-2.5 inline-flex items-center gap-1 hover:!border-rose-400/60 hover:!bg-rose-500/15 disabled:opacity-40"
                              >
                                {reverting === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />} Revert
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-white/10">
                  <th className="py-2 pr-3">Row</th>
                  <th className="py-2 pr-3">State</th>
                  <th className="py-2 pr-3">Why / notes</th>
                  <th className="py-2 pr-3">Week</th>
                  <th className="py-2 pr-3">Branch</th>
                  <th className="py-2 pr-3">BM (sheet)</th>
                  <th className="py-2 pr-3">Technicians · Completion</th>
                  <th className="py-2 pr-3 text-right">LTP</th>
                  <th className="py-2 pr-3 text-right">Tickets</th>
                  <th className="py-2 pr-3 text-right">Sheet $</th>
                  <th className="py-2 pr-3 text-right">App $</th>
                  <th className="py-2 pr-3">Flash</th>
                  <th className="py-2 pr-3">Damages</th>
                  <th className="py-2 pr-3 text-right">Dmg #</th>
                  <th className="py-2 pr-3">Paid</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={`${l.sheet}:${l.row}`} className="border-b border-white/5 align-top">
                    <td className="py-1.5 pr-3 text-muted-foreground tabular-nums">{l.row}</td>
                    <td className="py-1.5 pr-3"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${STATE_STYLE[l.state].cls}`}>{STATE_STYLE[l.state].label}</span></td>
                    <td className={`py-1.5 pr-3 text-[11px] min-w-[18rem] max-w-[26rem] ${l.state === "error" ? "text-red-300" : "text-slate-300"}`}>{l.messages.map((m, i) => <div key={i}>{m}</div>)}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{l.week} <span className="text-muted-foreground">{l.periodStart ? `${shortDate(l.periodStart)}–${shortDate(l.periodEnd)}` : ""}</span></td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{l.branchLabel}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{l.bmName}</td>
                    <td className="py-1.5 pr-3">{l.techs.map((t) => <div key={t.profileId} className="whitespace-nowrap">{t.profileName} · {t.completionPct}%</div>)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{l.ltpPct === null ? "—" : `${l.ltpPct}%`}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{l.tickets ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(l.sheetAmount)}</td>
                    <td className={`py-1.5 pr-3 text-right tabular-nums ${l.appAmount !== null && l.sheetAmount !== null && Math.abs(l.appAmount - l.sheetAmount) > 0.009 ? "text-amber-300 font-semibold" : ""}`}>{money(l.appAmount)}</td>
                    <td className="py-1.5 pr-3">{yesNo(l.flashTech)}</td>
                    <td className="py-1.5 pr-3">{yesNo(l.damages)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{l.damageCount ?? "—"}</td>
                    <td className="py-1.5 pr-3">{l.paid ? "Paid" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 flex items-center gap-3">
          {busy && <span className="text-xs text-slate-400 inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving {progress.done} / {progress.total}…</span>}
          <button type="button" onClick={onClose} disabled={busy} className="btn text-xs px-3 py-1.5 ml-auto disabled:opacity-40">Close</button>
          <button
            type="button"
            onClick={() => void runImport()}
            disabled={busy || toImport.length === 0 || !!result || !!saveBlocked}
            className="btn text-xs px-3 py-1.5 !border-emerald-400/60 !bg-emerald-500/20 text-emerald-100 disabled:opacity-40"
          >
            Import {toImport.length} line{toImport.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
