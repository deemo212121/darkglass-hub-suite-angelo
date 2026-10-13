/**
 * "Import Bulk Tickets" button + popup (Create New Ticket header). Upload a
 * ServicePower ticket export (.csv / .xlsx / .xls), check what's in it,
 * import, then see how many were added vs skipped (and why) — see
 * src/lib/supabase/ticketBulkImport.ts for the mapping and skip rules.
 */
import { useRef, useState, type ReactNode } from "react";
import { CheckCircle2, FileSpreadsheet, Loader2, Upload, XCircle, SkipForward, RefreshCw, Minus } from "lucide-react";
import { AppModal } from "@/components/ui-kit/AppModal";
import { importTickets, looksLikeTicketExport, readImportFile, type ImportRow, type ImportSummary } from "@/lib/supabase/ticketBulkImport";

type Stage = "pick" | "ready" | "importing" | "done";

export function ImportBulkTicketsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" /> Import Bulk Tickets
      </button>
      {open && <ImportBulkTicketsModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ImportBulkTicketsModal({ onClose }: { onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [stage, setStage] = useState<Stage>("pick");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [updateTechnicians, setUpdateTechnicians] = useState(false);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setReading(true);
    try {
      const parsed = await readImportFile(file);
      if (!looksLikeTicketExport(parsed)) {
        setError("This file doesn't look like a ticket export — it needs the TicketNo, StatusDesc and CxUserName columns.");
        return;
      }
      setFileName(file.name);
      setRows(parsed);
      setStage("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that file.");
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const runImport = async () => {
    setStage("importing");
    setError(null);
    try {
      const result = await importTickets(rows, (done, total) => setProgress({ done, total }), { updateTechnicians });
      setSummary(result);
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
      setStage("ready");
    }
  };

  const reset = () => {
    setStage("pick");
    setRows([]);
    setFileName("");
    setSummary(null);
    setProgress({ done: 0, total: 0 });
    setError(null);
  };

  const busy = stage === "importing";
  const skippedCount = summary ? summary.skippedExisting.length + summary.skippedDuplicate.length + summary.skippedMissing.length : 0;

  return (
    <AppModal
      title="Import Bulk Tickets"
      description="Upload a ticket file (.csv, .xlsx or .xls). New ticket numbers are added; ones already in the system get their status and schedule updated."
      icon={<FileSpreadsheet className="h-5 w-5" />}
      size="lg"
      busy={busy}
      onClose={onClose}
      footer={
        stage === "done" ? (
          <>
            <button type="button" className="btn" onClick={reset}>
              Import another file
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void runImport()} disabled={stage !== "ready"}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {busy ? "Importing…" : `Import ${rows.length} row${rows.length === 1 ? "" : "s"}`}
            </button>
          </>
        )
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="hidden"
        onChange={(e) => void pickFile(e.target.files?.[0])}
      />

      {error && <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</div>}

      {(stage === "pick" || stage === "ready") && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void pickFile(e.dataTransfer.files?.[0]);
          }}
          disabled={reading}
          className="w-full rounded-xl border-2 border-dashed border-[var(--color-panel-border)] px-4 py-8 text-center hover:bg-[color-mix(in_oklab,var(--color-foreground)_4%,transparent)] transition-colors"
        >
          {reading ? (
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          ) : stage === "ready" ? (
            <>
              <FileSpreadsheet className="mx-auto h-7 w-7 text-emerald-500" />
              <p className="mt-2 text-sm font-semibold">{fileName}</p>
              <p className="text-xs text-muted-foreground">
                {rows.length} ticket row{rows.length === 1 ? "" : "s"} found · click to choose a different file
              </p>
            </>
          ) : (
            <>
              <Upload className="mx-auto h-7 w-7 text-muted-foreground" />
              <p className="mt-2 text-sm font-semibold">Click to choose a file, or drop it here</p>
              <p className="text-xs text-muted-foreground">CSV or Excel</p>
            </>
          )}
        </button>
      )}

      {stage === "ready" && (
        <label className="mt-3 flex items-start gap-2 text-sm cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={updateTechnicians} onChange={(e) => setUpdateTechnicians(e.target.checked)} />
          <span>
            Also update technician assignments
            <span className="block text-xs text-muted-foreground">
              Off: a ticket already assigned keeps its technician (only unassigned tickets get the file&apos;s). On: the file&apos;s technician replaces the current one.
            </span>
          </span>
        </label>
      )}

      {stage === "importing" && (
        <div className="py-6">
          <p className="mb-2 text-sm">
            Importing… <span className="font-semibold tabular-nums">{progress.done}</span> of{" "}
            <span className="tabular-nums">{progress.total}</span> tickets
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--color-foreground)_10%,transparent)]">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Keep this window open until it finishes.</p>
        </div>
      )}

      {stage === "done" && summary && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Stat icon={<CheckCircle2 className="h-4 w-4" />} label="Added" value={summary.added.length} tone="text-emerald-500" />
            <Stat icon={<RefreshCw className="h-4 w-4" />} label="Updated" value={summary.updated.length} tone="text-sky-500" />
            <Stat icon={<Minus className="h-4 w-4" />} label="Unchanged" value={summary.unchanged.length} tone="text-muted-foreground" />
            <Stat icon={<SkipForward className="h-4 w-4" />} label="Skipped" value={skippedCount} tone="text-amber-500" />
            <Stat icon={<XCircle className="h-4 w-4" />} label="Failed" value={summary.failed.length} tone={summary.failed.length ? "text-red-500" : "text-muted-foreground"} />
          </div>
          <p className="text-xs text-muted-foreground">
            {summary.totalRows} row{summary.totalRows === 1 ? "" : "s"} in {fileName}.
          </p>

          <div className="space-y-2 text-sm">
            <Detail title="Updated" items={summary.updated.map((u) => `${u.ticketNo} — ${u.changes.join("; ")}`)} />
            <Detail title="Already in the system, nothing new" items={summary.unchanged} />
            <Detail title="Already in the system (added by someone else during the import)" items={summary.skippedExisting} />
            <Detail title="Repeated in the file (only the first one was used)" items={summary.skippedDuplicate} />
            <Detail title="No ticket number (spreadsheet rows)" items={summary.skippedMissing.map((n) => `Row ${n}`)} />
            <Detail title="Failed" items={summary.failed.map((f) => `${f.ticketNo} — ${f.error}`)} danger />
            <Detail title="Added" items={summary.added} />
          </div>
        </div>
      )}
    </AppModal>
  );
}

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-panel-border)] px-3 py-2">
      <div className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${tone}`}>
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${value ? tone : "text-muted-foreground"}`}>{value}</div>
    </div>
  );
}

function Detail({ title, items, danger }: { title: string; items: string[]; danger?: boolean }) {
  if (items.length === 0) return null;
  return (
    <details className="rounded-lg border border-[var(--color-panel-border)] px-3 py-2">
      <summary className={`cursor-pointer select-none font-medium ${danger ? "text-red-500" : ""}`}>
        {title} <span className="text-muted-foreground">({items.length})</span>
      </summary>
      <ul className="mt-2 max-h-48 overflow-y-auto space-y-0.5 font-mono text-xs text-muted-foreground">
        {items.map((t, i) => (
          <li key={`${t}-${i}`}>{t}</li>
        ))}
      </ul>
    </details>
  );
}
