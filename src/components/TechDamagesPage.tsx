/**
 * Accounting → Tech Damages (migration 0440) — Accounting's damages sheet as
 * a page: one row per house / parts damage a technician caused, what's being
 * deducted per payroll and from which cut-off, and what's left.
 *
 *   Total   = House Damage + Parts Damage        (worked out by the database)
 *   Balance = Total − Deduction per payroll      (worked out by the database)
 *   House / Parts Damage Count = that technician's damages that year
 *
 * Viewed by year (damage date) or by one bi-weekly cut-off period (cut-off
 * date). Finance, Admin and Super Admin add / edit / delete / restore; HR
 * reads. Every change is on the History tab, with what changed. Rules are
 * enforced by the table's triggers and RLS too — the page only mirrors them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertTriangle, ChevronLeft, Download, FileText, History, Paperclip, Plus, RotateCcw, Trash2, Upload, Wrench, X } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { useSmartBack } from "@/hooks/useSmartBack";
import { AppModal } from "@/components/ui-kit/AppModal";
import { EmptyState } from "@/components/ui-kit/EmptyState";
import { TableSkeleton } from "@/components/ui-kit/TableSkeleton";
import { hasDashboardAccess } from "@/lib/dashboardAccess";
import { getCompanyUsersLite, getMyProfileId, type ProfileRow } from "@/lib/supabase/users";
import { getBranchRoles, type BranchRoles } from "@/lib/supabase/generalInfo";
import { isEligibleForTechnicianFormChecklist } from "@/lib/roleLabels";
import { findPersonByName } from "@/lib/personName";
import { payPeriodContaining, type PayPeriod } from "@/lib/payPeriods";
import { addDaysISO, todayISO } from "@/lib/localDate";
import {
  addTechDamageFiles,
  createTechDamage,
  cutoffPeriodsForYear,
  deleteTechDamage,
  getTechDamageEvents,
  getTechDamageFileUrl,
  getTechDamages,
  inYearAndCutoff,
  isTechDamagesMissing,
  removeTechDamageFile,
  restoreTechDamage,
  techDamageTotals,
  technicianKey,
  updateTechDamage,
  yearOf,
  yearlyDamageCounts,
  type CutoffFilter,
  type TechDamage,
  type TechDamageEvent,
  type TechDamageFileKind,
  type TechDamageInput,
  type TechDamageStatus,
  sortTechDamages,
  type TechDamageSort,
} from "@/lib/supabase/techDamages";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const WRITE_ROLES = ["ADMIN", "FINANCE", "SUPERADMIN", "SUPERSUPERADMIN"];
const READ_ROLES = [...WRITE_ROLES, "HR"];

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${m}/${d}/${y}`;
}
/** MM/DD/YY — the table's short date. */
const fmtShort = (iso: string | null | undefined) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(2, 4)}` : "");
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
const shortDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const periodLabel = (p: PayPeriod) => `${shortDay(p.start)} – ${shortDay(p.end)}, ${p.end.slice(0, 4)}`;

const STATUS_LABEL: Record<TechDamageStatus, string> = { ongoing: "Ongoing", paid: "Paid" };
const STATUS_CLASS: Record<TechDamageStatus, string> = {
  ongoing: "bg-red-500/15 text-red-300 border-red-500/30",
  paid: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};
const EVENT_LABEL: Record<TechDamageEvent["action"], string> = { created: "Added", edited: "Edited", deleted: "Deleted", restored: "Restored" };

export function TechDamagesPage({ mod, sub }: Props) {
  const { uid, role, extraRoles } = useAuth();
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const canWrite = hasDashboardAccess(WRITE_ROLES, role, extraRoles);
  const canRead = hasDashboardAccess(READ_ROLES, role, extraRoles);

  const [rows, setRows] = useState<TechDamage[]>([]);
  const [events, setEvents] = useState<TechDamageEvent[]>([]);
  const [people, setPeople] = useState<ProfileRow[]>([]);
  const [branches, setBranches] = useState<BranchRoles[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const thisYear = yearOf(todayISO());
  const [tab, setTab] = useState<"active" | "deleted" | "history">("active");
  const [year, setYear] = useState(thisYear);
  const [cutoff, setCutoff] = useState<CutoffFilter>("all");
  const [statusFilter, setStatusFilter] = useState<"" | TechDamageStatus>("");
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [sortBy, setSortBy] = useState<TechDamageSort>("branch-asc");

  const [editing, setEditing] = useState<TechDamage | "new" | null>(null);
  const [confirm, setConfirm] = useState<{ row: TechDamage; action: "delete" | "restore" } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!uid || !canRead) return;
    setLoading(true);
    setError(null);
    try {
      const [list, ev, pid, users, br] = await Promise.all([
        getTechDamages(),
        getTechDamageEvents().catch(() => [] as TechDamageEvent[]),
        getMyProfileId(uid).catch(() => null),
        canWrite ? getCompanyUsersLite().catch(() => [] as ProfileRow[]) : Promise.resolve([] as ProfileRow[]),
        canWrite ? getBranchRoles().catch(() => [] as BranchRoles[]) : Promise.resolve([] as BranchRoles[]),
      ]);
      setRows(list);
      setEvents(ev);
      setMyId(pid);
      setPeople(users);
      setBranches(br);
    } catch (e: any) {
      const msg = e?.message || "Couldn't load tech damages.";
      setError(isTechDamagesMissing(msg) ? "Tech Damages isn't set up in the database yet — run migration 0440_tech_damages.sql in Supabase, then reload." : msg);
    } finally {
      setLoading(false);
    }
  }, [uid, canRead, canWrite]);

  useEffect(() => { void load(); }, [load]);

  const refreshEvents = () => { getTechDamageEvents().then(setEvents).catch(() => {}); };
  const replaceRow = (d: TechDamage) => setRows((prev) => (prev.some((x) => x.id === d.id) ? prev.map((x) => (x.id === d.id ? d : x)) : [d, ...prev]));

  const counts = useMemo(() => yearlyDamageCounts(rows), [rows]);
  const years = useMemo(() => {
    const set = new Set<number>([thisYear]);
    for (const d of rows) {
      if (Number.isFinite(yearOf(d.damageDate))) set.add(yearOf(d.damageDate));
      if (d.cutoffDate) set.add(yearOf(d.cutoffDate));
    }
    return [...set].sort((a, b) => b - a);
  }, [rows, thisYear]);
  const periods = useMemo(() => cutoffPeriodsForYear(year), [year]);
  // Cut-offs in this year that have damages on them — marked in the picker.
  const usedCutoffs = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of rows) if (!d.deletedAt && d.cutoffDate) {
      const s = payPeriodContaining(d.cutoffDate).start;
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const branchKey = branchFilter.trim().toLowerCase();
    const shown = rows.filter((d) => {
      if (tab === "deleted" ? !d.deletedAt : d.deletedAt) return false;
      if (tab === "active" && !inYearAndCutoff(d, year, cutoff)) return false;
      if (statusFilter && d.status !== statusFilter) return false;
      if (branchFilter && d.area.trim().toLowerCase() !== branchKey) return false;
      if (q && ![d.technicianName, d.area, d.bmSbm, d.ticketNumber, d.damageType, d.notes].some((s) => s.toLowerCase().includes(q))) return false;
      return true;
    });
    return sortTechDamages(shown, sortBy);
  }, [rows, tab, year, cutoff, statusFilter, branchFilter, sortBy, search]);
  // Every branch on a damage, A → Z, for the Branch filter.
  const branchOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of rows) if (d.area.trim() && !m.has(d.area.trim().toLowerCase())) m.set(d.area.trim().toLowerCase(), d.area.trim());
    return [...m.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [rows]);
  const totals = useMemo(() => techDamageTotals(visible), [visible]);
  const rowById = useMemo(() => new Map(rows.map((d) => [d.id, d])), [rows]);

  const viewLabel = cutoff === "all" ? `${year}` : cutoff === "none" ? `${year} — no cut-off date yet` : `Cut-off ${periodLabel(payPeriodContaining(cutoff))}`;

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const data = visible.map((d) => {
      const c = counts.get(`${technicianKey(d)}|${yearOf(d.damageDate)}`) ?? { house: 0, parts: 0 };
      return {
        Area: d.area,
        [`House Damage Count ${yearOf(d.damageDate)}`]: c.house,
        [`Parts Damage Count ${yearOf(d.damageDate)}`]: c.parts,
        "BM / SBM": d.bmSbm,
        Technician: d.technicianName,
        Date: fmtDate(d.damageDate),
        "Ticket Number": d.ticketNumber,
        Type: d.damageType,
        "House Damage $": d.houseDamage,
        "Parts Damage $": d.partsDamage,
        "Total Amount $": d.totalAmount,
        "Deduction per payroll": d.deductionPerPayroll,
        "Cut off date": fmtDate(d.cutoffDate),
        Balance: d.balance,
        Status: STATUS_LABEL[d.status],
        Notes: d.notes,
        "Attachment of the damages": d.damageFiles.length,
        "Waiver Attachment": d.waiverFiles.length,
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tech Damages");
    const tag = cutoff === "all" ? `${year}` : cutoff === "none" ? `${year}_no-cutoff` : `cutoff_${payPeriodContaining(cutoff).end}`;
    XLSX.writeFile(wb, `tech-damages_${tag}.xlsx`);
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      replaceRow(confirm.action === "delete" ? await deleteTechDamage(confirm.row.id) : await restoreTechDamage(confirm.row.id));
      refreshEvents();
      toast.success(confirm.action === "delete" ? "Deleted — you can restore it from the Deleted tab." : "Restored.");
      setConfirm(null);
    } catch (e: any) {
      toast.error(e?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  if (!canRead) {
    return (
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <EmptyState icon={<Wrench />} title="You don't have access to Tech Damages" hint="Accounting, Admin and HR can open this page." />
      </main>
    );
  }

  const deletedCount = rows.filter((d) => d.deletedAt).length;
  // Compact: everything on one screen — small type, tight cells, short headers (full name on hover).
  const th = "px-1.5 py-1.5 font-semibold leading-tight align-bottom";
  const td = "px-1.5 py-1 whitespace-nowrap";
  const sel = "glass-input !w-auto !py-1 !pl-2 !pr-7 text-xs h-8";
  const tabBtn = (active: boolean) =>
    `text-xs px-2.5 py-1 rounded-md border transition ${active ? "bg-blue-600 text-white border-blue-600" : "border-[var(--color-panel-border)] text-muted-foreground hover:text-foreground"}`;
  const cols: { label: string; full: string; right?: boolean }[] = [
    { label: "Area", full: "Area" },
    { label: `House # ${year}`, full: `House Damage Count ${year} — this technician's damages with a house amount that year`, right: true },
    { label: `Parts # ${year}`, full: `Parts Damage Count ${year} — this technician's damages with a parts amount that year`, right: true },
    { label: "BM / SBM", full: "BM / SBM" },
    { label: "Technician", full: "Technician" },
    { label: "Date", full: "Date" },
    { label: "Ticket #", full: "Ticket Number" },
    { label: "Type", full: "Type of damage" },
    { label: "House $", full: "House Damage $", right: true },
    { label: "Parts $", full: "Parts Damage $", right: true },
    { label: "Total $", full: "Total Amount $ (house + parts)", right: true },
    { label: "Deduct / payroll", full: "Deduction per payroll", right: true },
    { label: "Cut-off", full: "Cut off date" },
    { label: "Balance", full: "Balance (total − deduction)", right: true },
    { label: "Status", full: "Status" },
    { label: "Notes", full: "Notes" },
    { label: "Damage files", full: "Attachment of the damages" },
    { label: "Waiver", full: "Waiver Attachment" },
  ];

  return (
    <main className="flex-1 w-full max-w-[1920px] mx-auto px-3 sm:px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" onClick={goBack} className="btn text-xs hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" /> {mod.label}
          </button>
          <h1 className="text-2xl font-display font-bold tracking-tight truncate">{sub.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn text-xs" onClick={() => void exportExcel()} disabled={loading || visible.length === 0}>
            <Download className="h-4 w-4" /> Export to Excel
          </button>
          {canWrite && (
            <button type="button" className="btn btn-primary text-xs" onClick={() => setEditing("new")} disabled={!!error}>
              <Plus className="h-4 w-4" /> Add Damage
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="panel mb-3 border-red-500/30 bg-red-500/5 text-sm text-red-300 px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex items-center gap-1">
          {(["active", "deleted", "history"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={tabBtn(tab === t)}>
              {t === "active" ? "Damages" : t === "deleted" ? `Deleted (${deletedCount})` : "History"}
            </button>
          ))}
        </div>
        {tab !== "history" && (
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {tab === "active" && (
              <>
                <select aria-label="Year" title="Year" className={sel} value={year} onChange={(e) => { setYear(Number(e.target.value)); setCutoff("all"); }}>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                <select aria-label="Cut-off period" title="Cut-off period" className={`${sel} max-w-[15rem]`} value={cutoff} onChange={(e) => setCutoff(e.target.value)}>
                  <option value="all">Whole year ({year})</option>
                  <option value="none">No cut-off date yet</option>
                  {periods.map((p) => {
                    const n = usedCutoffs.get(p.start);
                    return <option key={p.start} value={p.start}>{periodLabel(p)}{n ? ` · ${n} damage${n === 1 ? "" : "s"}` : ""}</option>;
                  })}
                </select>
              </>
            )}
            <select aria-label="Branch" title="Branch" className={`${sel} max-w-[11rem]`} value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
              <option value="">All branches</option>
              {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select aria-label="Sort" title="Sort" className={sel} value={sortBy} onChange={(e) => setSortBy(e.target.value as TechDamageSort)}>
              <option value="branch-asc">Branch A → Z</option>
              <option value="branch-desc">Branch Z → A</option>
              <option value="newest">Newest first</option>
            </select>
            <select aria-label="Status" title="Status" className={sel} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
              <option value="">All statuses</option>
              <option value="ongoing">Ongoing</option>
              <option value="paid">Paid</option>
            </select>
            <input aria-label="Search" className={`${sel} !w-52`} placeholder="Search technician, area, ticket…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        )}
      </div>

      {tab === "active" && !loading && !error && (
        <div className="panel px-3 py-1.5 mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs tabular-nums">
          <span className="uppercase tracking-wide text-muted-foreground">
            {viewLabel} · {totals.count} damage{totals.count === 1 ? "" : "s"}{totals.ongoing ? ` · ${totals.ongoing} ongoing` : ""}
          </span>
          {[
            ["House", totals.house],
            ["Parts", totals.parts],
            ["Total", totals.total],
            ["Deductions", totals.deduction],
            ["Balance", totals.balance],
          ].map(([label, value]) => (
            <span key={label as string}>
              <span className="text-muted-foreground">{label} </span>
              <span className={`font-semibold ${label === "Balance" && (value as number) > 0 ? "text-red-300" : ""}`}>{money(value as number)}</span>
            </span>
          ))}
        </div>
      )}

      <div className="panel p-0 overflow-x-auto">
        {loading ? (
          <TableSkeleton rows={6} cols={10} />
        ) : tab === "history" ? (
          events.length === 0 ? (
            <EmptyState icon={<History />} title="No activity yet" />
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] uppercase text-muted-foreground border-b border-[var(--color-panel-border)]">
                  <th className={th}>When</th>
                  <th className={th}>Action</th>
                  <th className={th}>By</th>
                  <th className={th}>Damage</th>
                  <th className={th}>What changed</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => {
                  const d = rowById.get(ev.damageId);
                  return (
                    <tr key={ev.id} className="border-b border-[var(--color-panel-border)]/60 align-top">
                      <td className={td}>{fmtDateTime(ev.createdAt)}</td>
                      <td className={`${td} font-medium ${ev.action === "deleted" ? "text-red-300" : ev.action === "restored" ? "text-emerald-300" : ""}`}>{EVENT_LABEL[ev.action] ?? ev.action}</td>
                      <td className={td}>{ev.actorName || "—"}</td>
                      <td className={td}>
                        {d ? (
                          <button type="button" className="underline hover:text-foreground text-left" onClick={() => setEditing(d)}>
                            {d.technicianName} — {fmtDate(d.damageDate)}{d.ticketNumber ? ` — #${d.ticketNumber}` : ""}
                          </button>
                        ) : "—"}
                      </td>
                      <td className="px-1.5 py-1 text-muted-foreground min-w-[16rem]">{ev.detail || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Wrench />}
            title={tab === "deleted" ? "No deleted damages" : `No damages for ${viewLabel}`}
            hint={tab === "active" && canWrite && !error ? "Add one with “Add Damage”." : undefined}
          />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10.5px] uppercase text-muted-foreground border-b border-[var(--color-panel-border)]">
                {cols.map((c) => (
                  <th key={c.label} title={c.full} className={`${th} ${c.right ? "text-right" : ""}`}>{c.label}</th>
                ))}
                {canWrite && <th className={th}><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {visible.map((d) => {
                const c = counts.get(`${technicianKey(d)}|${yearOf(d.damageDate)}`) ?? { house: 0, parts: 0 };
                return (
                  <tr key={d.id} className="border-b border-[var(--color-panel-border)]/60 hover:bg-white/[0.04] cursor-pointer" onClick={() => setEditing(d)}>
                    <td className={`${td} max-w-[6rem] truncate`} title={d.area || undefined}>{d.area || "—"}</td>
                    <td className={`${td} text-right`} title={`${d.technicianName}: ${c.house} house damage${c.house === 1 ? "" : "s"} in ${yearOf(d.damageDate)}`}>{c.house}</td>
                    <td className={`${td} text-right`} title={`${d.technicianName}: ${c.parts} parts damage${c.parts === 1 ? "" : "s"} in ${yearOf(d.damageDate)}`}>{c.parts}</td>
                    <td className={`${td} max-w-[9rem] truncate`} title={d.bmSbm || undefined}>{d.bmSbm || "—"}</td>
                    <td className={`${td} max-w-[8rem] truncate font-medium`} title={d.technicianName}>{d.technicianName}</td>
                    <td className={td}>{fmtShort(d.damageDate)}</td>
                    <td className={`${td} max-w-[6rem] truncate`} title={d.ticketNumber || undefined}>{d.ticketNumber || "—"}</td>
                    <td className={`${td} max-w-[9rem] truncate`} title={d.damageType || undefined}>{d.damageType || "—"}</td>
                    <td className={`${td} text-right`}>{money(d.houseDamage)}</td>
                    <td className={`${td} text-right`}>{money(d.partsDamage)}</td>
                    <td className={`${td} text-right font-semibold`}>{money(d.totalAmount)}</td>
                    <td className={`${td} text-right`}>{money(d.deductionPerPayroll)}</td>
                    <td className={td}>{d.cutoffDate ? fmtShort(d.cutoffDate) : "—"}</td>
                    <td className={`${td} text-right font-semibold ${d.balance > 0 ? "text-red-300" : "text-emerald-300"}`}>{money(d.balance)}</td>
                    <td className={td}>
                      <span className={`inline-flex text-[10.5px] px-1.5 py-px rounded-full border ${STATUS_CLASS[d.status]}`}>{STATUS_LABEL[d.status]}</span>
                    </td>
                    <td className={`${td} max-w-[10rem] truncate`} title={d.notes || undefined}>{d.notes || "—"}</td>
                    <td className={td}><FileCount n={d.damageFiles.length} /></td>
                    <td className={td}><FileCount n={d.waiverFiles.length} /></td>
                    {canWrite && (
                      <td className={td} onClick={(e) => e.stopPropagation()}>
                        {d.deletedAt ? (
                          <button type="button" className="btn text-xs !px-2 !py-0.5" onClick={() => setConfirm({ row: d, action: "restore" })}>
                            <RotateCcw className="h-3.5 w-3.5" /> Restore
                          </button>
                        ) : (
                          <button type="button" aria-label="Delete" title="Delete" className="p-1 rounded text-muted-foreground hover:text-red-300 hover:bg-red-500/10" onClick={() => setConfirm({ row: d, action: "delete" })}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <DamageModal
          damage={editing === "new" ? null : rowById.get(editing.id) ?? editing}
          canWrite={canWrite}
          myId={myId}
          people={people}
          branches={branches}
          typeSuggestions={[...new Set(rows.map((d) => d.damageType).filter(Boolean))].sort()}
          events={editing === "new" ? [] : events.filter((e) => e.damageId === editing.id)}
          onClose={() => setEditing(null)}
          onSaved={(d) => {
            replaceRow(d);
            refreshEvents();
          }}
        />
      )}

      {confirm && (
        <AppModal
          title={confirm.action === "delete" ? "Delete this damage?" : "Restore this damage?"}
          description={`${confirm.row.technicianName} — ${fmtDate(confirm.row.damageDate)} — ${money(confirm.row.totalAmount)}`}
          tone={confirm.action === "delete" ? "warning" : "default"}
          size="sm"
          busy={busy}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
              <button type="button" className={`btn ${confirm.action === "delete" ? "btn-danger" : "btn-primary"}`} onClick={runConfirm} disabled={busy}>
                {busy ? "Working…" : confirm.action === "delete" ? "Delete" : "Restore"}
              </button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">
            {confirm.action === "delete"
              ? "It moves to the Deleted tab and can be restored any time. Who deleted it is on the History tab."
              : "It goes back to the Damages list exactly as it was."}
          </p>
        </AppModal>
      )}
    </main>
  );
}

function FileCount({ n }: { n: number }) {
  return n > 0 ? (
    <span className="inline-flex items-center gap-0.5 text-sky-300" title={`${n} file${n === 1 ? "" : "s"}`}><Paperclip className="h-3 w-3" />{n}</span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

// ---------------------------------------------------------------------
// Add / edit
// ---------------------------------------------------------------------

/** Cut-off choices: every period end from Jan of last year to two periods ahead, newest first, plus the saved one if it's off-cycle. */
function cutoffChoices(saved: string | null): { value: string; label: string }[] {
  const today = todayISO();
  const out: { value: string; label: string }[] = [];
  const first = `${yearOf(today) - 1}-01-01`;
  for (let p = payPeriodContaining(addDaysISO(today, 28)); p.end >= first; p = payPeriodContaining(addDaysISO(p.start, -1))) {
    out.push({ value: p.end, label: `${fmtDate(p.end)}  (${periodLabel(p)})` });
  }
  if (saved && !out.some((o) => o.value === saved)) out.unshift({ value: saved, label: fmtDate(saved) });
  return out;
}

const blankInput = (): TechDamageInput => ({
  area: "",
  bmSbm: "",
  technicianProfileId: null,
  technicianName: "",
  damageDate: todayISO(),
  ticketNumber: "",
  damageType: "",
  houseDamage: 0,
  partsDamage: 0,
  deductionPerPayroll: 0,
  cutoffDate: null,
  status: "ongoing",
  notes: "",
});

const toInput = (d: TechDamage): TechDamageInput => ({
  area: d.area,
  bmSbm: d.bmSbm,
  technicianProfileId: d.technicianProfileId,
  technicianName: d.technicianName,
  damageDate: d.damageDate,
  ticketNumber: d.ticketNumber,
  damageType: d.damageType,
  houseDamage: d.houseDamage,
  partsDamage: d.partsDamage,
  deductionPerPayroll: d.deductionPerPayroll,
  cutoffDate: d.cutoffDate,
  status: d.status,
  notes: d.notes,
});

/** Typed money → number; blank is 0. */
const parseMoney = (s: string) => {
  const n = Number(String(s).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
const moneyText = (n: number) => (n ? String(n) : "");

function DamageModal({
  damage,
  canWrite,
  myId,
  people,
  branches,
  typeSuggestions,
  events,
  onClose,
  onSaved,
}: {
  damage: TechDamage | null;
  canWrite: boolean;
  myId: string | null;
  people: ProfileRow[];
  branches: BranchRoles[];
  typeSuggestions: string[];
  events: TechDamageEvent[];
  onClose: () => void;
  onSaved: (d: TechDamage, created: boolean) => void;
}) {
  const readOnly = !canWrite || !!damage?.deletedAt;
  const [form, setForm] = useState<TechDamageInput>(() => (damage ? toInput(damage) : blankInput()));
  const [amounts, setAmounts] = useState(() => ({
    house: moneyText(damage?.houseDamage ?? 0),
    parts: moneyText(damage?.partsDamage ?? 0),
    deduction: moneyText(damage?.deductionPerPayroll ?? 0),
  }));
  const [pending, setPending] = useState<Record<TechDamageFileKind, File[]>>({ damage: [], waiver: [] });
  const [saving, setSaving] = useState(false);
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  const set = <K extends keyof TechDamageInput>(k: K, v: TechDamageInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const technicians = useMemo(
    () => people.filter((p) => p.is_active && isEligibleForTechnicianFormChecklist(p.role, p.extra_roles)).sort((a, b) => String(a.display_name).localeCompare(String(b.display_name))),
    [people]
  );
  const managerNames = useMemo(() => {
    const s = new Set<string>();
    for (const b of branches) for (const n of [b.branchManager, b.seniorBranchManager]) if (n?.trim()) s.add(n.trim());
    return [...s].sort();
  }, [branches]);
  const branchFor = (area: string) => branches.find((b) => b.branch.trim().toLowerCase() === area.trim().toLowerCase());
  const managersFor = (area: string) => {
    const b = branchFor(area);
    return b ? [b.branchManager, b.seniorBranchManager].map((n) => n?.trim()).filter(Boolean).join(" / ") : "";
  };

  // Picking a technician fills Area and BM / SBM from their branch (still editable) when those are blank or were filled the same way.
  const autoFilled = useRef({ area: "", bmSbm: "" });
  const pickTechnician = (name: string) => {
    const person = findPersonByName(name, technicians) ?? findPersonByName(name, people);
    setForm((f) => {
      const next = { ...f, technicianName: name, technicianProfileId: person?.id ?? null };
      const area = person?.assigned_branch?.trim() || "";
      if (area && (!f.area || f.area === autoFilled.current.area)) {
        next.area = area;
        autoFilled.current.area = area;
        const bm = managersFor(area);
        if (bm && (!f.bmSbm || f.bmSbm === autoFilled.current.bmSbm)) {
          next.bmSbm = bm;
          autoFilled.current.bmSbm = bm;
        }
      }
      return next;
    });
  };
  const pickArea = (area: string) => {
    setForm((f) => {
      const next = { ...f, area };
      const bm = managersFor(area);
      if (bm && (!f.bmSbm || f.bmSbm === autoFilled.current.bmSbm)) {
        next.bmSbm = bm;
        autoFilled.current.bmSbm = bm;
      }
      return next;
    });
  };

  const house = parseMoney(amounts.house || "0");
  const parts = parseMoney(amounts.parts || "0");
  const deduction = parseMoney(amounts.deduction || "0");
  const total = (Number.isFinite(house) ? house : 0) + (Number.isFinite(parts) ? parts : 0);
  const balance = total - (Number.isFinite(deduction) ? deduction : 0);
  const problem =
    !form.technicianName.trim() ? "Pick or type the technician."
    : !form.damageDate ? "Enter the date of the damage."
    : [house, parts, deduction].some((n) => !Number.isFinite(n) || n < 0) ? "Amounts must be numbers, $0 or more."
    : total <= 0 ? "Enter the house damage, the parts damage, or both."
    : deduction > total ? "The deduction per payroll can't be more than the total amount."
    : null;
  const cutoffs = useMemo(() => cutoffChoices(damage?.cutoffDate ?? null), [damage?.cutoffDate]);

  const save = async () => {
    if (problem || readOnly) return;
    setSaving(true);
    const input: TechDamageInput = { ...form, houseDamage: house, partsDamage: parts, deductionPerPayroll: deduction };
    try {
      let saved = damage ? await updateTechDamage(damage.id, input) : await createTechDamage(input);
      for (const kind of ["damage", "waiver"] as const) {
        if (pending[kind].length) {
          try {
            saved = await addTechDamageFiles(saved, kind, pending[kind], myId);
          } catch (e: any) {
            toast.error(`Saved, but an attachment didn't upload: ${e?.message || "error"}`);
          }
        }
      }
      setPending({ damage: [], waiver: [] });
      onSaved(saved, !damage);
      toast.success(damage ? "Saved." : `Added ${saved.technicianName}'s damage.`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };

  const uploadNow = async (kind: TechDamageFileKind, list: File[]) => {
    if (!damage || !list.length) return;
    setFileBusy(kind);
    try {
      onSaved(await addTechDamageFiles(damage, kind, list, myId), false);
      toast.success(`${list.length} file${list.length === 1 ? "" : "s"} attached.`);
    } catch (e: any) {
      toast.error(e?.message || "Upload failed.");
    } finally {
      setFileBusy(null);
    }
  };
  const removeNow = async (kind: TechDamageFileKind, path: string, name: string) => {
    if (!damage || !window.confirm(`Remove ${name}?`)) return;
    setFileBusy(path);
    try {
      onSaved(await removeTechDamageFile(damage, kind, path), false);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't remove it.");
    } finally {
      setFileBusy(null);
    }
  };
  const openFile = async (path: string) => {
    const w = window.open("", "_blank");
    try {
      const url = await getTechDamageFileUrl(path);
      if (w) w.location.href = url;
      else window.location.href = url;
    } catch (e: any) {
      w?.close();
      toast.error(e?.message || "Couldn't open the file.");
    }
  };

  const label = "grid gap-1 text-xs text-muted-foreground";
  const input = "glass-input text-sm text-foreground disabled:opacity-70";

  const fileSection = (kind: TechDamageFileKind, title: string) => {
    const saved = damage ? (kind === "damage" ? damage.damageFiles : damage.waiverFiles) : [];
    return (
      <div className="rounded-lg border border-[var(--color-panel-border)] p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-sm font-medium">{title}</div>
          {!readOnly && (
            <label className={`btn text-xs cursor-pointer ${fileBusy === kind ? "opacity-60 pointer-events-none" : ""}`}>
              <Upload className="h-3.5 w-3.5" /> {fileBusy === kind ? "Uploading…" : "Attach"}
              <input
                type="file"
                multiple
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const list = [...(e.target.files ?? [])];
                  e.target.value = "";
                  if (damage) void uploadNow(kind, list);
                  else setPending((p) => ({ ...p, [kind]: [...p[kind], ...list] }));
                }}
              />
            </label>
          )}
        </div>
        {saved.length === 0 && pending[kind].length === 0 ? (
          <div className="text-xs text-muted-foreground">No files yet.</div>
        ) : (
          <ul className="grid gap-1">
            {saved.map((f) => (
              <li key={f.path} className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <button type="button" className="underline hover:text-foreground truncate text-left" onClick={() => void openFile(f.path)}>{f.name}</button>
                {f.uploadedAt && <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(f.uploadedAt)}</span>}
                {!readOnly && (
                  <button type="button" className="ml-auto text-muted-foreground hover:text-red-300" title="Remove" disabled={fileBusy === f.path} onClick={() => void removeNow(kind, f.path, f.name)}>
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
            {pending[kind].map((f, i) => (
              <li key={`p${i}`} className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{f.name}</span>
                <span className="text-xs text-amber-300 whitespace-nowrap">uploads when you save</span>
                <button type="button" className="ml-auto text-muted-foreground hover:text-red-300" title="Remove" onClick={() => setPending((p) => ({ ...p, [kind]: p[kind].filter((_, j) => j !== i) }))}>
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <AppModal
      title={damage ? (readOnly ? "Tech damage" : "Edit tech damage") : "Add tech damage"}
      description={damage ? `${damage.technicianName} — ${fmtDate(damage.damageDate)}${damage.deletedAt ? " (deleted)" : ""}` : "Total and Balance are worked out for you."}
      icon={<Wrench />}
      size="xl"
      busy={saving}
      onClose={onClose}
      footer={
        <>
          {problem && !readOnly && <span className="mr-auto text-xs text-amber-300">{problem}</span>}
          <button type="button" className="btn" onClick={onClose} disabled={saving}>{readOnly ? "Close" : "Cancel"}</button>
          {!readOnly && (
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || !!problem}>
              {saving ? "Saving…" : damage ? "Save" : "Add Damage"}
            </button>
          )}
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={label}>
            Technician
            <input className={input} list="td-technicians" value={form.technicianName} disabled={readOnly} placeholder="Type or pick a name" onChange={(e) => pickTechnician(e.target.value)} />
          </label>
          <label className={label}>
            Area
            <input className={input} list="td-areas" value={form.area} disabled={readOnly} placeholder="Branch / area" onChange={(e) => pickArea(e.target.value)} />
          </label>
          <label className={label}>
            BM / SBM
            <input className={input} list="td-managers" value={form.bmSbm} disabled={readOnly} onChange={(e) => set("bmSbm", e.target.value)} />
          </label>
          <label className={label}>
            Date
            <input type="date" className={input} value={form.damageDate} disabled={readOnly} onChange={(e) => set("damageDate", e.target.value)} />
          </label>
          <label className={label}>
            Ticket Number
            <input className={input} value={form.ticketNumber} disabled={readOnly} onChange={(e) => set("ticketNumber", e.target.value)} />
          </label>
          <label className={label}>
            Type of damage
            <input className={input} list="td-types" value={form.damageType} disabled={readOnly} placeholder="e.g. Scratched floor" onChange={(e) => set("damageType", e.target.value)} />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 tabular-nums">
          <label className={label}>
            House Damage $
            <input inputMode="decimal" className={input} value={amounts.house} disabled={readOnly} placeholder="0.00" onChange={(e) => setAmounts((a) => ({ ...a, house: e.target.value }))} />
          </label>
          <label className={label}>
            Parts Damage $
            <input inputMode="decimal" className={input} value={amounts.parts} disabled={readOnly} placeholder="0.00" onChange={(e) => setAmounts((a) => ({ ...a, parts: e.target.value }))} />
          </label>
          <div className={label}>
            <span>Total Amount $ <span className="text-[10px]">(house + parts)</span></span>
            <div className="glass-input text-sm font-semibold text-foreground">{money(total)}</div>
          </div>
          <label className={label}>
            Deduction per payroll $
            <input inputMode="decimal" className={input} value={amounts.deduction} disabled={readOnly} placeholder="0.00" onChange={(e) => setAmounts((a) => ({ ...a, deduction: e.target.value }))} />
          </label>
          <label className={label}>
            Cut off date
            <select className={input} value={form.cutoffDate ?? ""} disabled={readOnly} onChange={(e) => set("cutoffDate", e.target.value || null)}>
              <option value="">Not set yet</option>
              {cutoffs.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <div className={label}>
            <span>Balance <span className="text-[10px]">(total − deduction)</span></span>
            <div className={`glass-input text-sm font-semibold ${balance > 0 ? "text-red-300" : "text-emerald-300"}`}>{money(balance)}</div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className={label}>
            Status
            <select className={input} value={form.status} disabled={readOnly} onChange={(e) => set("status", e.target.value as TechDamageStatus)}>
              <option value="ongoing">Ongoing</option>
              <option value="paid">Paid</option>
            </select>
          </label>
          <label className={`${label} sm:col-span-2`}>
            Notes
            <textarea className={`${input} min-h-[4.5rem]`} value={form.notes} disabled={readOnly} onChange={(e) => set("notes", e.target.value)} />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {fileSection("damage", "Attachment of the damages")}
          {fileSection("waiver", "Waiver Attachment")}
        </div>

        {damage && (
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">History</div>
            {events.length === 0 ? (
              <div className="text-xs text-muted-foreground">Added by {damage.createdByName || "—"} on {fmtDateTime(damage.createdAt)}.</div>
            ) : (
              <ul className="grid gap-1 text-xs">
                {events.map((e) => (
                  <li key={e.id} className="text-muted-foreground">
                    <span className="text-foreground">{EVENT_LABEL[e.action] ?? e.action}</span> by {e.actorName || "—"} · {fmtDateTime(e.createdAt)}
                    {e.detail ? ` — ${e.detail}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <datalist id="td-technicians">{technicians.map((p) => <option key={p.id} value={p.display_name ?? ""}>{p.assigned_branch || ""}</option>)}</datalist>
      <datalist id="td-areas">{branches.map((b) => <option key={b.id} value={b.branch} />)}</datalist>
      <datalist id="td-managers">{managerNames.map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="td-types">{typeSuggestions.map((t) => <option key={t} value={t} />)}</datalist>
    </AppModal>
  );
}
