/**
 * Triage Daily Report — rebuilt on live data, then overhauled to align with
 * the real TR- process a ticket passes through (TR-Need Triage, TR-Need PO
 * — the only two TR- statuses that exist anywhere in this app), the same
 * way ClaimsDashboard.tsx tracks its own PT-/CL- pipeline, PLUS an Activity
 * and Attendance summary for the same Triage roster Triage Dashboard
 * covers — same relationship Parts Daily Report has to Parts Dashboard/
 * Parts Order Dashboard: this report DERIVES its own summaries from the
 * same underlying live data those other pages read (ticket_audit_log via
 * DailyActivityPage's own `classify`, timecard entries via
 * ReportAttendanceMonitoring's own `dayStatus`), it doesn't re-embed their
 * components or pass their rendered output through.
 *
 * KPIs, the TR- stage pipeline + aging, the 10-day completed trend, a real
 * per-agent Triage Staff table (Start Date/Work Hours/Complete (tiered)/
 * Monthly Complete/Actions/Warnings/Mistakes/Sick & Vacation Days Used/
 * Covered Brands), an Activity-by-type breakdown, an Attendance summary, and
 * a Brand/Account Breakdown — bringing this report up to the same depth as
 * its Claims/Operations Daily Report siblings, which already show a real
 * staff table instead of just aggregate tiles.
 *
 * Remaining is a live snapshot of tickets currently in a TR- status.
 * Completed and Avg Triage Time are computed from ticket_audit_log (the
 * real trigger-written status-change trail): for each ticket, find the
 * timestamp it entered a TR- status and the timestamp it left one — the
 * delta is real triage duration, attributed to whoever moved it out.
 *
 * Work Hours/Sick Day/Vacation Day were dropped in that overhaul for having
 * no real backing at the time (no shift/time-off system yet). Since then a
 * real PTO system landed (src/lib/supabase/pto.ts — sickDaysUsed/ptoDaysUsed,
 * the same helpers Claims/CSR/HR Daily Reports already use), so per the
 * user's explicit call they're back: Start Date (employee_info.hireDate),
 * Work Hours (profiles.working_hours), Sick/Vacation Days Used (this tenure
 * year), and a Complete performance tier (≤39 Warning / 40-54 Low
 * Performance / 55-74 Good / 75+ Great Performance, also per the user's
 * explicit numbers) on the existing Tickets Touched count. Hr Rate (pay) and
 * a per-person Remaining/Support figure were explicitly left out — no
 * per-person "assigned workload" concept exists, and pay rate doesn't belong
 * on a report this roster can see. Covered Brands is derived from which
 * ticket sources each person actually closed tickets from in Date From/To,
 * not a separately-maintained (and easily stale) assignment list. The new
 * Brand/Account Breakdown panel groups every ticket by ticketSource (same
 * fallback chain as overallStatusData.ts's ticketSourceName) into an
 * all-time Total alongside its live Remaining (TR- snapshot) count.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import * as XLSX from "xlsx";
import { ChevronLeft, Loader2, Users, CheckCircle2, Clock, Timer, Download, Activity, UserCheck, UserX } from "lucide-react";
import { BrandedLoader } from "@/components/BrandedLoader";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyUsers, getEmployeeInfoByProfileIds, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyTickets, getTicketAuditLog, type TicketAuditEntry } from "@/lib/supabase/tickets";
import type { Ticket } from "@/lib/ticketData";
import { getAllAgentNotes, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import { getCompanyTimecardEntries, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import {
  getCompanyPtoRequests,
  ptoYearWindow,
  sickYearWindow,
  ptoDaysUsed,
  sickDaysUsed,
  type PtoRequestRow,
} from "@/lib/supabase/pto";
import { isTriageRole, normalizeRole, ROLE_LABELS } from "@/lib/roleLabels";
import { classify, BUCKET_LABEL, BUCKET_COLOR, BUCKET_ORDER, type ActionBucket } from "@/components/DailyActivityPage";
import { dayStatus, isOffDay, graceMinutesFor } from "@/components/ReportAttendanceMonitoring";

const TOOLTIP_STYLE = { background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" } as const;

function isTriageProfile(p: ProfileRow): boolean {
  return isTriageRole(p.role);
}
function normStatus(s: string | undefined | null): string {
  return String(s || "").trim().toLowerCase();
}
function isTriageStatus(status: string | undefined | null): boolean {
  return normStatus(status).startsWith("tr-");
}
function dateOnly(v: string | undefined | null): string {
  return (v || "").slice(0, 10);
}
const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
/** Add (or subtract, with a negative n) n days to an ISO date string. */
const addDaysToIso = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const fmtShort = (iso: string) => { const [, m, d] = iso.split("-"); return `${Number(m)}/${Number(d)}`; };
function fmtDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return `${hrs}h ${rem}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

// The only two TR- statuses that exist anywhere in this app (ticketData.ts,
// modules.ts, CSRStatusSummary.tsx) — the real triage pipeline is just
// these two stages, unlike Claims' longer PT-/CL- chain.
const STAGE_ORDER = ["tr-need triage", "tr-need po"];
const STAGE_LABEL: Record<string, string> = { "tr-need triage": "Need Triage", "tr-need po": "Need PO" };
const STAGE_COLOR: Record<string, string> = { "tr-need triage": "#f472b6", "tr-need po": "#c084fc" };

interface ExitEvent { ticketId: string; agentId: string | null; exitAt: string; durationMs: number | null }

// Walk each ticket's status-change history (sorted chronologically) and
// find every "left a TR- status" event, pairing it with the most recent
// "entered a TR- status" event for that same ticket to get a real duration.
function computeTriageExits(auditRows: { ticketId: string; field: string; beforeValue: string | null; afterValue: string | null; changedBy: string | null; createdAt: string }[]): ExitEvent[] {
  const byTicket = new Map<string, typeof auditRows>();
  for (const r of auditRows) {
    if (r.field !== "status") continue;
    if (!byTicket.has(r.ticketId)) byTicket.set(r.ticketId, []);
    byTicket.get(r.ticketId)!.push(r);
  }

  const exits: ExitEvent[] = [];
  for (const [ticketId, rows] of byTicket) {
    rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let enteredAt: string | null = null;
    for (const r of rows) {
      const wasTriage = isTriageStatus(r.beforeValue);
      const isTriage = isTriageStatus(r.afterValue);
      if (!wasTriage && isTriage) {
        enteredAt = r.createdAt;
      } else if (wasTriage && !isTriage) {
        exits.push({
          ticketId,
          agentId: r.changedBy,
          exitAt: r.createdAt,
          durationMs: enteredAt ? new Date(r.createdAt).getTime() - new Date(enteredAt).getTime() : null,
        });
        enteredAt = null;
      }
    }
  }
  return exits;
}

export function ReportTriageDaily({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [staff, setStaff] = useState<ProfileRow[]>([]);
  const [notes, setNotes] = useState<CsrAgentNote[]>([]);
  const [exits, setExits] = useState<ExitEvent[]>([]);
  const [auditRows, setAuditRows] = useState<TicketAuditEntry[]>([]);
  const [timecardEntries, setTimecardEntries] = useState<CompanyTimecardEntry[]>([]);
  const [ptoRequests, setPtoRequests] = useState<PtoRequestRow[]>([]);
  const [hireDateByProfileId, setHireDateByProfileId] = useState<Map<string, string | null>>(new Map());

  const [dateFrom, setDateFrom] = useState(daysAgoIso(29));
  const [dateTo, setDateTo] = useState(todayIso());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        // Widen the audit-log lookback so a ticket that entered triage before
        // dateFrom but exited inside the range still gets a real duration —
        // only exits inside [dateFrom, dateTo] are actually counted below.
        // The Activity breakdown re-uses this same fetch, filtered back down
        // to [dateFrom, dateTo] itself (see activityByProfile). Also always
        // reaches back to the 1st of the current calendar month, regardless
        // of how narrow Date From is set, so Monthly Complete (independent
        // of the Date From/To filter) never comes up short.
        const startOfMonthIso = `${todayIso().slice(0, 7)}-01`;
        const lookbackStart = [addDaysToIso(dateFrom, -60), startOfMonthIso].sort()[0];
        const [allTickets, profiles, allNotes, auditLog, timecardRows, ptoRows] = await Promise.all([
          getCompanyTickets(),
          getCompanyUsers(),
          getAllAgentNotes().catch((err) => { console.error("Failed to load agent notes:", err); return []; }),
          getTicketAuditLog({ startDate: lookbackStart, endDate: dateTo }).catch((err) => { console.error("Failed to load audit log:", err); return []; }),
          getCompanyTimecardEntries(dateFrom, dateTo).catch((err) => { console.error("Failed to load timecard entries:", err); return []; }),
          getCompanyPtoRequests().catch((err) => { console.error("Failed to load PTO requests:", err); return []; }),
        ]);
        if (cancelled) return;
        setTickets(allTickets);
        setStaff(profiles.filter((p) => p.is_active && isTriageProfile(p)));
        setNotes(allNotes);
        setExits(computeTriageExits(auditLog));
        setAuditRows(auditLog);
        setTimecardEntries(timecardRows);
        setPtoRequests(ptoRows);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Triage Daily Report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dateFrom, dateTo]);

  // Hire dates (employee_info.hireDate, for Start Date + the Sick/Vacation
  // Day tenure-year window) — a separate best-effort fetch keyed off the
  // resolved Triage roster, same "read hireDate off the heavier
  // employee_info blob" pattern AttendanceMonitoringPage.tsx already uses.
  useEffect(() => {
    if (staff.length === 0) { setHireDateByProfileId(new Map()); return; }
    let cancelled = false;
    getEmployeeInfoByProfileIds(staff.map((p) => p.id))
      .then((infoMap) => {
        if (cancelled) return;
        const hireDates = new Map<string, string | null>();
        for (const [pid, info] of infoMap) hireDates.set(pid, info.hireDate || null);
        setHireDateByProfileId(hireDates);
      })
      .catch((err) => console.error("Failed to load hire dates:", err));
    return () => { cancelled = true; };
  }, [staff]);

  const remainingTickets = useMemo(() => tickets.filter((t) => isTriageStatus(t.status)), [tickets]);
  const exitsInRange = useMemo(() => exits.filter((e) => dateOnly(e.exitAt) >= dateFrom && dateOnly(e.exitAt) <= dateTo), [exits, dateFrom, dateTo]);

  const withDuration = exitsInRange.filter((e) => e.durationMs !== null);
  const avgDurationMs = withDuration.length > 0 ? withDuration.reduce((s, e) => s + (e.durationMs ?? 0), 0) / withDuration.length : null;

  const kpi = {
    completed: exitsInRange.length,
    remaining: remainingTickets.length,
    staff: staff.length,
    avgTime: avgDurationMs !== null ? fmtDuration(avgDurationMs) : "—",
  };

  // Live snapshot pipeline — how the current backlog splits across the two
  // real TR- stages, same idea as ClaimsDashboard's Claim Stage tiles.
  const stageBreakdown = useMemo(() => {
    return STAGE_ORDER.map((s) => ({
      stage: s,
      label: STAGE_LABEL[s],
      count: remainingTickets.filter((t) => normStatus(t.status) === s).length,
    }));
  }, [remainingTickets]);

  // Aging — how long tickets still sitting in a TR- status have been there,
  // off status_changed_at (fallback created) — same signal ClaimsDashboard
  // and NeedClaimList.tsx use for their own aging columns. Always the live
  // snapshot, not scoped to Date From/To (matches the note below the filters).
  const agingBuckets = useMemo(() => {
    const buckets = { "0-1 Day": 0, "2-3 Days": 0, "4-6 Days": 0, "7+ Days": 0 };
    const now = Date.now();
    for (const t of remainingTickets) {
      const started = t.statusChangedAt || t.created;
      if (!started) continue;
      const days = Math.floor((now - new Date(started).getTime()) / 86400000);
      if (days <= 1) buckets["0-1 Day"]++;
      else if (days <= 3) buckets["2-3 Days"]++;
      else if (days <= 6) buckets["4-6 Days"]++;
      else buckets["7+ Days"]++;
    }
    return Object.entries(buckets).map(([label, count]) => ({ label, count }));
  }, [remainingTickets]);

  // Real day-by-day Completed count for the 10 days ending at Date To — not
  // the real "today", so this stays consistent with the KPI tiles when the
  // user looks at a past date range instead of the current one.
  const trendData = useMemo(() => {
    const dates = Array.from({ length: 10 }, (_, i) => addDaysToIso(dateTo, i - 9));
    const counts = new Map(dates.map((d) => [d, 0]));
    for (const e of exits) {
      const d = dateOnly(e.exitAt);
      if (counts.has(d)) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    return dates.map((d) => ({ date: fmtShort(d), completed: counts.get(d) ?? 0 }));
  }, [exits, dateTo]);

  // Only approved notes count as an employee's official record — same rule
  // used everywhere else this workflow shows up (CSR/Claims/Parts/Ops).
  const warningCountByProfile = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) { if (n.status !== "approved" || n.type !== "warning") continue; map.set(n.agentProfileId, (map.get(n.agentProfileId) ?? 0) + 1); }
    return map;
  }, [notes]);
  const mistakeCountByProfile = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) { if (n.status !== "approved" || n.type !== "mistake") continue; map.set(n.agentProfileId, (map.get(n.agentProfileId) ?? 0) + 1); }
    return map;
  }, [notes]);

  // Tickets Touched — who actually moved a ticket out of triage, from the
  // same exitsInRange the Completed KPI counts, so per-agent rows always
  // sum to that same total.
  const ticketsTouchedByProfile = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of exitsInRange) {
      if (!e.agentId) continue;
      map.set(e.agentId, (map.get(e.agentId) ?? 0) + 1);
    }
    return map;
  }, [exitsInRange]);

  // Monthly Complete — tickets moved out of triage since the 1st of the
  // CURRENT calendar month, independent of the Date From/To filter above
  // (the fetch effect always widens its audit-log lookback to cover this).
  const ticketsTouchedMonthByProfile = useMemo(() => {
    const monthStart = `${todayIso().slice(0, 7)}-01`;
    const map = new Map<string, number>();
    for (const e of exits) {
      if (!e.agentId) continue;
      const d = dateOnly(e.exitAt);
      if (d < monthStart || d > todayIso()) continue;
      map.set(e.agentId, (map.get(e.agentId) ?? 0) + 1);
    }
    return map;
  }, [exits]);

  // Activity — every ticket_audit_log action attributed to a triage staffer
  // within Date From/To, bucketed via DailyActivityPage's own `classify`
  // (the exact same function its Activity tab uses), so this is a real
  // derived summary of that same source data rather than a re-embed of the
  // page itself. Broader than Tickets Touched: this counts EVERY action a
  // triage staffer performed on any ticket, not just triage exits.
  const activityByProfile = useMemo(() => {
    const staffIds = new Set(staff.map((p) => p.id));
    const map = new Map<string, { total: number; counts: Record<ActionBucket, number> }>();
    for (const entry of auditRows) {
      if (!entry.changedBy || !staffIds.has(entry.changedBy)) continue;
      const d = dateOnly(entry.createdAt);
      if (d < dateFrom || d > dateTo) continue;
      if (!map.has(entry.changedBy)) {
        map.set(entry.changedBy, { total: 0, counts: Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0])) as Record<ActionBucket, number> });
      }
      const row = map.get(entry.changedBy)!;
      const bucket = classify(entry);
      row.counts[bucket] += 1;
      row.total += 1;
    }
    return map;
  }, [auditRows, staff, dateFrom, dateTo]);

  const activityBucketTotals = useMemo(() => {
    const totals = Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0])) as Record<ActionBucket, number>;
    for (const row of activityByProfile.values()) for (const b of BUCKET_ORDER) totals[b] += row.counts[b];
    return BUCKET_ORDER.map((b) => ({ bucket: b, label: BUCKET_LABEL[b], count: totals[b], color: BUCKET_COLOR[b] })).filter((x) => x.count > 0);
  }, [activityByProfile]);

  // Attendance — present/late/absent days for the triage roster across
  // Date From/To, via ReportAttendanceMonitoring's own `dayStatus`/
  // `isOffDay`/`graceMinutesFor` (the exact same present/late/absent
  // classification its Attendance tab uses), applied here to just the
  // triage roster instead of re-embedding that whole page.
  const attendanceDateRange = useMemo(() => {
    const dates: string[] = [];
    let d = new Date(dateFrom + "T00:00:00");
    const end = new Date(dateTo + "T00:00:00");
    while (d <= end) { dates.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
    return dates;
  }, [dateFrom, dateTo]);

  const timecardByProfileDate = useMemo(() => {
    const map = new Map<string, CompanyTimecardEntry>();
    for (const e of timecardEntries) map.set(`${e.profileId}|${e.workDate}`, e);
    return map;
  }, [timecardEntries]);

  const attendanceSummary = useMemo(() => {
    let present = 0, late = 0, absent = 0, hours = 0;
    for (const p of staff) {
      const graceMinutes = graceMinutesFor(p);
      for (const d of attendanceDateRange) {
        const off = isOffDay(d, p.off_days);
        const st = dayStatus(timecardByProfileDate.get(`${p.id}|${d}`), p.required_check_in, off, graceMinutes);
        if (st.present) { present++; if (st.late) late++; hours += st.hours; }
        else if (!off) absent++;
      }
    }
    return { present, late, absent, hours };
  }, [staff, attendanceDateRange, timecardByProfileDate]);

  // PTO requests grouped per profile — feeds the Sick/Vacation Day columns
  // below via the exact same ptoYearWindow/sickYearWindow/ptoDaysUsed/
  // sickDaysUsed helpers every other daily-report page (Claims/CSR/HR) uses.
  const ptoByProfile = useMemo(() => {
    const map = new Map<string, PtoRequestRow[]>();
    for (const r of ptoRequests) {
      const arr = map.get(r.profileId) ?? [];
      arr.push(r);
      map.set(r.profileId, arr);
    }
    return map;
  }, [ptoRequests]);

  // Which ticket source (warranty company/account) each ticket belongs to —
  // same fallback chain overallStatusData.ts's ticketSourceName uses, so
  // this brand/account breakdown agrees with that dashboard's own grouping.
  const sourceFor = (t: Ticket): string => (t.ticketSource || t.manufacturer || t.account || "Others").trim() || "Others";

  // Brand/account breakdown — every ticket source the company has ever
  // logged, with its all-time Total count alongside its current Remaining
  // (live TR- snapshot) count, same idea as the reference sheet's brand
  // table. Total is deliberately NOT scoped to Date From/To — it's a running
  // company-wide tally, same convention Remaining above already uses.
  const brandBreakdown = useMemo(() => {
    const totalBySource = new Map<string, number>();
    for (const t of tickets) totalBySource.set(sourceFor(t), (totalBySource.get(sourceFor(t)) ?? 0) + 1);
    const remainingBySource = new Map<string, number>();
    for (const t of remainingTickets) remainingBySource.set(sourceFor(t), (remainingBySource.get(sourceFor(t)) ?? 0) + 1);
    const sources = new Set([...totalBySource.keys(), ...remainingBySource.keys()]);
    return Array.from(sources)
      .map((source) => ({ source, total: totalBySource.get(source) ?? 0, remaining: remainingBySource.get(source) ?? 0 }))
      .sort((a, b) => b.total - a.total);
  }, [tickets, remainingTickets]);

  // Covered Brands per person — derived from which ticket sources they
  // ACTUALLY closed tickets from within Date From/To, rather than a
  // separately-maintained assignment list that can go stale. Reuses the
  // ticket lookup exitsInRange already keys off of.
  const ticketById = useMemo(() => {
    const map = new Map<string, Ticket>();
    for (const t of tickets) map.set(String((t as any)._id || ""), t);
    return map;
  }, [tickets]);
  const coveredBrandsByProfile = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of exitsInRange) {
      if (!e.agentId) continue;
      const t = ticketById.get(e.ticketId);
      if (!t) continue;
      const set = map.get(e.agentId) ?? new Set<string>();
      set.add(sourceFor(t));
      map.set(e.agentId, set);
    }
    return map;
  }, [exitsInRange, ticketById]);

  const staffRows = useMemo(() => {
    return staff
      .map((p) => {
        const hireDate = hireDateByProfileId.get(p.id) ?? null;
        const requests = ptoByProfile.get(p.id) ?? [];
        const vacationWindow = ptoYearWindow(hireDate, null, dateTo);
        const sickWindow = sickYearWindow(hireDate, null, dateTo);
        return {
          id: p.id,
          name: p.display_name || p.username || p.email,
          role: ROLE_LABELS[normalizeRole(p.role)] ?? p.role,
          branch: p.assigned_branch || "—",
          startDate: hireDate,
          workHours: p.working_hours,
          ticketsTouched: ticketsTouchedByProfile.get(p.id) ?? 0,
          monthlyComplete: ticketsTouchedMonthByProfile.get(p.id) ?? 0,
          actions: activityByProfile.get(p.id)?.total ?? 0,
          warnings: warningCountByProfile.get(p.id) ?? 0,
          mistakes: mistakeCountByProfile.get(p.id) ?? 0,
          sickDaysUsed: sickWindow ? Math.round(sickDaysUsed(requests, sickWindow) * 10) / 10 : null,
          vacationDaysUsed: vacationWindow ? Math.round(ptoDaysUsed(requests, vacationWindow) * 10) / 10 : null,
          coveredBrands: Array.from(coveredBrandsByProfile.get(p.id) ?? []).sort(),
        };
      })
      .sort((a, b) => b.ticketsTouched - a.ticketsTouched);
  }, [staff, hireDateByProfileId, ptoByProfile, dateTo, ticketsTouchedByProfile, ticketsTouchedMonthByProfile, activityByProfile, warningCountByProfile, mistakeCountByProfile, coveredBrandsByProfile]);

  const totalWarnings = staffRows.reduce((s, r) => s + r.warnings, 0);
  const totalMistakes = staffRows.reduce((s, r) => s + r.mistakes, 0);

  // Complete performance tiers — per the user's explicit thresholds.
  function completeTier(n: number): { label: string; className: string } {
    if (n <= 39) return { label: "Warning", className: "text-red-300" };
    if (n <= 54) return { label: "Low Performance", className: "text-yellow-300" };
    if (n <= 74) return { label: "Good", className: "text-blue-300" };
    return { label: "Great Performance", className: "text-green-300" };
  }

  // Exports exactly what's on screen — respects the same Date From/To
  // window as the dashboard itself, same convention as ClaimsDashboard.
  const exportToXlsx = () => {
    const sheet: (string | number)[][] = [
      ["Triage Daily Report"],
      [`Period: ${dateFrom} to ${dateTo}`],
      [`Generated: ${new Date().toLocaleString()}`],
      [],
      ["Summary"],
      ["Metric", "Value"],
      ["Completed", kpi.completed],
      ["Remaining", kpi.remaining],
      ["Triage Staff", kpi.staff],
      ["Avg Triage Time", kpi.avgTime],
      [],
      ["TR- Stage (live snapshot)"],
      ["Stage", "Count"],
      ...stageBreakdown.map((s) => [s.label, s.count]),
      [],
      ["Aging — Tickets Still in a TR- Status"],
      ["Bucket", "Count"],
      ...agingBuckets.map((b) => [b.label, b.count]),
      [],
      ["Activity by Type"],
      ["Type", "Count"],
      ...activityBucketTotals.map((b) => [b.label, b.count]),
      [],
      ["Attendance Summary"],
      ["Metric", "Value"],
      ["Present Days", attendanceSummary.present],
      ["Late Arrivals", attendanceSummary.late],
      ["Absent Days", attendanceSummary.absent],
      ["Total Hours", Math.round(attendanceSummary.hours * 100) / 100],
      [],
      ["Triage Staff"],
      ["Name", "Role", "Branch", "Start Date", "Work Hours", "Complete", "Complete Tier", "Monthly Complete", "Actions", "Warnings", "Mistakes", "Sick Days Used", "Vacation Days Used", "Covered Brands"],
      ...staffRows.map((s) => [
        s.name, s.role, s.branch, s.startDate || "", s.workHours ?? "",
        s.ticketsTouched, completeTier(s.ticketsTouched).label, s.monthlyComplete,
        s.actions, s.warnings, s.mistakes,
        s.sickDaysUsed ?? "", s.vacationDaysUsed ?? "Not Yet Eligible",
        s.coveredBrands.join(", "),
      ]),
      [],
      ["Brand / Account Breakdown"],
      ["Source", "Total", "Remaining"],
      ...brandBreakdown.map((b) => [b.source, b.total, b.remaining]),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(sheet);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Triage Report");
    XLSX.writeFile(workbook, `triage-daily-report_${dateFrom}_to_${dateTo}.xlsx`);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <button type="button" onClick={goBack} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></button>
          <h1 className="text-2xl font-bold">{sub.title}</h1>
        </div>

        <div className="panel mb-6"><div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" /></div>
            <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" /></div>
          </div>
          <button onClick={exportToXlsx} disabled={loading} className="btn text-sm px-3 shrink-0 flex items-center gap-1.5 disabled:opacity-50">
            <Download className="h-3.5 w-3.5" /> Download XLSX
          </button>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">Remaining and the TR- stage/aging breakdown reflect tickets currently in a TR- status (a live snapshot); Completed/Avg Triage Time/Triage Staff are scoped to Date From–To.</p>
        </div>

        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        {loading ? (
          <div className="panel p-8 mb-6"><BrandedLoader label="Loading Triage Daily Report…" /></div>
        ) : (
        <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Completed", value: kpi.completed, color: "text-green-300", icon: <CheckCircle2 className="h-4 w-4" /> },
            {
              label: "Remaining", value: kpi.remaining, color: "text-yellow-300", icon: <Clock className="h-4 w-4" />,
              // Opens Ticket List filtered to every live TR- status (both
              // stages — the same two statuses isTriageStatus/STAGE_ORDER
              // track) — matches exactly what this KPI counts, via the same
              // ?status= deep link TicketOperationReport uses, widened to a
              // comma-separated list (see TicketList.tsx's
              // matchesStatusFilterValue).
              onClick: () => window.open(`/m/tickets/ticket-list?status=${encodeURIComponent("TR-Need Triage,TR-Need PO")}`, "_blank", "noopener,noreferrer"),
            },
            { label: "Triage Staff", value: kpi.staff, color: "text-blue-300", icon: <Users className="h-4 w-4" /> },
            { label: "Avg Triage Time", value: kpi.avgTime, color: "text-purple-300", icon: <Timer className="h-4 w-4" /> },
          ].map((k) => (
            k.onClick ? (
              <button
                key={k.label}
                type="button"
                onClick={k.onClick}
                title="Open these tickets in Ticket List"
                className="panel p-4 text-center hover:bg-white/5 transition cursor-pointer"
              >
                <div className="flex justify-center mb-1 text-muted-foreground">{k.icon}</div>
                <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{k.label}</p>
              </button>
            ) : (
              <div key={k.label} className="panel p-4 text-center">
                <div className="flex justify-center mb-1 text-muted-foreground">{k.icon}</div>
                <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{k.label}</p>
              </div>
            )
          ))}
        </div>

        {/* TR- stage pipeline + aging */}
        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-4">TR- Stage (live snapshot)</p>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {stageBreakdown.map((s) => (
              <div key={s.stage} className="panel p-3 text-center">
                <p className="text-xl font-bold" style={{ color: STAGE_COLOR[s.stage] }}>{s.count}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Aging — Still in a TR- Status</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {agingBuckets.map((b) => (
              <div key={b.label} className="panel p-3 text-center">
                <p className="text-lg font-bold text-orange-300">{b.count}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{b.label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-4">Completed — Last 10 Days</p>
          <ResponsiveContainer width="100%" height={200} debounce={200}>
            <BarChart data={trendData} margin={{ left: -10 }}>
              <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="completed" fill="#34d399" radius={[4, 4, 0, 0]} name="Completed" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Activity — derived from ticket_audit_log via DailyActivityPage's
            own classify(), same as its Activity tab, scoped to Triage staff
            and Date From/To instead of embedding that whole page. */}
        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-4 flex items-center gap-1.5"><Activity className="h-4 w-4" /> Activity by Type</p>
          {activityBucketTotals.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">No triage staff activity logged in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(120, activityBucketTotals.length * 32)} debounce={200}>
              <BarChart data={activityBucketTotals} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} width={110} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} name="Actions">
                  {activityBucketTotals.map((b) => (
                    <Cell key={b.bucket} fill={b.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Attendance — derived from timecard entries via
            ReportAttendanceMonitoring's own dayStatus()/isOffDay()/
            graceMinutesFor(), same present/late/absent rule its Attendance
            tab uses, scoped to Triage staff instead of embedding that page. */}
        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-4">Attendance Summary</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Present Days", value: attendanceSummary.present, color: "text-green-300", icon: <UserCheck className="h-4 w-4" /> },
              { label: "Late Arrivals", value: attendanceSummary.late, color: "text-yellow-300", icon: <Clock className="h-4 w-4" /> },
              { label: "Absent Days", value: attendanceSummary.absent, color: "text-red-300", icon: <UserX className="h-4 w-4" /> },
              { label: "Total Hours", value: Math.round(attendanceSummary.hours * 10) / 10, color: "text-blue-300", icon: <Timer className="h-4 w-4" /> },
            ].map((k) => (
              <div key={k.label} className="panel p-3 text-center">
                <div className="flex justify-center mb-1 text-muted-foreground">{k.icon}</div>
                <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Staff table */}
        <div className="panel p-0 overflow-hidden mb-4">
          <div className="px-4 py-4 border-b border-white/10">
            <h2 className="font-semibold text-sm">Triage Staff</h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Everyone currently holding a Technical Support or Technical Support Manager role — click a name for their full stats, mistakes &amp; warnings.
              Complete is tiered <span className="text-red-300 font-semibold">Warning (≤39)</span>, <span className="text-yellow-300 font-semibold">Low Performance (40–54)</span>, <span className="text-blue-300 font-semibold">Good (55–74)</span>, <span className="text-green-300 font-semibold">Great Performance (75+)</span> — tickets moved out of triage within Date From–To.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/5 border-b border-white/10">
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Name</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Role</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Start Date</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Work Hours</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Complete</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Monthly Complete</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Actions</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Warnings</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Mistakes</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Sick Days Used</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Vacation Days Used</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Covered Brands</th>
                </tr>
              </thead>
              <tbody>
                {staffRows.length === 0 ? (
                  <tr><td colSpan={12} className="px-3 py-8 text-center text-muted-foreground">No one currently holds a Technical Support or Technical Support Manager role.</td></tr>
                ) : staffRows.map((s) => {
                  const tier = completeTier(s.ticketsTouched);
                  return (
                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 font-medium">
                      <a href={`/csr-agent/${s.id}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-300 hover:underline transition" title={`View ${s.name}'s statistics`}>
                        {s.name}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{s.role}</td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{s.startDate || "—"}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{s.workHours ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`font-bold ${tier.className}`} title={tier.label}>{s.ticketsTouched}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{s.monthlyComplete}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{s.actions}</td>
                    <td className="px-3 py-2 text-right">
                      {s.warnings > 0 ? <span className="bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded font-semibold">{s.warnings}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.mistakes > 0 ? <span className="bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded font-semibold">{s.mistakes}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{s.sickDaysUsed ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{s.vacationDaysUsed ?? "Not Yet Eligible"}</td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[220px] truncate" title={s.coveredBrands.join(", ")}>
                      {s.coveredBrands.length > 0 ? s.coveredBrands.join(", ") : "—"}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {staffRows.length > 0 && (
            <div className="px-4 py-3 border-t border-white/10 flex items-center gap-4 text-[10px] text-muted-foreground uppercase tracking-wide">
              <span>Warnings (Company-wide): <span className="text-yellow-300 font-semibold">{totalWarnings}</span></span>
              <span>Mistakes (Company-wide): <span className="text-orange-300 font-semibold">{totalMistakes}</span></span>
            </div>
          )}
        </div>

        {/* Brand/Account breakdown — every ticket source the company has
            logged, all-time Total alongside the current Remaining (live
            TR- snapshot), matching the reference sheet's brand table. */}
        <div className="panel p-0 overflow-hidden">
          <div className="px-4 py-4 border-b border-white/10">
            <h2 className="font-semibold text-sm">Brand / Account Breakdown</h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">Total is all-time across every ticket ever logged under that source; Remaining is a live snapshot of tickets currently in a TR- status.</p>
          </div>
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="bg-white/5 border-b border-white/10">
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Source</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Total</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {brandBreakdown.length === 0 ? (
                  <tr><td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">No tickets on file.</td></tr>
                ) : brandBreakdown.map((b) => (
                  <tr key={b.source} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 font-medium">{b.source}</td>
                    <td className="px-3 py-2 text-right">{b.total}</td>
                    <td className="px-3 py-2 text-right text-yellow-300 font-semibold">{b.remaining}</td>
                  </tr>
                ))}
              </tbody>
              {brandBreakdown.length > 0 && (
                <tfoot>
                  <tr className="border-t border-white/10 bg-white/5 font-semibold">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right">{brandBreakdown.reduce((s, b) => s + b.total, 0)}</td>
                    <td className="px-3 py-2 text-right text-yellow-300">{brandBreakdown.reduce((s, b) => s + b.remaining, 0)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
        </>
        )}
      </main>
    </div>
  );
}
