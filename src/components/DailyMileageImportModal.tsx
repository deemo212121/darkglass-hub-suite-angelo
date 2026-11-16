/**
 * Daily Mileage → Import. Pick a spreadsheet (.xlsx / .xls / .csv) laid out
 * any of the usual ways (lib/dailyMileageImport.ts): one row per technician
 * with the days across, one row per day with the technicians across, or a
 * plain list. Shows how it was read, matches each name to a technician (a
 * name it can't place is picked here, or skipped), then saves the days —
 * replacing or keeping days that already have miles.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, X } from "lucide-react";
import { matchTechnician, parseMileageSheet, type MileageSheetParse } from "@/lib/dailyMileageImport";
import { getTechDailyMileage, saveTechDailyMileage, type MileageCellChange } from "@/lib/supabase/techDailyMileage";

export interface ImportTechnician {
  id: string;
  name: string;
  branch: string;
  active: boolean;
}

const SKIP = "__skip__";
const LAYOUT_TEXT: Record<MileageSheetParse["layout"], string> = {
  "by-technician": "One row per technician, days across the top",
  "by-day": "One row per day, technicians across the top",
  list: "A list of technician, date and miles",
};
const fmtMiles = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
const fmtDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function DailyMileageImportModal({
  technicians,
  monthHint,
  onClose,
  onSaved,
}: {
  /** Everyone a name can be matched to — active technicians first. */
  technicians: ImportTechnician[];
  /** "2026-11" — the year for dates written without one, and the month for bare day numbers. */
  monthHint: string;
  onClose: () => void;
  onSaved: (saved: number) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<{ name: string; parse: MileageSheetParse | null }[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  /** Sheet name → technician id, or SKIP. Missing = the automatic match. */
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [keepExisting, setKeepExisting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const read = async (f: File) => {
    setFile(f);
    setSheets([]);
    setPicked({});
    setReadError(null);
    setReading(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
      const list = wb.SheetNames.map((name) => ({
        name,
        parse: parseMileageSheet(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: "", raw: true }), monthHint),
      }));
      const readable = list.filter((s) => s.parse);
      if (!readable.length) throw new Error("Couldn't find miles by day in this file. It needs technician names and dates, either across the top or in their own columns.");
      setSheets(list);
      // The sheet with the most entries is the likely one.
      setSheetName(readable.slice().sort((a, b) => b.parse!.entries.length - a.parse!.entries.length)[0].name);
    } catch (e) {
      setReadError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  };

  const parse = sheets.find((s) => s.name === sheetName)?.parse ?? null;
  const activeFirst = useMemo(() => [...technicians].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)), [technicians]);

  // One row per name in the file: its days, miles and who it is.
  const names = useMemo(() => {
    if (!parse) return [];
    const map = new Map<string, { name: string; days: number; miles: number }>();
    for (const e of parse.entries) {
      const n = map.get(e.name) ?? { name: e.name, days: 0, miles: 0 };
      n.days++;
      n.miles += e.miles;
      map.set(e.name, n);
    }
    const active = technicians.filter((t) => t.active);
    return [...map.values()]
      .map((n) => ({ ...n, auto: matchTechnician(n.name, active) ?? matchTechnician(n.name, technicians) }))
      .sort((a, b) => Number(!!a.auto) - Number(!!b.auto) || a.name.localeCompare(b.name));
  }, [parse, technicians]);

  const whoFor = (sheetName: string, autoId: string | null) => picked[sheetName] ?? autoId ?? "";
  const unresolved = names.filter((n) => !whoFor(n.name, n.auto?.id ?? null));
  const included = parse ? parse.entries.filter((e) => { const who = whoFor(e.name, names.find((n) => n.name === e.name)?.auto?.id ?? null); return who && who !== SKIP; }) : [];
  const dates = parse ? parse.entries.map((e) => e.date).sort() : [];
  const totalMiles = parse ? parse.entries.reduce((s, e) => s + e.miles, 0) : 0;

  // Two names in the file pointing at the same technician on the same day would overwrite each other.
  const clash = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of included) {
      const who = whoFor(e.name, names.find((n) => n.name === e.name)?.auto?.id ?? null);
      const k = `${who}|${e.date}`;
      const other = seen.get(k);
      if (other && other !== e.name) return `"${other}" and "${e.name}" are both set to the same technician.`;
      seen.set(k, e.name);
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [included, picked, names]);

  const problem =
    !parse ? null
    : unresolved.length ? `Pick a technician (or Skip) for ${unresolved.length} name${unresolved.length === 1 ? "" : "s"} first.`
    : clash ? clash
    : included.length === 0 ? "Nothing to import — every name is skipped."
    : null;

  const save = async () => {
    if (!parse || problem || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const from = dates[0], to = dates[dates.length - 1];
      const existing = await getTechDailyMileage(from, to);
      const have = new Map(existing.map((r) => [`${r.profileId}|${r.workDate}`, r]));
      const changes: MileageCellChange[] = [];
      for (const e of included) {
        const profileId = whoFor(e.name, names.find((n) => n.name === e.name)?.auto?.id ?? null);
        const row = have.get(`${profileId}|${e.date}`);
        if (row && (keepExisting || row.miles === e.miles)) continue;
        changes.push({ profileId, workDate: e.date, miles: e.miles, existingId: row?.id ?? null });
      }
      await saveTechDailyMileage(changes);
      onSaved(changes.length);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => !saving && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="mileage-import-title" className="flex max-h-[94vh] w-full max-w-4xl flex-col rounded-lg border border-white/10 bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-white/10 px-6 py-4">
          <div>
            <h3 id="mileage-import-title" className="text-lg font-bold text-white">Import miles</h3>
            <p className="text-xs text-slate-400">A spreadsheet with technician names and dates — days across the top, technicians across the top, or a list with a date and miles column.</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="p-1 text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-white/20 bg-white/[0.02] px-4 py-3 hover:border-blue-500/60">
            <FileSpreadsheet className="h-6 w-6 shrink-0 text-emerald-300" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-white">{file ? file.name : "Choose the mileage sheet"}</span>
              <span className="block text-xs text-slate-500">.xlsx, .xls or .csv</span>
            </span>
            <span className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white">{file ? "Change file" : "Choose file"}</span>
            <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" disabled={saving} onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ""; }} />
          </label>

          {reading && <p className="flex items-center gap-2 text-sm text-slate-300"><Loader2 className="h-4 w-4 animate-spin" /> Reading the file…</p>}
          {readError && <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{readError}</p>}

          {sheets.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs uppercase text-slate-400">Sheet</span>
              <select value={sheetName} onChange={(e) => { setSheetName(e.target.value); setPicked({}); }} className="rounded-md border border-white/10 bg-slate-800 px-2 py-1 text-sm text-white">
                {sheets.map((s) => <option key={s.name} value={s.name} disabled={!s.parse}>{s.name}{s.parse ? ` · ${s.parse.entries.length} days` : " · nothing to read"}</option>)}
              </select>
            </div>
          )}

          {parse && (
            <>
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  ["Read as", LAYOUT_TEXT[parse.layout]],
                  ["Dates", `${fmtDay(dates[0])} – ${fmtDay(dates[dates.length - 1])}`],
                  ["Days", `${parse.entries.length.toLocaleString()} for ${names.length} name${names.length === 1 ? "" : "s"}`],
                  ["Miles", fmtMiles(totalMiles)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-white/10 bg-slate-800/40 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{k}</p>
                    <p className="text-sm font-semibold text-white">{v}</p>
                  </div>
                ))}
              </div>
              {parse.skipped > 0 && <p className="text-xs text-amber-300">{parse.skipped} cell{parse.skipped === 1 ? "" : "s"} skipped — not a number of miles, or a row without a name or date.</p>}

              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Name in the file</th>
                      <th className="px-3 py-2 text-right font-semibold">Days</th>
                      <th className="px-3 py-2 text-right font-semibold">Miles</th>
                      <th className="px-3 py-2 font-semibold">Technician</th>
                    </tr>
                  </thead>
                  <tbody>
                    {names.map((n) => {
                      const who = whoFor(n.name, n.auto?.id ?? null);
                      return (
                        <tr key={n.name} className={`border-t border-white/5 ${who ? "" : "bg-red-500/[0.06]"}`}>
                          <td className="px-3 py-2 text-white">{n.name}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-300">{n.days}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-200">{fmtMiles(n.miles)}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                value={who}
                                onChange={(e) => setPicked((p) => ({ ...p, [n.name]: e.target.value }))}
                                aria-label={`Technician for ${n.name}`}
                                className="max-w-[240px] rounded-md border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white"
                              >
                                <option value="">Pick a technician…</option>
                                <option value={SKIP}>Skip — don't import</option>
                                {activeFirst.map((t) => <option key={t.id} value={t.id}>{t.name}{t.branch ? ` · ${t.branch}` : ""}{t.active ? "" : " (inactive)"}</option>)}
                              </select>
                              {who === SKIP ? <span className="text-[11px] text-slate-400">Skipped</span>
                                : who && who === n.auto?.id && !(n.name in picked) ? <span className="inline-flex items-center gap-1 text-[11px] text-green-300"><CheckCircle2 className="h-3 w-3" /> Matched</span>
                                : who ? <span className="text-[11px] text-blue-300">Picked here</span>
                                : <span className="inline-flex items-center gap-1 text-[11px] text-red-300"><AlertTriangle className="h-3 w-3" /> No match</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="space-y-1 text-xs text-slate-300">
                <span className="block uppercase text-slate-400">Days that already have miles</span>
                <label className="mr-4 inline-flex items-center gap-1.5"><input type="radio" checked={!keepExisting} onChange={() => setKeepExisting(false)} /> Replace with the file's miles</label>
                <label className="inline-flex items-center gap-1.5"><input type="radio" checked={keepExisting} onChange={() => setKeepExisting(true)} /> Keep what's there</label>
              </div>
            </>
          )}

          {(saveError || problem) && <p className={`text-xs ${saveError ? "text-red-300" : "text-slate-400"}`}>{saveError ?? problem}</p>}
        </div>

        <div className="flex gap-3 border-t border-white/10 px-6 py-4">
          <button
            type="button"
            onClick={save}
            disabled={!parse || !!problem || saving}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : parse ? `Import ${included.length.toLocaleString()} day${included.length === 1 ? "" : "s"}` : "Import"}
          </button>
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-600">Cancel</button>
        </div>
      </div>
    </div>
  );
}
