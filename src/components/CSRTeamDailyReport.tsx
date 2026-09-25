/**
 * CSR Daily Report — an editable, per-agent daily worksheet grouped by CSR
 * team (Team Composition, csr_teams/csr_team_members — migration 0031),
 * replacing a manually-kept spreadsheet. Distinct from the existing
 * "CSR Daily Report" page (ReportCSRDaily.tsx, custom: "csr-daily-report"),
 * which is an auto-computed chart/summary — that page is untouched; this
 * one is reached as "Daily Report" (custom: "csr-team-daily-report").
 *
 * Full Name/Start Date come from profiles/employee_info, Month is computed
 * from Start Date, Rate is read live off salary_entries (resolved as of
 * the selected report date, same entryEffectiveOn resolution Accounting
 * Dashboard's Payroll tab uses — no longer the old typed-in
 * csr_daily_report_entries.rate column, which still exists but is unused
 * now), and Sick Day/Vacation Day are each person's current
 * remaining/allowance balance (src/lib/supabase/pto.ts — same tenure-year
 * math Master List and Employee Self-Service already use), all fetched
 * live and read-only here. Every other column (Task, GH, Total, Schedule,
 * Attempt, Update, Mistake, Warning, Abs/Em., hr) is typed in by hand for
 * the selected date and saved per cell (migration 0270/0275,
 * csrDailyReportEntries.ts) — one row per (profile, date).
 *
 * Right sidebar (migration 0271/0276, csrExtensions.ts): an editable Extension
 * roster (code + what it means) shared by the AM/PM call-volume table and
 * the Information legend below it, plus a daily Summary panel — Total
 * CSR/Handle TK/Schedule/Attempt/Update/GH are computed by summing the
 * main grid above (never separately typed, so they can't drift out of
 * sync), while Inbound/Outbound/Update CSR Calls, Mistakes, HU, and MC
 * have no other source in the app and are typed in by hand.
 *
 * Mistake Log at the bottom (migration 0272/0277, csrMistakeLog.ts): a plain,
 * freely-editable running log — NOT tied to the date picker above, and
 * deliberately separate from employee_conduct_notes/csrAgentNotes.ts's
 * pending -> manager_approved -> approved review workflow, since this is
 * meant to be typed in and corrected on the spot. "Mistake #" (the Nth for
 * that person) is computed from the log itself, not stored.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { BrandedLoader } from "@/components/BrandedLoader";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyUsers, getEmployeeInfoByProfileIds, type ProfileRow, type EmployeeInfo } from "@/lib/supabase/users";
import { getCsrTeamComposition, type CsrTeamRow, type CsrTeamMemberRow } from "@/lib/supabase/csrTeams";
import { getCompanyPtoRequests, ptoYearWindow, ptoDaysUsed, sickYearWindow, sickDaysUsed, type PtoRequestRow } from "@/lib/supabase/pto";
import { getCompanySalaryEntries, entryEffectiveOn, type SalaryEntryRow } from "@/lib/supabase/salary";
import { getCsrDailyReportEntries, upsertCsrDailyReportEntry, type CsrDailyReportEntry, type CsrDailyReportEntryFields } from "@/lib/supabase/csrDailyReportEntries";
import {
  getCsrExtensions,
  createCsrExtension,
  updateCsrExtension,
  deleteCsrExtension,
  getCsrExtensionDailyCounts,
  upsertCsrExtensionDailyCount,
  getCsrDailyReportTotals,
  upsertCsrDailyReportTotals,
  type CsrExtension,
  type CsrExtensionDailyCount,
  type CsrDailyReportTotals,
  type CsrDailyReportTotalsFields,
} from "@/lib/supabase/csrExtensions";
import {
  getCsrMistakeLogEntries,
  createCsrMistakeLogEntry,
  updateCsrMistakeLogEntry,
  deleteCsrMistakeLogEntry,
  type CsrMistakeLogEntry,
} from "@/lib/supabase/csrMistakeLog";

// Exported so CSRMainDashboard.tsx's Team List tab can offer the exact
// same Task options — its dropdown writes to this same csr_daily_report_
// entries.task column (today's date), so the two must never drift apart.
export const CSR_DAILY_REPORT_TASKS = ["In", "Out", "PTO", "In/MS", "SMS/Wix/In", "Gen update", "Survey/Email", "Survey/OB"];

// America/Chicago, not raw UTC — matches the rest of the app's day-boundary
// convention (see flashTechOpenAlerts.ts's own chicagoDateIso and its header
// comment on why UTC drifted several hours from the company's real
// midnight). Exported so CSRMainDashboard.tsx's Team List tab computes the
// exact same "today" this page does — a genuine, real Task sync between the
// two needs both sides landing on the identical date string, not just the
// same formula run twice.
export function todayIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/** Every ISO date from start to end, inclusive — used to fan out one query per day across a picked range. */
function enumerateDatesISO(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  let cur = new Date(startIso + "T00:00:00");
  const end = new Date(endIso + "T00:00:00");
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

/** Joins distinct non-empty values with "; " — used to show a text field (Mistake/Warning/Abs-Em/Task) across a multi-day range without picking just one day's value arbitrarily. */
function joinDistinct(values: (string | null | undefined)[]): string | null {
  const uniq = Array.from(new Set(values.filter((v): v is string => !!v && v.trim() !== "")));
  return uniq.length > 0 ? uniq.join("; ") : null;
}

/** Whole months elapsed from startIso to onIso — matches ptoYearWindow's own anniversary-based day comparison (a same-day-of-month anniversary counts as the new month). */
function monthsElapsed(startIso: string, onIso: string): number | null {
  const start = new Date(startIso + "T00:00:00");
  const on = new Date(onIso + "T00:00:00");
  if (Number.isNaN(start.getTime()) || Number.isNaN(on.getTime())) return null;
  let months = (on.getFullYear() - start.getFullYear()) * 12 + (on.getMonth() - start.getMonth());
  if (on.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Performance color-coding for the GH/Total/Schedule cells — quota
 * thresholds differ by what the agent is actually doing that day (Task),
 * per the user's exact criteria: Inbound ("In") scores GH, Total ("Tickets
 * Handled"), and Schedule separately; Outbound ("Out") and Gen Update
 * share one combined GH+Total target plus their own Schedule target.
 * Every band is a floor ("X and above"); anything under the lowest named
 * floor is "needs-improvement" (red) — explicit for Inbound, and per the
 * user's own "anything below should be RED" for Outbound/Gen Update, whose
 * lowest band otherwise had no red floor given.
 */
type PerfTier = "great" | "good" | "low" | "needs-improvement";
interface PerfBand { great: number; good: number; low: number; }

const PERF_TIER_COLOR: Record<PerfTier, string> = {
  great: "#22c55e",
  good: "#3b82f6",
  low: "#eab308",
  "needs-improvement": "#ef4444",
};
const PERF_TIER_LABEL: Record<PerfTier, string> = {
  great: "Great Performance",
  good: "Good Performance",
  low: "Low Performance",
  "needs-improvement": "Needs Improvement",
};

const INBOUND_GH_BAND: PerfBand = { great: 56, good: 46, low: 36 };
const INBOUND_HANDLED_BAND: PerfBand = { great: 51, good: 41, low: 31 };
const INBOUND_SCHEDULE_BAND: PerfBand = { great: 21, good: 17, low: 13 };
const OUTBOUND_GH_HANDLED_BAND: PerfBand = { great: 61, good: 55, low: 50 };
const OUTBOUND_SCHEDULE_BAND: PerfBand = { great: 31, good: 28, low: 25 };

function perfTier(value: number | null, band: PerfBand | null): PerfTier | null {
  if (value === null || !band) return null;
  if (value >= band.great) return "great";
  if (value >= band.good) return "good";
  if (value >= band.low) return "low";
  return "needs-improvement";
}

function perfBandFor(task: string | null, metric: "gh" | "handled" | "schedule"): PerfBand | null {
  if (task === "In") {
    if (metric === "gh") return INBOUND_GH_BAND;
    if (metric === "handled") return INBOUND_HANDLED_BAND;
    return INBOUND_SCHEDULE_BAND;
  }
  if (task === "Out" || task === "Gen update") {
    if (metric === "gh" || metric === "handled") return OUTBOUND_GH_HANDLED_BAND;
    return OUTBOUND_SCHEDULE_BAND;
  }
  return null; // no criteria given for PTO/In-MS/SMS-Wix-In/Survey tasks
}

interface Row {
  profile: ProfileRow;
  isLeader: boolean;
}

export function CSRTeamDailyReport({ mod }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));

  // reportDate doubles as the range's start date; rangeEnd defaults equal
  // to it (a single day) — most of this page's editable cells only make
  // sense for one exact day, so a real range (rangeEnd !== reportDate)
  // switches the whole grid to a read-only sum across every day in it
  // (see isSingleDay below), rather than trying to guess which day's value
  // an edit should land on.
  const [reportDate, setReportDate] = useState(todayIso());
  const [rangeEnd, setRangeEnd] = useState(todayIso());
  const isSingleDay = reportDate === rangeEnd;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teams, setTeams] = useState<CsrTeamRow[]>([]);
  const [members, setMembers] = useState<CsrTeamMemberRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [employeeInfoByProfileId, setEmployeeInfoByProfileId] = useState<Map<string, EmployeeInfo>>(new Map());
  const [ptoRequests, setPtoRequests] = useState<PtoRequestRow[]>([]);
  const [salaryEntries, setSalaryEntries] = useState<SalaryEntryRow[]>([]);
  const [entries, setEntries] = useState<Map<string, CsrDailyReportEntry>>(new Map());
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [extensions, setExtensions] = useState<CsrExtension[]>([]);
  const [extCounts, setExtCounts] = useState<Map<string, CsrExtensionDailyCount>>(new Map());
  const [totals, setTotals] = useState<CsrDailyReportTotals | null>(null);
  const [newExtCode, setNewExtCode] = useState("");
  const [newExtLabel, setNewExtLabel] = useState("");
  const [addingExt, setAddingExt] = useState(false);

  const [mistakeLog, setMistakeLog] = useState<CsrMistakeLogEntry[]>([]);
  const [newMistakeProfileId, setNewMistakeProfileId] = useState("");
  const [newMistakeDate, setNewMistakeDate] = useState(todayIso());
  const [newMistakeReason, setNewMistakeReason] = useState("");
  const [newMistakeAction, setNewMistakeAction] = useState("");
  const [addingMistake, setAddingMistake] = useState(false);

  // A single day fetches exactly as before (one query per source). A real
  // range fans out one query per day per source and sums numerically
  // (joins distinct text for Task/Mistake/Warning/Abs-Em) — the grid then
  // renders those totals read-only (see isSingleDay), same as the eBay
  // Daily Report treats a picked range as a rollup rather than something
  // to edit in place.
  const fetchAggregatedForRange = async (dates: string[]) => {
    if (dates.length === 1) {
      const [entryRows, extCountRows, dayTotals] = await Promise.all([
        getCsrDailyReportEntries(dates[0]),
        getCsrExtensionDailyCounts(dates[0]),
        getCsrDailyReportTotals(dates[0]),
      ]);
      return {
        entries: new Map(entryRows.map((e) => [e.profileId, e])),
        extCounts: new Map(extCountRows.map((c) => [c.extensionId, c])),
        totals: dayTotals,
      };
    }
    const perDate = await Promise.all(
      dates.map((d) => Promise.all([getCsrDailyReportEntries(d), getCsrExtensionDailyCounts(d), getCsrDailyReportTotals(d)]))
    );
    const entryMap = new Map<string, CsrDailyReportEntry>();
    const extMap = new Map<string, CsrExtensionDailyCount>();
    let inboundCalls = 0, outboundCalls = 0, updateCsrCalls = 0, mistakesN = 0, hu = 0, mc = 0, anyTotals = false;
    for (const [entryRows, extCountRows, dayTotals] of perDate) {
      for (const e of entryRows) {
        const prev = entryMap.get(e.profileId);
        entryMap.set(e.profileId, {
          id: "", profileId: e.profileId, reportDate: dates[0], rate: null,
          task: joinDistinct([prev?.task, e.task]),
          gh: (prev?.gh ?? 0) + (e.gh ?? 0),
          total: (prev?.total ?? 0) + (e.total ?? 0),
          schedule: (prev?.schedule ?? 0) + (e.schedule ?? 0),
          attempt: (prev?.attempt ?? 0) + (e.attempt ?? 0),
          updateCount: (prev?.updateCount ?? 0) + (e.updateCount ?? 0),
          mistake: joinDistinct([prev?.mistake, e.mistake]),
          warning: joinDistinct([prev?.warning, e.warning]),
          absEm: joinDistinct([prev?.absEm, e.absEm]),
          hr: (prev?.hr ?? 0) + (e.hr ?? 0),
        });
      }
      for (const c of extCountRows) {
        const prev = extMap.get(c.extensionId);
        extMap.set(c.extensionId, {
          extensionId: c.extensionId, reportDate: dates[0],
          amCount: (prev?.amCount ?? 0) + (c.amCount ?? 0),
          pmCount: (prev?.pmCount ?? 0) + (c.pmCount ?? 0),
        });
      }
      if (dayTotals) {
        anyTotals = true;
        inboundCalls += dayTotals.inboundCalls ?? 0;
        outboundCalls += dayTotals.outboundCalls ?? 0;
        updateCsrCalls += dayTotals.updateCsrCalls ?? 0;
        mistakesN += dayTotals.mistakes ?? 0;
        hu += dayTotals.hu ?? 0;
        mc += dayTotals.mc ?? 0;
      }
    }
    return {
      entries: entryMap,
      extCounts: extMap,
      totals: anyTotals ? { reportDate: dates[0], inboundCalls, outboundCalls, updateCsrCalls, mistakes: mistakesN, hu, mc } : null,
    };
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const dates = enumerateDatesISO(reportDate, rangeEnd);
      const [composition, allProfiles, ptoReqs, salaryRows, aggregated, exts, mistakeRows] = await Promise.all([
        getCsrTeamComposition(),
        getCompanyUsers(),
        getCompanyPtoRequests(),
        getCompanySalaryEntries(),
        fetchAggregatedForRange(dates),
        getCsrExtensions(),
        getCsrMistakeLogEntries(),
      ]);
      setTeams(composition.teams);
      setMembers(composition.members);
      setProfiles(allProfiles);
      setPtoRequests(ptoReqs);
      setSalaryEntries(salaryRows);
      setEntries(aggregated.entries);
      setExtensions(exts);
      setExtCounts(aggregated.extCounts);
      setTotals(aggregated.totals);
      setMistakeLog(mistakeRows);
      const infoMap = await getEmployeeInfoByProfileIds(composition.members.map((m) => m.profileId));
      setEmployeeInfoByProfileId(infoMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Daily Report.");
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [reportDate, rangeEnd]);

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const ptoByProfile = useMemo(() => {
    const map = new Map<string, PtoRequestRow[]>();
    for (const r of ptoRequests) {
      const arr = map.get(r.profileId) ?? [];
      arr.push(r);
      map.set(r.profileId, arr);
    }
    return map;
  }, [ptoRequests]);

  const salaryByProfile = useMemo(() => {
    const map = new Map<string, SalaryEntryRow[]>();
    for (const s of salaryEntries) {
      const arr = map.get(s.profileId) ?? [];
      arr.push(s);
      map.set(s.profileId, arr);
    }
    return map;
  }, [salaryEntries]);

  // Rate used to be typed in by hand per day (csr_daily_report_entries.rate)
  // — now read live off the same salary_entries Accounting Dashboard's
  // Payroll tab uses, resolved as of rangeEnd (the most recent day in the
  // picked range — reportDate alone would resolve the rate as of the
  // range's START, not its current state), so it can never drift from the
  // agent's real pay rate.
  const resolveHourlyRate = (profileId: string): number | null => {
    const entry = entryEffectiveOn(salaryByProfile.get(profileId) ?? [], rangeEnd);
    return entry && entry.compensationType === "hourly" ? entry.hourlyRate : null;
  };

  const rowsByTeam = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const m of members) {
      const profile = profileById.get(m.profileId);
      if (!profile) continue;
      const arr = map.get(m.teamId) ?? [];
      arr.push({ profile, isLeader: m.isLeader });
      map.set(m.teamId, arr);
    }
    for (const rows of map.values()) {
      rows.sort((a, b) => (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0) || (a.profile.display_name || a.profile.email).localeCompare(b.profile.display_name || b.profile.email));
    }
    return map;
  }, [members, profileById]);

  const balanceFor = (profileId: string, startDate: string | null) => {
    const requests = ptoByProfile.get(profileId) ?? [];
    const vacationWindow = ptoYearWindow(startDate, null, rangeEnd);
    const sickWindow = sickYearWindow(startDate, null, rangeEnd);
    const vacation = vacationWindow ? { remaining: Math.max(0, vacationWindow.allowance - ptoDaysUsed(requests, vacationWindow)), allowance: vacationWindow.allowance } : null;
    const sick = sickWindow ? { remaining: Math.max(0, sickWindow.allowance - sickDaysUsed(requests, sickWindow)), allowance: sickWindow.allowance } : null;
    return { vacation, sick };
  };

  const handleCellSave = async (profileId: string, field: keyof CsrDailyReportEntryFields, value: string | number | null) => {
    const key = `${profileId}|${field}`;
    const prevEntry = entries.get(profileId);
    setEntries((prev) => {
      const next = new Map(prev);
      next.set(profileId, { ...(prev.get(profileId) ?? blankEntry(profileId, reportDate)), [field]: value });
      return next;
    });
    setSavingKey(key);
    try {
      await upsertCsrDailyReportEntry(profileId, reportDate, { [field]: value } as CsrDailyReportEntryFields);
    } catch (err) {
      setEntries((prev) => {
        const next = new Map(prev);
        if (prevEntry) next.set(profileId, prevEntry);
        else next.delete(profileId);
        return next;
      });
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSavingKey(null);
    }
  };

  // "Total CSR"/"Handle TK"/"Schedule"/"Attempt"/"Update"/"GH" on the
  // summary panel are always just today's grid summed up, never a
  // separately-typed number — so they can't ever drift out of sync with
  // the per-agent rows above them.
  const gridTotals = useMemo(() => {
    let totalCsr = 0, handleTk = 0, schedule = 0, attempt = 0, updateSum = 0, gh = 0;
    for (const rows of rowsByTeam.values()) {
      for (const { profile } of rows) {
        totalCsr++;
        const e = entries.get(profile.id);
        handleTk += e?.total ?? 0;
        schedule += e?.schedule ?? 0;
        attempt += e?.attempt ?? 0;
        updateSum += e?.updateCount ?? 0;
        gh += e?.gh ?? 0;
      }
    }
    return { totalCsr, handleTk, schedule, attempt, update: updateSum, gh };
  }, [rowsByTeam, entries]);

  const extTotals = useMemo(() => {
    let am = 0, pm = 0;
    for (const ext of extensions) {
      const c = extCounts.get(ext.id);
      am += c?.amCount ?? 0;
      pm += c?.pmCount ?? 0;
    }
    return { am, pm };
  }, [extensions, extCounts]);

  const handleExtCountSave = async (extensionId: string, field: "amCount" | "pmCount", value: number | null) => {
    const prev = extCounts.get(extensionId);
    setExtCounts((p) => {
      const next = new Map(p);
      next.set(extensionId, { ...(prev ?? { extensionId, reportDate, amCount: null, pmCount: null }), [field]: value });
      return next;
    });
    setSavingKey(`ext|${extensionId}|${field}`);
    try {
      await upsertCsrExtensionDailyCount(extensionId, reportDate, { [field]: value });
    } catch (err) {
      setExtCounts((p) => {
        const next = new Map(p);
        if (prev) next.set(extensionId, prev);
        else next.delete(extensionId);
        return next;
      });
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSavingKey(null);
    }
  };

  const handleTotalsSave = async (field: keyof CsrDailyReportTotalsFields, value: number | null) => {
    const prev = totals;
    setTotals((p) => ({ ...(p ?? blankTotals(reportDate)), [field]: value }));
    setSavingKey(`totals|${field}`);
    try {
      await upsertCsrDailyReportTotals(reportDate, { [field]: value } as CsrDailyReportTotalsFields);
    } catch (err) {
      setTotals(prev);
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSavingKey(null);
    }
  };

  const handleAddExtension = async () => {
    const code = newExtCode.trim();
    if (!code) return;
    setAddingExt(true);
    try {
      await createCsrExtension(code, newExtLabel.trim(), extensions.length);
      setNewExtCode("");
      setNewExtLabel("");
      setExtensions(await getCsrExtensions());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add extension.");
    } finally {
      setAddingExt(false);
    }
  };

  const handleUpdateExtensionField = async (id: string, field: "code" | "label", value: string) => {
    setExtensions((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
    try {
      await updateCsrExtension(id, { [field]: value });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update extension.");
      setExtensions(await getCsrExtensions());
    }
  };

  const handleDeleteExtension = async (id: string, code: string) => {
    if (!window.confirm(`Remove ${code}? This also clears its saved AM/PM counts for every date.`)) return;
    setExtensions((prev) => prev.filter((e) => e.id !== id));
    try {
      await deleteCsrExtension(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove extension.");
      setExtensions(await getCsrExtensions());
    }
  };

  // "Mistake #" — the Nth logged mistake for that person, oldest first —
  // computed here rather than stored, so it's always correct even after
  // editing a date or deleting an earlier entry.
  const mistakeNumberById = useMemo(() => {
    const byProfile = new Map<string, CsrMistakeLogEntry[]>();
    for (const m of mistakeLog) {
      const arr = byProfile.get(m.profileId) ?? [];
      arr.push(m);
      byProfile.set(m.profileId, arr);
    }
    const numberById = new Map<string, number>();
    for (const arr of byProfile.values()) {
      const sorted = [...arr].sort((a, b) => (a.occurredDate || a.createdAt).localeCompare(b.occurredDate || b.createdAt) || a.createdAt.localeCompare(b.createdAt));
      sorted.forEach((m, i) => numberById.set(m.id, i + 1));
    }
    return numberById;
  }, [mistakeLog]);

  const handleAddMistake = async () => {
    if (!newMistakeProfileId) return;
    setAddingMistake(true);
    try {
      await createCsrMistakeLogEntry(newMistakeProfileId, newMistakeDate || null, newMistakeReason, newMistakeAction);
      setNewMistakeProfileId("");
      setNewMistakeReason("");
      setNewMistakeAction("");
      setMistakeLog(await getCsrMistakeLogEntries());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add mistake log entry.");
    } finally {
      setAddingMistake(false);
    }
  };

  const handleUpdateMistakeField = async (id: string, field: "profileId" | "occurredDate" | "reason" | "actionTaken", value: string | null) => {
    setMistakeLog((prev) => prev.map((m) => (m.id === id ? { ...m, [field]: value } : m)));
    try {
      await updateCsrMistakeLogEntry(id, { [field]: value });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update mistake log entry.");
      setMistakeLog(await getCsrMistakeLogEntries());
    }
  };

  const handleDeleteMistake = async (id: string, name: string) => {
    if (!window.confirm(`Remove this mistake entry for ${name}? This cannot be undone.`)) return;
    setMistakeLog((prev) => prev.filter((m) => m.id !== id));
    try {
      await deleteCsrMistakeLogEntry(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove mistake log entry.");
      setMistakeLog(await getCsrMistakeLogEntries());
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <BrandedLoader label="Loading Daily Report…" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1900px] mx-auto w-full px-6 py-5">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <button type="button" onClick={goBack} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold">Daily Report</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Per-agent daily worksheet, by team.</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Date</label>
            <input
              type="date"
              value={reportDate}
              onChange={(e) => {
                const v = e.target.value;
                setReportDate(v);
                if (v > rangeEnd) setRangeEnd(v);
              }}
              className="glass-input"
            />
            <span className="text-muted-foreground text-xs">to</span>
            <input
              type="date"
              value={rangeEnd}
              onChange={(e) => {
                const v = e.target.value;
                setRangeEnd(v);
                if (v < reportDate) setReportDate(v);
              }}
              className="glass-input"
            />
            {!isSingleDay && (
              <span className="text-[10px] text-amber-300 whitespace-nowrap" title="Cells show the sum across the whole range and can't be edited here — narrow back to one day to edit.">
                Range totals (read-only)
              </span>
            )}
            {savingKey && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
        )}

        <div className="flex flex-col xl:flex-row gap-4 items-start">
        <div className="flex-1 min-w-0">
        {teams.length === 0 ? (
          <div className="panel p-8 text-center text-sm text-muted-foreground">
            No CSR teams set up yet — add teams and place staff on them from CSR Dashboard's Team Composition tool first.
          </div>
        ) : (
          <div className="space-y-6">
            {teams.map((team) => {
              const rows = rowsByTeam.get(team.id) ?? [];
              if (rows.length === 0) return null;
              return (
                <div key={team.id} className="panel p-0 overflow-hidden">
                  <div className="px-4 py-2.5 flex items-center gap-2" style={{ backgroundColor: `${team.color}22`, borderBottom: `1px solid ${team.color}55` }}>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: team.color }} />
                    <h2 className="font-semibold text-sm" style={{ color: team.color }}>{team.name}</h2>
                    <span className="text-xs text-muted-foreground">{rows.length} member{rows.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-white/10 bg-white/5">
                          <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Full Name</th>
                          <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Start Date</th>
                          <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Rate</th>
                          <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase" title="Whole months since Start Date">Month</th>
                          <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Task</th>
                          <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">GH</th>
                          <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Total</th>
                          <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Schedule</th>
                          <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Attempt</th>
                          <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Update</th>
                          <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Mistake</th>
                          <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Warning</th>
                          <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Abs/Em.</th>
                          <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase" title="Remaining / Allowance">Sick Day</th>
                          <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase" title="Remaining / Allowance">Vacation Day</th>
                          <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">hr</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(({ profile, isLeader }) => {
                          const info = employeeInfoByProfileId.get(profile.id);
                          const startDate = info?.hireDate || profile.created_at?.slice(0, 10) || null;
                          const entry = entries.get(profile.id);
                          const { vacation, sick } = balanceFor(profile.id, startDate);
                          const months = startDate ? monthsElapsed(startDate, rangeEnd) : null;
                          return (
                            <tr key={profile.id} className="border-b border-white/5 hover:bg-white/5">
                              <td className="px-2 py-1 whitespace-nowrap">
                                {profile.display_name || profile.username || profile.email}
                                {isLeader && <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300">Leader</span>}
                              </td>
                              <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">{startDate || "—"}</td>
                              <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">{(() => { const r = resolveHourlyRate(profile.id); return r !== null ? `$${r.toFixed(2)}` : "—"; })()}</td>
                              <td className="px-2 py-1 text-muted-foreground">{months ?? "—"}</td>
                              <td className="px-2 py-1">
                                {isSingleDay ? (
                                  <select
                                    value={entry?.task ?? ""}
                                    onChange={(e) => void handleCellSave(profile.id, "task", e.target.value || null)}
                                    className="glass-input text-[11px] py-0.5 px-1 rounded-md"
                                  >
                                    <option value="">—</option>
                                    {entry?.task && !CSR_DAILY_REPORT_TASKS.includes(entry.task) && (
                                      <option value={entry.task}>{entry.task}</option>
                                    )}
                                    {CSR_DAILY_REPORT_TASKS.map((t) => (
                                      <option key={t} value={t}>{t}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="text-[11px] text-muted-foreground">{entry?.task || "—"}</span>
                                )}
                              </td>
                              <NumberCell value={entry?.gh ?? null} onSave={(v) => handleCellSave(profile.id, "gh", v)} tier={perfTier(entry?.gh ?? null, perfBandFor(entry?.task ?? null, "gh"))} readOnly={!isSingleDay} />
                              <NumberCell value={entry?.total ?? null} onSave={(v) => handleCellSave(profile.id, "total", v)} tier={perfTier(entry?.total ?? null, perfBandFor(entry?.task ?? null, "handled"))} readOnly={!isSingleDay} />
                              <NumberCell value={entry?.schedule ?? null} onSave={(v) => handleCellSave(profile.id, "schedule", v)} tier={perfTier(entry?.schedule ?? null, perfBandFor(entry?.task ?? null, "schedule"))} readOnly={!isSingleDay} />
                              <NumberCell value={entry?.attempt ?? null} onSave={(v) => handleCellSave(profile.id, "attempt", v)} readOnly={!isSingleDay} />
                              <NumberCell value={entry?.updateCount ?? null} onSave={(v) => handleCellSave(profile.id, "updateCount", v)} readOnly={!isSingleDay} />
                              <TextCell value={entry?.mistake ?? ""} onSave={(v) => handleCellSave(profile.id, "mistake", v || null)} readOnly={!isSingleDay} />
                              <TextCell value={entry?.warning ?? ""} onSave={(v) => handleCellSave(profile.id, "warning", v || null)} readOnly={!isSingleDay} />
                              <TextCell value={entry?.absEm ?? ""} onSave={(v) => handleCellSave(profile.id, "absEm", v || null)} readOnly={!isSingleDay} />
                              <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">{sick ? `${sick.remaining}/${sick.allowance}` : "—"}</td>
                              <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">{vacation ? `${vacation.remaining}/${vacation.allowance}` : "—"}</td>
                              <NumberCell value={entry?.hr ?? null} onSave={(v) => handleCellSave(profile.id, "hr", v)} width="w-12" readOnly={!isSingleDay} />
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </div>

        <div className="w-full xl:w-80 shrink-0 space-y-4">
          {/* ── Extension Number / AM / PM ── */}
          <div className="panel p-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-white/10 bg-white/5">
              <h3 className="text-xs font-semibold">Extension Number</h3>
            </div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Ext</th>
                  <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">AM</th>
                  <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">PM</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {extensions.map((ext) => {
                  const c = extCounts.get(ext.id);
                  return (
                    <tr key={ext.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-2 py-1 whitespace-nowrap">
                        <input
                          type="text"
                          defaultValue={ext.code}
                          onBlur={(e) => { if (e.target.value.trim() && e.target.value !== ext.code) void handleUpdateExtensionField(ext.id, "code", e.target.value.trim()); }}
                          className="glass-input text-[11px] py-0.5 px-1 rounded-md w-20"
                        />
                      </td>
                      <NumberCell value={c?.amCount ?? null} onSave={(v) => handleExtCountSave(ext.id, "amCount", v)} width="w-12" readOnly={!isSingleDay} />
                      <NumberCell value={c?.pmCount ?? null} onSave={(v) => handleExtCountSave(ext.id, "pmCount", v)} width="w-12" readOnly={!isSingleDay} />
                      <td className="px-1 py-1">
                        <button type="button" onClick={() => void handleDeleteExtension(ext.id, ext.code)} className="text-red-400 hover:text-red-300 p-0.5" title="Remove extension">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t border-white/10 bg-white/5 font-semibold">
                  <td className="px-2 py-1.5">TOTAL</td>
                  <td className="px-2 py-1.5">{extTotals.am}</td>
                  <td className="px-2 py-1.5">{extTotals.pm}</td>
                  <td />
                </tr>
              </tbody>
            </table>
            <div className="p-2 flex items-center gap-1.5 border-t border-white/10">
              <input type="text" placeholder="EXT #" value={newExtCode} onChange={(e) => setNewExtCode(e.target.value)} className="glass-input text-[11px] py-1 px-1.5 rounded-md w-16" />
              <input type="text" placeholder="Meaning (optional)" value={newExtLabel} onChange={(e) => setNewExtLabel(e.target.value)} className="glass-input text-[11px] py-1 px-1.5 rounded-md flex-1 min-w-0" />
              <button type="button" onClick={() => void handleAddExtension()} disabled={addingExt || !newExtCode.trim()} className="btn text-[11px] px-2 py-1 disabled:opacity-50">
                <Plus className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* ── Summary ── */}
          <div className="panel p-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-white/10 bg-white/5">
              <h3 className="text-xs font-semibold">Summary</h3>
              <p className="text-[9px] text-muted-foreground mt-0.5">Total CSR / Handle TK / Schedule / Attempt / Update / GH are the grid above, summed automatically — across the whole picked range, not just one day.</p>
            </div>
            <table className="w-full text-[11px]">
              <tbody>
                <SummaryAutoRow label="Total CSR" value={gridTotals.totalCsr} />
                <SummaryManualRow label="Inbound Calls" value={totals?.inboundCalls ?? null} onSave={(v) => handleTotalsSave("inboundCalls", v)} readOnly={!isSingleDay} />
                <SummaryManualRow label="Outbound Calls" value={totals?.outboundCalls ?? null} onSave={(v) => handleTotalsSave("outboundCalls", v)} readOnly={!isSingleDay} />
                <SummaryManualRow label="Update CSR Calls" value={totals?.updateCsrCalls ?? null} onSave={(v) => handleTotalsSave("updateCsrCalls", v)} readOnly={!isSingleDay} />
                <SummaryManualRow label="Mistakes" value={totals?.mistakes ?? null} onSave={(v) => handleTotalsSave("mistakes", v)} readOnly={!isSingleDay} />
                <SummaryManualRow label="HU" value={totals?.hu ?? null} onSave={(v) => handleTotalsSave("hu", v)} readOnly={!isSingleDay} />
                <SummaryManualRow label="MC" value={totals?.mc ?? null} onSave={(v) => handleTotalsSave("mc", v)} readOnly={!isSingleDay} />
                <SummaryAutoRow label="Handle TK" value={gridTotals.handleTk} />
                <SummaryAutoRow label="Schedule" value={gridTotals.schedule} />
                <SummaryAutoRow label="Attempt" value={gridTotals.attempt} />
                <SummaryAutoRow label="Update" value={gridTotals.update} />
                <SummaryAutoRow label="GH" value={gridTotals.gh} />
              </tbody>
            </table>
          </div>

          {/* ── Information (what each extension means) ── */}
          <div className="panel p-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-white/10 bg-white/5">
              <h3 className="text-xs font-semibold">Information</h3>
            </div>
            <table className="w-full text-[11px]">
              <tbody>
                {extensions.length === 0 ? (
                  <tr><td className="px-3 py-3 text-center text-muted-foreground text-[10px]">No extensions added yet.</td></tr>
                ) : (
                  extensions.map((ext) => (
                    <tr key={ext.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">{ext.code}</td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          defaultValue={ext.label ?? ""}
                          placeholder="Meaning"
                          onBlur={(e) => { if (e.target.value !== (ext.label ?? "")) void handleUpdateExtensionField(ext.id, "label", e.target.value); }}
                          className="glass-input text-[11px] py-0.5 px-1 rounded-md w-full"
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* ── Performance Key — the criteria driving the colored dots on GH/Total/Schedule ── */}
          <div className="panel p-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-white/10 bg-white/5">
              <h3 className="text-xs font-semibold">Performance Key</h3>
              <p className="text-[9px] text-muted-foreground mt-0.5">Colors on GH/Total/Schedule depend on that row's Task.</p>
            </div>
            <div className="p-3 space-y-3 text-[11px]">
              <div>
                <p className="font-semibold text-muted-foreground uppercase tracking-wide text-[9px] mb-1">Inbound (Task: In)</p>
                <PerfKeyMetric label="GH" band={INBOUND_GH_BAND} />
                <PerfKeyMetric label="Total (Tickets Handled)" band={INBOUND_HANDLED_BAND} />
                <PerfKeyMetric label="Schedule" band={INBOUND_SCHEDULE_BAND} />
              </div>
              <div>
                <p className="font-semibold text-muted-foreground uppercase tracking-wide text-[9px] mb-1">Outbound / Gen update</p>
                <PerfKeyMetric label="GH & Total" band={OUTBOUND_GH_HANDLED_BAND} />
                <PerfKeyMetric label="Schedule" band={OUTBOUND_SCHEDULE_BAND} />
              </div>
            </div>
          </div>
        </div>
        </div>

        {/* ── Mistake Log — running, company-wide, not tied to the date above ── */}
        <div className="panel p-0 overflow-hidden mt-6">
          <div className="px-4 py-2.5 border-b border-white/10 bg-white/5">
            <h2 className="font-semibold text-sm">Mistake Log</h2>
            <p className="text-xs text-muted-foreground mt-0.5">A running record, not tied to the date picker above.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase w-40">Name</th>
                  <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Mistake</th>
                  <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase w-32">Date</th>
                  <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Reason</th>
                  <th className="px-2 py-1.5 text-left text-[10px] text-muted-foreground uppercase">Action Taken</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {mistakeLog.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground text-xs">No mistakes logged yet.</td></tr>
                ) : (
                  mistakeLog.map((m) => {
                    const person = profileById.get(m.profileId);
                    return (
                      <tr key={m.id} className="border-b border-white/5 hover:bg-white/5 align-top">
                        <td className="px-2 py-1">
                          <select
                            value={m.profileId}
                            onChange={(e) => void handleUpdateMistakeField(m.id, "profileId", e.target.value)}
                            className="glass-input text-[11px] py-0.5 px-1 rounded-md w-full"
                          >
                            {person && <option value={person.id}>{person.display_name || person.username || person.email}</option>}
                            {profiles.filter((p) => p.id !== m.profileId).map((p) => (
                              <option key={p.id} value={p.id}>{p.display_name || p.username || p.email}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1 text-center font-semibold text-muted-foreground">{mistakeNumberById.get(m.id) ?? "—"}</td>
                        <td className="px-2 py-1">
                          <input
                            type="date"
                            defaultValue={m.occurredDate ?? ""}
                            onBlur={(e) => { if (e.target.value !== (m.occurredDate ?? "")) void handleUpdateMistakeField(m.id, "occurredDate", e.target.value || null); }}
                            className="glass-input text-[11px] py-0.5 px-1 rounded-md w-full"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <textarea
                            defaultValue={m.reason ?? ""}
                            onBlur={(e) => { if (e.target.value !== (m.reason ?? "")) void handleUpdateMistakeField(m.id, "reason", e.target.value); }}
                            rows={2}
                            className="glass-input text-[11px] py-0.5 px-1 rounded-md w-full resize-y"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <textarea
                            defaultValue={m.actionTaken ?? ""}
                            onBlur={(e) => { if (e.target.value !== (m.actionTaken ?? "")) void handleUpdateMistakeField(m.id, "actionTaken", e.target.value); }}
                            rows={2}
                            className="glass-input text-[11px] py-0.5 px-1 rounded-md w-full resize-y"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <button
                            type="button"
                            onClick={() => void handleDeleteMistake(m.id, person?.display_name || person?.email || "this person")}
                            className="text-red-400 hover:text-red-300 p-0.5"
                            title="Remove entry"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-white/10 flex flex-wrap items-end gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Name</label>
              <select value={newMistakeProfileId} onChange={(e) => setNewMistakeProfileId(e.target.value)} className="glass-input mt-1 block">
                <option value="">Select…</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name || p.username || p.email}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Date</label>
              <input type="date" value={newMistakeDate} onChange={(e) => setNewMistakeDate(e.target.value)} className="glass-input mt-1 block" />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Reason</label>
              <input type="text" value={newMistakeReason} onChange={(e) => setNewMistakeReason(e.target.value)} className="glass-input mt-1 block w-full" />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Action Taken</label>
              <input type="text" value={newMistakeAction} onChange={(e) => setNewMistakeAction(e.target.value)} className="glass-input mt-1 block w-full" />
            </div>
            <button type="button" onClick={() => void handleAddMistake()} disabled={addingMistake || !newMistakeProfileId} className="btn btn-primary inline-flex items-center gap-1.5 disabled:opacity-50">
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function PerfKeyMetric({ label, band }: { label: string; band: PerfBand }) {
  return (
    <div className="mb-1.5 last:mb-0">
      <p className="text-muted-foreground mb-0.5">{label}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: PERF_TIER_COLOR.great }} />{band.great}+</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: PERF_TIER_COLOR.good }} />{band.good}–{band.great - 1}</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: PERF_TIER_COLOR.low }} />{band.low}–{band.good - 1}</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: PERF_TIER_COLOR["needs-improvement"] }} />&lt;{band.low}</span>
      </div>
    </div>
  );
}

function SummaryAutoRow({ label, value }: { label: string; value: number }) {
  return (
    <tr className="border-b border-white/5">
      <td className="px-2 py-1 text-muted-foreground">{label}</td>
      <td className="px-2 py-1 text-right font-semibold">{value}</td>
    </tr>
  );
}

function SummaryManualRow({ label, value, onSave, readOnly }: { label: string; value: number | null; onSave: (v: number | null) => void; readOnly?: boolean }) {
  return (
    <tr className="border-b border-white/5">
      <td className="px-2 py-1 text-muted-foreground">{label}</td>
      <td className="px-2 py-1 text-right">
        {readOnly ? (
          <span className="text-[11px] text-muted-foreground">{value ?? "—"}</span>
        ) : (
          <input
            type="number"
            defaultValue={value ?? ""}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const parsed = raw === "" ? null : Number(raw);
              if ((parsed ?? null) !== (value ?? null)) onSave(Number.isFinite(parsed as number) ? parsed : null);
            }}
            className="glass-input text-[11px] py-0.5 px-1 rounded-md w-16 text-right"
          />
        )}
      </td>
    </tr>
  );
}

function blankEntry(profileId: string, reportDate: string): CsrDailyReportEntry {
  return { id: "", profileId, reportDate, rate: null, task: null, gh: null, total: null, schedule: null, attempt: null, updateCount: null, mistake: null, warning: null, absEm: null, hr: null };
}

function blankTotals(reportDate: string): CsrDailyReportTotals {
  return { reportDate, inboundCalls: null, outboundCalls: null, updateCsrCalls: null, mistakes: null, hu: null, mc: null };
}

function NumberCell({ value, onSave, width = "w-14", tier, readOnly }: { value: number | null; onSave: (v: number | null) => void; width?: string; tier?: PerfTier | null; readOnly?: boolean }) {
  return (
    <td className="px-2 py-1">
      <div className="flex items-center gap-1.5">
        {tier && (
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: PERF_TIER_COLOR[tier] }}
            title={PERF_TIER_LABEL[tier]}
          />
        )}
        {readOnly ? (
          <span className={`text-[11px] text-muted-foreground text-right ${width}`}>{value ?? "—"}</span>
        ) : (
          <input
            type="number"
            defaultValue={value ?? ""}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const parsed = raw === "" ? null : Number(raw);
              if ((parsed ?? null) !== (value ?? null)) onSave(Number.isFinite(parsed as number) ? parsed : null);
            }}
            className={`glass-input text-[11px] py-0.5 px-1 rounded-md ${width}`}
          />
        )}
      </div>
    </td>
  );
}

function TextCell({ value, onSave, readOnly }: { value: string; onSave: (v: string) => void; readOnly?: boolean }) {
  return (
    <td className="px-2 py-1">
      {readOnly ? (
        <span className="text-[11px] text-muted-foreground">{value || "—"}</span>
      ) : (
        <input
          type="text"
          defaultValue={value}
          onBlur={(e) => {
            const v = e.target.value;
            if (v !== value) onSave(v);
          }}
          className="glass-input text-[11px] py-0.5 px-1 rounded-md w-24"
        />
      )}
    </td>
  );
}
