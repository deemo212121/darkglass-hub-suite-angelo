/**
 * Accounting → Expenses → Other Expenses: a branch's own costs, one row per
 * bill (migrations 0444 / 0445). The categories are Accounting's branch
 * sheet columns (lib/branchExpenses.ts): Lease … Operation, then Tech / US
 * Office / PH Office Payroll. Same look as the Flash Tech tab: date range,
 * category filter, summary cards (TOTAL, EXP TOTAL, Payroll Total), Spend by
 * branch (export = the sheet's columns), then the bills. Accounting, Admin
 * and Super Admin add, edit and delete.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RefreshCw, Download, FileSpreadsheet, Loader2, Paperclip, Pencil, Receipt, Trash2, TrendingUp, Users, Wallet, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { normalizeRole } from "@/lib/roleLabels";
import { addDaysISO, localISODate, todayISO } from "@/lib/localDate";
import { payPeriodContaining } from "@/lib/payPeriods";
import { LOCATIONS_DATA } from "@/lib/zipCoverage";
import { deleteExpenseReceiptFile, uploadExpenseReceipt } from "@/lib/firebase/storage";
import { ReceiptLightbox, isPdfReceipt } from "@/components/ReceiptLightbox";
import { CarIqImportModal } from "@/components/CarIqImportModal";
import { ExpenseRecordsSyncModal } from "@/components/ExpenseRecordsSyncModal";
import { TicketColumnFilter } from "@/components/TicketColumnFilter";
import { DateModeBar } from "@/components/DateModeBar";
import { getCompanyExpenses } from "@/lib/supabase/expenses";
import { getCompanyUsers } from "@/lib/supabase/users";
import { PAYROLL_FILL_CATEGORIES, buildPayrollFill, payrollBillLine, payrollNote } from "@/lib/branchPayroll";
import { getPayrollPays } from "@/lib/supabase/branchPayroll";
import type { ProfileRow } from "@/lib/supabase/users";
import { AUTO_FILL_CATEGORIES, autoFillNote, buildAutoFill, toBillLine, usedRecordIds, type AutoFillLine, type AutoFillRecord } from "@/lib/branchAutoFill";
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
  type BranchExpenseLine,
} from "@/lib/branchExpenses";
import {
  addBranchExpense,
  deleteBranchExpense,
  deleteBranchExpenses,
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
  cariq_transactions: "bg-blue-400",
  cariq_mileage: "bg-sky-200",
  non_cariq_mileage: "bg-purple-300",
  gas: "bg-yellow-300",
  equipment_supplies: "bg-teal-400",
  field_equipment: "bg-green-300",
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

/** Sortable columns in a bill's transaction list. */
type TxSortKey = "date" | "driver" | "vehicle" | "service" | "merchant" | "address" | "amount";
const TX_SORT: Record<TxSortKey, (a: BranchExpenseLine, b: BranchExpenseLine) => number> = {
  date: (a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
  driver: (a, b) => a.driver.localeCompare(b.driver),
  vehicle: (a, b) => (a.vehicle || "").localeCompare(b.vehicle || ""),
  service: (a, b) => (a.service || "").localeCompare(b.service || ""),
  merchant: (a, b) => (a.merchant || "").localeCompare(b.merchant || ""),
  address: (a, b) => (a.address || "").localeCompare(b.address || ""),
  amount: (a, b) => (Number(a.amount) || 0) - (Number(b.amount) || 0),
};

const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDay = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** "2026-11" for a date. */
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
/** "2026-11" → first and last day. */
function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  return { from: localISODate(new Date(y, m - 1, 1)), to: localISODate(new Date(y, m, 0)) };
}
/** "2026-11" + 1 → "2026-12". */
function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + n, 1));
}
/** "2026-11" → "November 2026". */
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};
/** The month when [from, to] is exactly one whole month, else null. */
function monthOfRange(from: string, to: string): string | null {
  if (!from || !to) return null;
  const ym = from.slice(0, 7);
  const b = monthBounds(ym);
  return b.from === from && b.to === to ? ym : null;
}

/** A picture (shown as a thumbnail) — Firebase download links keep the file name before "?". */
const isImageFile = (url: string) => /.(png|jpe?g|gif|webp|bmp|heic)$/i.test(decodeURIComponent(url.split("?")[0]));

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
  // "Delete all" — Super Admin only.
  const isSuperAdmin = [role, ...(extraRoles ?? [])].some((r) => r && ["SUPERADMIN", "SUPERSUPERADMIN"].includes(normalizeRole(r)));

  const [rows, setRows] = useState<BranchExpense[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Opens on this month — the branch sheet is one block per month.
  const [dateFrom, setDateFrom] = useState(() => monthBounds(monthKey(new Date())).from);
  const [dateTo, setDateTo] = useState(() => monthBounds(monthKey(new Date())).to);
  /** "Custom dates" — the From / To boxes instead of the month picker. */
  const [customDates, setCustomDates] = useState(false);
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [branch, setBranch] = useState("");
  const [search, setSearch] = useState("");
  /** Spend by branch order: biggest spend first, or A → Z (same as Flash Tech). */
  const [branchSort, setBranchSort] = useState<"amount" | "name">("amount");
  const [form, setForm] = useState<{ editing: BranchExpense | null } | null>(null);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  /** Branch Bills funnel filters: column key → picked values. */
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const [preview, setPreview] = useState<{ url: string; urls: string[] } | null>(null);
  /** Bills opened to show their transactions (click the branch). */
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const toggleOpen = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  /** Per opened bill: the driver chip picked (shows only their transactions) and the column sort. */
  const [txView, setTxView] = useState<Record<string, { driver: string | null; sort: TxSortKey; dir: "asc" | "desc" }>>({});
  const viewOf = (id: string) => txView[id] ?? { driver: null, sort: "date" as TxSortKey, dir: "asc" as const };
  const setView = (id: string, patch: Partial<{ driver: string | null; sort: TxSortKey; dir: "asc" | "desc" }>) =>
    setTxView((prev) => ({ ...prev, [id]: { ...viewOf(id), ...patch } }));

  /** A bill's transactions, one per line — so the branch total can be checked swipe by swipe. */
  const renderTransactions = (e: BranchExpense) => {
    const all = e.lineItems;
    const view = viewOf(e.id);
    const picked = view.driver;
    const lines = (picked ? all.filter((l) => l.driver === picked) : all).slice().sort((a, b) => {
      const by = TX_SORT[view.sort](a, b) || `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);
      return view.dir === "asc" ? by : -by;
    });
    const sum = Math.round(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0) * 100) / 100;
    const allSum = Math.round(all.reduce((s, l) => s + (Number(l.amount) || 0), 0) * 100) / 100;
    const sortHead = (key: TxSortKey, label: string, cls = "px-2") => (
      <th className={`${cls} py-1.5`}>
        <button
          type="button"
          onClick={() => setView(e.id, { sort: key, dir: view.sort === key && view.dir === "asc" ? "desc" : "asc" })}
          className={`inline-flex items-center gap-0.5 uppercase hover:text-slate-200 ${view.sort === key ? "text-blue-300" : ""}`}
        >
          {label}
          {view.sort === key && (view.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
        </button>
      </th>
    );
    const byDriver = new Map<string, { total: number; count: number }>();
    for (const l of all) {
      const d = byDriver.get(l.driver) ?? { total: 0, count: 0 };
      d.total += Number(l.amount) || 0;
      d.count++;
      byDriver.set(l.driver, d);
    }
    const drivers = Array.from(byDriver, ([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total);
    // Car IQ swipes vs Expense Records pulled by Auto-fill — same table, fitting headings; empty columns hidden.
    const fromRecords = all.some((l) => l.sourceId);
    const showTime = all.some((l) => l.time);
    const showVehicle = all.some((l) => l.vehicle);
    const word = fromRecords ? "record" : "transaction";
    return (
      <div className="rounded-md border border-white/10 bg-slate-900/70">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
          <span className="text-xs font-semibold text-white">{e.branch} · {all.length} {word}{all.length === 1 ? "" : "s"}{fromRecords ? " from Expense Records" : ""}</span>
          <span className="text-[11px] text-slate-400">by {fromRecords ? "employee" : "driver"}:</span>
          {drivers.map((d) => {
            const on = picked === d.name;
            return (
              <button
                key={d.name}
                type="button"
                onClick={() => setView(e.id, { driver: on ? null : d.name })}
                aria-pressed={on}
                title={on ? "Show everyone" : `Show only ${d.name}`}
                className={`rounded border px-1.5 py-0.5 text-[11px] transition ${on ? "border-blue-400 bg-blue-500/20 text-white" : "border-white/10 bg-white/5 text-slate-200 hover:border-blue-400/60 hover:bg-white/10"}`}
              >
                {d.name} <span className="font-mono text-slate-300">{fmtMoney(d.total)}</span> <span className="text-slate-500">({d.count})</span>
              </button>
            );
          })}
          {picked && (
            <button type="button" onClick={() => setView(e.id, { driver: null })} className="text-[11px] font-semibold text-blue-300 hover:underline">
              Show all
            </button>
          )}
        </div>
        <div className="max-h-[360px] overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-slate-900">
              <tr className="text-left text-[10px] font-semibold uppercase text-slate-500">
                <th className="px-3 py-1.5">#</th>
                {sortHead("date", "Date")}
                {showTime && <th className="px-2 py-1.5">Time</th>}
                {sortHead("driver", fromRecords ? "Employee" : "Driver")}
                {showVehicle && sortHead("vehicle", "Vehicle")}
                {sortHead("service", "Type")}
                {sortHead("merchant", fromRecords ? "Description" : "Station")}
                {sortHead("address", fromRecords ? "Where / dates" : "Address")}
                {sortHead("amount", "Amount", "px-3 text-right")}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-3 py-1 tabular-nums text-slate-500">{i + 1}</td>
                  <td className="whitespace-nowrap px-2 py-1 tabular-nums text-slate-300">{fmtDay(l.date) || "—"}</td>
                  {showTime && <td className="whitespace-nowrap px-2 py-1 tabular-nums text-slate-400">{l.time || "—"}</td>}
                  <td className="whitespace-nowrap px-2 py-1 font-medium text-slate-200">{l.driver}</td>
                  {showVehicle && <td className="max-w-[200px] truncate px-2 py-1 text-slate-400" title={l.vehicle}>{l.vehicle || "—"}</td>}
                  <td className="whitespace-nowrap px-2 py-1 text-slate-400">{l.service || "—"}</td>
                  <td className="max-w-[180px] truncate px-2 py-1 text-slate-300" title={l.merchant}>{l.merchant || "—"}</td>
                  <td className="max-w-[260px] truncate px-2 py-1 text-slate-400" title={l.address}>{l.address || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-1 text-right font-mono text-emerald-300">{fmtMoney(Number(l.amount) || 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-slate-900">
              <tr className="border-t border-white/10">
                <td colSpan={6 + (showTime ? 1 : 0) + (showVehicle ? 1 : 0)} className="px-3 py-1.5 text-right text-[11px] font-semibold text-slate-300">
                  {picked ? `${picked}: ${lines.length} of ${all.length} ${word}s` : `Total of ${lines.length} ${word}${lines.length === 1 ? "" : "s"}`}
                  {!picked && Math.abs(allSum - e.amount) >= 0.01 && <span className="ml-2 font-normal text-amber-300">(bill amount is {fmtMoney(e.amount)} — it was changed by hand)</span>}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-xs font-bold text-emerald-400">{fmtMoney(sum)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  };

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
  // Funnel filter on each Branch Bills column (same as the Flash Tech list): column → picked values; empty = no filter.
  const COLUMNS: { key: string; label: string; value: (e: BranchExpense) => string; right?: boolean }[] = [
    { key: "month", label: "Month", value: (e) => monthLabel(e.expenseDate.slice(0, 7)) },
    { key: "branch", label: "Branch", value: (e) => e.branch },
    { key: "category", label: "Category", value: (e) => branchExpenseCategoryText(e) },
    { key: "vendor", label: "Vendor / provider", value: (e) => e.vendor || "—" },
    { key: "account", label: "Account #", value: (e) => e.accountNumber || "—" },
    { key: "period", label: "Billing period", value: (e) => (e.periodStart || e.periodEnd ? `${fmtDay(e.periodStart) || "…"} – ${fmtDay(e.periodEnd) || "…"}` : "—") },
    { key: "amount", label: "Amount", value: (e) => fmtMoney(e.amount), right: true },
    { key: "notes", label: "Notes", value: (e) => (e.notes ? "Has notes" : "No notes") },
    { key: "files", label: "Bill / receipt", value: (e) => (e.receipts.length ? "Has a file" : "No file") },
    { key: "addedBy", label: "Added by", value: (e) => e.createdByName || "—" },
  ];
  const matchesColumns = (e: BranchExpense, skipKey?: string) =>
    COLUMNS.every((c) => c.key === skipKey || !colFilters[c.key]?.size || colFilters[c.key].has(c.value(e)));
  const anyColumnFilter = Object.values(colFilters).some((v) => v.size > 0);

  const filtered = inRange.filter((e) => matchesCategory(e.category, category) && (!branch || e.branch === branch) && matchesSearch(e) && matchesColumns(e));

  /** A column's funnel choices: its values among the bills every OTHER filter leaves. */
  const columnOptions = (key: string) => {
    const col = COLUMNS.find((c) => c.key === key)!;
    const pool = inRange.filter((e) => matchesCategory(e.category, category) && (!branch || e.branch === branch) && matchesSearch(e) && matchesColumns(e, key));
    const values = Array.from(new Set(pool.map(col.value)));
    if (key === "amount") return values.sort((a, b) => Number(a.replace(/[$,]/g, "")) - Number(b.replace(/[$,]/g, "")));
    if (key === "month") return values.sort((a, b) => Date.parse(`1 ${b}`) - Date.parse(`1 ${a}`));
    return values.sort((a, b) => a.localeCompare(b));
  };

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
    const r = buildBranchReport(inRange.filter((e) => matchesCategory(e.category, category) && matchesSearch(e) && matchesColumns(e, "branch")));
    r.branches.sort((a, b) => (branchSort === "name" ? a.branch.localeCompare(b.branch) : b.total - a.total || a.branch.localeCompare(b.branch)));
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRange, category, search, branchSort, colFilters]);
  const maxBranchSpend = report.branches.reduce((m, b) => Math.max(m, b.total), 0);

  const branchOptions = useMemo(() => Array.from(new Set((rows ?? []).map((e) => e.branch))).sort((a, b) => a.localeCompare(b)), [rows]);
  const sumOf = (list: BranchExpense[]) => list.reduce((s, e) => s + e.amount, 0);
  const payrollBills = filtered.filter((e) => PAYROLL_CATEGORIES.has(e.category));
  const expenseBills = filtered.filter((e) => !PAYROLL_CATEGORIES.has(e.category));
  const branchesInView = new Set(filtered.map((e) => e.branch)).size;

  const fmtRange = (d: string) => fmtDay(d);
  /** The month in view ("2026-11") when the range is exactly one month, like a block of the branch sheet. */
  const viewMonth = monthOfRange(dateFrom, dateTo);
  const rangeLabel = viewMonth
    ? monthLabel(viewMonth)
    : dateFrom && dateTo ? `${fmtRange(dateFrom)} – ${fmtRange(dateTo)}` : dateFrom ? `From ${fmtRange(dateFrom)}` : dateTo ? `Until ${fmtRange(dateTo)}` : "All dates";
  const setMonth = (ym: string) => {
    const b = monthBounds(ym);
    setDateFrom(b.from);
    setDateTo(b.to);
    setCustomDates(false);
  };
  const setPreset = (p: "thisYear" | "all") => {
    setCustomDates(false);
    if (p === "all") { setDateFrom(""); setDateTo(""); return; }
    const y = new Date().getFullYear();
    setDateFrom(`${y}-01-01`);
    setDateTo(`${y}-12-31`);
  };
  /** Months to pick from: the first month with a bill (or a year back) through next month, newest first. */
  const monthOptions = useMemo(() => {
    const now = monthKey(new Date());
    const earliest = (rows ?? []).reduce((m, e) => (e.expenseDate.slice(0, 7) < m ? e.expenseDate.slice(0, 7) : m), shiftMonth(now, -12));
    const out: string[] = [];
    for (let m = shiftMonth(now, 1); m >= earliest; m = shiftMonth(m, -1)) out.push(m);
    if (viewMonth && !out.includes(viewMonth)) out.push(viewMonth);
    return out.sort().reverse();
  }, [rows, viewMonth]);

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
      ["Month", "Branch", "Category", "Vendor", "Account #", "Billing period", "Amount", "Notes", "Files", "Added by"],
      filtered.map((e) => [
        monthLabel(e.expenseDate.slice(0, 7)),
        e.branch,
        branchExpenseCategoryText(e),
        e.vendor,
        e.accountNumber,
        e.periodStart || e.periodEnd ? `${e.periodStart ?? ""} – ${e.periodEnd ?? ""}` : "",
        e.amount.toFixed(2),
        e.notes,
        e.receipts.length,
        e.createdByName ?? "",
      ]),
    );

  /** Super Admin: delete every bill in view (this month / filters), after typing DELETE. */
  const handleDeleteAll = async () => {
    if (!filtered.length) return;
    const total = filtered.reduce((sum, e) => sum + e.amount, 0);
    const typed = prompt(
      `Delete all ${filtered.length} bill${filtered.length === 1 ? "" : "s"} shown (${rangeLabel}${branch ? ` · ${branch}` : ""}, ${fmtMoney(total)})?\n\nThis cannot be undone. Type DELETE to confirm.`,
    );
    if ((typed ?? "").trim().toUpperCase() !== "DELETE") return;
    setDeletingAll(true);
    try {
      const ids = new Set(filtered.map((e) => e.id));
      await deleteBranchExpenses([...ids]);
      // Remove their files unless a bill that's staying still uses them.
      const stillUsed = new Set((rows ?? []).filter((x) => !ids.has(x.id)).flatMap((x) => x.receipts.map((r) => r.path)));
      const paths = new Set(filtered.flatMap((e) => e.receipts.map((r) => r.path)).filter((p) => p && !stillUsed.has(p)));
      for (const p of paths) deleteExpenseReceiptFile(p).catch(() => undefined);
      load();
    } catch (err) {
      alert(`Couldn't delete: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingAll(false);
    }
  };

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
    return <p className="rounded-lg border border-white/10 bg-slate-900/50 p-6 text-sm text-slate-400">Overall Expenses is for Accounting, Admin and Super Admin.</p>;
  }

  return (
    <div className="space-y-6">
      {/* Pay period | Monthly | Date picker — the same bar as the other Expenses tabs. */}
      <div className="space-y-1">
        <DateModeBar from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
        {!viewMonth && (dateFrom || dateTo) && (
          <p className="px-1 text-[11px] text-slate-500">Bills are saved by month — showing every month this range touches ({rangeLabel}).</p>
        )}
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
          {anyColumnFilter && (
            <button type="button" onClick={() => setColFilters({})} className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700">
              Clear column filters
            </button>
          )}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={exportBills} className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            <Download className="h-4 w-4" /> Export CSV
          </button>
          {/* Everything already in Expense Records → saved bills (back job included), one click */}
          <button type="button" onClick={() => setSyncing(true)} disabled={!rows} title="Save Hotel, Food, Car Rental, Gas and Supplies records from Expense Records into Branch Bills" className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
            <RefreshCw className="h-4 w-4" /> Sync Expense Records
          </button>
          {/* Car IQ's transaction report → CarIQ Transactions per branch */}
          <button type="button" onClick={() => setImporting(true)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-600">
            <FileSpreadsheet className="h-4 w-4" /> Import Car IQ
          </button>
          {isSuperAdmin && (
            <button
              type="button"
              onClick={handleDeleteAll}
              disabled={deletingAll || filtered.length === 0}
              title="Super Admin only — deletes every bill shown (this month and filters)"
              className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deletingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete all ({filtered.length})
            </button>
          )}
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
              {COLUMNS.map((c) => (
                <th key={c.key} className={`whitespace-nowrap px-2 py-2 ${c.right ? "text-right" : ""}`}>
                  <span className={`inline-flex items-center ${c.right ? "justify-end" : ""}`}>
                    {c.label}
                    <TicketColumnFilter
                      options={columnOptions(c.key)}
                      selected={colFilters[c.key] ?? new Set()}
                      onChange={(next) => setColFilters((prev) => ({ ...prev, [c.key]: next }))}
                      label={`Filter by ${c.label}`}
                    />
                  </span>
                </th>
              ))}
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!rows ? (
              <tr><td colSpan={COLUMNS.length + 1} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={COLUMNS.length + 1} className="px-3 py-8 text-center text-slate-400">{rows.length === 0 ? "No branch bills yet — press + Add Expense to record the first one." : "No bills match these filters."}</td></tr>
            ) : (
              filtered.map((e) => {
                const urls = e.receipts.map((r) => r.url);
                const lines = e.lineItems;
                const open = lines.length > 0 && openIds.has(e.id);
                return (
                  <Fragment key={e.id}>
                  <tr className={`border-b border-white/5 transition hover:bg-white/5 ${open ? "bg-white/5" : ""}`}>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-300">{monthLabel(e.expenseDate.slice(0, 7))}</td>
                    <td className="whitespace-nowrap px-2 py-2 font-medium text-white">
                      {lines.length ? (
                        <button
                          type="button"
                          onClick={() => toggleOpen(e.id)}
                          aria-expanded={open}
                          title={open ? "Hide transactions" : "Show every transaction"}
                          className="group inline-flex items-center gap-1 rounded text-left hover:text-blue-300"
                        >
                          {open ? <ChevronDown className="h-3.5 w-3.5 text-blue-300" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500 group-hover:text-blue-300" />}
                          <span>{e.branch}</span>
                          <span className="ml-1 rounded bg-blue-500/15 px-1.5 py-px text-[10px] font-semibold text-blue-300">{lines.length} {lines.some((l) => l.sourceId) ? "record" : "txn"}{lines.length === 1 ? "" : "s"}</span>
                        </button>
                      ) : e.branch}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">
                      <span className="inline-flex items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-medium text-slate-200">
                        <span className={`h-2 w-2 rounded-full ${CAT_COLOR[e.category]}`} />
                        {branchExpenseCategoryText(e)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-300">{e.vendor || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-2 font-mono text-xs text-slate-300">{e.accountNumber || <span className="font-sans text-slate-600">—</span>}</td>
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-400">{e.periodStart || e.periodEnd ? `${fmtDay(e.periodStart) || "…"} – ${fmtDay(e.periodEnd) || "…"}` : "—"}</td>
                    <td className="px-2 py-2 text-right font-mono text-emerald-300">{fmtMoney(e.amount)}</td>
                    <td className="max-w-[260px] truncate px-2 py-2 text-slate-400" title={e.notes}>{e.notes || "—"}</td>
                    <td className="px-2 py-2">
                      {urls.length === 0 ? <span className="text-slate-600">—</span> : (
                        <div className="flex items-center gap-1">
                          {urls.slice(0, 2).map((url) => (
                            <button
                              key={url}
                              type="button"
                              // Pictures and PDFs open in the viewer; anything else (the Car IQ .xlsx) downloads.
                              onClick={() => (isImageFile(url) || isPdfReceipt(url) ? setPreview({ url, urls: urls.filter((u) => isImageFile(u) || isPdfReceipt(u)) }) : window.open(url, "_blank", "noopener"))}
                              title={e.receipts.find((r) => r.url === url)?.name || "View"}
                              className="block h-8 w-8 overflow-hidden rounded border border-white/10 bg-slate-800 hover:border-blue-500"
                            >
                              {isImageFile(url) ? <img src={url} alt="Bill" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-slate-400">{/\.xlsx?(\?|$)/i.test(url.split("?")[0]) ? <FileSpreadsheet className="h-4 w-4 text-emerald-300" /> : <Paperclip className="h-4 w-4" />}</span>}
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
                  {open && (
                    <tr className="border-b border-white/10 bg-slate-950/60">
                      <td colSpan={COLUMNS.length + 1} className="px-3 pb-4 pt-2">{renderTransactions(e)}</td>
                    </tr>
                  )}
                  </Fragment>
                );
              })
            )}
          </tbody>
          {rows && filtered.length > 0 && (() => {
            const total = Math.round(filtered.reduce((s, e) => s + e.amount, 0) * 100) / 100;
            const txns = filtered.reduce((s, e) => s + e.lineItems.length, 0);
            return (
              <tfoot>
                <tr className="border-t-2 border-white/20 bg-white/5">
                  <td colSpan={COLUMNS.findIndex((c) => c.key === "amount")} className="whitespace-nowrap px-2 py-2.5 text-right text-xs font-semibold uppercase text-slate-300">
                    Total · {filtered.length} bill{filtered.length === 1 ? "" : "s"}
                    {txns > 0 && <span className="normal-case text-slate-400"> · {txns} txn{txns === 1 ? "" : "s"}</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono text-sm font-bold text-emerald-400">{fmtMoney(total)}</td>
                  <td colSpan={COLUMNS.length - COLUMNS.findIndex((c) => c.key === "amount")} />
                </tr>
              </tfoot>
            );
          })()}
        </table>
      </div>

      {preview && <ReceiptLightbox url={preview.url} urls={preview.urls} onClose={() => setPreview(null)} />}
      {syncing && rows && (
        <ExpenseRecordsSyncModal
          existing={rows}
          knownBranches={KNOWN_BRANCHES}
          onClose={() => setSyncing(false)}
          onSaved={() => { setSyncing(false); load(); }}
        />
      )}
      {importing && (
        <CarIqImportModal
          companyId={companyId}
          existing={rows ?? []}
          branchSuggestions={Array.from(new Set([...KNOWN_BRANCHES, ...branchOptions])).sort((a, b) => a.localeCompare(b))}
          onClose={() => setImporting(false)}
          onSaved={() => { setImporting(false); load(); }}
        />
      )}
      {/* Add: every column for one branch at once (like a row of the sheet). Edit: one bill. */}
      {form && !form.editing && (
        <BranchSheetForm
          companyId={companyId}
          existing={rows ?? []}
          defaultMonth={viewMonth ?? monthKey(new Date())}
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

/** Lines that can hold several bills a month, each with its own provider / vendor (one shared list, from past bills). */
const PROVIDER_CATS = new Set<BranchExpenseCategory>(["internet", "utility", "equipment_supplies", "field_equipment", "operation"]);
/** Lines with more than one row: the provider lines and the three payrolls (one row per pay period, or one for the month). */
const MULTI_CATS = new Set<BranchExpenseCategory>([...PROVIDER_CATS, ...PAYROLL_CATEGORIES]);
const providerWord = (c: BranchExpenseCategory) => (c === "internet" || c === "utility" ? "provider" : "vendor");
/** Operation's kinds — job posting / ads / shipping go to the branch picked above (the assigned branch). */
const OPERATION_TYPES = ["Job posting", "Ads", "Shipping", "Other"];
/** Vendors the app fills in itself — not offered as providers. */
const SYSTEM_VENDORS = new Set(["AHS Expense Records", "Car IQ"]);

/** Pay periods that touch a month ("2026-11"), oldest first. */
function payPeriodsInMonth(ym: string): { start: string; end: string }[] {
  const b = monthBounds(ym);
  const out: { start: string; end: string }[] = [];
  for (let p = payPeriodContaining(b.from); p.start <= b.to; p = payPeriodContaining(addDaysISO(p.end, 1))) out.push(p);
  return out;
}

/** One more row on a multi-row line. */
interface ExtraRow {
  key: number;
  vendor: string;
  account: string;
  kind: string;
  /** "start|end" of a pay period, or "" for the month. */
  period: string;
  amount: string;
  notes: string;
  files: File[];
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
  existing,
  branchSuggestions,
  defaultBranch,
  defaultMonth,
  onClose,
  onSaved,
}: {
  companyId: string | null;
  /** Every saved bill — for "Already entered" and so Auto-fill never pulls a record twice. */
  existing: BranchExpense[];
  branchSuggestions: string[];
  defaultBranch: string;
  /** "2026-11" — the month in view on the page. */
  defaultMonth: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [branch, setBranch] = useState(defaultBranch);
  // Saved as the 1st of the month — the sheet is by month.
  const [expenseDate, setExpenseDate] = useState(`${defaultMonth}-01`);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [amounts, setAmounts] = useState<Partial<Record<BranchExpenseCategory, string>>>({});
  const [lineNotes, setLineNotes] = useState<Partial<Record<BranchExpenseCategory, string>>>({});
  const [lineFiles, setLineFiles] = useState<Partial<Record<BranchExpenseCategory, File[]>>>({});
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** Lines filled by "Auto-fill from AHS" — the Expense Records behind each, saved with the bill. */
  const [autoLines, setAutoLines] = useState<Partial<Record<BranchExpenseCategory, AutoFillLine>>>({});
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoMsg, setAutoMsg] = useState<string | null>(null);
  /** Auto-filled lines opened to show their records. */
  const [autoOpen, setAutoOpen] = useState<Set<BranchExpenseCategory>>(() => new Set());
  /** Saved lines unlocked to add a second, separate bill. */
  const [addAnother, setAddAnother] = useState<Set<BranchExpenseCategory>>(() => new Set());
  /** Saved lines opened to show what's in them. */
  const [savedOpen, setSavedOpen] = useState<Set<BranchExpenseCategory>>(() => new Set());
  // Each line's first row: its provider / vendor, Operation's type, a payroll's pay period ("start|end", "" = month).
  const [lineVendor, setLineVendor] = useState<Partial<Record<BranchExpenseCategory, string>>>({});
  /** Each line's first row: the account it was paid on. */
  const [lineAccount, setLineAccount] = useState<Partial<Record<BranchExpenseCategory, string>>>({});
  const [lineKind, setLineKind] = useState<Partial<Record<BranchExpenseCategory, string>>>({});
  const [linePeriod, setLinePeriod] = useState<Partial<Record<BranchExpenseCategory, string>>>({});
  /** More rows under a multi-row line ("+ Add line"). */
  const [extraRows, setExtraRows] = useState<Partial<Record<BranchExpenseCategory, ExtraRow[]>>>({});
  const nextRowKey = useRef(1);
  /** Payroll rows filled from payroll runs: "category|start|end" → each person's pay, saved with the bill. */
  const [payrollSrc, setPayrollSrc] = useState<Record<string, BranchExpenseLine[]>>({});
  /** Payroll lines the last auto-fill filled — taken back when the branch or month changes. */
  const payrollAutoRef = useRef<Set<BranchExpenseCategory>>(new Set());
  // Read by auto-fill, which runs from a timer after a branch / month change — the latest values, not that render's.
  const amountsRef = useRef(amounts);
  amountsRef.current = amounts;
  const extraRowsRef = useRef(extraRows);
  extraRowsRef.current = extraRows;

  const month = expenseDate.slice(0, 7);
  /** The branch as the list spells it, once what's typed is a known branch — auto-fill waits for that. */
  const knownBranch = branchSuggestions.find((b) => b.trim().toLowerCase() === branch.trim().toLowerCase()) ?? null;
  /** Bills already saved for this branch + month, per line. */
  const alreadyFor = (c: BranchExpenseCategory) =>
    branch.trim() ? existing.filter((b) => b.category === c && b.expenseDate.slice(0, 7) === month && b.branch.trim().toLowerCase() === branch.trim().toLowerCase()) : [];
  /** A line that's already saved shows the saved bill, locked — unless "+ Add another" was pressed. */
  const isLocked = (c: BranchExpenseCategory) => alreadyFor(c).length > 0 && !addAnother.has(c);
  const savedSum = (c: BranchExpenseCategory) => alreadyFor(c).reduce((s, b) => s + b.amount, 0);

  // Expense Records + people, loaded once per form (switching branch / month re-uses them).
  const recordsRef = useRef<Promise<{ records: AutoFillRecord[]; users: ProfileRow[] }> | null>(null);
  const loadRecords = () => {
    if (!recordsRef.current) {
      recordsRef.current = Promise.all([getCompanyExpenses(), getCompanyUsers()]).then(([expenses, users]) => {
        const byId = new Map(users.map((u) => [u.id, u]));
        return { users, records: expenses.map((e): AutoFillRecord => {
          const p = byId.get(e.profileId);
          return {
            id: e.id, category: e.category, reimbursementType: e.reimbursementType, status: e.status, expenseDate: e.expenseDate,
            amount: e.amount, branch: p?.assigned_branch || "", destination: e.toLocation, person: p?.display_name || p?.email || "Unknown", description: e.description || "",
            fromLocation: e.fromLocation, toLocation: e.toLocation, pickupDate: e.pickupDate, returnDate: e.returnDate,
          };
        }) };
      });
      recordsRef.current.catch(() => { recordsRef.current = null; });
    }
    return recordsRef.current;
  };

  // Picking the branch and month fills the lines by itself. A new branch / month first takes back what the
  // last auto-fill put in (amounts and notes still as it left them), so nothing from the other branch stays.
  const autoLinesRef = useRef(autoLines);
  autoLinesRef.current = autoLines;
  useEffect(() => {
    const prev = autoLinesRef.current;
    if (Object.keys(prev).length) {
      setAmounts((a) => { const n = { ...a }; for (const c of AUTO_FILL_CATEGORIES) if (prev[c] && n[c] === prev[c]!.total.toFixed(2)) delete n[c]; return n; });
      setLineNotes((a) => { const n = { ...a }; for (const c of AUTO_FILL_CATEGORIES) if (prev[c] && n[c] === autoFillNote(prev[c]!)) delete n[c]; return n; });
    }
    setAutoLines({});
    setAutoOpen(new Set());
    setAddAnother(new Set());
    setSavedOpen(new Set());
    setLinePeriod({});
    const payAuto = payrollAutoRef.current;
    if (payAuto.size) {
      setAmounts((a) => { const n = { ...a }; for (const c of payAuto) delete n[c]; return n; });
      setLineNotes((a) => { const n = { ...a }; for (const c of payAuto) if ((n[c] ?? "").startsWith("From payroll")) delete n[c]; return n; });
      setExtraRows((p) => { const n = { ...p }; for (const c of payAuto) n[c] = []; return n; });
      payrollAutoRef.current = new Set();
    }
    setPayrollSrc({});
    setExtraRows((p) => { const n: typeof p = {}; for (const k of Object.keys(p) as BranchExpenseCategory[]) n[k] = p[k]!.map((r) => ({ ...r, period: "" })); return n; });
    setAutoMsg(null);
    if (!knownBranch || !month) return;
    const t = setTimeout(() => void autoFill(), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownBranch, month]);

  const autoFill = async () => {
    if (!branch.trim()) return;
    setAutoBusy(true);
    setAutoMsg(null);
    try {
      const { records, users } = await loadRecords();
      const result = buildAutoFill(records, branch, month, usedRecordIds(existing));
      const filled: Partial<Record<BranchExpenseCategory, AutoFillLine>> = {};
      const said: string[] = [];
      for (const c of AUTO_FILL_CATEGORIES) {
        const r = result[c];
        const label = BRANCH_EXPENSE_LABEL[c];
        if (alreadyFor(c).length) { said.push(`${label}: saved already${r.records.length ? ` (${r.records.length} new record${r.records.length === 1 ? "" : "s"} not added — use + Add another)` : ""}`); continue; }
        if (!r.records.length) { said.push(`${label}: nothing${r.alreadyUsed ? ` new (${r.alreadyUsed} already in a saved bill)` : ""}`); continue; }
        filled[c] = r;
        said.push(`${label}: ${fmtMoney(r.total)} from ${r.records.length} record${r.records.length === 1 ? "" : "s"}`);
      }
      setAutoLines(filled);
      setAmounts((prev) => {
        const next = { ...prev };
        for (const c of AUTO_FILL_CATEGORIES) if (filled[c]) next[c] = filled[c]!.total.toFixed(2);
        return next;
      });
      setLineNotes((prev) => {
        const next = { ...prev };
        for (const c of AUTO_FILL_CATEGORIES) if (filled[c] && !(prev[c] ?? "").trim()) next[c] = autoFillNote(filled[c]!);
        return next;
      });
      // Payroll — generated payroll runs, one row per pay period (a period counts in the month it ends).
      // Only fills a payroll line that's empty: nothing typed, no extra rows, nothing saved for it.
      const payCats = PAYROLL_FILL_CATEGORIES.filter((c) => !alreadyFor(c).length && !(amountsRef.current[c] ?? "").trim() && !(extraRowsRef.current[c]?.length) && !payrollAutoRef.current.has(c));
      if (payCats.length) {
        try {
          const b = monthBounds(month);
          const fill = buildPayrollFill(await getPayrollPays(b.from, b.to, users), branch, month, usedRecordIds(existing));
          const src: Record<string, BranchExpenseLine[]> = {};
          const filledCats = new Set<BranchExpenseCategory>();
          for (const c of payCats) {
            const periods = fill[c];
            const label = BRANCH_EXPENSE_LABEL[c];
            if (!periods.length) { said.push(`${label}: no payroll run`); continue; }
            filledCats.add(c);
            for (const p of periods) src[`${c}|${p.start}|${p.end}`] = p.pays.map(payrollBillLine);
            const [first, ...rest] = periods;
            setAmounts((a) => ({ ...a, [c]: first.total.toFixed(2) }));
            setLinePeriod((a) => ({ ...a, [c]: `${first.start}|${first.end}` }));
            setLineNotes((a) => ({ ...a, [c]: payrollNote(first) }));
            setExtraRows((a) => ({
              ...a,
              [c]: rest.map((p) => ({ key: nextRowKey.current++, vendor: "", account: "", kind: "", period: `${p.start}|${p.end}`, amount: p.total.toFixed(2), notes: payrollNote(p), files: [] })),
            }));
            said.push(`${label}: ${fmtMoney(periods.reduce((t, p) => t + p.total, 0))} from ${periods.length} pay period${periods.length === 1 ? "" : "s"}`);
          }
          payrollAutoRef.current = filledCats;
          setPayrollSrc(src);
        } catch (e) {
          said.push(`Payroll: couldn't load (${e instanceof Error ? e.message : String(e)})`);
        }
      }
      // Trips this month whose destination isn't a branch we know — their money would land nowhere, so say so.
      const known = new Set(branchSuggestions.map((b) => b.trim().toLowerCase()));
      const stray = records.filter((r) => r.destination?.trim() && r.status !== "Rejected" && r.amount > 0 && r.expenseDate.slice(0, 7) === month && !known.has(r.destination.trim().toLowerCase()));
      if (stray.length) said.push(`⚠ ${stray.length} trip record${stray.length === 1 ? "" : "s"} this month go to a destination that isn't a branch (${Array.from(new Set(stray.map((r) => r.destination!.trim()))).join(", ")}) — not filled anywhere`);
      setAutoMsg(said.join(" · "));
    } catch (e) {
      setAutoMsg(`Couldn't load Expense Records: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAutoBusy(false);
    }
  };

  const num = (c: BranchExpenseCategory) => parseAmount(amounts[c]);
  const rowsOf = (c: BranchExpenseCategory) => extraRows[c] ?? [];
  const withKind = (kind: string | undefined, notes: string) => (kind ? (notes.trim() ? `${kind} · ${notes.trim()}` : kind) : notes);
  /** Every bill this form will save: each line's first row, then its extra rows — blank amounts skipped. */
  const entries = BRANCH_EXPENSE_CATEGORIES.flatMap((c) => {
    const out: { c: BranchExpenseCategory; label: string; amount: number; vendor: string; account: string; notes: string; files: File[]; period: string; auto: boolean }[] = [];
    const main = isLocked(c) ? null : num(c);
    if (main != null) out.push({ c, label: BRANCH_EXPENSE_LABEL[c], amount: main, vendor: lineVendor[c] ?? "", account: lineAccount[c] ?? "", notes: withKind(lineKind[c], lineNotes[c] ?? ""), files: lineFiles[c] ?? [], period: linePeriod[c] ?? "", auto: !!autoLines[c] });
    for (const r of rowsOf(c)) {
      const n = parseAmount(r.amount);
      if (n != null) out.push({ c, label: `${BRANCH_EXPENSE_LABEL[c]} (another line)`, amount: n, vendor: r.vendor, account: r.account, notes: withKind(r.kind, r.notes), files: r.files, period: r.period, auto: false });
    }
    return out;
  });
  const entered = Array.from(new Set(entries.map((e) => e.c)));
  const badEntry = entries.find((e) => !isFinite(e.amount) || e.amount < 0);
  // Notes or files on a row with no amount — easy to miss, so it's flagged.
  const orphan =
    BRANCH_EXPENSE_CATEGORIES.find((c) => !isLocked(c) && num(c) == null && ((lineNotes[c] ?? "").trim() || (lineFiles[c]?.length ?? 0) > 0)) ??
    BRANCH_EXPENSE_CATEGORIES.find((c) => rowsOf(c).some((r) => parseAmount(r.amount) == null && (r.notes.trim() || r.files.length)));
  // The month's whole row: what's saved already plus what's being added now.
  const sumCats = (cats: BranchExpenseCategory[]) =>
    cats.reduce((s, c) => s + savedSum(c) + entries.filter((e) => e.c === c && isFinite(e.amount)).reduce((t, e) => t + e.amount, 0), 0);
  const savedCount = BRANCH_EXPENSE_CATEGORIES.filter((c) => alreadyFor(c).length).length;
  const payrollTotal = sumCats(PAYROLL_CATS);
  const expTotal = sumCats(EXPENSE_CATS);

  const problem =
    !branch.trim() ? "Pick or type the branch."
    : !expenseDate ? "Pick the month."
    : entries.length === 0 ? (savedCount ? "Everything filled here is saved already — fill in a blank line to add it." : "Fill in at least one line.")
    : badEntry ? `${badEntry.label}: enter a valid amount.`
    : orphan ? `${BRANCH_EXPENSE_LABEL[orphan]} has notes or files but no amount.`
    : periodStart && periodEnd && periodStart > periodEnd ? "The billing period ends before it starts."
    : null;

  const save = async () => {
    if (problem || saving) return;
    if (!companyId) { setErr("No company — sign in again."); return; }
    setErr(null);
    setSaving({ done: 0, total: entries.length });
    let done = 0;
    try {
      for (const e of entries) {
        const c = e.c;
        // A payroll row's pay period is its billing period; otherwise the form's.
        const [ps, pe] = e.period ? e.period.split("|") : [periodStart, periodEnd];
        const id = await addBranchExpense({
          branch, category: c, otherLabel: "", vendor: e.auto ? "AHS Expense Records" : e.vendor.trim(), accountNumber: e.account, amount: e.amount, expenseDate,
          periodStart: ps || null, periodEnd: pe || null, notes: e.notes, receipts: [],
        }, e.auto ? autoLines[c]?.records.map(toBillLine) ?? [] : e.period ? payrollSrc[`${c}|${e.period}`] ?? [] : []);
        const files = e.files;
        if (files.length) {
          const uploaded: BranchExpenseFile[] = [];
          for (const f of files) {
            const r = await uploadExpenseReceipt(companyId, `branch-${id}`, f);
            uploaded.push({ url: r.url, path: r.fullPath, name: f.name });
          }
          await setBranchExpenseReceipts(id, uploaded);
        }
        done++;
        setSaving({ done, total: entries.length });
      }
      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(done ? `Saved ${done} of ${entries.length}, then: ${msg}. Close and check the list before saving again.` : msg);
      setSaving(null);
    }
  };

  const input = "w-full rounded-lg border border-white/10 bg-slate-800/50 p-2 text-sm text-white placeholder-slate-500 [color-scheme:dark] focus:border-blue-500 focus:outline-none";
  const label = "mb-1 block text-xs uppercase text-slate-400";
  const cell = "rounded-md border border-white/10 bg-slate-800/50 py-1.5 text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none";

  /** The shared provider / vendor list for a line: every one used before, plus any typed in this form. */
  const vendorOptions = (c: BranchExpenseCategory) => {
    const set = new Set<string>();
    for (const b of existing) if (b.category === c && b.vendor.trim() && !SYSTEM_VENDORS.has(b.vendor.trim())) set.add(b.vendor.trim());
    if (lineVendor[c]?.trim()) set.add(lineVendor[c]!.trim());
    for (const r of rowsOf(c)) if (r.vendor.trim()) set.add(r.vendor.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  };
  const picker = "rounded-md border border-white/10 bg-slate-800/50 py-1.5 pl-2 pr-6 text-sm text-white [color-scheme:dark] focus:border-blue-500 focus:outline-none";
  // Render calls (not components), so typing never loses focus.
  const vendorPick = (c: BranchExpenseCategory, value: string, set: (v: string) => void) => (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value !== "__new") { set(e.target.value); return; }
        const typed = prompt(`New ${providerWord(c)} for ${BRANCH_EXPENSE_LABEL[c]}:`)?.trim();
        if (typed) set(typed);
      }}
      aria-label={`${BRANCH_EXPENSE_LABEL[c]} ${providerWord(c)}`}
      className={`${picker} w-40 shrink-0 ${value ? "" : "text-slate-500"}`}
    >
      <option value="" className="bg-slate-800 text-slate-400">{providerWord(c) === "provider" ? "Provider…" : "Vendor…"}</option>
      {vendorOptions(c).map((v) => <option key={v} value={v} className="bg-slate-800 text-white">{v}</option>)}
      <option value="__new" className="bg-slate-800 text-sky-300">+ New {providerWord(c)}…</option>
    </select>
  );
  const kindPick = (value: string, set: (v: string) => void) => (
    <select value={value} onChange={(e) => set(e.target.value)} aria-label="Operation type" className={`${picker} w-32 shrink-0 ${value ? "" : "text-slate-500"}`}>
      <option value="" className="bg-slate-800 text-slate-400">Type…</option>
      {OPERATION_TYPES.map((k) => <option key={k} value={k} className="bg-slate-800 text-white">{k}</option>)}
    </select>
  );
  const periodPick = (value: string, set: (v: string) => void) => (
    <select value={value} onChange={(e) => set(e.target.value)} aria-label="Pay period" className={`${picker} w-48 shrink-0`}>
      <option value="" className="bg-slate-800 text-white">Whole month</option>
      {payPeriodsInMonth(month).map((p) => (
        <option key={p.start} value={`${p.start}|${p.end}`} className="bg-slate-800 text-white">{fmtDay(p.start).replace(/, \d{4}$/, "")} – {fmtDay(p.end).replace(/, \d{4}$/, "")}</option>
      ))}
    </select>
  );
  /** The pickers in front of a row's notes: provider / vendor, Operation's type, or a payroll's pay period. */
  const pickers = (c: BranchExpenseCategory, row: { vendor: string; kind: string; period: string }, set: (patch: Partial<ExtraRow>) => void) => (
    <>
      {c === "operation" && kindPick(row.kind, (kind) => set({ kind }))}
      {PROVIDER_CATS.has(c) && vendorPick(c, row.vendor, (vendor) => set({ vendor }))}
      {PAYROLL_CATEGORIES.has(c) && periodPick(row.period, (period) => set({ period }))}
    </>
  );
  const accountBox = (c: BranchExpenseCategory, value: string, set: (v: string) => void) =>
    PAYROLL_CATEGORIES.has(c) ? null : (
      <input
        type="text"
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder="Account #"
        title="The account it was paid on (provider account # / card or bank account)"
        aria-label={`${BRANCH_EXPENSE_LABEL[c]} account number`}
        className={`${cell} w-28 shrink-0 px-2 font-mono text-xs`}
      />
    );
  const addRow = (c: BranchExpenseCategory) =>
    setExtraRows((p) => ({ ...p, [c]: [...(p[c] ?? []), { key: nextRowKey.current++, vendor: "", account: "", kind: "", period: "", amount: "", notes: "", files: [] }] }));
  const patchRow = (c: BranchExpenseCategory, key: number, patch: Partial<ExtraRow>) =>
    setExtraRows((p) => ({ ...p, [c]: (p[c] ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  const removeRow = (c: BranchExpenseCategory, key: number) => setExtraRows((p) => ({ ...p, [c]: (p[c] ?? []).filter((r) => r.key !== key) }));

  /** An extra row under a multi-row line. */
  const extraRow = (c: BranchExpenseCategory, r: ExtraRow) => (
    <div key={r.key} className="mt-1 grid grid-cols-[12rem_8.5rem_1fr_auto] items-center gap-2">
      <span className="flex items-center justify-end gap-1 pr-1 text-[11px] text-slate-500">
        ↳ another line
        <button type="button" onClick={() => removeRow(c, r.key)} aria-label="Remove this line" title="Remove this line" className="rounded p-0.5 text-slate-500 hover:bg-white/10 hover:text-white"><X className="h-3 w-3" /></button>
      </span>
      <span className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">$</span>
        <input
          type="text" inputMode="decimal" autoComplete="off" data-amount-box
          value={r.amount}
          onChange={(e) => patchRow(c, r.key, { amount: cleanAmount(e.target.value) })}
          onKeyDown={nextAmountOnEnter}
          onFocus={(e) => e.currentTarget.select()}
          placeholder="0.00"
          aria-label={`${BRANCH_EXPENSE_LABEL[c]} amount (another line)`}
          className={`${cell} w-full pl-5 pr-2 text-right tabular-nums`}
        />
      </span>
      <span className="flex min-w-0 gap-2">
        {pickers(c, r, (patch) => patchRow(c, r.key, patch))}
        {accountBox(c, r.account, (account) => patchRow(c, r.key, { account }))}
        <input type="text" value={r.notes} onChange={(e) => patchRow(c, r.key, { notes: e.target.value })} placeholder="Notes" aria-label={`${BRANCH_EXPENSE_LABEL[c]} notes (another line)`} className={`${cell} min-w-0 flex-1 px-2`} />
      </span>
      <span className="flex items-center gap-1">
        <label className={`inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold transition ${r.files.length ? "bg-blue-500/20 text-blue-200 hover:bg-blue-500/30" : "bg-slate-700 text-slate-200 hover:bg-slate-600"}`} title={r.files.length ? r.files.map((x) => x.name).join("\n") : "Attach a bill or receipt"}>
          <Paperclip className="h-3.5 w-3.5" />
          {r.files.length ? r.files.length : "Attach"}
          <input type="file" multiple accept="image/*,application/pdf" className="sr-only" aria-label="Files (another line)" onChange={(e) => { const picked = Array.from(e.target.files ?? []); patchRow(c, r.key, { files: [...r.files, ...picked] }); e.target.value = ""; }} />
        </label>
      </span>
    </div>
  );

  // A render call, not a component — a component declared in here would lose focus on every keystroke.
  const line = (c: BranchExpenseCategory) => {
    const files = lineFiles[c] ?? [];
    const already = alreadyFor(c);
    const auto = autoLines[c];
    const autoEdited = auto && num(c) != null && Math.abs((num(c) ?? 0) - auto.total) >= 0.01;
    if (isLocked(c)) {
      // Saved already for this branch + month — shown so the form reads like the whole sheet row, not editable here.
      const notes = already.map((b) => b.notes).filter(Boolean).join(" | ");
      return (
        <div key={c} className="px-1 py-1">
          <div className="grid grid-cols-[12rem_8.5rem_1fr_auto] items-center gap-2">
            <span className="flex items-center gap-2 text-xs text-slate-200">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${CAT_COLOR[c]}`} aria-hidden />
              {BRANCH_EXPENSE_LABEL[c]}
            </span>
            <button
              type="button"
              onClick={() => setSavedOpen((p) => { const n = new Set(p); if (n.has(c)) n.delete(c); else n.add(c); return n; })}
              aria-expanded={savedOpen.has(c)}
              title={savedOpen.has(c) ? "Hide the details" : "Show what's in this saved line"}
              className="flex items-center justify-end gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1.5 text-sm tabular-nums text-sky-100 transition hover:border-sky-400/70 hover:bg-sky-500/20"
            >
              {savedOpen.has(c) ? <ChevronDown className="h-3 w-3 text-sky-300" /> : <ChevronRight className="h-3 w-3 text-sky-300" />}
              <span className="rounded bg-sky-500/20 px-1 text-[9px] font-bold uppercase tracking-wide text-sky-300">Saved</span>
              {fmtMoney(savedSum(c))}
            </button>
            <span className="truncate rounded-md border border-white/5 bg-slate-800/30 px-2 py-1.5 text-sm text-slate-400" title={notes}>
              {notes || <span className="text-slate-600">{already.length} bill{already.length === 1 ? "" : "s"} saved{already[0]?.createdByName ? ` by ${already[0].createdByName}` : ""}</span>}
            </span>
            <button
              type="button"
              onClick={() => setAddAnother((p) => new Set(p).add(c))}
              title={`Add a second, separate ${BRANCH_EXPENSE_LABEL[c]} bill for ${branch.trim()}, ${monthLabel(month)}`}
              className="whitespace-nowrap rounded-md bg-slate-700 px-2 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-600"
            >
              + Add another
            </button>
          </div>
          {savedOpen.has(c) && (
            <div className="ml-[12.5rem] mt-1 space-y-2">
              {already.map((b) => {
                const lines = b.lineItems;
                const records = lines.some((l) => l.sourceId);
                const showTime = lines.some((l) => l.time);
                const showVehicle = lines.some((l) => l.vehicle);
                return (
                  <div key={b.id} className="overflow-x-auto rounded-md border border-sky-500/20 bg-slate-950/60">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-white/10 px-2 py-1.5 text-[11px] text-slate-400">
                      <span className="font-semibold text-sky-200">{fmtMoney(b.amount)}</span>
                      {b.vendor && <span>{b.vendor}</span>}
                      {(b.periodStart || b.periodEnd) && <span>{fmtDay(b.periodStart) || "…"} – {fmtDay(b.periodEnd) || "…"}</span>}
                      <span>Added by {b.createdByName ?? "—"} · {fmtDay(b.createdAt.slice(0, 10))}</span>
                      {b.receipts.length > 0 && <span>{b.receipts.length} file{b.receipts.length === 1 ? "" : "s"}</span>}
                      {!lines.length && b.notes && <span className="text-slate-300">“{b.notes}”</span>}
                    </div>
                    {lines.length > 0 ? (
                      <div className="max-h-64 overflow-y-auto">
                        <table className="w-full text-[11px]">
                          <thead className="sticky top-0 bg-slate-950">
                            <tr className="text-left text-[10px] font-semibold uppercase text-slate-500">
                              <th className="px-2 py-1">Date</th>
                              {showTime && <th className="px-2 py-1">Time</th>}
                              <th className="px-2 py-1">{records ? "Employee" : "Driver"}</th>
                              {showVehicle && <th className="px-2 py-1">Vehicle</th>}
                              <th className="px-2 py-1">Type</th>
                              <th className="px-2 py-1">{records ? "Description" : "Station"}</th>
                              <th className="px-2 py-1">{records ? "Where / dates" : "Address"}</th>
                              <th className="px-2 py-1 text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lines.map((l, i) => (
                              <tr key={i} className="border-t border-white/5">
                                <td className="whitespace-nowrap px-2 py-1 tabular-nums text-slate-300">{fmtDay(l.date) || "—"}</td>
                                {showTime && <td className="whitespace-nowrap px-2 py-1 tabular-nums text-slate-400">{l.time || "—"}</td>}
                                <td className="whitespace-nowrap px-2 py-1 font-medium text-slate-200">{l.driver}</td>
                                {showVehicle && <td className="max-w-[160px] truncate px-2 py-1 text-slate-400" title={l.vehicle}>{l.vehicle || "—"}</td>}
                                <td className={`whitespace-nowrap px-2 py-1 ${/pending/.test(l.service) ? "text-amber-300" : "text-slate-400"}`}>{l.service || "—"}</td>
                                <td className="max-w-[220px] truncate px-2 py-1 text-slate-300" title={l.merchant}>{l.merchant || "—"}</td>
                                <td className="max-w-[240px] truncate px-2 py-1 text-slate-400" title={l.address}>{l.address || "—"}</td>
                                <td className="whitespace-nowrap px-2 py-1 text-right font-mono text-emerald-300">{fmtMoney(Number(l.amount) || 0)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="px-2 py-1.5 text-[11px] text-slate-500">Typed in by hand — no line-by-line details.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }
    return (
      <div key={c} className="px-1 py-1">
      <div className="grid grid-cols-[12rem_8.5rem_1fr_auto] items-center gap-2">
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
            className={`${cell} w-full pl-5 pr-2 text-right tabular-nums ${auto ? "!border-emerald-500/50 !bg-emerald-500/10" : already.length ? "!border-amber-500/50" : ""}`}
          />
        </span>
        <span className="flex min-w-0 gap-2">
          {MULTI_CATS.has(c) && pickers(c, { vendor: lineVendor[c] ?? "", kind: lineKind[c] ?? "", period: linePeriod[c] ?? "" }, (patch) => {
            if (patch.vendor !== undefined) setLineVendor((p) => ({ ...p, [c]: patch.vendor }));
            if (patch.kind !== undefined) setLineKind((p) => ({ ...p, [c]: patch.kind }));
            if (patch.period !== undefined) setLinePeriod((p) => ({ ...p, [c]: patch.period }));
          })}
          {accountBox(c, lineAccount[c] ?? "", (v) => setLineAccount((p) => ({ ...p, [c]: v })))}
          <input
            type="text"
            value={lineNotes[c] ?? ""}
            onChange={(e) => setLineNotes((prev) => ({ ...prev, [c]: e.target.value }))}
            placeholder="Notes"
            aria-label={`${BRANCH_EXPENSE_LABEL[c]} notes`}
            className={`${cell} min-w-0 flex-1 px-2`}
          />
        </span>
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
      {rowsOf(c).map((r) => extraRow(c, r))}
      {MULTI_CATS.has(c) && (
        <button type="button" onClick={() => addRow(c)} className="ml-[12.5rem] mt-0.5 text-[11px] font-semibold text-sky-300 hover:text-sky-200 hover:underline">
          + Add line{PROVIDER_CATS.has(c) ? ` (another ${providerWord(c)})` : " (another pay period)"}
        </button>
      )}
      {(auto || already.length > 0) && (
        <div className="ml-[12.5rem] mt-0.5 flex flex-wrap gap-x-3 text-[11px]">
          {auto && (
            <span className="text-emerald-300">
              <button
                type="button"
                onClick={() => setAutoOpen((p) => { const n = new Set(p); if (n.has(c)) n.delete(c); else n.add(c); return n; })}
                aria-expanded={autoOpen.has(c)}
                title={autoOpen.has(c) ? "Hide the records" : "See the records behind this amount"}
                className="inline-flex items-center gap-0.5 hover:text-emerald-200 hover:underline"
              >
                {autoOpen.has(c) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Auto-filled: {auto.records.length} Expense Record{auto.records.length === 1 ? "" : "s"} ({fmtMoney(auto.total)}){auto.pending ? ` · ${auto.pending} still pending` : ""}
              </button>
              {autoEdited && <span className="text-amber-300"> · amount changed by hand</span>}
              <button
                type="button"
                onClick={() => { setAutoLines((p) => { const n = { ...p }; delete n[c]; return n; }); setAmounts((p) => ({ ...p, [c]: "" })); setLineNotes((p) => ({ ...p, [c]: (p[c] ?? "") === autoFillNote(auto) ? "" : p[c] })); }}
                className="ml-2 text-slate-400 underline hover:text-white"
              >
                Clear
              </button>
            </span>
          )}
          {already.length > 0 && (
            <span className="text-amber-300">
              Saved already: {already.map((b) => fmtMoney(b.amount)).join(" + ")} — this adds a separate bill.
              <button type="button" onClick={() => { setAddAnother((p) => { const n = new Set(p); n.delete(c); return n; }); setAmounts((p) => ({ ...p, [c]: "" })); }} className="ml-2 text-slate-400 underline hover:text-white">Cancel</button>
            </span>
          )}
        </div>
      )}
      {auto && autoOpen.has(c) && (
        <div className="ml-[12.5rem] mt-1 overflow-x-auto rounded-md border border-emerald-500/20 bg-slate-950/60">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase text-slate-500">
                <th className="px-2 py-1">Date</th>
                <th className="px-2 py-1">Employee</th>
                <th className="px-2 py-1">Type</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Description</th>
                <th className="px-2 py-1">Original → Destination</th>
                <th className="px-2 py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {auto.records.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="whitespace-nowrap px-2 py-1 tabular-nums text-slate-300">{fmtDay(r.expenseDate)}{r.pickupDate || r.returnDate ? <div className="text-[10px] text-slate-500">{fmtDay(r.pickupDate) || "…"} – {fmtDay(r.returnDate) || "…"}</div> : null}</td>
                  <td className="whitespace-nowrap px-2 py-1 font-medium text-slate-200">{r.person}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-slate-400">{r.reimbursementType || r.category}</td>
                  <td className={`whitespace-nowrap px-2 py-1 ${r.status === "Pending" ? "text-amber-300" : r.status === "Reimbursed" ? "text-emerald-300" : "text-sky-300"}`}>{r.status}</td>
                  <td className="max-w-[260px] truncate px-2 py-1 text-slate-400" title={r.description}>{r.description || "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-slate-300">{r.destination?.trim() ? <>{r.branch || "—"} → <span className="text-sky-300">{r.destination.trim()}</span></> : r.branch || "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right font-mono text-emerald-300">{fmtMoney(r.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10">
                <td colSpan={6} className="px-2 py-1 text-right text-[11px] font-semibold text-slate-300">Total of {auto.records.length} record{auto.records.length === 1 ? "" : "s"}</td>
                <td className="px-2 py-1 text-right font-mono font-bold text-emerald-400">{fmtMoney(auto.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => !saving && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="branch-sheet-title" className="max-h-[94vh] w-full max-w-7xl overflow-y-auto rounded-lg border border-white/10 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
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
            <select id="bs-branch" value={branch} onChange={(e) => setBranch(e.target.value)} className={`${input} cursor-pointer ${branch ? "" : "text-slate-500"}`}>
              <option value="" className="bg-slate-800 text-slate-400">Pick a branch</option>
              {branch && !branchSuggestions.includes(branch) && <option value={branch} className="bg-slate-800 text-white">{branch}</option>}
              {branchSuggestions.map((x) => <option key={x} value={x} className="bg-slate-800 text-white">{x}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="bs-date">Month <span className="normal-case text-red-400">*</span></label>
            <input id="bs-date" type="month" value={expenseDate.slice(0, 7)} onChange={(e) => e.target.value && setExpenseDate(`${e.target.value}-01`)} className={input} />
          </div>
          <div>
            <span className={label}>Billing period (optional)</span>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} aria-label="Billing period start" className={input} />
              <input type="date" value={periodEnd} min={periodStart || undefined} onChange={(e) => setPeriodEnd(e.target.value)} aria-label="Billing period end" className={input} />
            </div>
          </div>
        </div>

        {/* Travel / Lodging, Food, Rental Car, Gas and Equipment / Office Supplies from Expense Records — each record only ever in one bill. */}
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-emerald-300">
            {autoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {autoBusy ? "Filling from AHS…" : knownBranch ? `From AHS · ${knownBranch}, ${monthLabel(month)}` : "Auto-fill from AHS"}
          </span>
          <span className="flex-1 text-[11px] text-slate-400">
            {!knownBranch
              ? "Pick the branch and month — Travel / Lodging, Food, Rental Car, Gas and Equipment / Office Supplies fill in from Expense Records by themselves (Flash Tech trips count for their destination branch), and lines already saved for that month show as Saved."
              : autoMsg ?? "Checking Expense Records…"}
          </span>
          {knownBranch && !autoBusy && (
            <button type="button" onClick={() => void autoFill()} disabled={!!saving} title="Check Expense Records again" className="shrink-0 text-[11px] font-semibold text-emerald-300 underline hover:text-emerald-200">
              Refresh
            </button>
          )}
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border border-white/10 bg-white/[0.02] p-3">
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
          {savedCount > 0 && <span className="w-full text-right text-[11px] text-slate-500">Includes {savedCount} line{savedCount === 1 ? "" : "s"} saved already for {branch.trim()}, {monthLabel(month)}.</span>}
        </div>

        {(err || problem) && <p className={`mt-3 text-xs ${err ? "text-red-300" : "text-slate-400"}`}>{err ?? problem}</p>}

        <div className="mt-5 flex gap-3">
          <button type="button" onClick={save} disabled={!!problem || !!saving} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving {saving.done} of {saving.total}…</> : entries.length ? `Save ${entries.length} bill${entries.length === 1 ? "" : "s"}` : "Save"}
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
  const [accountNumber, setAccountNumber] = useState(editing?.accountNumber ?? "");
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
    : !expenseDate ? "Pick the month."
    : periodStart && periodEnd && periodStart > periodEnd ? "The billing period ends before it starts."
    : null;

  const save = async () => {
    if (problem || saving) return;
    if (!companyId) { setErr("No company — sign in again."); return; }
    setSaving(true);
    setErr(null);
    const input: BranchExpenseInput = {
      branch, category, otherLabel, vendor, accountNumber, amount: amountNum, expenseDate,
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
              <label className={label} htmlFor="be-date">Month <span className="normal-case text-red-400">*</span></label>
              <input id="be-date" type="month" value={expenseDate.slice(0, 7)} onChange={(e) => e.target.value && setExpenseDate(`${e.target.value}-01`)} className={input} />
            </div>
          </div>

          <div>
            <label className={label} htmlFor="be-vendor">Vendor / provider</label>
            <input id="be-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. AT&T, Duke Energy, landlord's name" className={input} />
          </div>

          <div>
            <label className={label} htmlFor="be-account">Account #</label>
            <input id="be-account" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="The account it was paid on" className={`${input} font-mono`} />
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
