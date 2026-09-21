/**
 * Claims Daily Report — replaces the team's manual daily spreadsheet
 * (brand Open/Claim/Pend counts, a "Remaining" reason breakdown, a staff
 * roster, and a Pre-Authorization/Back Orders/Data-Closed tracker) with a
 * real page, following the same manual daily-entry pattern already proven
 * out by PartsDailyReportEbay.tsx — but scoped to ONE day at a time (a
 * snapshot, not a date-range rollup), since that's what the spreadsheet
 * actually was.
 *
 * Brand/Remaining counts are typed in by hand each day (migration 0293's
 * claims_daily_brand_counts / claims_daily_remaining_counts) rather than
 * computed from ticket data — same "manual entry, like eBay" choice this
 * feature was built with. The staff roster ties to real employee profiles
 * (same isClaimsProfile role check ClaimsDashboard.tsx already uses) —
 * Start Date, Hourly Rate, Position, Hours (of work), and Sick/Vacation
 * Leave are all read live from profiles.employee_info, profiles.
 * working_hours, salary_entries, and the same pto_requests-based
 * remaining-balance calculation Master List's own Sick Leave/Vacation
 * columns use, so none of it can drift from the real record. Only
 * Claimed/Covered/Remarks/Warnings/Performance are typed in per report
 * (claims_daily_staff_entries).
 *
 * Distinct from ReportClaimsDaily.tsx (/m/report/report-claims-daily), a
 * different, already-shipped live ticket-KPI report — unrelated to this page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, ChevronRight, ChevronLeft as ChevronLeftNav, Download, Pencil, Plus, Trash2, X, Loader2 } from "lucide-react";
import * as XLSX from "xlsx";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyUsers, getEmployeeInfoByProfileIds, getWorkingHoursByProfileIds, type ProfileRow, type EmployeeInfo } from "@/lib/supabase/users";
import { getCompanySalaryEntries, entryEffectiveOn, type SalaryEntryRow } from "@/lib/supabase/salary";
import { getCompanyPtoRequests, ptoYearWindow, sickYearWindow, ptoDaysUsed, sickDaysUsed, type PtoRequestRow } from "@/lib/supabase/pto";
import { normalizeRole, ROLE_LABELS } from "@/lib/roleLabels";
import {
  getClaimsBrands, addClaimsBrand, removeClaimsBrand, type ClaimsBrand,
  getClaimsRemainingReasons, addClaimsRemainingReason, removeClaimsRemainingReason, type ClaimsRemainingReason,
  getClaimsDailyReportHeader, upsertClaimsDailyReportHeader, type ClaimsDailyReportHeader,
  getClaimsBrandCounts, upsertClaimsBrandCount, type ClaimsBrandCount,
  getClaimsRemainingCounts, upsertClaimsRemainingCount, type ClaimsRemainingCount,
  getClaimsStaffEntries, upsertClaimsStaffEntry, type ClaimsStaffEntry,
  getClaimsTaskEntries, addClaimsTaskEntry, updateClaimsTaskEntry, deleteClaimsTaskEntry, type ClaimsTaskEntry, type ClaimsTask,
} from "@/lib/supabase/claimsDailyReport";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const CLAIMS_ROLES = new Set(["CLAIMS", "CLAIMS_MANAGER"]);
// Same convention as ClaimsDashboard.tsx's isClaimsProfile — checks both
// primary role AND extra_roles for dual-role users.
function isClaimsProfile(p: ProfileRow): boolean {
  if (CLAIMS_ROLES.has(normalizeRole(p.role))) return true;
  return (p.extra_roles || []).some((r) => CLAIMS_ROLES.has(normalizeRole(r)));
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDaysISO(date: string, days: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type ClaimsPerformanceFlag = "warning" | "low_performance" | "good" | "great";

const PERFORMANCE_FLAGS: { value: ClaimsPerformanceFlag; label: string; dot: string; rowTone: string; cellTone: string }[] = [
  { value: "warning", label: "Warning", dot: "bg-red-500", rowTone: "bg-red-500/10", cellTone: "bg-red-500/80 text-white" },
  { value: "low_performance", label: "Low Performance", dot: "bg-yellow-500", rowTone: "bg-yellow-500/10", cellTone: "bg-yellow-400/80 text-slate-900" },
  { value: "good", label: "Good", dot: "bg-teal-500", rowTone: "bg-teal-500/10", cellTone: "bg-teal-500/70 text-white" },
  { value: "great", label: "Great Performance", dot: "bg-green-500", rowTone: "bg-green-500/10", cellTone: "bg-green-500/80 text-white" },
];
const FLAG_BY_VALUE = new Map(PERFORMANCE_FLAGS.map((f) => [f.value, f]));

// Below 30 claimed = Warning, below 40 = Low Performance, below 50 = Good,
// below 60 and up = Great Performance — thresholds given directly by the
// Claims team, applied live off claimed_count rather than picked by hand,
// so the whole roster re-colors itself the moment a count changes and a
// later threshold tweak applies retroactively to every past report too.
function computeFlagFromClaimed(claimed: number): ClaimsPerformanceFlag {
  if (claimed < 30) return "warning";
  if (claimed < 40) return "low_performance";
  if (claimed < 50) return "good";
  return "great";
}

const TASKS: ClaimsTask[] = ["Pre-Authorization", "Back Orders", "Data-Closed"];

const TABS = [
  { id: "overview" as const, label: "Overview" },
  { id: "staff" as const, label: "Staff Roster" },
  { id: "tasks" as const, label: "Pre-Auth / Back Orders / Data-Closed" },
];
type TabId = (typeof TABS)[number]["id"];

function errMsg(err: unknown, fallback: string): string {
  console.error(fallback, err);
  if (err && typeof err === "object" && "message" in err && typeof (err as any).message === "string" && (err as any).message) {
    return (err as any).message;
  }
  return fallback;
}

// Small reusable "manage this list" modal — used for both the Brand list
// and the Remaining-reason list (claims_brands / claims_remaining_reasons),
// which are otherwise identical shapes: name, add, soft-delete.
function EditListModal({
  title, items, onAdd, onRemove, onClose,
}: {
  title: string;
  items: { id: string; name: string }[];
  onAdd: (name: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await onAdd(newName.trim());
      setNewName("");
    } catch (err) {
      alert(errMsg(err, "Failed to add."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-md border border-white/15 bg-slate-800/70 p-1.5 text-slate-300 hover:bg-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mb-3 max-h-64 overflow-y-auto rounded-lg border border-white/10 divide-y divide-white/10">
          {items.length === 0 ? (
            <div className="px-3 py-3 text-xs text-slate-500">Nothing yet.</div>
          ) : (
            items.map((it) => (
              <div key={it.id} className="flex items-center justify-between px-3 py-2 text-sm text-slate-200">
                <span>{it.name}</span>
                <button
                  type="button"
                  onClick={async () => { try { await onRemove(it.id); } catch (err) { alert(errMsg(err, "Failed to remove.")); } }}
                  className="text-slate-500 hover:text-red-300"
                  title="Remove"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
            placeholder="Add new…"
            className="glass-input flex-1 text-sm py-1.5 px-2 rounded-md"
          />
          <button type="button" disabled={busy || !newName.trim()} onClick={handleAdd} className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium transition">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// Which real brands (from claims_brands) this staff member covers — a
// multi-select checklist against the actual Brand list rather than free
// text, so "Covered" can never drift into a name that isn't a real brand.
// Stored as a comma-joined string on claims_daily_staff_entries.covered_brands
// (no schema change needed), just picked from a real list instead of typed.
function CoveredBrandsCell({
  brands, selected, onChange,
}: {
  brands: ClaimsBrand[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);
  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);
  };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="glass-input text-xs py-1 px-1.5 rounded w-40 text-left truncate block"
        title={selected.join(", ")}
      >
        {selected.length > 0 ? selected.join(", ") : <span className="text-slate-500">Select brands…</span>}
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-48 max-h-56 overflow-y-auto rounded-md border border-white/15 bg-slate-900 shadow-xl p-1.5">
          {brands.length === 0 ? (
            <div className="px-2 py-1 text-xs text-slate-500">No brands yet.</div>
          ) : (
            brands.map((b) => (
              <label key={b.id} className="flex items-center gap-2 px-2 py-1 text-xs text-slate-200 hover:bg-white/5 rounded cursor-pointer">
                <input type="checkbox" checked={selected.includes(b.name)} onChange={() => toggle(b.name)} />
                {b.name}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Small-circle legend style, same as BranchManagerCommissionTab.tsx's tier
// dots — sits right beside the Claimed count it describes. Purely a
// computed display (see computeFlagFromClaimed): the flag is derived from
// the claimed count, not picked by hand, so there's nothing to click here.
function PerformanceFlagDot({ claimed }: { claimed: number }) {
  const flag = FLAG_BY_VALUE.get(computeFlagFromClaimed(claimed))!;
  return <span className={`inline-block h-3 w-3 rounded-full shrink-0 ring-1 ring-white/20 ${flag.dot}`} title={flag.label} />;
}

export function ClaimsDailyReport({ mod, sub }: Props) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));

  const [tab, setTab] = useState<TabId>("overview");
  const [reportDate, setReportDate] = useState(todayStr());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Company-wide, loaded once.
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [employeeInfo, setEmployeeInfo] = useState<Map<string, EmployeeInfo>>(new Map());
  const [salaryEntries, setSalaryEntries] = useState<SalaryEntryRow[]>([]);
  const [workingHours, setWorkingHours] = useState<Map<string, number | null>>(new Map());
  const [ptoRequests, setPtoRequests] = useState<PtoRequestRow[]>([]);
  const [brands, setBrands] = useState<ClaimsBrand[]>([]);
  const [reasons, setReasons] = useState<ClaimsRemainingReason[]>([]);
  const [editBrandsOpen, setEditBrandsOpen] = useState(false);
  const [editReasonsOpen, setEditReasonsOpen] = useState(false);

  // Extra staff manually added to the roster beyond the CLAIMS-role filter
  // (e.g. someone temporarily covering claims) — persists locally per
  // session via whatever already has a staff entry, resolved below.
  const [extraStaffIds, setExtraStaffIds] = useState<Set<string>>(new Set());
  const [addStaffId, setAddStaffId] = useState("");

  // Per-report-date data.
  const [header, setHeader] = useState<ClaimsDailyReportHeader>({ reportDate: todayStr(), snapshotLabel: "", overviewNote: "", trainingCount: 0, generalNote: "" });
  const [brandCounts, setBrandCounts] = useState<Map<string, ClaimsBrandCount>>(new Map());
  const [remainingCounts, setRemainingCounts] = useState<Map<string, ClaimsRemainingCount>>(new Map());
  const [staffEntries, setStaffEntries] = useState<Map<string, ClaimsStaffEntry>>(new Map());
  const [taskEntries, setTaskEntries] = useState<ClaimsTaskEntry[]>([]);
  const [newTaskAssignee, setNewTaskAssignee] = useState<Record<ClaimsTask, string>>({ "Pre-Authorization": "", "Back Orders": "", "Data-Closed": "" });

  const loadStatic = useCallback(async () => {
    try {
      const [profileRows, salaryRows, ptoRows, brandRows, reasonRows] = await Promise.all([
        getCompanyUsers(),
        getCompanySalaryEntries(),
        getCompanyPtoRequests(),
        getClaimsBrands(),
        getClaimsRemainingReasons(),
      ]);
      setProfiles(profileRows);
      setSalaryEntries(salaryRows);
      setPtoRequests(ptoRows);
      setBrands(brandRows);
      setReasons(reasonRows);
      const claimsIds = profileRows.filter((p) => p.is_active && isClaimsProfile(p)).map((p) => p.id);
      if (claimsIds.length > 0) {
        const [info, hours] = await Promise.all([getEmployeeInfoByProfileIds(claimsIds), getWorkingHoursByProfileIds(claimsIds)]);
        setEmployeeInfo(info);
        setWorkingHours(hours);
      }
    } catch (err) {
      setError(errMsg(err, "Failed to load data."));
    }
  }, []);
  useEffect(() => { void loadStatic(); }, [loadStatic]);

  const loadForDate = useCallback(async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      const [h, bc, rc, se, te] = await Promise.all([
        getClaimsDailyReportHeader(date),
        getClaimsBrandCounts(date),
        getClaimsRemainingCounts(date),
        getClaimsStaffEntries(date),
        getClaimsTaskEntries(date),
      ]);
      setHeader(h);
      setBrandCounts(new Map(bc.map((r) => [r.brand, r])));
      setRemainingCounts(new Map(rc.map((r) => [r.reason, r])));
      setStaffEntries(new Map(se.map((r) => [r.profileId, r])));
      setTaskEntries(te);
      setExtraStaffIds(new Set(se.map((r) => r.profileId)));
    } catch (err) {
      setError(errMsg(err, "Failed to load this date's report."));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void loadForDate(reportDate); }, [reportDate, loadForDate]);

  // Load employee_info/working_hours for any extra staff added outside the CLAIMS role filter.
  useEffect(() => {
    const missing = [...extraStaffIds].filter((id) => !employeeInfo.has(id));
    if (missing.length === 0) return;
    Promise.all([getEmployeeInfoByProfileIds(missing), getWorkingHoursByProfileIds(missing)])
      .then(([info, hours]) => {
        setEmployeeInfo((prev) => new Map([...prev, ...info]));
        setWorkingHours((prev) => new Map([...prev, ...hours]));
      })
      .catch((err) => console.error("Failed to load employee info:", err));
  }, [extraStaffIds, employeeInfo]);

  const salaryByProfile = useMemo(() => {
    const map = new Map<string, SalaryEntryRow[]>();
    for (const s of salaryEntries) {
      const list = map.get(s.profileId);
      if (list) list.push(s);
      else map.set(s.profileId, [s]);
    }
    return map;
  }, [salaryEntries]);

  const resolveHourlyRate = useCallback(
    (profileId: string) => {
      const entry = entryEffectiveOn(salaryByProfile.get(profileId) ?? [], reportDate);
      return entry && entry.compensationType === "hourly" ? entry.hourlyRate : null;
    },
    [salaryByProfile, reportDate]
  );

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const ptoRequestsByProfile = useMemo(() => {
    const map = new Map<string, PtoRequestRow[]>();
    for (const r of ptoRequests) {
      const list = map.get(r.profileId);
      if (list) list.push(r);
      else map.set(r.profileId, [r]);
    }
    return map;
  }, [ptoRequests]);

  // employee_info.hireDate is only ever set once someone fills in Master
  // List's own Start Date column — a just-added trainee has no reason to
  // have that yet, so this falls back to the profile's own created_at
  // (when the account was actually made, which for a trainee added on
  // their first day is a close real stand-in) — same hireDate-then-
  // createdAt fallback pto.ts's own ptoYearWindow/sickYearWindow already
  // use internally for PTO eligibility.
  const resolveStartDate = useCallback(
    (profileId: string): string => {
      const hireDate = employeeInfo.get(profileId)?.hireDate;
      if (hireDate) return hireDate;
      return profileById.get(profileId)?.created_at?.slice(0, 10) || "";
    },
    [employeeInfo, profileById]
  );

  // Same remaining-balance math as ReportHRDaily.tsx's Master List "Sick
  // Leave"/"Vacation" columns (ptoYearWindow/sickYearWindow anchored to the
  // employee's hire anniversary, minus days already used this tenure
  // year) — "Not Yet Eligible" before the vacation waiting period elapses,
  // same label Master List shows. Doesn't include Master List's extra
  // HR-plotted-absence merge (hrPlottedDaysForBalance) — that's sourced
  // from a separate HR-status note table this report has no reason to
  // duplicate; only real pto_requests count here.
  const resolveLeaveBalance = useCallback(
    (profileId: string, kind: "vacation" | "sick"): number | "Not Yet Eligible" => {
      const p = profileById.get(profileId);
      const hireDate = resolveStartDate(profileId) || null;
      const window = kind === "vacation" ? ptoYearWindow(hireDate, p?.created_at ?? null, reportDate) : sickYearWindow(hireDate, p?.created_at ?? null, reportDate);
      if (!window) return "Not Yet Eligible";
      const requests = ptoRequestsByProfile.get(profileId) ?? [];
      const used = kind === "vacation" ? ptoDaysUsed(requests, window) : sickDaysUsed(requests, window);
      return Math.max(0, window.allowance - used);
    },
    [profileById, resolveStartDate, ptoRequestsByProfile, reportDate]
  );

  const rosterProfiles = useMemo(() => {
    const base = profiles.filter((p) => p.is_active && isClaimsProfile(p));
    const baseIds = new Set(base.map((p) => p.id));
    const extras = [...extraStaffIds].filter((id) => !baseIds.has(id)).map((id) => profileById.get(id)).filter((p): p is ProfileRow => !!p);
    return [...base, ...extras].sort((a, b) => (a.display_name || a.email).localeCompare(b.display_name || b.email));
  }, [profiles, extraStaffIds, profileById]);

  const addableProfiles = useMemo(() => {
    const rosterIds = new Set(rosterProfiles.map((p) => p.id));
    return profiles.filter((p) => p.is_active && !rosterIds.has(p.id)).sort((a, b) => (a.display_name || a.email).localeCompare(b.display_name || b.email));
  }, [profiles, rosterProfiles]);

  // ── Brand counts ──────────────────────────────────────────────────────
  const getBrandCount = (brand: string): ClaimsBrandCount => brandCounts.get(brand) || { brand, openCount: 0, claimCount: 0, pendCount: 0 };
  const updateBrandField = (brand: string, field: "openCount" | "claimCount" | "pendCount", value: number) => {
    setBrandCounts((prev) => {
      const next = new Map(prev);
      next.set(brand, { ...getBrandCount(brand), [field]: value });
      return next;
    });
  };
  const saveBrandField = async (brand: string, field: "openCount" | "claimCount" | "pendCount", value: number) => {
    try {
      await upsertClaimsBrandCount(reportDate, brand, { [field]: value });
    } catch (err) {
      setError(errMsg(err, "Failed to save."));
    }
  };

  const brandTotals = useMemo(() => {
    return brands.reduce(
      (acc, b) => {
        const c = getBrandCount(b.name);
        acc.open += c.openCount; acc.claim += c.claimCount; acc.pend += c.pendCount;
        return acc;
      },
      { open: 0, claim: 0, pend: 0 }
    );
  }, [brands, brandCounts]);

  // ── Remaining reason counts ──────────────────────────────────────────
  const getRemainingCount = (reason: string): number => remainingCounts.get(reason)?.count ?? 0;
  const updateRemainingField = (reason: string, value: number) => {
    setRemainingCounts((prev) => {
      const next = new Map(prev);
      next.set(reason, { reason, count: value });
      return next;
    });
  };
  const saveRemainingField = async (reason: string, value: number) => {
    try {
      await upsertClaimsRemainingCount(reportDate, reason, value);
    } catch (err) {
      setError(errMsg(err, "Failed to save."));
    }
  };

  // ── Report header (snapshot label / notes / training count) ─────────
  const updateHeaderField = <K extends keyof ClaimsDailyReportHeader>(field: K, value: ClaimsDailyReportHeader[K]) => {
    setHeader((prev) => ({ ...prev, [field]: value }));
  };
  const saveHeaderField = async (patch: Partial<ClaimsDailyReportHeader>) => {
    try {
      await upsertClaimsDailyReportHeader(reportDate, patch);
    } catch (err) {
      setError(errMsg(err, "Failed to save."));
    }
  };

  // ── Staff roster entries ─────────────────────────────────────────────
  const getStaffEntry = (profileId: string): ClaimsStaffEntry =>
    staffEntries.get(profileId) || { profileId, claimedCount: 0, coveredBrands: "", remarks: "", warnings: 0 };
  const updateStaffField = <K extends keyof ClaimsStaffEntry>(profileId: string, field: K, value: ClaimsStaffEntry[K]) => {
    setStaffEntries((prev) => {
      const next = new Map(prev);
      next.set(profileId, { ...getStaffEntry(profileId), [field]: value });
      return next;
    });
  };
  const saveStaffField = async (profileId: string, patch: Partial<Omit<ClaimsStaffEntry, "profileId">>) => {
    try {
      await upsertClaimsStaffEntry(reportDate, profileId, patch);
      setExtraStaffIds((prev) => new Set(prev).add(profileId));
    } catch (err) {
      setError(errMsg(err, "Failed to save."));
    }
  };

  const handleAddStaff = () => {
    if (!addStaffId) return;
    setExtraStaffIds((prev) => new Set(prev).add(addStaffId));
    setAddStaffId("");
  };

  // ── Task tracker (Pre-Auth / Back Orders / Data-Closed) ──────────────
  const taskRows = (task: ClaimsTask) => taskEntries.filter((t) => t.task === task);
  const handleAddTaskRow = async (task: ClaimsTask) => {
    const name = newTaskAssignee[task].trim();
    if (!name) return;
    try {
      const id = await addClaimsTaskEntry(reportDate, task, name);
      setTaskEntries((prev) => [...prev, { id, task, assigneeName: name, pendingCount: 0, handledCount: 0, movedCount: 0 }]);
      setNewTaskAssignee((prev) => ({ ...prev, [task]: "" }));
    } catch (err) {
      alert(errMsg(err, "Failed to add row."));
    }
  };
  const updateTaskField = (id: string, field: "pendingCount" | "handledCount" | "movedCount", value: number) => {
    setTaskEntries((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  };
  const saveTaskField = async (id: string, field: "pendingCount" | "handledCount" | "movedCount", value: number) => {
    try {
      await updateClaimsTaskEntry(id, { [field]: value });
    } catch (err) {
      setError(errMsg(err, "Failed to save."));
    }
  };
  const handleDeleteTaskRow = async (id: string) => {
    try {
      await deleteClaimsTaskEntry(id);
      setTaskEntries((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      alert(errMsg(err, "Failed to remove row."));
    }
  };

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const aoa: (string | number)[][] = [];
    aoa.push([`Claims Daily Report — ${reportDate}`]);
    if (header.snapshotLabel) aoa.push([`As of: ${header.snapshotLabel}`]);
    aoa.push([]);
    aoa.push(["Brand", "Open", "Claim", "Pend"]);
    for (const b of brands) {
      const c = getBrandCount(b.name);
      aoa.push([b.name, c.openCount, c.claimCount, c.pendCount]);
    }
    aoa.push(["TOTAL", brandTotals.open, brandTotals.claim, brandTotals.pend]);
    aoa.push([]);
    aoa.push(["Remaining", "Count"]);
    for (const r of reasons) aoa.push([r.name, getRemainingCount(r.name)]);
    aoa.push([]);
    aoa.push(["Claimed", brandTotals.claim, "Remaining", brandTotals.pend, "Staff", rosterProfiles.length, "Training", header.trainingCount]);
    aoa.push([]);
    aoa.push(["Full Name", "Start Date", "Hourly Rate", "Position", "Hours", "Sick", "Vacation", "Claimed", "Flag", "Covered", "Remarks", "Warnings"]);
    for (const p of rosterProfiles) {
      const entry = getStaffEntry(p.id);
      const rate = resolveHourlyRate(p.id);
      aoa.push([
        p.display_name || p.email,
        resolveStartDate(p.id),
        rate ?? "",
        ROLE_LABELS[normalizeRole(p.role)] || p.role,
        workingHours.get(p.id) ?? "",
        resolveLeaveBalance(p.id, "sick"),
        resolveLeaveBalance(p.id, "vacation"),
        entry.claimedCount,
        FLAG_BY_VALUE.get(computeFlagFromClaimed(entry.claimedCount))!.label,
        entry.coveredBrands, entry.remarks, entry.warnings,
      ]);
    }
    for (const task of TASKS) {
      aoa.push([]);
      aoa.push([task]);
      aoa.push(["Assignee", "Pending", "Handled", "Moved"]);
      for (const t of taskRows(task)) aoa.push([t.assigneeName, t.pendingCount, t.handledCount, t.movedCount]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, "Claims Daily Report");
    XLSX.writeFile(wb, `Claims_Daily_Report_${reportDate}.xlsx`);
  };

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">{mod.label}</Link><span>›</span>
        <span className="text-foreground font-medium">{sub.title}</span>
      </div>
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-3">
          <button type="button" onClick={goBack} className="btn"><ChevronLeft className="h-4 w-4" /></button>
          <h1 className="text-xl font-bold">{sub.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setReportDate((d) => addDaysISO(d, -1))} className="btn" title="Previous day">
            <ChevronLeftNav className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            className="glass-input text-sm py-1.5 px-2 rounded-md"
          />
          <button type="button" onClick={() => setReportDate((d) => addDaysISO(d, 1))} className="btn" title="Next day">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setReportDate(todayStr())} className="btn text-sm">Today</button>
          <button type="button" onClick={exportExcel} className="btn text-sm inline-flex items-center gap-1.5">
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>

      {error && (
        <div className="panel mb-4 border-red-500/30 bg-red-500/5 text-sm text-red-300 px-4 py-3">{error}</div>
      )}

      <div className="flex gap-2 mb-5 border-b border-white/10">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition ${tab === t.id ? "border-blue-500 text-white" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="panel px-4 py-12 text-center text-muted-foreground">Loading…</div>
      ) : tab === "overview" ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 panel overflow-x-auto p-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <h2 className="font-semibold text-sm">Brand</h2>
              <button type="button" onClick={() => setEditBrandsOpen(true)} className="text-xs text-blue-400 hover:text-blue-300 inline-flex items-center gap-1">
                <Pencil className="h-3 w-3" /> Edit brands
              </button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/80">
                  {["Brand", "Open", "Claim", "Pend"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-slate-200 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {brands.map((b) => {
                  const c = getBrandCount(b.name);
                  return (
                    <tr key={b.id} className="border-b border-white/5">
                      <td className="px-3 py-1.5 font-medium">{b.name}</td>
                      {(["openCount", "claimCount", "pendCount"] as const).map((field) => (
                        <td key={field} className="px-3 py-1.5">
                          <input
                            type="number"
                            value={c[field]}
                            onChange={(e) => updateBrandField(b.name, field, Number(e.target.value))}
                            onBlur={(e) => void saveBrandField(b.name, field, Number(e.target.value))}
                            className="glass-input text-sm py-1 px-2 rounded w-20 text-right"
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
                <tr className="bg-white/5 font-bold">
                  <td className="px-3 py-2">TOTAL</td>
                  <td className="px-3 py-2 text-right">{brandTotals.open}</td>
                  <td className="px-3 py-2 text-right">{brandTotals.claim}</td>
                  <td className="px-3 py-2 text-right">{brandTotals.pend}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-5">
            <div className="panel overflow-hidden p-0">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <h2 className="font-semibold text-sm">Remaining</h2>
                <button type="button" onClick={() => setEditReasonsOpen(true)} className="text-xs text-blue-400 hover:text-blue-300 inline-flex items-center gap-1">
                  <Pencil className="h-3 w-3" /> Edit reasons
                </button>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {reasons.map((r) => (
                    <tr key={r.id} className="border-b border-white/5 last:border-b-0">
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5 w-24">
                        <input
                          type="number"
                          value={getRemainingCount(r.name)}
                          onChange={(e) => updateRemainingField(r.name, Number(e.target.value))}
                          onBlur={(e) => void saveRemainingField(r.name, Number(e.target.value))}
                          className="glass-input text-sm py-1 px-2 rounded w-20 text-right"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="panel p-4">
              <h2 className="font-semibold text-sm mb-3">Data</h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><div className="text-muted-foreground text-xs">Claimed</div><div className="font-bold text-lg text-green-400">{brandTotals.claim}</div></div>
                <div><div className="text-muted-foreground text-xs">Remaining</div><div className="font-bold text-lg text-amber-400">{brandTotals.pend}</div></div>
                <div><div className="text-muted-foreground text-xs">Staff</div><div className="font-bold text-lg">{rosterProfiles.length}</div></div>
                <div>
                  <div className="text-muted-foreground text-xs">Training</div>
                  <input
                    type="number"
                    value={header.trainingCount}
                    onChange={(e) => updateHeaderField("trainingCount", Number(e.target.value))}
                    onBlur={(e) => void saveHeaderField({ trainingCount: Number(e.target.value) })}
                    className="glass-input text-sm py-1 px-2 rounded w-20 font-bold"
                  />
                </div>
              </div>
            </div>

            <div className="panel p-4 flex flex-col gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Snapshot label (e.g. "OPEN 2:59 PM")</label>
                <input
                  value={header.snapshotLabel}
                  onChange={(e) => updateHeaderField("snapshotLabel", e.target.value)}
                  onBlur={(e) => void saveHeaderField({ snapshotLabel: e.target.value })}
                  className="glass-input text-sm py-1.5 px-2 rounded-md w-full"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Overview</label>
                <textarea
                  value={header.overviewNote}
                  onChange={(e) => updateHeaderField("overviewNote", e.target.value)}
                  onBlur={(e) => void saveHeaderField({ overviewNote: e.target.value })}
                  rows={2}
                  className="glass-input text-sm py-1.5 px-2 rounded-md w-full resize-none"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Note</label>
                <textarea
                  value={header.generalNote}
                  onChange={(e) => updateHeaderField("generalNote", e.target.value)}
                  onBlur={(e) => void saveHeaderField({ generalNote: e.target.value })}
                  rows={2}
                  placeholder="e.g. low number of tks to claim today for GE and Electro"
                  className="glass-input text-sm py-1.5 px-2 rounded-md w-full resize-none"
                />
              </div>
            </div>
          </div>
        </div>
      ) : tab === "staff" ? (
        <div className="panel overflow-x-auto p-0">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 flex-wrap">
            <h2 className="font-semibold text-sm mr-auto">Staff Roster</h2>
            <select value={addStaffId} onChange={(e) => setAddStaffId(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md">
              <option value="">+ Add staff…</option>
              {addableProfiles.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name || p.email}</option>
              ))}
            </select>
            <button type="button" disabled={!addStaffId} onClick={handleAddStaff} className="btn text-sm disabled:opacity-40">Add</button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-700/80">
                {["Full Name", "Start Date", "Hourly Rate", "Position", "Hours", "Sick", "Vacation", "Claimed", "Covered", "Remarks", "Warnings"].map((h) => (
                  <th key={h} className="px-2.5 py-2 text-left text-xs font-semibold text-slate-200 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rosterProfiles.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">No Claims staff found.</td></tr>
              ) : (
                rosterProfiles.map((p) => {
                  const entry = getStaffEntry(p.id);
                  const rate = resolveHourlyRate(p.id);
                  const hours = workingHours.get(p.id);
                  const sick = resolveLeaveBalance(p.id, "sick");
                  const vacation = resolveLeaveBalance(p.id, "vacation");
                  const flag = FLAG_BY_VALUE.get(computeFlagFromClaimed(entry.claimedCount))!;
                  return (
                    <tr key={p.id} className={`border-b border-white/5 ${flag.rowTone}`}>
                      <td className="px-2.5 py-1.5 font-medium whitespace-nowrap">
                        {p.display_name || p.email}
                        {p.employment_type === "trainee" && (
                          <span className="ml-1.5 shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300">Trainee</span>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 text-slate-400 whitespace-nowrap">{resolveStartDate(p.id) || "—"}</td>
                      <td className="px-2.5 py-1.5 text-slate-400 whitespace-nowrap">{rate !== null ? `$${rate.toFixed(2)}` : "—"}</td>
                      <td className="px-2.5 py-1.5 text-slate-400 whitespace-nowrap">{ROLE_LABELS[normalizeRole(p.role)] || p.role}</td>
                      <td className="px-2.5 py-1.5 text-slate-400 whitespace-nowrap text-right" title="Master List's Total Work Hours">{hours ?? "—"}</td>
                      <td className="px-2.5 py-1.5 text-slate-400 whitespace-nowrap text-right" title="Remaining Sick Leave (Master List)">{sick}</td>
                      <td className="px-2.5 py-1.5 text-slate-400 whitespace-nowrap text-right" title="Remaining Vacation (Master List)">{vacation}</td>
                      <td className={`px-2.5 py-1.5 ${flag.cellTone}`}>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            value={entry.claimedCount}
                            onChange={(e) => updateStaffField(p.id, "claimedCount", Number(e.target.value))}
                            onBlur={(e) => void saveStaffField(p.id, { claimedCount: Number(e.target.value) })}
                            className={`text-xs py-1 px-1.5 rounded w-16 text-right ${flag.cellTone ? "bg-black/20 border border-white/20" : "glass-input"}`}
                          />
                          <PerformanceFlagDot claimed={entry.claimedCount} />
                        </div>
                      </td>
                      <td className="px-2.5 py-1.5">
                        <CoveredBrandsCell
                          brands={brands}
                          selected={entry.coveredBrands ? entry.coveredBrands.split(",").map((s) => s.trim()).filter(Boolean) : []}
                          onChange={(next) => {
                            const joined = next.join(", ");
                            updateStaffField(p.id, "coveredBrands", joined);
                            void saveStaffField(p.id, { coveredBrands: joined });
                          }}
                        />
                      </td>
                      <td className="px-2.5 py-1.5">
                        <input
                          value={entry.remarks}
                          onChange={(e) => updateStaffField(p.id, "remarks", e.target.value)}
                          onBlur={(e) => void saveStaffField(p.id, { remarks: e.target.value })}
                          className="glass-input text-xs py-1 px-1.5 rounded w-32"
                        />
                      </td>
                      <td className="px-2.5 py-1.5">
                        <input
                          type="number"
                          value={entry.warnings}
                          onChange={(e) => updateStaffField(p.id, "warnings", Number(e.target.value))}
                          onBlur={(e) => void saveStaffField(p.id, { warnings: Number(e.target.value) })}
                          className="glass-input text-xs py-1 px-1.5 rounded w-14 text-right"
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {TASKS.map((task) => (
            <div key={task} className="panel overflow-hidden p-0">
              <div className="px-4 py-3 border-b border-white/10">
                <h2 className="font-semibold text-sm">{task}</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-700/80">
                    {["Assignee", "Pending", "Handled", "Moved", ""].map((h) => (
                      <th key={h} className="px-2.5 py-2 text-left text-xs font-semibold text-slate-200 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {taskRows(task).length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-4 text-center text-xs text-muted-foreground">No rows yet.</td></tr>
                  ) : (
                    taskRows(task).map((t) => (
                      <tr key={t.id} className="border-b border-white/5">
                        <td className="px-2.5 py-1.5 font-medium">{t.assigneeName}</td>
                        {(["pendingCount", "handledCount", "movedCount"] as const).map((field) => (
                          <td key={field} className="px-2.5 py-1.5">
                            <input
                              type="number"
                              value={t[field]}
                              onChange={(e) => updateTaskField(t.id, field, Number(e.target.value))}
                              onBlur={(e) => void saveTaskField(t.id, field, Number(e.target.value))}
                              className="glass-input text-xs py-1 px-1.5 rounded w-16 text-right"
                            />
                          </td>
                        ))}
                        <td className="px-2.5 py-1.5">
                          <button type="button" onClick={() => void handleDeleteTaskRow(t.id)} className="text-slate-500 hover:text-red-300">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <div className="flex gap-2 p-2.5 border-t border-white/10">
                <input
                  value={newTaskAssignee[task]}
                  onChange={(e) => setNewTaskAssignee((prev) => ({ ...prev, [task]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleAddTaskRow(task); }}
                  placeholder="Assignee name…"
                  className="glass-input flex-1 text-xs py-1.5 px-2 rounded-md"
                />
                <button type="button" onClick={() => void handleAddTaskRow(task)} className="btn text-xs px-2">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editBrandsOpen && (
        <EditListModal
          title="Brands"
          items={brands}
          onAdd={async (name) => { await addClaimsBrand(name); setBrands(await getClaimsBrands()); }}
          onRemove={async (id) => { await removeClaimsBrand(id); setBrands(await getClaimsBrands()); }}
          onClose={() => setEditBrandsOpen(false)}
        />
      )}
      {editReasonsOpen && (
        <EditListModal
          title="Remaining reasons"
          items={reasons}
          onAdd={async (name) => { await addClaimsRemainingReason(name); setReasons(await getClaimsRemainingReasons()); }}
          onRemove={async (id) => { await removeClaimsRemainingReason(id); setReasons(await getClaimsRemainingReasons()); }}
          onClose={() => setEditReasonsOpen(false)}
        />
      )}
    </main>
  );
}
