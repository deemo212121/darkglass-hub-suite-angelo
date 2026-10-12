/**
 * Admin → Reports Library: imported spreadsheet reports for leadership
 * (HR's Attendance & Leave reports, leave dashboards, ...), shown as
 * dashboards inside AHS — headline tiles, titled tables with in-row bars,
 * notes — plus the original file for download.
 *
 * Kept apart from live data on purpose: these are snapshots of someone's
 * spreadsheet, stored in their own tables (migration 0371), never read by
 * attendance/PTO/payroll and never written into them. Admin / SuperAdmin
 * only (the Admin module gate here, RLS in the database).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ChevronLeft, Download, FileSpreadsheet, Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import { useSmartBack } from "@/hooks/useSmartBack";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import {
  analyzeSheet,
  countSpreadsheetErrors,
  defaultReportTitle,
  parseNumber,
  readReportFile,
  SPREADSHEET_ERROR,
  type ReportBlock,
  type ReportSheet,
} from "@/lib/reportWorkbook";
import {
  createExecutiveReport,
  deleteExecutiveReport,
  getExecutiveReport,
  getExecutiveReportFile,
  listExecutiveReports,
  type ExecutiveReport,
  type ExecutiveReportSummary,
} from "@/lib/supabase/executiveReports";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPT = ".xlsx,.xls,.csv";
/** Single-series bar colour — validated (dataviz validate_palette) against both the dark and light panel surfaces. */
const BAR_COLOR = "#3b82f6";

interface PendingFile {
  file: File;
  title: string;
  period: string;
  source: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the file."));
    reader.readAsDataURL(file);
  });
}

function formatBytes(n: number | null): string {
  if (!n) return "";
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function ReportsLibraryPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));

  const [reports, setReports] = useState<ExecutiveReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setReports(await listExecutiveReports());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load reports.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  // ── Add Report ──
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const pickFiles = (files: FileList | null) => {
    if (!files) return;
    setUploadError(null);
    const next: PendingFile[] = [];
    for (const file of Array.from(files)) {
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { setUploadError(`${file.name}: only Excel (.xlsx, .xls) or CSV files.`); continue; }
      if (file.size > MAX_FILE_BYTES) { setUploadError(`${file.name} is over ${formatBytes(MAX_FILE_BYTES)}.`); continue; }
      next.push({ file, title: defaultReportTitle(file.name), period: "", source: "" });
    }
    setPending((prev) => [...prev, ...next]);
  };

  const handleUpload = async () => {
    if (pending.length === 0) return;
    setUploadError(null);
    try {
      for (const p of pending) {
        setUploading(p.file.name);
        const sheets = await readReportFile(p.file);
        if (sheets.length === 0) throw new Error(`${p.file.name} has no data.`);
        await createExecutiveReport({
          title: p.title.trim() || defaultReportTitle(p.file.name),
          period: p.period.trim(),
          source: p.source.trim(),
          notes: notes.trim(),
          fileName: p.file.name,
          fileType: p.file.type || (/\.csv$/i.test(p.file.name) ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
          fileSize: p.file.size,
          sheets,
          fileBase64: await fileToBase64(p.file),
        });
        setPending((prev) => prev.filter((x) => x !== p));
      }
      setNotes("");
      setAdding(false);
      await load();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
      await load();
    } finally {
      setUploading(null);
    }
  };

  // ── Viewer ──
  const [openReport, setOpenReport] = useState<ExecutiveReport | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);

  const open = async (id: string) => {
    setOpening(id);
    setError(null);
    try {
      const r = await getExecutiveReport(id);
      if (!r) throw new Error("That report no longer exists.");
      setOpenReport(r);
      setSheetIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open the report.");
    } finally {
      setOpening(null);
    }
  };

  const [downloading, setDownloading] = useState<string | null>(null);
  const download = async (r: ExecutiveReportSummary) => {
    setDownloading(r.id);
    try {
      const blob = await getExecutiveReportFile(r.id, r.fileType);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't download the file.");
    } finally {
      setDownloading(null);
    }
  };

  const remove = async (r: ExecutiveReportSummary) => {
    if (!window.confirm(`Delete "${r.title}" from the Reports Library? The uploaded file is removed too.`)) return;
    try {
      await deleteExecutiveReport(r.id);
      if (openReport?.id === r.id) setOpenReport(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete the report.");
    }
  };

  if (openReport) {
    return (
      <ReportViewer
        report={openReport}
        sheetIndex={sheetIndex}
        onSheet={setSheetIndex}
        onClose={() => setOpenReport(null)}
        onDownload={() => void download(openReport)}
        downloading={downloading === openReport.id}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <button type="button" onClick={goBack} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></button>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold">{sub.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Imported reports for leadership. Each one is a snapshot of an uploaded spreadsheet, kept separate from live AHS data. Admin and SuperAdmin only.
            </p>
          </div>
          {!adding && (
            <button type="button" onClick={() => setAdding(true)} className="btn text-sm px-3 py-1.5 flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shrink-0">
              <Plus className="h-4 w-4" /> Add Report
            </button>
          )}
        </div>

        {error && <p className="mt-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">{error}</p>}

        {adding && (
          <div className="panel mt-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="font-semibold text-sm">Add Report</h2>
              <button type="button" onClick={() => { setAdding(false); setPending([]); setUploadError(null); }} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-white/20 rounded-lg p-6 cursor-pointer hover:bg-white/5 text-sm text-muted-foreground">
              <Upload className="h-5 w-5" />
              <span>Choose Excel or CSV files (one report per file, up to {formatBytes(MAX_FILE_BYTES)} each)</span>
              <input type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => { pickFiles(e.target.files); e.target.value = ""; }} />
            </label>
            {pending.length > 0 && (
              <div className="mt-4 flex flex-col gap-3">
                {pending.map((p, idx) => (
                  <div key={`${p.file.name}-${idx}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] items-end border border-white/10 rounded-md p-3">
                    <div className="flex flex-col gap-1 min-w-0">
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Title</label>
                      <input value={p.title} onChange={(e) => setPending((prev) => prev.map((x) => (x === p ? { ...x, title: e.target.value } : x)))} className="glass-input text-sm py-1.5 px-2.5 rounded-md" />
                      <span className="text-[10px] text-muted-foreground truncate">{p.file.name} · {formatBytes(p.file.size)}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Period (optional)</label>
                      <input value={p.period} placeholder="e.g. September 2026" onChange={(e) => setPending((prev) => prev.map((x) => (x === p ? { ...x, period: e.target.value } : x)))} className="glass-input text-sm py-1.5 px-2.5 rounded-md" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Source (optional)</label>
                      <input value={p.source} placeholder="e.g. HR spreadsheet" onChange={(e) => setPending((prev) => prev.map((x) => (x === p ? { ...x, source: e.target.value } : x)))} className="glass-input text-sm py-1.5 px-2.5 rounded-md" />
                    </div>
                    <button type="button" onClick={() => setPending((prev) => prev.filter((x) => x !== p))} className="text-muted-foreground hover:text-red-400 justify-self-end pb-2" aria-label={`Remove ${p.file.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Notes (optional, shown with each report)</label>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="glass-input text-sm py-1.5 px-2.5 rounded-md" />
                </div>
              </div>
            )}
            {uploadError && <p className="mt-3 text-xs text-red-300">{uploadError}</p>}
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => void handleUpload()} disabled={pending.length === 0 || !!uploading} className="btn text-sm px-4 py-2 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                {uploading ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading {uploading}…</> : <><Upload className="h-4 w-4" /> Upload {pending.length || ""} report{pending.length === 1 ? "" : "s"}</>}
              </button>
            </div>
          </div>
        )}

        <div className="panel p-0 overflow-hidden mt-4">
          {loading ? (
            <div className="p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading reports…</div>
          ) : reports.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 opacity-60" />
              No reports yet. Click <b>Add Report</b> to upload an Excel or CSV file.
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {reports.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-white/5">
                  <FileSpreadsheet className="h-5 w-5 text-blue-300 shrink-0" />
                  <button type="button" onClick={() => void open(r.id)} className="flex-1 min-w-[12rem] text-left">
                    <p className="text-sm font-semibold hover:text-blue-300">{r.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {[r.period, r.source, `Uploaded ${new Date(r.createdAt).toLocaleDateString()}${r.uploadedByName ? ` by ${r.uploadedByName}` : ""}`].filter(Boolean).join(" · ")}
                    </p>
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button type="button" onClick={() => void open(r.id)} disabled={opening === r.id} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 disabled:opacity-50">
                      {opening === r.id && <Loader2 className="h-3 w-3 animate-spin" />} Open
                    </button>
                    <button type="button" onClick={() => void download(r)} disabled={downloading === r.id} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 disabled:opacity-50" title={`Download ${r.fileName}`}>
                      {downloading === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} File
                    </button>
                    <button type="button" onClick={() => void remove(r)} className="text-muted-foreground hover:text-red-400 p-1.5" aria-label={`Delete ${r.title}`}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}

export function ReportViewer({ report, sheetIndex, onSheet, onClose, onDownload, downloading }: {
  report: ExecutiveReport;
  sheetIndex: number;
  onSheet: (i: number) => void;
  onClose: () => void;
  onDownload: () => void;
  downloading: boolean;
}) {
  const sheet: ReportSheet | undefined = report.sheets[sheetIndex];
  // The sheet's own title row usually repeats the report's title — show it once.
  const blocks = useMemo(() => {
    const all = sheet ? analyzeSheet(sheet.rows) : [];
    const same = (a: string) => a.trim().toLowerCase();
    return all.filter((b, i) => !(i === 0 && b.kind === "title" && same(b.text) === same(report.title)));
  }, [sheet, report.title]);
  const errorCount = useMemo(() => countSpreadsheetErrors(report.sheets), [report.sheets]);
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-4 sm:px-6 py-8">
        <div className="flex flex-wrap items-start gap-3">
          <button type="button" onClick={onClose} className="btn hover:bg-white/15" aria-label="Back to Reports Library"><ChevronLeft className="h-4 w-4" /></button>
          <div className="flex-1 min-w-[14rem]">
            <h1 className="text-2xl font-bold">{report.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {[report.period, report.source, `Uploaded ${new Date(report.createdAt).toLocaleDateString()}${report.uploadedByName ? ` by ${report.uploadedByName}` : ""}`, report.fileName].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button type="button" onClick={onDownload} disabled={downloading} className="btn text-sm px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50 shrink-0">
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download original
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="text-[11px] font-semibold px-2 py-1 rounded bg-amber-500/15 text-amber-300">Imported snapshot — not live AHS data</span>
          {errorCount > 0 && (
            <span className="text-[11px] font-semibold px-2 py-1 rounded bg-red-500/15 text-red-300 flex items-center gap-1" title="Cells that held a spreadsheet formula error (#REF!, #N/A, …) in the uploaded file — shown as — below">
              <AlertTriangle className="h-3 w-3" /> {errorCount} spreadsheet error{errorCount === 1 ? "" : "s"} in the file
            </span>
          )}
        </div>
        {report.notes && <p className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap">{report.notes}</p>}

        {report.sheets.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-1 border-b border-white/10">
            {report.sheets.map((s, i) => (
              <button key={`${s.name}-${i}`} type="button" onClick={() => onSheet(i)} className={`px-3 py-2 text-sm -mb-px border-b-2 ${i === sheetIndex ? "border-blue-400 text-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {s.name}
              </button>
            ))}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-5">
          {blocks.map((b, i) => <Block key={i} block={b} />)}
        </div>
      </main>
    </div>
  );
}

function Cell({ value }: { value: string }) {
  if (SPREADSHEET_ERROR.test(value)) return <span className="text-amber-300" title={`Spreadsheet error in the uploaded file: ${value}`}>—</span>;
  return <>{value}</>;
}

function Block({ block }: { block: ReportBlock }) {
  if (block.kind === "title") return <h2 className="text-xl font-bold">{block.text}</h2>;
  if (block.kind === "heading") return <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground -mb-2">{block.text}</h3>;
  if (block.kind === "text") return <p className="text-sm text-muted-foreground leading-relaxed">{block.text}</p>;
  if (block.kind === "kpis") {
    return (
      <div className="grid gap-3 grid-cols-2 md:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
        {block.items.map((k, i) => (
          <div key={i} className="panel py-3 px-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{k.label}</p>
            <p className="text-2xl font-bold mt-1 tabular-nums"><Cell value={k.value || "—"} /></p>
            {k.caption && <p className="text-[11px] text-muted-foreground mt-0.5">{k.caption}</p>}
          </div>
        ))}
      </div>
    );
  }
  return <ReportTable block={block} />;
}

function ReportTable({ block }: { block: Extract<ReportBlock, { kind: "table" }> }) {
  const barMax = useMemo(() => {
    if (block.barColumn == null) return 0;
    return Math.max(0, ...block.rows.filter((_, r) => !block.totals[r]).map((row) => parseNumber(row[block.barColumn!] ?? "") ?? 0));
  }, [block]);
  return (
    <div className="panel p-0 overflow-hidden">
      {block.title && <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm">{block.title}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {block.header.map((h, k) => (
                <th key={k} className={`px-3 py-2 text-xs font-semibold text-muted-foreground whitespace-nowrap ${block.numeric[k] ? "text-right" : "text-left"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => {
              const total = block.totals[r];
              return (
                <tr key={r} className={`border-b border-white/5 ${total ? "font-semibold border-t border-white/20" : "hover:bg-white/5"}`}>
                  {block.header.map((_, k) => {
                    const value = row[k] ?? "";
                    const barred = k === block.barColumn && !total && barMax > 0;
                    const n = barred ? parseNumber(value) : null;
                    return (
                      <td key={k} className={`px-3 py-2 ${block.numeric[k] ? "text-right tabular-nums" : "text-left"} ${k === 0 ? "whitespace-nowrap" : ""}`}>
                        {barred ? (
                          <div className="flex items-center justify-end gap-2" title={`${row.find((c, i) => i !== k && c && parseNumber(c) == null) ?? ""}: ${value}`}>
                            <div className="w-24 sm:w-32 flex justify-start">
                              {n != null && n > 0 && <div className="h-2 rounded-r" style={{ width: `${(n / barMax) * 100}%`, backgroundColor: BAR_COLOR }} />}
                            </div>
                            <span className="min-w-[2.5rem]"><Cell value={value} /></span>
                          </div>
                        ) : (
                          <Cell value={value} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
