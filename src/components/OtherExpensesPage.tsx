/**
 * Accounting → Expenses → Other Expenses: a branch's own costs, one row per
 * bill (migrations 0444 / 0445). The categories are Accounting's branch
 * sheet columns (lib/branchExpenses.ts): Lease … Operation, then Tech / US
 * Office / PH Office Payroll. Same look as the Flash Tech tab: date range,
 * category filter, summary cards (TOTAL, EXP TOTAL, Payroll Total), Spend by
 * branch (export = the sheet's columns), then the bills. Accounting, Admin
 * and Super Admin add, edit and delete.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, Paperclip, Pencil, Receipt, Trash2, TrendingUp, Users, Wallet, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { normalizeRole } from "@/lib/roleLabels";
import { localISODate, todayISO } from "@/lib/localDate";
import { LOCATIONS_DATA } from "@/lib/zipCoverage";
import { deleteExpenseReceiptFile, uploadExpenseReceipt } from "@/lib/firebase/storage";
import { ReceiptLightbox, isPdfReceipt } from "@/components/ReceiptLightbox";
import {
  ALL_BRANCH_EXPENSE_CATEGORIES,
  BRANCH_EXPENSE_CATEGORIES,
  BRANCH_EXPENSE_LABEL,
  LEGACY_BRANCH_EXPENSE_CATEGORIES,
  PAYROLL_CATEGORIES,
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

/** Each category's color — its bar segment and legend / pill dot. Sheet order. */
const CAT_COLOR: Record<BranchExpenseCategory, string> = {
  lease: "bg-sky-400",
  auto_insurance: "bg-indigo-400",
  internet: "bg-emerald-400",
  utility: "bg-amber-400",
  travel_lodging: "bg-violet-400",
  food: "bg-orange-400",
  rental_car: "bg-rose-400",
  gas: "bg-yellow-300",
  equipment_supplies: "bg-teal-400",
  operation: "bg-cyan-400",
  tech_payroll: "bg-fuchsia-400",
  us_office_payroll: "bg-pink-400",
  ph_office_payroll: "bg-lime-400",
  phone: "bg-red-400",
  other: "bg-slate-400",
};

/** The category filter: one category, every non-payroll expense, every payroll, or all. */
type CategoryFilter = BranchExpenseCategory | "all" | "expenses" | "payroll";
const matchesCategory = (c: BranchExpenseCategory, f: CategoryFilter) =>
  f === "all" ? true : f === "payroll" ? PAYROLL_CATEGORIES.has(c) : f === "expenses" ? !PAYROLL_CATEGORIES.has(c) : c === f;

const EXPENSE_CATS = BRANCH_EXPENSE_CATEGORIES.filter((c) => !PAYROLL_CATEGORIES.has(c));
const PAYROLL_CATS = BRANCH_EXPENSE_CATEGORIES.filter((c) => PAYROLL_CATEGORIES.has(c));

/** Summary card colors. */
const CARD_TONE = {
  violet: { chip: "bg-violet-500/15 text-violet-300", text: "text-white", bar: "bg-violet-400/70", border: "border-violet-500/20" },
  sky: { chip: "bg-sky-500/15 text-sky-300", text: "text-sky-300", bar: "bg-sky-400/70", border: "border-sky-500/20" },
  fuchsia: { chip: "bg-fuchsia-500/15 text-fuchsia-300", text: "text-fuchsia-300", bar: "bg-fuchsia-400/70", border: "border-fuchsia-500/20" },
  emerald: { chip: "bg-emerald-500/15 text-emerald-300", text: "text-emerald-300", bar: "bg-emerald-400/70", border: "border-emerald-500/20" },
} as const;

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
  const [category, setCategory] = useState<CategoryFilter>("all");
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
  const filtered = inRange.filter((e) => matchesCategory(e.category, category) && (!branch || e.branch === branch) && matchesSearch(e));

  /** Bills per category in the date range (and branch) — shown in the Category dropdown. */
  const catCounts = useMemo(() => {
    const c = new Map<CategoryFilter, number>();
    for (const e of inRange) {
      if (branch && e.branch !== branch) continue;
      for (const f of ["all", PAYROLL_CATEGORIES.has(e.category) ? "payroll" : "expenses", e.category] as CategoryFilter[]) c.set(f, (c.get(f) ?? 0) + 1);
    }
    return c;
  }, [inRange, branch]);
  /** Old Phone / Other bills, if any — only then offered in the filter and the report. */
  const legacyInUse = LEGACY_BRANCH_EXPENSE_CATEGORIES.filter((c) => (rows ?? []).some((e) => e.category === c));
  const reportCategories = [...BRANCH_EXPENSE_CATEGORIES, ...legacyInUse];

  // Spend by branch (same as Flash Tech's): everything in view except the branch choice itself —
  // the date range, the category filter and the search all apply.
  const report = useMemo(() => {
    const r = buildBranchReport(inRange.filter((e) => matchesCategory(e.category, category) && matchesSearch(e)));
    r.branches.sort((a, b) => (branchSort === "name" ? a.branch.localeCompare(b.branch) : b.total - a.total || a.branch.localeCompare(b.branch)));
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRange, category, search, branchSort]);
  const maxBranchSpend = report.branches.reduce((m, b) => Math.max(m, b.total), 0);

  const branchOptions = useMemo(() => Array.from(new Set((rows ?? []).map((e) => e.branch))).sort((a, b) => a.localeCompare(b)), [rows]);
  const sumOf = (list: BranchExpense[]) => list.reduce((s, e) => s + e.amount, 0);
  const payrollBills = filtered.filter((e) => PAYROLL_CATEGORIES.has(e.category));
  const expenseBills = filtered.filter((e) => !PAYROLL_CATEGORIES.has(e.category));
  const branchesInView = new Set(filtered.map((e) => e.branch)).size;

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

  // The branch sheet's columns: every category, then Payroll Total, EXP TOTAL, TOTAL.
  const exportReport = () =>
    downloadCsv(
      `branch-expense-report-${todayISO()}.csv`,
      ["Branch", ...reportCategories.map((c) => BRANCH_EXPENSE_LABEL[c]), "Payroll Total", "EXP TOTAL", "TOTAL", "Bills"],
      [...report.branches, report.total].map((b) => [
        b.branch,
        ...reportCategories.map((c) => b.byCategory[c].toFixed(2)),
        b.payrollTotal.toFixed(2),
        b.expenseTotal.toFixed(2),
        b.total.toFixed(2),
        b.count,
      ]),
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
      // Files added with "fill in every column" are shared by that branch's bills — only delete one nobody else uses.
      const usedElsewhere = new Set((rows ?? []).filter((x) => x.id !== e.id).flatMap((x) => x.receipts.map((r) => r.path)));
      for (const r of e.receipts) if (r.path && !usedElsewhere.has(r.path)) deleteExpenseReceiptFile(r.path).catch(() => undefined);
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

      {/* Category — the branch sheet's columns, grouped Expenses / Payroll */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Category</span>
        <div className="flex gap-1" role="group" aria-label="Expenses or payroll">
          {([["all", "All"], ["expenses", "Expenses"], ["payroll", "Payroll"]] as const).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setCategory(k)}
              aria-pressed={category === k}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${category === k ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-200 hover:bg-slate-700"}`}
            >
              {l} <span className="tabular-nums opacity-70">{catCounts.get(k) ?? 0}</span>
            </button>
          ))}
        </div>
        <select
          value={category === "all" || category === "expenses" || category === "payroll" ? "" : category}
          onChange={(e) => setCategory((e.target.value || "all") as CategoryFilter)}
          aria-label="One category"
          className="rounded-lg border border-white/10 bg-slate-800/50 px-2 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
        >
          <option value="">One category…</option>
          <optgroup label="Expenses">
            {[...EXPENSE_CATS, ...legacyInUse].map((c) => <option key={c} value={c}>{BRANCH_EXPENSE_LABEL[c]} ({catCounts.get(c) ?? 0})</option>)}
          </optgroup>
          <optgroup label="Payroll">
            {PAYROLL_CATS.map((c) => <option key={c} value={c}>{BRANCH_EXPENSE_LABEL[c]} ({catCounts.get(c) ?? 0})</option>)}
          </optgroup>
        </select>
      </div>

      {/* Summary cards — the sheet's TOTAL, EXP TOTAL and Payroll Total */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {([
          { key: "total", label: "Total", value: fmtMoney(sumOf(filtered)), sub: `${filtered.length} bill${filtered.length === 1 ? "" : "s"} · ${rangeLabel}`, Icon: Wallet, tone: CARD_TONE.violet },
          { key: "exp", label: "EXP Total", value: fmtMoney(sumOf(expenseBills)), sub: "Everything except payroll", Icon: Receipt, tone: CARD_TONE.sky },
          { key: "payroll", label: "Payroll Total", value: fmtMoney(sumOf(payrollBills)), sub: "Tech + US Office + PH Office", Icon: Users, tone: CARD_TONE.fuchsia },
          { key: "avg", label: "Per branch", value: fmtMoney(branchesInView ? sumOf(filtered) / branchesInView : 0), sub: `Average of ${branchesInView} branch${branchesInView === 1 ? "" : "es"}`, Icon: TrendingUp, tone: CARD_TONE.emerald },
        ]).map(({ key, label, value, sub, Icon, tone }) => (
          <div key={key} className={`relative overflow-hidden rounded-xl border bg-slate-900/60 p-4 ${tone.border}`}>
            <div className={`pointer-events-none absolute inset-x-0 top-0 h-0.5 ${tone.bar}`} />
            <div className="flex items-start gap-3">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.chip}`}><Icon className="h-4 w-4" /></span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                <p className={`mt-0.5 text-2xl font-bold tabular-nums ${tone.text}`}>{rows ? value : "…"}</p>
                <p className="mt-0.5 truncate text-xs text-slate-500" title={sub}>{sub}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Spend by branch — same design as Flash Tech's; each bar split by category color. Click one to filter to it. */}
      {rows && report.branches.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <p className="text-sm font-semibold text-white">Spend by branch</p>
              {/* Which color is which category */}
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                {/* Only the categories that have money in view, so the legend stays short. */}
                {ALL_BRANCH_EXPENSE_CATEGORIES.filter((c) => report.total.byCategory[c] > 0).map((c) => (
                  <span key={c} className="inline-flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${CAT_COLOR[c]}`} /> {BRANCH_EXPENSE_LABEL[c]}
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
              const breakdown = ALL_BRANCH_EXPENSE_CATEGORIES.filter((c) => b.byCategory[c] > 0).map((c) => `${BRANCH_EXPENSE_LABEL[c]}: ${fmtMoney(b.byCategory[c])}`).join("\n");
              return (
                <button
                  key={b.branch}
                  type="button"
                  onClick={() => setBranch(on ? "" : b.branch)}
                  aria-pressed={on}
                  title={`${b.branch}\n${breakdown}\n\nPayroll Total: ${fmtMoney(b.payrollTotal)}\nEXP TOTAL: ${fmtMoney(b.expenseTotal)}\nTOTAL: ${fmtMoney(b.total)} · ${b.count} bill${b.count === 1 ? "" : "s"}`}
                  className={`group grid grid-cols-[9rem_1fr_7.5rem] items-center gap-3 rounded-md px-2 py-1 text-left text-xs transition ${on ? "bg-blue-500/15 ring-1 ring-blue-500/40" : "hover:bg-white/5"}`}
                >
                  <span className={`truncate ${on ? "font-semibold text-white" : "text-slate-300"}`}>{b.branch}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-white/5">
                    {/* One bar, its length the branch's total; split into each category's share. */}
                    <span className="flex h-full" style={{ width: `${maxBranchSpend > 0 ? Math.max(2, (b.total / maxBranchSpend) * 100) : 2}%` }}>
                      {ALL_BRANCH_EXPENSE_CATEGORIES.filter((c) => b.byCategory[c] > 0).map((c) => (
                        <span key={c} className={`h-full ${CAT_COLOR[c]} ${on ? "opacity-100" : "opacity-80 group-hover:opacity-100"}`} style={{ width: `${b.total > 0 ? (b.byCategory[c] / b.total) * 100 : 0}%` }} />
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
                      <span className="inline-flex items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-medium text-slate-200">
                        <span className={`h-2 w-2 rounded-full ${CAT_COLOR[e.category]}`} />
                        {branchExpenseCategoryText(e)}
                      </span>
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
      {/* Add: every column for one branch at once (like a row of the sheet). Edit: one bill. */}
      {form && !form.editing && (
        <BranchSheetForm
          companyId={companyId}
          branchSuggestions={Array.from(new Set([...KNOWN_BRANCHES, ...branchOptions])).sort((a, b) => a.localeCompare(b))}
          defaultBranch={branch}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); load(); }}
        />
      )}
      {form?.editing && (
        <BranchExpenseForm
          editing={form.editing}
          companyId={companyId}
          branchSuggestions={Array.from(new Set([...KNOWN_BRANCHES, ...branchOptions])).sort((a, b) => a.localeCompare(b))}
          defaultCategory={category === "all" || category === "expenses" ? "lease" : category === "payroll" ? "tech_payroll" : category}
          defaultBranch={branch}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); load(); }}
        />
      )}
    </div>
  );
}

/**
 * "1,250.50" / "$1250" / "" → number (null when blank). Commas and a $ are
 * fine, so amounts can be typed the way they look on a bill.
 */
function parseAmount(raw: string | undefined): number | null {
  const v = (raw ?? "").replace(/[$,\s]/g, "");
  return v === "" ? null : Number(v);
}

/** Keep only what an amount can hold: digits, one dot, commas. */
const cleanAmount = (raw: string) => raw.replace(/[^\d.,]/g, "").replace(/(\..*)\./g, "$1");

/** Enter in an amount box jumps to the next one, like a spreadsheet. */
function nextAmountOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const boxes = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-amount-box]"));
  boxes[boxes.indexOf(e.currentTarget) + 1]?.focus();
}

/**
 * Add: one branch, every column of the sheet filled in at once — Lease …
 * Operation, then the three payrolls. Each line has its own amount, notes
 * and files; Payroll Total / EXP TOTAL / TOTAL add up as she types. Saves
 * one bill per amount entered (blank lines are skipped), all with the same
 * bill date and billing period.
 */
function BranchSheetForm({
  companyId,
  branchSuggestions,
  defaultBranch,
  onClose,
  onSaved,
}: {
  companyId: string | null;
  branchSuggestions: string[];
  defaultBranch: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [branch, setBranch] = useState(defaultBranch);
  const [expenseDate, setExpenseDate] = useState(todayISO());
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [amounts, setAmounts] = useState<Partial<Record<BranchExpenseCategory, string>>>({});
  const [lineNotes, setLineNotes] = useState<Partial<Record<BranchExpenseCategory, string>>>({});
  const [lineFiles, setLineFiles] = useState<Partial<Record<BranchExpenseCategory, File[]>>>({});
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const num = (c: BranchExpenseCategory) => parseAmount(amounts[c]);
  const entered = BRANCH_EXPENSE_CATEGORIES.filter((c) => num(c) != null);
  const bad = entered.find((c) => { const n = num(c)!; return !isFinite(n) || n < 0; });
  // Notes or files on a line with no amount — easy to miss, so it's flagged.
  const orphan = BRANCH_EXPENSE_CATEGORIES.find((c) => num(c) == null && ((lineNotes[c] ?? "").trim() || (lineFiles[c]?.length ?? 0) > 0));
  const sumCats = (cats: BranchExpenseCategory[]) => cats.reduce((s, c) => { const n = num(c); return s + (n != null && isFinite(n) ? n : 0); }, 0);
  const payrollTotal = sumCats(PAYROLL_CATS);
  const expTotal = sumCats(EXPENSE_CATS);

  const problem =
    !branch.trim() ? "Pick or type the branch."
    : !expenseDate ? "Pick the bill date."
    : entered.length === 0 ? "Fill in at least one line."
    : bad ? `${BRANCH_EXPENSE_LABEL[bad]}: enter a valid amount.`
    : orphan ? `${BRANCH_EXPENSE_LABEL[orphan]} has notes or files but no amount.`
    : periodStart && periodEnd && periodStart > periodEnd ? "The billing period ends before it starts."
    : null;

  const save = async () => {
    if (problem || saving) return;
    if (!companyId) { setErr("No company — sign in again."); return; }
    setErr(null);
    setSaving({ done: 0, total: entered.length });
    let done = 0;
    try {
      for (const c of entered) {
        const id = await addBranchExpense({
          branch, category: c, otherLabel: "", vendor: "", amount: num(c)!, expenseDate,
          periodStart: periodStart || null, periodEnd: periodEnd || null, notes: lineNotes[c] ?? "", receipts: [],
        });
        const files = lineFiles[c] ?? [];
        if (files.length) {
          const uploaded: BranchExpenseFile[] = [];
          for (const f of files) {
            const r = await uploadExpenseReceipt(companyId, `branch-${id}`, f);
            uploaded.push({ url: r.url, path: r.fullPath, name: f.name });
          }
          await setBranchExpenseReceipts(id, uploaded);
        }
        done++;
        setSaving({ done, total: entered.length });
      }
      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(done ? `Saved ${done} of ${entered.length}, then: ${msg}. Close and check the list before saving again.` : msg);
      setSaving(null);
    }
  };

  const input = "w-full rounded-lg border border-white/10 bg-slate-800/50 p-2 text-sm text-white placeholder-slate-500 [color-scheme:dark] focus:border-blue-500 focus:outline-none";
  const label = "mb-1 block text-xs uppercase text-slate-400";
  const cell = "rounded-md border border-white/10 bg-slate-800/50 py-1.5 text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none";

  // A render call, not a component — a component declared in here would lose focus on every keystroke.
  const line = (c: BranchExpenseCategory) => {
    const files = lineFiles[c] ?? [];
    return (
      <div key={c} className="grid grid-cols-[12rem_8.5rem_1fr_auto] items-center gap-2 px-1 py-1">
        <span className="flex items-center gap-2 text-xs text-slate-200">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${CAT_COLOR[c]}`} aria-hidden />
          {BRANCH_EXPENSE_LABEL[c]}
        </span>
        <span className="relative">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">$</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            data-amount-box
            value={amounts[c] ?? ""}
            onChange={(e) => setAmounts((prev) => ({ ...prev, [c]: cleanAmount(e.target.value) }))}
            onKeyDown={nextAmountOnEnter}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="0.00"
            aria-label={`${BRANCH_EXPENSE_LABEL[c]} amount`}
            className={`${cell} w-full pl-5 pr-2 text-right tabular-nums`}
          />
        </span>
        <input
          type="text"
          value={lineNotes[c] ?? ""}
          onChange={(e) => setLineNotes((prev) => ({ ...prev, [c]: e.target.value }))}
          placeholder="Notes"
          aria-label={`${BRANCH_EXPENSE_LABEL[c]} notes`}
          className={`${cell} w-full px-2`}
        />
        <span className="flex items-center gap-1">
          <label
            className={`inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold transition ${files.length ? "bg-blue-500/20 text-blue-200 hover:bg-blue-500/30" : "bg-slate-700 text-slate-200 hover:bg-slate-600"}`}
            title={files.length ? files.map((f) => f.name).join("\n") : `Attach a bill or receipt to ${BRANCH_EXPENSE_LABEL[c]}`}
          >
            <Paperclip className="h-3.5 w-3.5" />
            {files.length ? files.length : "Attach"}
            <input
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="sr-only"
              aria-label={`${BRANCH_EXPENSE_LABEL[c]} files`}
              onChange={(e) => { const picked = Array.from(e.target.files ?? []); setLineFiles((prev) => ({ ...prev, [c]: [...(prev[c] ?? []), ...picked] })); e.target.value = ""; }}
            />
          </label>
          {files.length > 0 && (
            <button type="button" onClick={() => setLineFiles((prev) => ({ ...prev, [c]: [] }))} aria-label={`Remove ${BRANCH_EXPENSE_LABEL[c]} files`} title="Remove these files" className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => !saving && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="branch-sheet-title" className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-white/10 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 id="branch-sheet-title" className="text-lg font-bold text-white">Add branch expenses</h3>
            <p className="text-xs text-slate-400">Fill in every line for the branch at once — each with its own notes and files. Leave a line blank if there's nothing for it. Enter jumps to the next amount.</p>
          </div>
          <button type="button" onClick={onClose} disabled={!!saving} aria-label="Close" className="p-1 text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={label} htmlFor="bs-branch">Branch <span className="normal-case text-red-400">*</span></label>
            <input id="bs-branch" list="bs-branches" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Pick or type a branch" className={input} />
            <datalist id="bs-branches">{branchSuggestions.map((b) => <option key={b} value={b} />)}</datalist>
          </div>
          <div>
            <label className={label} htmlFor="bs-date">Bill date <span className="normal-case text-red-400">*</span></label>
            <input id="bs-date" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className={input} />
          </div>
          <div>
            <span className={label}>Billing period (optional)</span>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} aria-label="Billing period start" className={input} />
              <input type="date" value={periodEnd} min={periodStart || undefined} onChange={(e) => setPeriodEnd(e.target.value)} aria-label="Billing period end" className={input} />
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-[12rem_8.5rem_1fr_auto] gap-2 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <span>Expenses</span><span className="text-right">Amount</span><span>Notes</span><span className="w-[4.5rem]">Files</span>
            </div>
            {EXPENSE_CATS.map(line)}
            <div className="mt-2 border-t border-white/10 px-1 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Payroll</div>
            {PAYROLL_CATS.map(line)}
          </div>
        </div>

        {/* The sheet's three totals, adding up as she types */}
        <div className="mt-3 flex flex-wrap justify-end gap-x-6 gap-y-1 rounded-lg border border-white/10 bg-slate-800/40 px-4 py-2 text-sm tabular-nums">
          <span className="text-slate-300">Payroll Total <span className="ml-1 font-semibold text-white">{fmtMoney(payrollTotal)}</span></span>
          <span className="text-slate-300">EXP TOTAL <span className="ml-1 font-semibold text-white">{fmtMoney(expTotal)}</span></span>
          <span className="text-slate-300">TOTAL <span className="ml-1 font-bold text-white">{fmtMoney(payrollTotal + expTotal)}</span></span>
        </div>

        {(err || problem) && <p className={`mt-3 text-xs ${err ? "text-red-300" : "text-slate-400"}`}>{err ?? problem}</p>}

        <div className="mt-5 flex gap-3">
          <button type="button" onClick={save} disabled={!!problem || !!saving} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving {saving.done} of {saving.total}…</> : entered.length ? `Save ${entered.length} line${entered.length === 1 ? "" : "s"}` : "Save"}
          </button>
          <button type="button" onClick={onClose} disabled={!!saving} className="flex-1 rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-600">Cancel</button>
        </div>
      </div>
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

  const amountNum = parseAmount(amount) ?? NaN;
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
            <label className={label} htmlFor="be-category">Category <span className="normal-case text-red-400">*</span></label>
            {/* The branch sheet's columns, in its order. */}
            <div className="flex items-center gap-2">
              <span className={`h-3 w-3 shrink-0 rounded-full ${CAT_COLOR[category]}`} aria-hidden />
              <select id="be-category" value={category} onChange={(e) => setCategory(e.target.value as BranchExpenseCategory)} className={input}>
                <optgroup label="Expenses">
                  {EXPENSE_CATS.map((c) => <option key={c} value={c}>{BRANCH_EXPENSE_LABEL[c]}</option>)}
                </optgroup>
                <optgroup label="Payroll">
                  {PAYROLL_CATS.map((c) => <option key={c} value={c}>{BRANCH_EXPENSE_LABEL[c]}</option>)}
                </optgroup>
                {/* A bill saved under an old category keeps it until changed. */}
                {editing && LEGACY_BRANCH_EXPENSE_CATEGORIES.includes(editing.category) && (
                  <optgroup label="Old category">
                    <option value={editing.category}>{BRANCH_EXPENSE_LABEL[editing.category]}</option>
                  </optgroup>
                )}
              </select>
            </div>
            {category === "other" && (
              <input value={otherLabel} onChange={(e) => setOtherLabel(e.target.value)} placeholder="What is it? e.g. Pest control, Security, Water delivery" aria-label="What the Other expense is" className={`${input} mt-2`} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="be-amount">Amount ($) <span className="normal-case text-red-400">*</span></label>
              <input id="be-amount" type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(cleanAmount(e.target.value))} onFocus={(e) => e.currentTarget.select()} placeholder="0.00" className={input} />
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
