import { useEffect, useState } from "react";
import { Download, Eye, FileText, Loader2 } from "lucide-react";
import { getEmployeeFileUrl, getMyEmployeeFiles, type EmployeeFileRow } from "@/lib/supabase/employeeFiles";

/**
 * Employee Self-Service → My Files: the paystubs Accounting published to
 * this employee from Accounting → Paystubs (migration 0418), newest pay
 * date first. RLS only ever returns the caller's own published files, and
 * each one opens through a short-lived signed link.
 */
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

export function MyFilesTab({ profileId }: { profileId: string | null }) {
  const [files, setFiles] = useState<EmployeeFileRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    if (!profileId) return;
    getMyEmployeeFiles(profileId)
      .then(setFiles)
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Couldn't load your files.");
        setFiles([]);
      });
  }, [profileId]);

  const open = async (f: EmployeeFileRow, download: boolean) => {
    setOpening(f.id);
    setError(null);
    try {
      const name = `${f.title}${f.payDate ? ` ${f.payDate}` : ""}.pdf`;
      const url = await getEmployeeFileUrl(f.storagePath, download ? name : undefined);
      if (download) window.location.href = url;
      else window.open(url, "_blank", "noopener");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open the file.");
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-white mb-1">My Files</h3>
      <p className="text-xs text-slate-500 mb-3">Paystubs and other documents Accounting has sent you.</p>
      {error && <p className="mb-2 text-xs text-red-300">{error}</p>}
      {files === null ? (
        <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-slate-400">No files yet. Your paystubs will show here once Accounting sends them.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <FileText className="h-5 w-5 shrink-0 text-sky-300" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">
                  {f.title}
                  {f.payDate && <span className="text-slate-400"> · Pay date {fmtDate(f.payDate)}</span>}
                  {f.replacesId && (
                    <span className="ml-2 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300" title="Accounting sent a corrected copy — this one replaces the earlier stub">
                      Corrected{f.publishedAt ? ` · ${new Date(f.publishedAt).toLocaleDateString()}` : ""}
                    </span>
                  )}
                </p>
                {f.periodStart && (
                  <p className="text-xs text-slate-500">Pay period {fmtDate(f.periodStart)} – {fmtDate(f.periodEnd)}</p>
                )}
              </div>
              <button type="button" onClick={() => void open(f, false)} disabled={opening === f.id} className="inline-flex items-center gap-1 rounded bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-600 disabled:opacity-50">
                {opening === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} View
              </button>
              <button type="button" onClick={() => void open(f, true)} disabled={opening === f.id} className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                <Download className="h-3.5 w-3.5" /> Download
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
