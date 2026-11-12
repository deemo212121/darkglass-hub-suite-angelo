/**
 * Accounting Dashboard → "New Hires" button (beside New Promotion / New
 * wage). Everyone hired in a pay period (Master List Hire Date) with their
 * HR forms — W-4, Direct Deposit and I-9 to start, any other HR form from
 * the Forms dropdown — status, View PDF, and download as separate files:
 * tick the ones wanted, or Download all. Filter by group (US office /
 * Technicians / PH / Mexico) and branch. Read-only. See lib/newHiresForms.ts.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Download, Eye, Loader2, Search, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { normalizeRole, ROLE_LABELS } from "@/lib/roleLabels";
import { addDaysISO, localISODate } from "@/lib/localDate";
import { payPeriodContaining, type PayPeriod } from "@/lib/payPeriods";
import {
  ALL_HIRE_FORMS,
  DEFAULT_HIRE_FORMS,
  HIRE_FORM_STATUS_LABEL,
  HIRE_GROUP_LABEL,
  US_HIRE_GROUPS,
  hireFormCell,
  hireFormFileName,
  hireFormLabel,
  type HireFormType,
  type HireGroup,
  type NewHireRow,
} from "@/lib/newHiresForms";
import { getNewHiresWithForms } from "@/lib/supabase/newHiresForms";
import { downloadSignableDocumentPdf } from "@/lib/downloadSignableDocumentPdf";
import { InlinePdfModal } from "@/components/InlinePdfViewer";
import type { DocumentReviewStatus } from "@/lib/signableDocumentRegistry";

// W-4 / I-9 carry SSNs — Accounting, Admin and Super Admin only.
const VIEW_ROLES = new Set(["FINANCE", "ACCOUNTING_MANAGER", "ADMIN", "SUPERADMIN", "SUPERSUPERADMIN"]);
const GROUPS: HireGroup[] = ["US", "TECH", "PH", "MX"];
/** How many pay periods back the Pay period dropdown goes (about a year). */
const PERIODS_BACK = 26;

const STATUS_PILL: Record<DocumentReviewStatus, string> = {
  done: "bg-green-500/15 text-green-300 border-green-500/30",
  awaiting_hr: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  awaiting_employee: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  not_sent: "bg-red-500/10 text-red-300 border-red-500/30",
  outdated: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

const fmtDay = (iso: string, withYear = true) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
};
const periodLabel = (p: PayPeriod) => `${fmtDay(p.start, false)} – ${fmtDay(p.end)}`;
const periodKey = (p: PayPeriod) => `${p.start}|${p.end}`;

/** Sorting a form column: least done first when ascending. */
const STATUS_ORDER: Record<DocumentReviewStatus, number> = { not_sent: 0, awaiting_employee: 1, awaiting_hr: 2, outdated: 3, done: 4 };

/** A column to sort by: Employee, Hire date, or one of the form columns. */
type SortKey = "name" | "hire" | HireFormType;

const fileKey = (personId: string, type: HireFormType) => `${personId}|${type}`;

/** "CSR_MANAGER" → "CSR Manager" (the app's own role names). */
const roleName = (role: string) =>
  ROLE_LABELS[normalizeRole(role)] ?? role.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const iconBtn = "inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-40";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The next pay period, the current one, and ~a year back — newest first. */
function payPeriodOptions(): PayPeriod[] {
  const out: PayPeriod[] = [];
  let p = payPeriodContaining(addDaysISO(payPeriodContaining(localISODate()).end, 1));
  for (let i = 0; i <= PERIODS_BACK + 1; i++) {
    out.push(p);
    p = payPeriodContaining(addDaysISO(p.start, -1));
  }
  return out;
}

export function NewHiresFormsButton({ periodStart, periodEnd }: { periodStart: string; periodEnd: string }) {
  const { role, extraRoles } = useAuth();
  const canView = [role, ...(extraRoles ?? [])].some((r) => r && VIEW_ROLES.has(normalizeRole(r)));

  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<PayPeriod>({ start: periodStart, end: periodEnd });
  const [rows, setRows] = useState<NewHireRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forms, setForms] = useState<Set<HireFormType>>(new Set(DEFAULT_HIRE_FORMS));
  const [formsOpen, setFormsOpen] = useState(false);
  const [formQuery, setFormQuery] = useState("");
  /** Empty = every group. */
  const [groups, setGroups] = useState<Set<HireGroup>>(new Set());
  const [branch, setBranch] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "hire", dir: "asc" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState<{ done: number; total: number } | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ url: string; title: string; fileName: string } | null>(null);

  // Follows the payroll run's pay period until the window is opened.
  useEffect(() => { if (!open) setPeriod({ start: periodStart, end: periodEnd }); }, [periodStart, periodEnd, open]);

  const periods = useMemo(() => {
    const list = payPeriodOptions();
    // The payroll run's own dates, if they aren't one of the regular periods.
    return list.some((p) => periodKey(p) === periodKey(period)) ? list : [period, ...list];
  }, [period]);

  const load = useCallback((p: PayPeriod) => {
    if (!p.start || !p.end || p.start > p.end) { setRows([]); return; }
    setRows(null);
    setError(null);
    getNewHiresWithForms(p.start, p.end)
      .then((r) => { setRows(r); setSelected(new Set()); })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => { if (canView) load({ start: periodStart, end: periodEnd }); }, [canView, periodStart, periodEnd, load]);
  useEffect(() => { if (open) load(period); }, [open, period, load]);

  /** W-4 / Direct Deposit / I-9 first (when ticked), then the rest A–Z. */
  const shownForms = useMemo(
    () => [...DEFAULT_HIRE_FORMS.filter((t) => forms.has(t)), ...ALL_HIRE_FORMS.filter((t) => forms.has(t) && !DEFAULT_HIRE_FORMS.includes(t))],
    [forms],
  );
  const formOptions = useMemo(() => {
    const q = formQuery.trim().toLowerCase();
    return ALL_HIRE_FORMS.filter((t) => !q || hireFormLabel(t).toLowerCase().includes(q));
  }, [formQuery]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (rows ?? []).filter(
      (r) =>
        (groups.size === 0 || groups.has(r.group)) &&
        (!branch || r.branch === branch) &&
        (!q || `${r.name} ${r.role} ${r.branch}`.toLowerCase().includes(q)),
    );
    const sign = sort.dir === "asc" ? 1 : -1;
    const cmp = (a: NewHireRow, b: NewHireRow) =>
      sort.key === "name" ? a.name.localeCompare(b.name)
      : sort.key === "hire" ? a.hireDay.localeCompare(b.hireDay)
      : STATUS_ORDER[hireFormCell(a, sort.key).status] - STATUS_ORDER[hireFormCell(b, sort.key).status];
    // Ties keep a steady order: by hire date, then name.
    return [...list].sort((a, b) => sign * cmp(a, b) || a.hireDay.localeCompare(b.hireDay) || a.name.localeCompare(b.name));
  }, [rows, groups, branch, query, sort]);

  // A form column that's been un-ticked can't stay the sort.
  useEffect(() => {
    if (sort.key !== "name" && sort.key !== "hire" && !forms.has(sort.key)) setSort({ key: "hire", dir: "asc" });
  }, [forms, sort.key]);

  const sortBy = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const SortHeader = ({ k, label }: { k: SortKey; label: string }) => {
    const active = sort.key === k;
    const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th className="px-3 py-2.5 font-semibold" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          onClick={() => sortBy(k)}
          className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-white ${active ? "text-white" : ""}`}
          title={active ? (sort.dir === "asc" ? "Sorted ascending — click for descending" : "Sorted descending — click for ascending") : "Click to sort"}
        >
          {label}
          <Icon className={`h-3 w-3 ${active ? "text-blue-300" : "opacity-50"}`} />
        </button>
      </th>
    );
  };

  /** Branches of the new hires in the chosen groups, for the Branch filter. */
  const branches = useMemo(
    () => Array.from(new Set((rows ?? []).filter((r) => groups.size === 0 || groups.has(r.group)).map((r) => r.branch).filter(Boolean))).sort(),
    [rows, groups],
  );
  useEffect(() => { if (branch && !branches.includes(branch)) setBranch(""); }, [branch, branches]);

  const groupCounts = useMemo(() => {
    const c: Record<HireGroup, number> = { US: 0, TECH: 0, PH: 0, MX: 0 };
    for (const r of rows ?? []) c[r.group]++;
    return c;
  }, [rows]);

  /** Every downloadable file among the shown rows and forms. */
  const files = useMemo(
    () =>
      shown.flatMap((r) =>
        shownForms
          .filter((t) => hireFormCell(r, t).doc?.pdfUrl)
          .map((t) => ({ key: fileKey(r.id, t), url: hireFormCell(r, t).doc!.pdfUrl!, name: hireFormFileName(r, t) })),
      ),
    [shown, shownForms],
  );
  const selectedFiles = files.filter((f) => selected.has(f.key));

  const counts = useMemo(() => {
    const done = shown.filter((r) => shownForms.every((t) => hireFormCell(r, t).status === "done")).length;
    return { people: shown.length, done, missing: shown.length - done };
  }, [shown, shownForms]);

  // Button badge: US / technician new hires in the payroll's pay period without a completed W-4.
  const badge = useMemo(() => (rows ?? []).filter((r) => US_HIRE_GROUPS.has(r.group) && hireFormCell(r, "w4").status !== "done").length, [rows]);

  const toggle = (keys: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) on ? next.add(k) : next.delete(k);
      return next;
    });

  const download = async (list: { url: string; name: string }[]) => {
    if (list.length === 0) return;
    setDownloadError(null);
    setDownloading({ done: 0, total: list.length });
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      try {
        await downloadSignableDocumentPdf(list[i].url, list[i].name);
      } catch {
        failed++;
      }
      setDownloading({ done: i + 1, total: list.length });
      // A short gap so the browser saves each file instead of dropping some.
      if (i < list.length - 1) await wait(400);
    }
    setDownloading(null);
    if (failed) setDownloadError(`${failed} of ${list.length} files couldn't be downloaded. Try those again.`);
  };

  if (!canView) return null;

  const allShownSelected = files.length > 0 && files.every((f) => selected.has(f.key));
  const chip = (on: boolean) => `rounded-md px-2.5 py-1 text-xs font-semibold transition ${on ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`;

  const modal = open && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-hires-title"
        className="w-full max-w-[1400px] h-[92vh] flex flex-col rounded-xl border border-white/10 bg-slate-900 text-left shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-white/10 px-5 py-4">
          <div className="flex-1 min-w-0">
            <h3 id="new-hires-title" className="text-lg font-bold text-white">New Hires</h3>
            <p className="text-xs text-slate-400">Everyone hired in the pay period (Master List Hire Date), with their HR forms. Tick the files you want, or download them all.</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-5 py-2.5">
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            Pay period
            <select
              value={periodKey(period)}
              onChange={(e) => {
                const [start, end] = e.target.value.split("|");
                setPeriod({ start, end });
              }}
              className="rounded-md border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white"
            >
              {periods.map((p) => (
                <option key={periodKey(p)} value={periodKey(p)}>
                  {periodLabel(p)}{p.start === periodStart && p.end === periodEnd ? " (payroll run)" : ""}
                </option>
              ))}
            </select>
          </label>

          {/* Forms: every HR form, searchable; W-4 / Direct Deposit / I-9 ticked to start. */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setFormsOpen((v) => !v)}
              aria-expanded={formsOpen}
              className="inline-flex max-w-[360px] items-center gap-1.5 rounded-md border border-white/10 bg-slate-800 px-2.5 py-1 text-xs text-white hover:border-white/20"
            >
              <span className="text-slate-400">Forms:</span>
              <span className="truncate">{shownForms.map(hireFormLabel).join(", ")}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            </button>
            {formsOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setFormsOpen(false)} />
                <div className="absolute left-0 top-full z-30 mt-1 w-80 rounded-lg border border-white/10 bg-slate-800 p-2 shadow-2xl">
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                    <input
                      autoFocus
                      type="search"
                      value={formQuery}
                      onChange={(e) => setFormQuery(e.target.value)}
                      placeholder="Search forms…"
                      aria-label="Search forms"
                      className="w-full rounded-md border border-white/10 bg-slate-900 py-1.5 pl-7 pr-2 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                  <div className="mt-1.5 flex items-center justify-between px-1 text-[11px]">
                    <span className="text-slate-400">{forms.size} selected</span>
                    <button type="button" onClick={() => setForms(new Set(DEFAULT_HIRE_FORMS))} className="text-blue-300 hover:text-blue-200">
                      Reset to W-4, Direct Deposit, I-9
                    </button>
                  </div>
                  <ul className="mt-1 max-h-72 overflow-y-auto">
                    {formOptions.length === 0 ? (
                      <li className="px-2 py-3 text-center text-xs text-slate-500">No form matches.</li>
                    ) : (
                      formOptions.map((t) => (
                        <li key={t}>
                          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-200 hover:bg-white/5">
                            <input
                              type="checkbox"
                              checked={forms.has(t)}
                              onChange={() => setForms((prev) => {
                                const next = new Set(prev);
                                if (next.has(t)) { if (next.size > 1) next.delete(t); } else next.add(t);
                                return next;
                              })}
                            />
                            {hireFormLabel(t)}
                          </label>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </>
            )}
          </div>

          <span className="h-5 w-px bg-white/10" aria-hidden />

          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Group">
            <button type="button" aria-pressed={groups.size === 0} onClick={() => setGroups(new Set())} className={chip(groups.size === 0)}>
              Everyone <span className="tabular-nums opacity-80">{rows ? rows.length : ""}</span>
            </button>
            {GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={groups.has(g)}
                onClick={() => setGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(g)) next.delete(g); else next.add(g);
                  return next;
                })}
                className={chip(groups.has(g))}
              >
                {HIRE_GROUP_LABEL[g]} <span className="tabular-nums opacity-80">{rows ? groupCounts[g] : ""}</span>
              </button>
            ))}
          </div>

          <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch" className="rounded-md border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white">
            <option value="">All branches</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>

          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, role or branch…"
            aria-label="Search people"
            className="ml-auto w-56 rounded-md border border-white/10 bg-slate-800 px-2.5 py-1.5 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-5 py-2">
          <p className="text-xs text-slate-400 tabular-nums">
            <span className="font-semibold text-white">{counts.people}</span> new hire{counts.people === 1 ? "" : "s"} ·{" "}
            <span className="text-green-300">{counts.done} with every selected form completed</span> ·{" "}
            <span className="text-red-300">{counts.missing} missing some</span>
          </p>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {downloading && (
              <span className="flex items-center gap-1.5 text-xs text-slate-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Downloading {downloading.done} of {downloading.total}…
              </span>
            )}
            <button
              type="button"
              disabled={!!downloading || selectedFiles.length === 0}
              onClick={() => download(selectedFiles)}
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              <Download className="h-3.5 w-3.5" /> Download selected ({selectedFiles.length})
            </button>
            <button
              type="button"
              disabled={!!downloading || files.length === 0}
              onClick={() => download(files)}
              className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" /> Download all ({files.length})
            </button>
          </div>
        </div>
        {downloadError && <p className="mx-5 mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{downloadError}</p>}

        <div className="flex-1 overflow-auto">
          {error ? (
            <p className="p-5 text-sm text-red-300">Couldn't load new hires: {error}</p>
          ) : !rows ? (
            <p className="flex items-center gap-2 p-5 text-sm text-slate-300"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
          ) : shown.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">
              {query || branch || groups.size > 0 ? "No new hires match these filters." : `No one was hired in the ${periodLabel(period)} pay period.`}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-900">
                <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="w-10 px-5 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Select every file shown"
                      checked={allShownSelected}
                      disabled={files.length === 0}
                      onChange={(e) => toggle(files.map((f) => f.key), e.target.checked)}
                    />
                  </th>
                  <SortHeader k="name" label="Employee" />
                  <SortHeader k="hire" label="Hire date" />
                  {shownForms.map((t) => <SortHeader key={t} k={t} label={hireFormLabel(t)} />)}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const rowKeys = shownForms.filter((t) => hireFormCell(r, t).doc?.pdfUrl).map((t) => fileKey(r.id, t));
                  return (
                    <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-5 py-2.5 align-middle">
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.name}'s files`}
                          checked={rowKeys.length > 0 && rowKeys.every((k) => selected.has(k))}
                          disabled={rowKeys.length === 0}
                          onChange={(e) => toggle(rowKeys, e.target.checked)}
                        />
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <p className="font-semibold text-white leading-tight">{r.name}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">{[roleName(r.role), r.branch].filter(Boolean).join(" · ")}</p>
                      </td>
                      <td className="px-3 py-2.5 align-middle whitespace-nowrap tabular-nums text-slate-300">{fmtDay(r.hireDay)}</td>
                      {shownForms.map((t) => {
                        const cell = hireFormCell(r, t);
                        const url = cell.doc?.pdfUrl;
                        const key = fileKey(r.id, t);
                        const name = hireFormFileName(r, t);
                        return (
                          <td key={t} className="px-3 py-2.5 align-middle">
                            {/* Same slots in every cell (box · status · view · download) so columns line up. */}
                            <div className="flex items-center gap-1.5">
                              <span className="flex w-4 justify-center">
                                {url && (
                                  <input
                                    type="checkbox"
                                    aria-label={`Select ${r.name}'s ${hireFormLabel(t)}`}
                                    checked={selected.has(key)}
                                    onChange={(e) => toggle([key], e.target.checked)}
                                  />
                                )}
                              </span>
                              <span className={`inline-block w-[104px] rounded-full border py-0.5 text-center text-[11px] font-semibold ${STATUS_PILL[cell.status]}`}>
                                {HIRE_FORM_STATUS_LABEL[cell.status]}
                              </span>
                              {url && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setViewing({ url, title: `${r.name} — ${hireFormLabel(t)}`, fileName: name })}
                                    className={iconBtn}
                                    title={`View ${hireFormLabel(t)}`}
                                    aria-label={`View ${r.name}'s ${hireFormLabel(t)}`}
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!!downloading}
                                    onClick={() => download([{ url, name }])}
                                    className={iconBtn}
                                    title={`Download ${hireFormLabel(t)}`}
                                    aria-label={`Download ${r.name}'s ${hireFormLabel(t)}`}
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        );
                      })}
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative px-3 py-1.5 text-sm rounded font-semibold bg-slate-700 text-slate-100 hover:bg-slate-600 transition"
      >
        New Hires
        {badge > 0 && (
          <span
            className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-bold leading-5 text-center tabular-nums"
            aria-label={`${badge} new hires without a completed W-4`}
            title={`${badge} US / technician new hire${badge === 1 ? "" : "s"} this pay period without a completed W-4`}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
      {/* Portaled: the dashboard header sits inside a blurred .panel, which traps position: fixed. */}
      {modal && typeof document !== "undefined" && createPortal(
        <>
          {modal}
          {viewing && <InlinePdfModal url={viewing.url} title={viewing.title} fileName={viewing.fileName} onClose={() => setViewing(null)} />}
        </>,
        document.body,
      )}
    </>
  );
}
