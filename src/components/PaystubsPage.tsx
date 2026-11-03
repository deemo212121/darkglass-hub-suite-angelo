import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, ChevronLeft, Eye, FileText, Loader2, Pencil, RefreshCw, Trash2, Undo2, Upload, X, XCircle } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useSmartBack } from "@/hooks/useSmartBack";
import { useAuth } from "@/lib/auth";
import { getCompanyUsers, getMyProfileAndCompanyIds, type ProfileRow } from "@/lib/supabase/users";
import { extractPdfPage, pdfPageCount, readPaystubFiles, type PaystubPage } from "@/lib/paystubPdf";
import { matchEmployeeName, type EmployeeMatchPerson, type EmployeeMatchStatus } from "@/lib/employeeFileMatch";
import {
  deleteEmployeeFile,
  getCompanyEmployeeFiles,
  getEmployeeFileUrl,
  publishEmployeeFile,
  replaceEmployeeFile,
  saveEmployeeFiles,
  updateEmployeeFileDetails,
  withdrawEmployeeFile,
  withdrawEmployeeFilesForPayDate,
  type EmployeeFileRow,
} from "@/lib/supabase/employeeFiles";
import { getPayrollReviewBreakdowns, reviewBreakdownTotal } from "@/lib/supabase/payrollReviewBreakdowns";
import { getTechTaxLinesForPeriod, taxLineAmount } from "@/lib/supabase/techTaxLines";

/**
 * Accounting → Paystubs (migration 0418). Upload a pay run's check stubs in
 * bulk — one PDF with a page per employee, or several PDFs — and each page
 * is split off, its payee name read (OCR) and matched to an account. Nothing
 * reaches anyone until it's confirmed here: green matches start ticked,
 * yellow ones (nickname, middle name, deactivated account, two possible
 * people) have to be ticked by hand, red ones need a person picked. Publish
 * sends the ticked rows to each employee's Self-Service → My Files and keeps
 * the rest as unassigned, to assign later from Uploaded files.
 */

type Tab = "upload" | "files";

interface ReviewRow extends PaystubPage {
  profileId: string | null;
  status: EmployeeMatchStatus;
  reason: string | null;
  /** Ticked = publish to profileId. */
  confirmed: boolean;
  /** The person was picked by hand (always counts as checked). */
  manual: boolean;
}

const STATUS_STYLE: Record<EmployeeMatchStatus, { label: string; cls: string }> = {
  matched: { label: "Matched", cls: "bg-emerald-500/15 text-emerald-300" },
  check: { label: "Please confirm", cls: "bg-amber-500/15 text-amber-300" },
  ambiguous: { label: "Pick one", cls: "bg-amber-500/15 text-amber-300" },
  none: { label: "No account found", cls: "bg-red-500/15 text-red-300" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function mostCommon(values: (string | null)[]): string {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

export function PaystubsPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { uid, displayName } = useAuth();
  const [tab, setTab] = useState<Tab>("upload");
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  // The company's real id (profiles.company_id). useAuth().companyId is the
  // legacy login code, which matches neither the storage folder nor
  // employee_files.company_id.
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [files, setFiles] = useState<EmployeeFileRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = async () => {
    try {
      setFiles(await getCompanyEmployeeFiles());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load the files.");
    }
  };

  useEffect(() => {
    if (!uid) return;
    void getMyProfileAndCompanyIds(uid).then((ids) => {
      setMyProfileId(ids?.profileId ?? null);
      setCompanyId(ids?.companyId ?? null);
    });
    void getCompanyUsers().then(setProfiles);
    void reload();
  }, [uid]);

  const people: EmployeeMatchPerson[] = useMemo(
    () => profiles.filter((p) => p.display_name).map((p) => ({ id: p.id, name: p.display_name!, isActive: p.is_active })),
    [profiles]
  );
  const nameOf = useMemo(() => new Map(profiles.map((p) => [p.id, p.display_name ?? p.email])), [profiles]);
  const unassignedCount = files.filter((f) => f.status === "unassigned").length;

  return (
    <main className="flex-1 bg-slate-950 py-6">
      <div className="max-w-[1600px] mx-auto px-6">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-white">
          <button onClick={goBack} className="btn">
            <ChevronLeft className="h-4 w-4" />
            {mod.label}
          </button>
          <div>
            <h1 className="text-2xl font-semibold leading-tight">{sub.title}</h1>
            <p className="text-sm text-muted-foreground">{sub.description}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4">
          <button type="button" onClick={() => setTab("upload")} className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${tab === "upload" ? "bg-primary/20 text-primary" : ""}`}>
            <Upload className="h-3.5 w-3.5" /> Upload
          </button>
          <button type="button" onClick={() => setTab("files")} className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${tab === "files" ? "bg-primary/20 text-primary" : ""}`}>
            <FileText className="h-3.5 w-3.5" /> Uploaded files
            {unassignedCount > 0 && <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] font-semibold text-amber-300">{unassignedCount} unassigned</span>}
          </button>
        </div>

        {loadError && <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{loadError}</p>}

        {/* Kept mounted (just hidden) so a review in progress survives a look at Uploaded files. */}
        <div hidden={tab !== "upload"}>
          <UploadTab
            people={people}
            nameOf={nameOf}
            existing={files}
            companyId={companyId}
            actorId={myProfileId}
            actorName={displayName}
            onSaved={async (done) => {
              await reload();
              if (done) setTab("files");
            }}
          />
        </div>
        {tab === "files" && <FilesTab files={files} people={people} nameOf={nameOf} companyId={companyId} actorId={myProfileId} actorName={displayName} onChanged={reload} />}
      </div>
    </main>
  );
}

function PersonSelect({ value, people, onChange, className }: { value: string | null; people: EmployeeMatchPerson[]; onChange: (id: string | null) => void; className?: string }) {
  const active = people.filter((p) => p.isActive).sort((a, b) => a.name.localeCompare(b.name));
  const inactive = people.filter((p) => !p.isActive).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={`rounded border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white ${className ?? ""}`}
      aria-label="Employee"
    >
      <option value="">— Pick employee —</option>
      <optgroup label="Active">
        {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </optgroup>
      <optgroup label="Deactivated">
        {inactive.map((p) => <option key={p.id} value={p.id}>{p.name} (deactivated)</option>)}
      </optgroup>
    </select>
  );
}

function UploadTab({
  people,
  nameOf,
  existing,
  companyId,
  actorId,
  actorName,
  onSaved,
}: {
  people: EmployeeMatchPerson[];
  nameOf: Map<string, string>;
  existing: EmployeeFileRow[];
  companyId: string | null;
  actorId: string | null;
  actorName: string | null;
  /** `done` = everything saved (go to Uploaded files); false = some pages failed and stay here to retry. */
  onSaved: (done: boolean) => Promise<void>;
}) {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [reading, setReading] = useState<{ done: number; total: number; status: string } | null>(null);
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("Paystub");
  const [payDate, setPayDate] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [filter, setFilter] = useState<"all" | "look" | "matched" | "none">("all");
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  // AHS net pay for the period above, per person — Reviewed Periods' Total
  // (the saved columns less the Tech Activity Report's tax lines), to check
  // against the net pay read off each stub.
  const [ahsNet, setAhsNet] = useState<{ key: string; byProfile: Map<string, number> } | null>(null);
  useEffect(() => {
    if (!periodStart || !periodEnd || periodStart > periodEnd) return;
    const key = `${periodStart}|${periodEnd}`;
    let cancelled = false;
    void Promise.all([getPayrollReviewBreakdowns(periodStart, periodEnd), getTechTaxLinesForPeriod(periodStart, periodEnd)])
      .then(([rowsForPeriod, taxes]) => {
        const byProfile = new Map<string, number>();
        for (const r of rowsForPeriod) {
          const gross = Math.round(reviewBreakdownTotal(r) * 100) / 100;
          const tax = (taxes.get(r.profileId) ?? []).reduce((s, l) => s + taxLineAmount(l, gross), 0);
          byProfile.set(r.profileId, Math.round((gross - tax) * 100) / 100);
        }
        if (!cancelled) setAhsNet({ key, byProfile });
      })
      .catch((err) => console.error("Failed to load AHS net pay:", err));
    return () => { cancelled = true; };
  }, [periodStart, periodEnd]);
  const ahsNetOf = (profileId: string | null): number | null | undefined =>
    ahsNet?.key !== `${periodStart}|${periodEnd}` ? undefined : profileId ? ahsNet.byProfile.get(profileId) ?? null : null;

  const read = async (list: FileList | null) => {
    const pdfs = [...(list ?? [])].filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (pdfs.length === 0) return;
    setError(null);
    setRows([]);
    setReading({ done: 0, total: 0, status: "Starting…" });
    try {
      const pages = await readPaystubFiles(pdfs, (done, total, status) => setReading({ done, total, status }));
      setRows(
        pages.map((p) => {
          const m = matchEmployeeName(p.name, people);
          return { ...p, profileId: m.profileId, status: m.status, reason: m.reason, confirmed: m.status === "matched", manual: false };
        })
      );
      setPayDate(mostCommon(pages.map((p) => p.payDate)));
      setPeriodStart(mostCommon(pages.map((p) => p.periodStart)));
      setPeriodEnd(mostCommon(pages.map((p) => p.periodEnd)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read the PDF.");
    } finally {
      setReading(null);
    }
  };

  // Leaving the page (reload, close, typing another address) would lose the
  // review — the browser asks first while there's anything unpublished.
  useEffect(() => {
    if (rows.length === 0 && !reading && !saving) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [rows.length, reading, saving]);

  const update = (key: string, patch: Partial<ReviewRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // Flags: the same person on two pages, or already holding a published
  // file for this pay date.
  const dupInBatch = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of rows) if (r.profileId) count.set(r.profileId, (count.get(r.profileId) ?? 0) + 1);
    return count;
  }, [rows]);
  const alreadyHas = useMemo(
    () => new Set(existing.filter((f) => f.status === "published" && f.payDate && f.payDate === payDate && f.profileId).map((f) => f.profileId!)),
    [existing, payDate]
  );
  const flagOf = (r: ReviewRow): string | null => {
    if (!r.profileId) return null;
    if ((dupInBatch.get(r.profileId) ?? 0) > 1) return "Same person on another page";
    if (alreadyHas.has(r.profileId)) return `Already has a paystub for ${fmtDate(payDate)}`;
    return null;
  };

  const counts = {
    matched: rows.filter((r) => r.status === "matched" && !r.manual).length,
    look: rows.filter((r) => (r.status === "check" || r.status === "ambiguous") && !r.manual).length,
    none: rows.filter((r) => !r.profileId).length,
  };
  const shown = rows.filter((r) =>
    filter === "all" ? true : filter === "matched" ? r.status === "matched" && !r.manual : filter === "look" ? (r.status === "check" || r.status === "ambiguous") && !r.manual : !r.profileId
  );
  const toPublish = rows.filter((r) => r.confirmed && r.profileId);
  const flagged = toPublish.filter((r) => flagOf(r)).length;
  const allShownTicked = shown.length > 0 && shown.filter((r) => r.profileId).every((r) => r.confirmed);

  const publish = async () => {
    if (!companyId) return setError("Your company isn't loaded yet — try again in a moment.");
    if (!payDate) return setError("Enter the pay date.");
    const keep = rows.length - toPublish.length;
    const lines = [
      `Publish ${toPublish.length} paystub${toPublish.length === 1 ? "" : "s"} to employees' My Files?`,
      keep > 0 ? `${keep} page${keep === 1 ? "" : "s"} not confirmed will be kept as unassigned.` : "",
      flagged > 0 ? `${flagged} confirmed row${flagged === 1 ? " is" : "s are"} flagged as a possible duplicate.` : "",
    ].filter(Boolean);
    if (!confirm(lines.join("\n\n"))) return;
    setError(null);
    setSaving({ done: 0, total: rows.length });
    try {
      const { failed } = await saveEmployeeFiles({
        companyId,
        actorId,
        actorName,
        files: rows.map((r) => ({
          profileId: r.profileId,
          title: title.trim() || "Paystub",
          payDate: payDate || null,
          periodStart: periodStart || null,
          periodEnd: periodEnd || null,
          sourceFileName: r.sourceFileName,
          sourcePage: r.pageCount > 1 ? r.page : null,
          nameOnFile: r.name || null,
          matchNote: r.manual ? "picked by hand" : [STATUS_STYLE[r.status].label, r.reason].filter(Boolean).join(" · "),
          publish: r.confirmed,
          bytes: r.bytes,
        })),
        onProgress: (done, total) => setSaving({ done, total }),
      });
      if (failed.length > 0) {
        setError(`${failed.length} page${failed.length === 1 ? "" : "s"} couldn't be saved: ${failed[0].error}. The rest were saved.`);
        const failedKeys = new Set(failed.map((f) => `${f.file.sourceFileName}#${f.file.sourcePage ?? 1}`));
        setRows((rs) => rs.filter((r) => failedKeys.has(`${r.sourceFileName}#${r.pageCount > 1 ? r.page : 1}`)));
        await onSaved(false);
        return;
      }
      setRows([]);
      await onSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(null);
    }
  };

  const preview = rows.find((r) => r.key === previewKey) ?? null;

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-slate-800/30 p-6">
        {reading ? (
          <div className="space-y-3 text-sm text-slate-300">
            <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> {reading.status}</div>
            {reading.total > 0 && (
              <>
                <div className="h-2 overflow-hidden rounded bg-slate-700">
                  <div className="h-full bg-blue-500 transition-all" style={{ width: `${(reading.done / reading.total) * 100}%` }} />
                </div>
                <p className="text-xs text-slate-500">{reading.done} of {reading.total} pages read</p>
              </>
            )}
          </div>
        ) : (
          <label
            className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-white/15 px-6 py-12 text-center hover:border-blue-400/50"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void read(e.dataTransfer.files);
            }}
          >
            <Upload className="h-8 w-8 text-slate-400" />
            <span className="text-sm font-semibold text-white">Drop the paystub PDF here, or click to choose</span>
            <span className="max-w-xl text-xs text-slate-400">
              One PDF with a page per employee (the check run), or several PDFs. Each page is split off and the name on it is read and matched to an
              account — you check every match before anything is sent.
            </span>
            <input type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => void read(e.target.files)} />
          </label>
        )}
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-white/10 bg-slate-800/30 p-3 text-xs">
        <label className="flex flex-col gap-1 text-slate-400">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-40 rounded border border-white/10 bg-slate-800 px-2 py-1 text-white" />
        </label>
        <label className="flex flex-col gap-1 text-slate-400">
          <span>Pay date <span className="text-red-400">*</span></span>
          <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="rounded border border-white/10 bg-slate-800 px-2 py-1 text-white" />
        </label>
        <label className="flex flex-col gap-1 text-slate-400">
          Period from
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="rounded border border-white/10 bg-slate-800 px-2 py-1 text-white" />
        </label>
        <label className="flex flex-col gap-1 text-slate-400">
          to
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="rounded border border-white/10 bg-slate-800 px-2 py-1 text-white" />
        </label>
        <span className="text-slate-500">Read off the stubs — change them if they're wrong.</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {([
          ["all", `All (${rows.length})`, ""],
          ["matched", `Matched (${counts.matched})`, "text-emerald-300"],
          ["look", `Please confirm (${counts.look})`, "text-amber-300"],
          ["none", `No account (${counts.none})`, "text-red-300"],
        ] as const).map(([k, label, cls]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={`btn px-3 py-1 text-xs ${cls} ${filter === k ? "bg-primary/20" : ""}`}>
            {label}
          </button>
        ))}
        <span className="ml-auto text-slate-400">
          <strong className="text-white">{toPublish.length}</strong> confirmed · {rows.length - toPublish.length} kept unassigned
          {flagged > 0 && <span className="text-amber-300"> · {flagged} flagged</span>}
        </span>
        <button type="button" onClick={() => !saving && setRows([])} disabled={!!saving} className="btn px-3 py-1 text-xs">
          <X className="h-3.5 w-3.5" /> Discard
        </button>
        <button
          type="button"
          onClick={() => void publish()}
          disabled={!!saving || toPublish.length === 0 || !payDate}
          title={!payDate ? "Enter the Pay date above first — it couldn't be read off the stubs." : toPublish.length === 0 ? "Tick at least one row matched to an employee." : undefined}
          className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {saving ? `Saving ${saving.done} of ${saving.total}…` : `Publish ${toPublish.length} confirmed`}
        </button>
      </div>
      {!payDate && toPublish.length > 0 && <p className="text-xs text-amber-300">Enter the Pay date above to publish — it couldn't be read off the stubs.</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-xs">
          <thead className="bg-slate-800/60 text-left text-slate-400">
            <tr>
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  checked={allShownTicked}
                  onChange={(e) => {
                    const keys = new Set(shown.filter((r) => r.profileId).map((r) => r.key));
                    setRows((rs) => rs.map((r) => (keys.has(r.key) ? { ...r, confirmed: e.target.checked } : r)));
                  }}
                  title="Confirm every row shown that has a person"
                />
              </th>
              <th className="px-3 py-2">Page</th>
              <th className="px-3 py-2">Name on stub</th>
              <th className="px-3 py-2">Matched to</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right" title="Reviewed Periods' net pay (gross − taxes) for the period above">AHS net pay</th>
              <th className="px-3 py-2 text-right" title="Net pay read off the stub — the check amount and the NETPAY row, kept when they agree">Stub net pay</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {shown.map((r) => {
              const ahs = ahsNetOf(r.profileId);
              const netDiff = ahs != null && r.netPay != null ? Math.round((r.netPay - ahs) * 100) / 100 : null;
              const flag = flagOf(r);
              const st = r.manual ? { label: "Picked by hand", cls: "bg-sky-500/15 text-sky-300" } : STATUS_STYLE[r.status];
              return (
                <tr key={r.key} className={r.confirmed ? "bg-emerald-500/[0.03]" : ""}>
                  <td className="px-3 py-1.5">
                    <input type="checkbox" checked={r.confirmed} disabled={!r.profileId} onChange={(e) => update(r.key, { confirmed: e.target.checked })} aria-label="Confirm" />
                  </td>
                  <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">
                    {r.pageCount > 1 ? `p${r.page}` : r.sourceFileName}
                  </td>
                  <td className="px-3 py-1.5 text-white">
                    {r.name || <span className="text-slate-500">Couldn't read a name</span>}
                    {r.nameSource === "filename" && <span className="ml-1 text-[10px] text-slate-500">(from file name)</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    <PersonSelect value={r.profileId} people={people} onChange={(id) => update(r.key, { profileId: id, manual: true, confirmed: !!id })} className="max-w-[240px]" />
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
                    {!r.manual && r.reason && <span className="ml-1.5 text-[10px] text-slate-500">{r.reason}</span>}
                    {flag && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-amber-300">
                        <AlertTriangle className="h-3 w-3" /> {flag}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap text-slate-300">
                    {ahs === undefined ? <span className="text-slate-500">…</span> : ahs === null ? <span className="text-slate-500" title="No Reviewed Periods row for this person and period">—</span> : money(ahs)}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${netDiff == null ? "text-slate-300" : netDiff === 0 ? "text-emerald-300" : "text-red-300"}`}
                    title={netDiff ? `${netDiff > 0 ? "+" : "−"}${money(Math.abs(netDiff))} vs AHS` : undefined}
                  >
                    {r.netPay == null ? <span className="text-slate-500" title="Couldn't read the net pay off this stub — check the preview">—</span> : money(r.netPay)}
                    {!!netDiff && <div className="text-[10px]">{netDiff > 0 ? "+" : "−"}{money(Math.abs(netDiff))}</div>}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <button type="button" onClick={() => setPreviewKey(r.key)} className="inline-flex items-center gap-1 rounded px-2 py-1 text-slate-300 hover:bg-white/10" title="Preview this page">
                      <Eye className="h-3.5 w-3.5" /> Preview
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreviewKey(null)}>
          <div className="flex max-h-full w-full max-w-5xl flex-col gap-3 overflow-hidden rounded-lg border border-white/10 bg-slate-900 p-3 md:flex-row" onClick={(e) => e.stopPropagation()}>
            <div className="min-h-0 flex-1 overflow-auto rounded bg-white">
              <img src={preview.preview} alt={`Page ${preview.page}`} className="w-full" />
            </div>
            <div className="flex w-full shrink-0 flex-col gap-2 text-xs md:w-64">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">{preview.pageCount > 1 ? `Page ${preview.page} of ${preview.pageCount}` : preview.sourceFileName}</span>
                <button type="button" onClick={() => setPreviewKey(null)} className="rounded p-1 text-slate-400 hover:bg-white/10"><X className="h-4 w-4" /></button>
              </div>
              <div className="text-slate-400">Name on stub</div>
              <div className="text-sm font-semibold text-white">{preview.name || "—"}</div>
              <div className="text-slate-400">Matched to</div>
              <PersonSelect value={preview.profileId} people={people} onChange={(id) => update(preview.key, { profileId: id, manual: true, confirmed: !!id })} />
              {preview.profileId && <div className="text-slate-500">{nameOf.get(preview.profileId)}</div>}
              <div className="text-slate-400">Net pay — stub / AHS</div>
              <div className="text-sm font-semibold text-white tabular-nums">
                {preview.netPay == null ? "—" : money(preview.netPay)} / {(() => { const a = ahsNetOf(preview.profileId); return a == null ? "—" : money(a); })()}
              </div>
              <label className="mt-1 flex items-center gap-2 text-white">
                <input type="checkbox" checked={preview.confirmed} disabled={!preview.profileId} onChange={(e) => update(preview.key, { confirmed: e.target.checked })} />
                That's them — confirm
              </label>
              <div className="mt-auto flex gap-2">
                {(() => {
                  const i = rows.findIndex((r) => r.key === preview.key);
                  return (
                    <>
                      <button type="button" disabled={i <= 0} onClick={() => setPreviewKey(rows[i - 1]?.key ?? null)} className="btn flex-1 justify-center px-2 py-1 text-xs">Previous</button>
                      <button type="button" disabled={i >= rows.length - 1} onClick={() => setPreviewKey(rows[i + 1]?.key ?? null)} className="btn flex-1 justify-center px-2 py-1 text-xs">Next</button>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilesTab({
  files,
  people,
  nameOf,
  companyId,
  actorId,
  actorName,
  onChanged,
}: {
  files: EmployeeFileRow[];
  people: EmployeeMatchPerson[];
  nameOf: Map<string, string>;
  companyId: string | null;
  actorId: string | null;
  actorName: string | null;
  onChanged: () => Promise<void>;
}) {
  const payDates = useMemo(() => [...new Set(files.map((f) => f.payDate ?? ""))].sort().reverse(), [files]);
  const [payDate, setPayDate] = useState<string>("");
  const [status, setStatus] = useState<"all" | "published" | "unassigned" | "withdrawn" | "replaced">("all");
  const [replacing, setReplacing] = useState<EmployeeFileRow | null>(null);
  const [editing, setEditing] = useState<EmployeeFileRow | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!payDate && payDates.length > 0) setPayDate(payDates[0]);
  }, [payDates, payDate]);

  const shown = files.filter(
    (f) =>
      (payDate === "*" || (f.payDate ?? "") === payDate) &&
      (status === "all" || f.status === status) &&
      (!search || `${f.profileId ? nameOf.get(f.profileId) ?? "" : ""} ${f.nameOnFile ?? ""}`.toLowerCase().includes(search.toLowerCase()))
  );

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const view = async (f: EmployeeFileRow) => {
    try {
      window.open(await getEmployeeFileUrl(f.storagePath), "_blank", "noopener");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open the file.");
    }
  };

  if (files.length === 0) return <p className="rounded-lg border border-white/10 bg-slate-800/30 p-6 text-sm text-slate-400">No paystubs uploaded yet.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select value={payDate} onChange={(e) => setPayDate(e.target.value)} className="rounded border border-white/10 bg-slate-800 px-2 py-1 text-white" aria-label="Pay date">
          <option value="*">All pay dates</option>
          {payDates.map((d) => <option key={d} value={d}>{d ? `Pay date ${fmtDate(d)}` : "No pay date"}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="rounded border border-white/10 bg-slate-800 px-2 py-1 text-white" aria-label="Status">
          <option value="all">All statuses</option>
          <option value="published">Published</option>
          <option value="unassigned">Unassigned</option>
          <option value="withdrawn">Withdrawn</option>
          <option value="replaced">Replaced (old copies)</option>
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name" className="w-48 rounded border border-white/10 bg-slate-800 px-2 py-1 text-white placeholder-slate-500" />
        <span className="ml-auto text-slate-400">{shown.length} file{shown.length === 1 ? "" : "s"}</span>
        {payDate && payDate !== "*" && (() => {
          const live = files.filter((f) => f.payDate === payDate && f.status === "published").length;
          return live > 0 ? (
            <button
              type="button"
              disabled={busy === "pay-date"}
              onClick={() =>
                confirm(`Withdraw all ${live} published paystub${live === 1 ? "" : "s"} for pay date ${fmtDate(payDate)}?\n\nEmployees won't see them anymore. Upload the corrected run afterwards.`) &&
                void run("pay-date", async () => {
                  await withdrawEmployeeFilesForPayDate(payDate, actorName);
                })
              }
              className="btn px-3 py-1 text-xs text-amber-300"
              title="A whole run sent wrong — take them all back"
            >
              <Undo2 className="h-3.5 w-3.5" /> Withdraw all {live} for {fmtDate(payDate)}
            </button>
          ) : null;
        })()}
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-xs">
          <thead className="bg-slate-800/60 text-left text-slate-400">
            <tr>
              <th className="px-3 py-2">Employee</th>
              <th className="px-3 py-2">Name on stub</th>
              <th className="px-3 py-2">Pay date</th>
              <th className="px-3 py-2">Period</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Uploaded</th>
              <th className="px-3 py-2">Confirmed</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {shown.map((f) => (
              <tr key={f.id}>
                <td className="px-3 py-1.5 text-white">
                  {f.status === "published" ? (
                    nameOf.get(f.profileId ?? "") ?? "—"
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <PersonSelect value={assigning[f.id] ?? f.profileId} people={people} onChange={(id) => setAssigning((a) => ({ ...a, [f.id]: id }))} className="max-w-[200px]" />
                      <button
                        type="button"
                        disabled={busy === f.id || !(assigning[f.id] ?? f.profileId)}
                        onClick={() => {
                          const id = (assigning[f.id] ?? f.profileId)!;
                          if (confirm(`Publish this paystub to ${nameOf.get(id)}?`)) void run(f.id, () => publishEmployeeFile(f.id, id, actorId, actorName));
                        }}
                        className="rounded bg-blue-600 px-2 py-1 font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                      >
                        Publish
                      </button>
                    </div>
                  )}
                </td>
                <td className="px-3 py-1.5 text-slate-300">
                  {f.nameOnFile ?? "—"}
                  {f.sourcePage != null && <span className="ml-1 text-[10px] text-slate-500">p{f.sourcePage}</span>}
                </td>
                <td className="px-3 py-1.5 text-slate-300 whitespace-nowrap">{fmtDate(f.payDate)}</td>
                <td className="px-3 py-1.5 text-slate-300 whitespace-nowrap">{f.periodStart ? `${fmtDate(f.periodStart)} – ${fmtDate(f.periodEnd)}` : "—"}</td>
                <td className="px-3 py-1.5">
                  {f.status === "published" && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">Published</span>}
                  {f.replacesId && (
                    <span className="ml-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300" title="Corrected copy — replaced an earlier stub">
                      Corrected
                    </span>
                  )}
                  {f.status === "replaced" && (
                    <span className="rounded bg-slate-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300" title="Hidden from the employee — a corrected copy took its place">
                      Replaced · {f.replacedByName ?? "—"} {f.replacedAt ? new Date(f.replacedAt).toLocaleDateString() : ""}
                    </span>
                  )}
                  {f.status === "unassigned" && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">Unassigned</span>}
                  {f.status === "withdrawn" && (
                    <span className="rounded bg-slate-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300" title={`Withdrawn by ${f.withdrawnByName ?? "—"} ${f.withdrawnAt ? new Date(f.withdrawnAt).toLocaleString() : ""}`}>
                      Withdrawn
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">{f.uploadedByName ?? "—"} · {new Date(f.uploadedAt).toLocaleDateString()}</td>
                <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap" title={f.matchNote ?? undefined}>
                  {f.confirmedByName ? `${f.confirmedByName} · ${f.publishedAt ? new Date(f.publishedAt).toLocaleDateString() : ""}` : "—"}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  <button type="button" onClick={() => void view(f)} className="rounded p-1 text-slate-300 hover:bg-white/10" title="View"><Eye className="h-3.5 w-3.5" /></button>
                  {f.status !== "replaced" && (
                    <button type="button" onClick={() => setEditing(f)} className="rounded p-1 text-slate-300 hover:bg-white/10" title="Edit title / pay date / period">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {f.status === "published" && (
                    <button type="button" onClick={() => setReplacing(f)} className="rounded p-1 text-slate-300 hover:bg-white/10" title="Replace with a corrected PDF">
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {f.status === "published" && (
                    <button
                      type="button"
                      disabled={busy === f.id}
                      onClick={() => confirm(`Withdraw this paystub from ${nameOf.get(f.profileId ?? "")}? They won't see it anymore; you can publish it again.`) && void run(f.id, () => withdrawEmployeeFile(f.id, actorName))}
                      className="rounded p-1 text-slate-300 hover:bg-white/10 disabled:opacity-40"
                      title="Withdraw from the employee"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {f.status !== "published" && (
                    <button
                      type="button"
                      disabled={busy === f.id}
                      onClick={() => confirm("Delete this file for good?") && void run(f.id, () => deleteEmployeeFile(f))}
                      className="rounded p-1 text-slate-300 hover:bg-white/10 hover:text-red-300 disabled:opacity-40"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {busy === f.id && <Loader2 className="ml-1 inline h-3.5 w-3.5 animate-spin" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && (
        <p className="flex items-center gap-1.5 text-xs text-slate-500"><XCircle className="h-3.5 w-3.5" /> Nothing matches these filters.</p>
      )}

      {replacing && (
        <ReplaceModal
          file={replacing}
          employeeName={nameOf.get(replacing.profileId ?? "") ?? "—"}
          onClose={() => setReplacing(null)}
          onReplace={async (bytes, sourceFileName) => {
            if (!companyId) throw new Error("Your company isn't loaded yet — try again in a moment.");
            await replaceEmployeeFile({ old: replacing, companyId, bytes, sourceFileName, actorId, actorName });
            setReplacing(null);
            await onChanged();
          }}
        />
      )}
      {editing && (
        <EditDetailsModal
          file={editing}
          onClose={() => setEditing(null)}
          onSave={async (details) => {
            await updateEmployeeFileDetails(editing.id, details);
            setEditing(null);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

/** Old vs new side by side, then Replace. A multi-page PDF asks which page is theirs. */
function ReplaceModal({
  file,
  employeeName,
  onClose,
  onReplace,
}: {
  file: EmployeeFileRow;
  employeeName: string;
  onClose: () => void;
  onReplace: (bytes: Uint8Array, sourceFileName: string) => Promise<void>;
}) {
  const [oldUrl, setOldUrl] = useState<string | null>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getEmployeeFileUrl(file.storagePath).then(setOldUrl).catch(() => setError("Couldn't load the current stub."));
  }, [file.storagePath]);

  // Preview the page that will be saved (the chosen page alone).
  useEffect(() => {
    if (!picked) return;
    let url: string | null = null;
    let cancelled = false;
    void extractPdfPage(picked, page)
      .then((bytes) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
        setNewUrl(url);
      })
      .catch(() => setError("Couldn't read that PDF."));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [picked, page]);

  const choose = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setNewUrl(null);
    try {
      const n = await pdfPageCount(f);
      setPicked(f);
      setPages(n);
      setPage(1);
    } catch {
      setError("That file isn't a PDF that can be read.");
    }
  };

  const replace = async () => {
    if (!picked) return;
    if (!confirm(`Replace ${employeeName}'s paystub for ${fmtDate(file.payDate)} with this corrected copy?\n\nThe old one is kept for the record and hidden from them; they'll see the new one marked Corrected.`)) return;
    setBusy(true);
    setError(null);
    try {
      await onReplace(await extractPdfPage(picked, page), picked.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't replace it.");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !busy && onClose()}>
      <div className="flex h-[90vh] w-full max-w-6xl flex-col gap-3 rounded-lg border border-white/10 bg-slate-900 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Replace paystub — {employeeName}</h3>
            <p className="text-xs text-slate-400">
              {file.title} · Pay date {fmtDate(file.payDate)}
              {file.periodStart && ` · Period ${fmtDate(file.periodStart)} – ${fmtDate(file.periodEnd)}`}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded p-1 text-slate-400 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-2">
          <div className="flex min-h-0 flex-col gap-1">
            <span className="text-xs font-semibold text-slate-400">Current</span>
            {oldUrl ? <iframe src={oldUrl} title="Current stub" className="min-h-0 flex-1 rounded bg-white" /> : <div className="flex flex-1 items-center justify-center text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /></div>}
          </div>
          <div className="flex min-h-0 flex-col gap-1">
            <span className="text-xs font-semibold text-slate-400">Corrected</span>
            {newUrl ? (
              <iframe src={newUrl} title="Corrected stub" className="min-h-0 flex-1 rounded bg-white" />
            ) : (
              <label className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-white/15 text-center hover:border-blue-400/50">
                <Upload className="h-6 w-6 text-slate-400" />
                <span className="text-xs font-semibold text-white">Choose the corrected PDF</span>
                <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void choose(e.target.files?.[0])} />
              </label>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {picked && (
            <>
              <span className="text-slate-400">{picked.name}</span>
              {pages > 1 && (
                <label className="flex items-center gap-1 text-slate-400">
                  Page
                  <input type="number" min={1} max={pages} value={page} onChange={(e) => setPage(Math.min(pages, Math.max(1, Number(e.target.value) || 1)))} className="w-16 rounded border border-white/10 bg-slate-800 px-2 py-1 text-white" />
                  of {pages} — pick the page that's {employeeName}'s
                </label>
              )}
              <label className="btn cursor-pointer px-2 py-1 text-xs">
                Choose another
                <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void choose(e.target.files?.[0])} />
              </label>
            </>
          )}
          {error && <span className="text-red-300">{error}</span>}
          <button
            type="button"
            onClick={() => void replace()}
            disabled={!picked || !newUrl || busy}
            className="ml-auto inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Replace
          </button>
        </div>
      </div>
    </div>
  );
}

function EditDetailsModal({
  file,
  onClose,
  onSave,
}: {
  file: EmployeeFileRow;
  onClose: () => void;
  onSave: (details: { title: string; payDate: string | null; periodStart: string | null; periodEnd: string | null }) => Promise<void>;
}) {
  const [title, setTitle] = useState(file.title);
  const [payDate, setPayDate] = useState(file.payDate ?? "");
  const [periodStart, setPeriodStart] = useState(file.periodStart ?? "");
  const [periodEnd, setPeriodEnd] = useState(file.periodEnd ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!payDate) return setError("Enter the pay date.");
    if (periodStart && periodEnd && periodStart > periodEnd) return setError("The period ends before it starts.");
    setBusy(true);
    setError(null);
    try {
      await onSave({ title: title.trim() || "Paystub", payDate, periodStart: periodStart || null, periodEnd: periodEnd || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
      setBusy(false);
    }
  };

  const input = "rounded border border-white/10 bg-slate-800 px-2 py-1 text-white";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-sm space-y-3 rounded-lg border border-white/10 bg-slate-900 p-4 text-xs" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-white">Edit details</h3>
        <label className="flex flex-col gap-1 text-slate-400">Title<input value={title} onChange={(e) => setTitle(e.target.value)} className={input} /></label>
        <label className="flex flex-col gap-1 text-slate-400"><span>Pay date <span className="text-red-400">*</span></span><input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className={input} /></label>
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-slate-400">Period from<input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className={input} /></label>
          <label className="flex flex-1 flex-col gap-1 text-slate-400">to<input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className={input} /></label>
        </div>
        {error && <p className="text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded bg-slate-700 px-3 py-1.5 font-semibold text-white hover:bg-slate-600">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}
