/**
 * Accounting → Expenses → Other Expenses: a branch's own running costs —
 * Utility, Lease, Internet, Phone, Other — one row per bill (migration
 * 0444). Same look as the Flash Tech tab: date range, category buttons,
 * summary cards, then the branch report (every category in its own column,
 * per branch, with totals) and the bills themselves. Accounting, Admin and
 * Super Admin add, edit and delete.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Download, Home, Loader2, Paperclip, Pencil, Phone, Plug, Receipt, Trash2, Wifi, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { normalizeRole } from "@/lib/roleLabels";
import { localISODate, todayISO } from "@/lib/localDate";
import { LOCATIONS_DATA } from "@/lib/zipCoverage";
import { deleteExpenseReceiptFile, uploadExpenseReceipt } from "@/lib/firebase/storage";
import { ReceiptLightbox, isPdfReceipt } from "@/components/ReceiptLightbox";
import {
  BRANCH_EXPENSE_CATEGORIES,
  BRANCH_EXPENSE_LABEL,
  branchExpenseCategoryText,
  buildBranchReport,
  type BranchExpense,
  type BranchExpenseCategory,
  type BranchExpenseFile,
} from "@/lib/branchExpenses";
import {
  addBranchExpense,
  deleteBranchExpense,
  getBranchExpenses,
  setBranchExpenseReceipts,
  updateBranchExpense,
  type BranchExpenseInput,
} from "@/lib/supabase/branchExpenses";

const EDIT_ROLES = new Set(["FINANCE", "ACCOUNTING_MANAGER", "ADMIN", "SUPERADMIN", "SUPERSUPERADMIN"]);

/** Each category's own color — buttons, cards, pills and its report column. */
const CAT_TONE: Record<BranchExpenseCategory | "all", { on: string; off: string; icon: string; pill: string; text: string; bar: string; border: string; chip: string }> = {
  all: { on: "border-violet-400/70 bg-violet-500/25 text-white", off: "border-violet-500/30 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20", icon: "text-violet-300", pill: "", text: "text-white", bar: "bg-violet-400/70", border: "border-violet-500/20", chip: "bg-violet-500/15 text-violet-300" },
  utility: { on: "border-amber-400/70 bg-amber-500/25 text-white", off: "border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20", icon: "text-amber-300", pill: "border-amber-400/40 bg-amber-500/10 text-amber-200", text: "text-amber-300", bar: "bg-amber-400/70", border: "border-amber-500/20", chip: "bg-amber-500/15 text-amber-300" },
  lease: { on: "border-sky-400/70 bg-sky-500/25 text-white", off: "border-sky-500/30 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20", icon: "text-sky-300", pill: "border-sky-400/40 bg-sky-500/10 text-sky-200", text: "text-sky-300", bar: "bg-sky-400/70", border: "border-sky-500/20", chip: "bg-sky-500/15 text-sky-300" },
  internet: { on: "border-emerald-400/70 bg-emerald-500/25 text-white", off: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20", icon: "text-emerald-300", pill: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200", text: "text-emerald-300", bar: "bg-emerald-400/70", border: "border-emerald-500/20", chip: "bg-emerald-500/15 text-emerald-300" },
  phone: { on: "border-rose-400/70 bg-rose-500/25 text-white", off: "border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20", icon: "text-rose-300", pill: "border-rose-400/40 bg-rose-500/10 text-rose-200", text: "text-rose-300", bar: "bg-rose-400/70", border: "border-rose-500/20", chip: "bg-rose-500/15 text-rose-300" },
  other: { on: "border-slate-300/60 bg-slate-500/25 text-white", off: "border-slate-500/30 bg-slate-500/10 text-slate-200 hover:bg-slate-500/20", icon: "text-slate-300", pill: "border-slate-400/40 bg-slate-500/10 text-slate-200", text: "text-slate-200", bar: "bg-slate-400/70", border: "border-slate-500/20", chip: "bg-slate-500/15 text-slate-300" },
};

const CAT_ICON: Record<BranchExpenseCategory | "all", typeof Receipt> = {
  all: Receipt,
  utility: Plug,
  lease: Home,
  internet: Wifi,
  phone: Phone,
  other: Building2,
};

const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDay = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** Every branch the company has (US, PH, Mexico), A–Z — the form's branch suggestions. */
const KNOWN_BRANCHES = Array.from(new Set(LOCATIONS_DATA.map((l) => l.location).filter(Boolean))).sort((a, b) => a.localeCompare(b));


function downloadCsv(name: string, header: string[], rows: (string | number)[][]) {
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((r) => r.map(q).join(",")).join("\n");
  const el = document.createElement("a");
  el.href = "data:text/csv;charset=utf-8," + encodeURIComponent(String.fromCharCode(0xfeff) + csv);
  el.download = name;
  el.style.display = "none";
  document.body.appendChild(el);
  el.click();
  document.body.removeChild(el);
}

export function OtherExpensesPage() {
  const { companyId, role, extraRoles } = useAuth();
  const canEdit = [role, ...(extraRoles ?? [])].some((r) => r && EDIT_ROLES.has(normalizeRole(r)));

  const [rows, setRows] = useState<BranchExpense[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [category, setCategory] = useState<BranchExpenseCategory | "all">("all");
  const [branch, setBranch] = useState("");
  const [search, setSearch] = useState("");
  /** Spend by branch order: biggest spend first, or A → Z (same as Flash Tech). */
  const [branchSort, setBranchSort] = useState<"amount" | "name">("amount");
  const [form, setForm] = useState<{ editing: BranchExpense | null } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; urls: string[] } | null>(null);

  const load = useCallback(() => {
    setError(null);
    getBranchExpenses()
      .then(setRows)
      .catch((e) => { setError(e instanceof Error ? e.message : String(e)); setRows([]); });
  }, []);
  useEffect(() => { if (canEdit) load(); }, [canEdit, load]);

  // Date range → everything below; category + branch + search → cards, report and list.
  const inRange = useMemo(
    () => (rows ?? []).filter((e) => (!dateFrom || e.expenseDate >= dateFrom) && (!dateTo || e.expenseDate <= dateTo)),
    [rows, dateFrom, dateTo],
  );
  const matchesSearch = (e: BranchExpense) =>
    !search.trim() || `${e.branch} ${e.vendor} ${e.notes} ${branchExpenseCategoryText(e)}`.toLowerCase().includes(search.trim().toLowerCase());
  const filtered = inRange.filter((e) => (category === "all" || e.category === category) && (!branch || e.branch === branch) && matchesSearch(e));

  const catCounts = useMemo(() => {
    const c: Record<BranchExpenseCategory | "all", number> = { all: 0, utility: 0, lease: 0, internet: 0, phone: 0, other: 0 };
    for (const e of inRange) {
      if (branch && e.branch !== branch) continue;
      c.all++;
      c[e.category]++;
    }
    return c;
  }, [inRange, branch]);

  // Spend by branch (same as Flash Tech's): everything in view except the branch choice itself —
  // the date range, the category button and the search all apply.
  const report = useMemo(() => {
    const r = buildBranchReport(inRange.filter((e) => (category === "all" || e.category === category) && matchesSearch(e)));
    r.branches.sort((a, b) => (branchSort === "name" ? a.branch.localeCompare(b.branch) : b.total - a.total || a.branch.localeCompare(b.branch)));
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRange, category, search, branchSort]);
  const maxBranchSpend = report.branches.reduce((m, b) => Math.max(m, b.total), 0);

  const branchOptions = useMemo(() => Array.from(new Set((rows ?? []).map((e) => e.branch))).sort((a, b) => a.localeCompare(b)), [rows]);
  const total = filtered.reduce((s, e) => s + e.amount, 0);
  const totalBy = (c: BranchExpenseCategory) => filtered.filter((e) => e.category === c).reduce((s, e) => s + e.amount, 0);

  const fmtRange = (d: string) => fmtDay(d);
  const rangeLabel = dateFrom && dateTo ? `${fmtRange(dateFrom)} – ${fmtRange(dateTo)}` : dateFrom ? `From ${fmtRange(dateFrom)}` : dateTo ? `Until ${fmtRange(dateTo)}` : "All dates";
  const setPreset = (p: "thisMonth" | "lastMonth" | "thisYear" | "all") => {
    if (p === "all") { setDateFrom(""); setDateTo(""); return; }
    const now = new Date();
    if (p === "thisYear") { setDateFrom(`${now.getFullYear()}-01-01`); setDateTo(`${now.getFullYear()}-12-31`); return; }
    const first = new Date(now.getFullYear(), now.getMonth() - (p === "lastMonth" ? 1 : 0), 1);
    setDateFrom(localISODate(first));
    setDateTo(localISODate(new Date(first.getFullYear(), first.getMonth() + 1, 0)));
  };

  const exportReport = () =>
    downloadCsv(
      `branch-expense-report-${todayISO()}.csv`,
      ["Branch", ...BRANCH_EXPENSE_CATEGORIES.map((c) => BRANCH_EXPENSE_LABEL[c]), "Total", "Bills"],
      [...report.branches, report.total].map((b) => [b.branch, ...BRANCH_EXPENSE_CATEGORIES.map((c) => b.byCategory[c].toFixed(2)), b.total.toFixed(2), b.count]),
    );
  const exportBills = () =>
    downloadCsv(
      `other-expenses-${todayISO()}.csv`,
      ["Bill date", "Branch", "Category", "Vendor", "Billing period", "Amount", "Notes", "Files", "Added by"],
      filtered.map((e) => [
        e.expenseDate,
        e.branch,
        branchExpenseCategoryText(e),
        e.vendor,
        e.periodStart || e.periodEnd ? `${e.periodStart ?? ""} – ${e.periodEnd ?? ""}` : "",
        e.amount.toFixed(2),
        e.notes,
        e.receipts.length,
        e.createdByName ?? "",
      ]),
    );

  const handleDelete = async (e: BranchExpense) => {
    if (!confirm(`Delete this ${branchExpenseCategoryText(e)} bill for ${e.branch} (${fmtMoney(e.amount)})? This cannot be undone.`)) return;
    setDeletingId(e.id);
    try {
      await deleteBranchExpense(e.id);
      for (const r of e.receipts) if (r.path) deleteExpenseReceiptFile(r.path).catch(() => undefined);
      load();
    } catch (err) {
      alert(`Couldn't delete: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingId(null);
    }
  };

  if (!canEdit) {
    return <p className="rounded-lg border border-white/10 bg-slate-900/50 p-6 text-sm text-slate-400">Other Expenses is for Accounting, Admin and Super Admin.</p>;
  }

  return (
    <div className="space-y-6">
      {/* Date range */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-slate-900/50 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bill date</span>
        <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" className="rounded-lg border border-white/10 bg-slate-800/50 px-2 py-1.5 text-sm text-white [color-scheme:dark] focus:border-blue-500 focus:outline-none" />
        <span className="text-xs text-slate-500">to</span>
        <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} aria-label="To date" className="rounded-lg border border-white/10 bg-slate-800/50 px-2 py-1.5 text-sm text-white [color-scheme:dark] focus:border-blue-500 focus:outline-none" />
        <div className="flex gap-1">
          {([["thisMonth", "This month"], ["lastMonth", "Last month"], ["thisYear", "This year"], ["all", "All dates"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setPreset(k)} className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700">{l}</button>
          ))}
        </div>
        <span className="ml-auto text-xs text-slate-400">Showing: <span className="font-semibold text-white">{rangeLabel}{branch ? ` · ${branch}` : ""}</span></span>
      </div>

      {/* Category buttons */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Category">
        {(["all", ...BRANCH_EXPENSE_CATEGORIES] as const).map((k) => {
          const on = category === k;
          const t = CAT_TONE[k];
          const Icon = CAT_ICON[k];
          return (
            <button key={k} type="button" role="tab" aria-selected={on} onClick={() => setCategory(k)} className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold transition ${on ? t.on : t.off}`}>
              <Icon className={`h-4 w-4 ${t.icon}`} />
              {k === "all" ? "All" : BRANCH_EXPENSE_LABEL[k]}
              <span className="rounded-full bg-black/20 px-1.5 py-0.5 text-[10px] tabular-nums">{catCounts[k]}</span>
            </button>
          );
        })}
      </div>

      {/* Summary cards — the total, then each category on its own */}
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {([
          { key: "all" as const, label: "Total Spend", value: total, sub: `${filtered.length} bill${filtered.length === 1 ? "" : "s"}` },
          ...BRANCH_EXPENSE_CATEGORIES.map((c) => ({ key: c, label: BRANCH_EXPENSE_LABEL[c], value: category === "all" || category === c ? totalBy(c) : 0, sub: `${filtered.filter((e) => e.category === c).length} bills` })),
        ]).map(({ key, label, value, sub }) => {
          const t = CAT_TONE[key];
          const Icon = CAT_ICON[key];
          return (
            <div key={key} className={`relative overflow-hidden rounded-xl border bg-slate-900/60 p-4 ${t.border}`}>
              <div className={`pointer-events-none absolute inset-x-0 top-0 h-0.5 ${t.bar}`} />
              <div className="flex items-start gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${t.chip}`}><Icon className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                  <p className={`mt-0.5 text-xl font-bold tabular-nums ${t.text}`}>{rows ? fmtMoney(value) : "…"}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{sub}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Spend by branch — same design as Flash Tech's; each bar split by category color. Click one to filter to it. */}
      {rows && report.branches.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <p className="text-sm font-semibold text-white">Spend by branch</p>
              {/* Which color is which category */}
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                {BRANCH_EXPENSE_CATEGORIES.filter((c) => category === "all" || category === c).map((c) => (
                  <span key={c} className="inline-flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${CAT_TONE[c].bar}`} /> {BRANCH_EXPENSE_LABEL[c]}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <p className="text-xs text-slate-500">{branch ? "Click the branch again to show every branch" : "Click a branch to see only its expenses"}</p>
              <div className="flex gap-1" role="group" aria-label="Sort branches">
                {([["amount", "Most → least"], ["name", "A → Z"]] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setBranchSort(key)}
                    aria-pressed={branchSort === key}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${branchSort === key ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button type="button" onClick={exportReport} className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700">
                <Download className="h-3 w-3" /> Export
              </button>
            </div>
          </div>
          {/* Reads down the first column, then the second. */}
          <div className="grid gap-x-6 gap-y-1 md:grid-flow-col" style={{ gridTemplateRows: `repeat(${Math.ceil(report.branches.length / 2)}, auto)` }}>
            {report.branches.map((b) => {
              const on = branch === b.branch;
              const breakdown = BRANCH_EXPENSE_CATEGORIES.filter((c) => b.byCategory[c] > 0).map((c) => `${BRANCH_EXPENSE_LABEL[c]}: ${fmtMoney(b.byCategory[c])}`).join("\n");
              return (
                <button
                  key={b.branch}
                  type="button"
                  onClick={() => setBranch(on ? "" : b.branch)}
                  aria-pressed={on}
                  title={`${b.branch}\n${breakdown}\nTotal: ${fmtMoney(b.total)} · ${b.count} bill${b.count === 1 ? "" : "s"}`}
                  className={`group grid grid-cols-[9rem_1fr_7.5rem] items-center gap-3 rounded-md px-2 py-1 text-left text-xs transition ${on ? "bg-blue-500/15 ring-1 ring-blue-500/40" : "hover:bg-white/5"}`}
                >
                  <span className={`truncate ${on ? "font-semibold text-white" : "text-slate-300"}`}>{b.branch}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-white/5">
                    {/* One bar, its length the branch's total; split into each category's share. */}
                    <span className="flex h-full" style={{ width: `${maxBranchSpend > 0 ? Math.max(2, (b.total / maxBranchSpend) * 100) : 2}%` }}>
                      {BRANCH_EXPENSE_CATEGORIES.filter((c) => b.byCategory[c] > 0).map((c) => (
                        <span key={c} className={`h-full ${CAT_TONE[c].bar} ${on ? "opacity-100" : "opacity-80 group-hover:opacity-100"}`} style={{ width: `${b.total > 0 ? (b.byCategory[c] / b.total) * 100 : 0}%` }} />
                      ))}
                    </span>
                  </span>
                  <span className="text-right tabular-nums text-slate-200">
                    {fmtMoney(b.total)} <span className="text-slate-500">· {b.count}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters + actions */}
      <div className="rounded-lg border border-white/10 bg-slate-900/50 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input type="text" placeholder="Search branch, vendor or notes…" value={search} onChange={(e) => setSearch(e.target.value)} className="min-w-[260px] flex-1 rounded-lg border border-white/10 bg-slate-800/50 p-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none" />
          <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch" className="rounded-lg border border-white/10 bg-slate-800/50 px-2 py-2 text-sm text-white focus:border-blue-500 focus:outline-none">
            <option value="">All branches</option>
            {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={exportBills} className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            <Download className="h-4 w-4" /> Export CSV
          </button>
          <button type="button" onClick={() => setForm({ editing: null })} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            + Add Expense
          </button>
        </div>
      </div>

      {/* Bills */}
      <div className="max-w-full overflow-x-auto rounded-lg border border-white/10 bg-slate-900/50 p-4">
        <h2 className="mb-3 text-lg font-bold text-white">Branch Bills</h2>
        {error && <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        <table className="w-full min-w-max text-xs">
          <thead>
            <tr className="border-b border-white/10 text-left text-[10px] font-semibold uppercase text-slate-400">
              <th className="px-2 py-2">Bill date</th>
              <th className="px-2 py-2">Branch</th>
              <th className="px-2 py-2">Category</th>
              <th className="px-2 py-2">Vendor / provider</th>
              <th className="px-2 py-2">Billing period</th>
              <th className="px-2 py-2 text-right">Amount</th>
              <th className="px-2 py-2">Notes</th>
              <th className="px-2 py-2">Bill / receipt</th>
              <th className="px-2 py-2">Added by</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!rows ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">{rows.length === 0 ? "No branch bills yet — press + Add Expense to record the first one." : "No bills match these filters."}</td></tr>
            ) : (
              filtered.map((e) => {
                const urls = e.receipts.map((r) => r.url);
                return (
                  <tr key={e.id} className="border-b border-white/5 transition hover:bg-white/5">
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-300">{fmtDay(e.expenseDate)}</td>
                    <td className="whitespace-nowrap px-2 py-2 font-medium text-white">{e.branch}</td>
                    <td className="whitespace-nowrap px-2 py-2">
                      <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${CAT_TONE[e.category].pill}`}>{branchExpenseCategoryText(e)}</span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-300">{e.vendor || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-400">{e.periodStart || e.periodEnd ? `${fmtDay(e.periodStart) || "…"} – ${fmtDay(e.periodEnd) || "…"}` : "—"}</td>
                    <td className="px-2 py-2 text-right font-mono text-slate-200">{fmtMoney(e.amount)}</td>
                    <td className="max-w-[260px] truncate px-2 py-2 text-slate-400" title={e.notes}>{e.notes || "—"}</td>
                    <td className="px-2 py-2">
                      {urls.length === 0 ? <span className="text-slate-600">—</span> : (
                        <div className="flex items-center gap-1">
                          {urls.slice(0, 2).map((url) => (
                            <button key={url} type="button" onClick={() => setPreview({ url, urls })} title="View" className="block h-8 w-8 overflow-hidden rounded border border-white/10 bg-slate-800 hover:border-blue-500">
                              {isPdfReceipt(url) ? <span className="flex h-full w-full items-center justify-center text-slate-400"><Paperclip className="h-4 w-4" /></span> : <img src={url} alt="Bill" className="h-full w-full object-cover" />}
                            </button>
                          ))}
                          {urls.length > 2 && <button type="button" onClick={() => setPreview({ url: urls[2], urls })} className="rounded bg-slate-800 px-1.5 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-700">+{urls.length - 2}</button>}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-300">
                      <div>{e.createdByName ?? "—"}</div>
                      <div className="text-[11px] text-slate-500">{fmtDay(e.createdAt.slice(0, 10))}</div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => setForm({ editing: e })} title="Edit" className="rounded bg-slate-700 px-2 py-1 text-white hover:bg-slate-600"><Pencil className="h-3 w-3" /></button>
                        <button type="button" onClick={() => handleDelete(e)} disabled={deletingId === e.id} title="Delete" className="rounded bg-slate-700 px-2 py-1 text-white hover:bg-red-700 disabled:opacity-50">
                          {deletingId === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {preview && <ReceiptLightbox url={preview.url} urls={preview.urls} onClose={() => setPreview(null)} />}
      {form && (
        <BranchExpenseForm
          editing={form.editing}
          companyId={companyId}
          branchSuggestions={Array.from(new Set([...KNOWN_BRANCHES, ...branchOptions])).sort((a, b) => a.localeCompare(b))}
          defaultCategory={category === "all" ? "utility" : category}
          defaultBranch={branch}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); load(); }}
        />
      )}
    </div>
  );
}

function BranchExpenseForm({
  editing,
  companyId,
  branchSuggestions,
  defaultCategory,
  defaultBranch,
  onClose,
  onSaved,
}: {
  editing: BranchExpense | null;
  companyId: string | null;
  branchSuggestions: string[];
  defaultCategory: BranchExpenseCategory;
  defaultBranch: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [branch, setBranch] = useState(editing?.branch ?? defaultBranch);
  const [category, setCategory] = useState<BranchExpenseCategory>(editing?.category ?? defaultCategory);
  const [otherLabel, setOtherLabel] = useState(editing?.otherLabel ?? "");
  const [vendor, setVendor] = useState(editing?.vendor ?? "");
  const [amount, setAmount] = useState(editing ? String(editing.amount) : "");
  const [expenseDate, setExpenseDate] = useState(editing?.expenseDate ?? todayISO());
  const [periodStart, setPeriodStart] = useState(editing?.periodStart ?? "");
  const [periodEnd, setPeriodEnd] = useState(editing?.periodEnd ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [kept, setKept] = useState<BranchExpenseFile[]>(editing?.receipts ?? []);
  const [removed, setRemoved] = useState<BranchExpenseFile[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const amountNum = Number(amount);
  const problem =
    !branch.trim() ? "Pick or type the branch."
    : category === "other" && !otherLabel.trim() ? "Say what the Other expense is."
    : !amount.trim() || !isFinite(amountNum) || amountNum < 0 ? "Enter the amount."
    : !expenseDate ? "Pick the bill date."
    : periodStart && periodEnd && periodStart > periodEnd ? "The billing period ends before it starts."
    : null;

  const save = async () => {
    if (problem || saving) return;
    if (!companyId) { setErr("No company — sign in again."); return; }
    setSaving(true);
    setErr(null);
    const input: BranchExpenseInput = {
      branch, category, otherLabel, vendor, amount: amountNum, expenseDate,
      periodStart: periodStart || null, periodEnd: periodEnd || null, notes, receipts: kept,
    };
    try {
      const id = editing ? editing.id : await addBranchExpense(input);
      if (editing) await updateBranchExpense(id, input);
      if (newFiles.length) {
        const uploaded: BranchExpenseFile[] = [];
        for (const f of newFiles) {
          const r = await uploadExpenseReceipt(companyId, `branch-${id}`, f);
          uploaded.push({ url: r.url, path: r.fullPath, name: f.name });
        }
        await setBranchExpenseReceipts(id, [...kept, ...uploaded]);
      }
      for (const r of removed) if (r.path) deleteExpenseReceiptFile(r.path).catch(() => undefined);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const input = "w-full rounded-lg border border-white/10 bg-slate-800/50 p-2 text-sm text-white placeholder-slate-500 [color-scheme:dark] focus:border-blue-500 focus:outline-none";
  const label = "mb-1 block text-xs uppercase text-slate-400";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => !saving && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="branch-expense-title" className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-lg border border-white/10 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <h3 id="branch-expense-title" className="text-lg font-bold text-white">{editing ? "Edit branch expense" : "Add branch expense"}</h3>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="p-1 text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className={label} htmlFor="be-branch">Branch <span className="normal-case text-red-400">*</span></label>
            <input id="be-branch" list="be-branches" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Pick or type a branch" className={input} />
            <datalist id="be-branches">{branchSuggestions.map((b) => <option key={b} value={b} />)}</datalist>
          </div>

          <div>
            <span className={label}>Category <span className="normal-case text-red-400">*</span></span>
            <div className="flex flex-wrap gap-1.5">
              {BRANCH_EXPENSE_CATEGORIES.map((c) => (
                <button key={c} type="button" onClick={() => setCategory(c)} aria-pressed={category === c} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${category === c ? CAT_TONE[c].on : CAT_TONE[c].off}`}>
                  {BRANCH_EXPENSE_LABEL[c]}
                </button>
              ))}
            </div>
            {category === "other" && (
              <input value={otherLabel} onChange={(e) => setOtherLabel(e.target.value)} placeholder="What is it? e.g. Pest control, Security, Water delivery" aria-label="What the Other expense is" className={`${input} mt-2`} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="be-amount">Amount ($) <span className="normal-case text-red-400">*</span></label>
              <input id="be-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={input} />
            </div>
            <div>
              <label className={label} htmlFor="be-date">Bill date <span className="normal-case text-red-400">*</span></label>
              <input id="be-date" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className={input} />
            </div>
          </div>

          <div>
            <label className={label} htmlFor="be-vendor">Vendor / provider</label>
            <input id="be-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. AT&T, Duke Energy, landlord's name" className={input} />
          </div>

          <div>
            <span className={label}>Billing period (optional)</span>
            <div className="grid grid-cols-2 gap-3">
              <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} aria-label="Billing period start" className={input} />
              <input type="date" value={periodEnd} min={periodStart || undefined} onChange={(e) => setPeriodEnd(e.target.value)} aria-label="Billing period end" className={input} />
            </div>
          </div>

          <div>
            <label className={label} htmlFor="be-notes">Notes</label>
            <textarea id="be-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Account number, meter, anything worth knowing" className={`${input} resize-none`} />
          </div>

          <div>
            <span className={label}>Bill / receipt files</span>
            {kept.length > 0 && (
              <ul className="mb-2 space-y-1">
                {kept.map((f) => (
                  <li key={f.url} className="flex items-center justify-between gap-2 rounded bg-slate-800/60 px-2 py-1 text-xs text-slate-300">
                    <span className="truncate">{f.name || "File"}</span>
                    <button type="button" onClick={() => { setKept((k) => k.filter((x) => x.url !== f.url)); setRemoved((r) => [...r, f]); }} className="text-red-300 hover:text-red-200">Remove</button>
                  </li>
                ))}
              </ul>
            )}
            <input type="file" multiple accept="image/*,application/pdf" onChange={(e) => setNewFiles(Array.from(e.target.files ?? []))} className="block w-full text-xs text-slate-300 file:mr-3 file:rounded file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-600" />
          </div>
        </div>

        {(err || problem) && <p className={`mt-3 text-xs ${err ? "text-red-300" : "text-slate-400"}`}>{err ?? problem}</p>}

        <div className="mt-5 flex gap-3">
          <button type="button" onClick={save} disabled={!!problem || saving} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {editing ? "Save changes" : "Add expense"}
          </button>
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-600">Cancel</button>
        </div>
      </div>
    </div>
  );
}
