/**
 * Reports module — Technician Performance Report. A standalone, read-only
 * viewing surface (per an explicit ask that this NOT be folded into the
 * Tech Activity Report / payroll editing tools) computing the KPIs a
 * legacy "Technician Performance Management Module" spec called for:
 * Total Tickets, Redo Rate %, Tickets/Hour, and Miles/Ticket, per
 * technician, for a Weekly or Monthly period — plus 3 threshold alerts
 * (High Redo >5%, Route Mileage Audit >30 mi/ticket, Low Utilization
 * <32 hrs/week) and grouping by Branch/Manager/Tier.
 *
 * Deliberately reuses the SAME underlying data every other payroll/tech
 * report in this app already computes from (getTechCompletedRepairCounts,
 * getTechRedoTickets, mileage.ts, timecards.ts) rather than a new data
 * pipeline — this module is a different VIEW of that data, not a new
 * source of truth. Minor/Major Ticket split (explicit user rule, not
 * derived): a completed ticket's repair_type (the "Repair Type (2nd
 * Tech)" dropdown on the ticket's Visit Log, techPayroll.ts's
 * REPAIR_TYPES — despite the label, set on every visit, not just 2nd-
 * tech ones) counts as MAJOR when it's Sealed System (any of its 3
 * variants), Drum Replacement, or Major Repair; every other repair_type
 * (2 Man Job included — explicitly confirmed minor) and no-repair-type-
 * set tickets are MINOR. Computed from getTechCompletedRepairCounts'
 * per-(technician, repairType) totals, split into a day-level breakdown the
 * same way Total Tickets is (migration 0326) so a manual correction can
 * replace one day's Minor or Major count independently of the other.
 *
 * "Tier Level" here is whatever's on profiles.tier_level verbatim — a
 * pre-existing, loosely-defined column (a mix of pay-tier labels like
 * "tier 1" and job titles like "Branch Manager") that predates this
 * report and isn't a clean Tier 1-4 enum. Shown as-is rather than
 * inventing a new field no one would maintain.
 *
 * Tech ID is profiles.technician_id — the real dedicated column Admin User
 * Management's own "Technician ID" field edits (getCompanyUsers already
 * selects it, no extra fetch needed) — NOT employee_info.employeeId, a
 * separate free-text HR field that's a different piece of data entirely
 * and was almost always empty, which is why every row showed "—" here.
 * Falls back to "—" rather than fabricating an ID when it hasn't been set.
 *
 * Export CSV / Download Import Template / Import Excel all share one
 * column arrangement (per an explicit reference spreadsheet): Name,
 * Variance, Damage Assessment, [Date — import template only], Minor Ticket,
 * Major Ticket, Redo, Total Completion, Average Completion, Reschedule,
 * NCNS, Cancelled, Mileage, Working Days, Off Days, Unexcused Off Days
 * Total 2026, Hours Worked, Location, Manager, Tier — plus this report's
 * own extra analytical columns (Redo Rate %, Miles/Ticket, Tickets/Hour,
 * the 3 threshold alerts) appended after, not dropped.
 * "Off Days" = scheduled weekly RDOs within the period (profiles.off_days),
 * not days actually missed. "Unexcused Off Days Total 2026" is a blank,
 * manually-filled column by design — this app has no excused/unexcused
 * absence tracking yet, so there's nothing live to put there, and it's
 * not parsed back out on import (same as Location/Manager/Tier). "NCNS"
 * has no live tracking either (no-call-no-show detection doesn't exist in
 * this app — see visitExceptions.ts), but unlike Unexcused Off Days it DOES
 * have a real per-day override column (migration 0326) to persist a typed
 * number into and read back on import — it just has no live value to ever
 * merge with, so it's purely whatever's been manually entered, per day.
 * "Variance" = this technician's Total Completion
 * vs. the average of every technician CURRENTLY in view (filteredRows), as
 * a signed %, colored green/red in the .xlsx export (CSV can't carry
 * color). "Damage Assessment" = count of "damage" signable documents (the
 * HR-initiated Damage/Part Loss/Tool Penalty payroll-deduction agreement,
 * see damageAssessmentCount on TechPerfRow) sent to this technician in the
 * period — NOT a technician self-report. "Reschedule" = ticket_reschedules
 * rows this technician themselves created (mobile app's own action) in the
 * period. "Cancelled" = this technician's assigned tickets that reached a
 * terminal CL-Cancelled status in the period (see
 * getTechCancelledTicketCounts) — distinct from "CL-Need Cancel", which is
 * still a pending request, not yet cancelled.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronLeft, Download, Upload, RefreshCw, X, MapPin, UserSquare2, Star, CalendarClock, ChevronRight, PencilLine, Crown, AlertTriangle } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { BrandedLoader } from "@/components/BrandedLoader";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getTechCompletedRepairCounts, getTechCompletedTicketsDaily, getTechRedoTickets, getTechCancelledTicketCounts, type TechCompletedTicketDaily } from "@/lib/supabase/techPayroll";
import { getMileageEntries, mileageEffectiveTotal } from "@/lib/supabase/mileage";
import { getCompanyTicketReschedules } from "@/lib/supabase/ticketReschedules";
import { getSignableDocuments } from "@/lib/supabase/signableDocuments";
import { getCompanyTimecardEntries, calcWorkedHours, computeMealTimeCredit, startOfWeekSunday, addDaysISO } from "@/lib/supabase/timecards";
import { getCorrectionsInRange } from "@/lib/supabase/timecardCorrections";
import { getCsrTeamComposition, type CsrTeamComposition } from "@/lib/supabase/csrTeams";
import { visibleAttendanceProfileIds } from "@/lib/notifyRouting";
import { TECHNICIAN_PAY_ROLES, normalizeRole, isMealAlwaysPaidRole, isFinanceRole, isCompanySuperAdminRole } from "@/lib/roleLabels";
import { exportToCSV } from "@/lib/csvExport";
import {
  getTechnicianPerformanceOverrides,
  bulkUpsertTechnicianPerformanceOverrides,
  type DailyPerformanceOverride,
} from "@/lib/supabase/technicianPerformanceOverrides";

const TOOLTIP_STYLE = {
  background: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  color: "#0f172a",
  fontSize: 12,
  fontWeight: 600,
  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
} as const;
/**
 * Per the user's call (2026-10-01): on THIS REPORT ONLY, Minor Comp, Major
 * Comp, Redo Count, Mileage, Hours of Work, Working Days and Off Days count
 * as 0 from this date to the present — live tickets / redos / punches /
 * mileage / scheduled off days on or after it are ignored here, unless a
 * value was entered for the day (import / correction). Earlier dates are
 * unaffected, and nothing in the database is changed or deleted (payroll,
 * Accounting, timecards all still use the real data). Set to "9999-12-31"
 * to turn it off.
 */
const BLANK_LIVE_TIME_FROM = "2026-08-27";

const CHART_BAR_FILL = "#3b82f6";
const COMPARE_BAR_FILLS = ["#3b82f6", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6", "#06b6d4"];

/** Checkbox-list multi-select so Location/Manager/Tier can pick several
 *  values at once (combined/OR filtering) rather than only one. Portaled
 *  to <body> with `fixed` positioning from the trigger's
 *  getBoundingClientRect() (same fix as AdminUserManagementPage.tsx's
 *  column filter) — an `absolute` menu here renders inside the glass
 *  `.panel` filter bar, which sits earlier in the DOM than the chart/
 *  table panels below; those panels are glassmorphic (backdrop-blur),
 *  which forms their own stacking context and paints over an in-flow
 *  `absolute` dropdown regardless of z-index. Rendering into <body>
 *  sidesteps that entirely. */
function MultiSelect({
  label, options, selected, onChange,
}: { label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const closeOnScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", closeOnScroll, { capture: true, passive: true });
    const closeOnOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => {
      window.removeEventListener("scroll", closeOnScroll, { capture: true });
      document.removeEventListener("mousedown", closeOnOutsideClick);
    };
  }, [open]);

  const allSelected = selected.length === options.length && options.length > 0;
  const toggleAll = () => onChange(allSelected ? [] : [...options]);
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  const display = selected.length === 0
    ? "All"
    : selected.length === options.length
    ? "All selected"
    : selected.slice(0, 2).join(", ") + (selected.length > 2 ? `, +${selected.length - 2} more` : "");

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={`Select ${label}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="glass-input text-xs py-1.5 px-3 rounded-md flex items-center gap-2 min-w-[140px] justify-between"
      >
        <span className="truncate">{display}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={label}
          aria-multiselectable="true"
          className="fixed z-[9999] w-56 max-h-64 overflow-y-auto rounded-md border border-white/15 shadow-2xl"
          style={{ top: pos.top, left: pos.left, background: "rgb(22,28,52)", border: "1px solid rgba(255,255,255,0.15)" }}
        >
          <label className="flex items-center gap-2 px-3 py-2 hover:bg-white/5 cursor-pointer border-b border-white/10 text-xs font-medium">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-blue-500" />
            [ Select All ]
          </label>
          {options.map((o) => (
            <label key={o} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 cursor-pointer text-xs">
              <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} className="accent-blue-500" />
              {o}
            </label>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

// "total" = every pay period combined (first period's start → today);
// "custom" = one pay period picked from the dropdown.
type PeriodMode = "total" | "custom";

// Pay periods: the first is the irregular 08-27 → 09-12 (2026); after
// that they're biweekly Monday → Saturday (09-14 → 09-26, 09-28 → 10-10,
// ...), skipping the Sunday between periods. Listed up to the one that
// contains (or most recently started before) today.
const FIRST_PAY_PERIOD = { start: "2026-08-27", end: "2026-09-12" };
const payPeriodsThrough = (today: string): { start: string; end: string }[] => {
  const periods = [FIRST_PAY_PERIOD];
  let start = addDaysISO(FIRST_PAY_PERIOD.end, 2);
  while (start <= today) {
    periods.push({ start, end: addDaysISO(start, 12) });
    start = addDaysISO(start, 14);
  }
  return periods;
};
const fmtPayDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
type SortKey = "techId" | "name" | "location" | "manager" | "tier" | "daysWorked" | "hoursWorked" | "totalTickets" | "minorTicketCount" | "majorTicketCount" | "redoCount" | "redoRatePct" | "miles" | "milesPerTicket" | "ticketsPerHour" | "rescheduleCount" | "cancelledCount" | "damageAssessmentCount" | "shortTotalTicket" | "shortRedoPct" | "shortDailyAvg" | "shortPoints" | "shortAvgHours" | "shortAvgMiles" | "shortErrorCount";

// Short-view columns, computed straight from what that view shows:
// Total Ticket = Minor + Major − Redo; Redo % = Redo ÷ (Minor + Major).
const shortTotalTicket = (r: { minorTicketCount: number; majorTicketCount: number; redoCount: number }) =>
  r.minorTicketCount + r.majorTicketCount - r.redoCount;
const shortRedoPct = (r: { minorTicketCount: number; majorTicketCount: number; redoCount: number }): number | null => {
  const completed = r.minorTicketCount + r.majorTicketCount;
  return completed > 0 ? (r.redoCount / completed) * 100 : null;
};
// Average Tickets = Total Ticket ÷ Working Total Days; 0 with no working
// days (no tickets per day), so it reads and grades like any other 0.
const shortDailyAvg = (r: { minorTicketCount: number; majorTicketCount: number; redoCount: number; daysWorked: number }): number =>
  r.daysWorked > 0 ? shortTotalTicket(r) / r.daysWorked : 0;
// Average Hours / Average Mileage = Hours of Work / Mileage ÷ Working
// Days (0 with no working days). Shown, not graded or scored.
const shortAvgHours = (r: { hoursWorked: number; daysWorked: number }): number =>
  r.daysWorked > 0 ? r.hoursWorked / r.daysWorked : 0;
const shortAvgMiles = (r: { miles: number; daysWorked: number }): number =>
  r.daysWorked > 0 ? r.miles / r.daysWorked : 0;
// Error Count = timecard issues (correction requests) + damages (damage
// documents issued). Shown, not scored.
const shortErrorCount = (r: { timecardIssueCount: number; damageAssessmentCount: number }): number =>
  r.timecardIssueCount + r.damageAssessmentCount;
// Redo % with no tickets reads (and grades) as 0%, same as any other 0.
const fmtRedoPct = (p: number | null) => `${fmt1(p ?? 0)}%`;

// Performance grades for the six main factors, per the scale ops handed
// over (Maximum / Great / Median / Effort / Alert). The totals' thresholds
// are sized for a 2-week pay period.
type Grade = "max" | "great" | "median" | "effort" | "alert";
const GRADE_META: Record<Grade, { label: string; pill: string; dot: string; xlsxFill: string; xlsxFont: string }> = {
  max: { label: "Maximum", pill: "bg-sky-500/15 text-sky-300 ring-sky-400/30", dot: "bg-sky-400", xlsxFill: "FFDBEAFE", xlsxFont: "FF1D4ED8" },
  great: { label: "Great", pill: "bg-emerald-500/15 text-emerald-400 ring-emerald-400/30", dot: "bg-emerald-400", xlsxFill: "FFDCFCE7", xlsxFont: "FF15803D" },
  median: { label: "Median", pill: "bg-yellow-400/15 text-yellow-300 ring-yellow-300/30", dot: "bg-yellow-300", xlsxFill: "FFFEF9C3", xlsxFont: "FFA16207" },
  effort: { label: "Effort", pill: "bg-orange-500/15 text-orange-300 ring-orange-400/30", dot: "bg-orange-400", xlsxFill: "FFFFEDD5", xlsxFont: "FFC2410C" },
  alert: { label: "Alert", pill: "bg-red-500/15 text-red-300 ring-red-400/30", dot: "bg-red-400", xlsxFill: "FFFEE2E2", xlsxFont: "FFB91C1C" },
};
const GRADE_ORDER: Grade[] = ["max", "great", "median", "effort", "alert"];
// Higher is better: thresholds are the minimum for Maximum/Great/Median/Effort.
const gradeAtLeast = (v: number | null, [max, great, median, effort]: [number, number, number, number]): Grade | null =>
  v == null ? null : v >= max ? "max" : v >= great ? "great" : v >= median ? "median" : v >= effort ? "effort" : "alert";
const GRADERS = {
  dailyAvg: (v: number | null) => gradeAtLeast(v, [10, 7, 5, 3]),
  totalTicket: (v: number | null) => gradeAtLeast(v, [90, 71, 60, 40]),
  // Lower is better: ≤2% Maximum, ≤4% Great, ≤6% Median, under 10% Effort.
  // No tickets (null) counts as 0%.
  redoPct: (v: number | null): Grade => {
    const p = v ?? 0;
    return p <= 2 ? "max" : p <= 4 ? "great" : p <= 6 ? "median" : p < 10 ? "effort" : "alert";
  },
  workingDays: (v: number | null) => gradeAtLeast(v, [13, 11, 10, 8]),
  // Average Hours: 12 or less a day is yellow (0); over 12 is orange (−1 pt).
  avgHours: (v: number): Grade => (v > 12 ? "effort" : "median"),
  // Average Mileage: 250+ a day is green (+1 pt); under 250 is yellow (0).
  avgMiles: (v: number): Grade => (v >= 250 ? "great" : "median"),
};
// Points per grade; a technician's Points = the sum over the scored
// factors, −5 to 11. Redo % and Working Days top out at 2 (their Maximum
// is worth the same as Great). Average Hours only ever takes a point
// away (over 12 hours a day is −1); Average Mileage only ever adds one
// (250+ miles a day is +1).
const GRADE_POINTS: Record<Grade, number> = { max: 3, great: 2, median: 1, effort: 0, alert: -1 };
const CAPPED_GRADE_POINTS: Record<Grade, number> = { ...GRADE_POINTS, max: 2 };
const AVG_HOURS_POINTS: Record<Grade, number> = { max: 0, great: 0, median: 0, effort: -1, alert: 0 };
const AVG_MILES_POINTS: Record<Grade, number> = { max: 0, great: 1, median: 0, effort: 0, alert: 0 };
type ShortRowInput = { minorTicketCount: number; majorTicketCount: number; redoCount: number; daysWorked: number; hoursWorked: number; miles: number };
const shortPoints = (r: ShortRowInput): number => {
  const pts = (g: Grade | null, table: Record<Grade, number>) => (g ? table[g] : 0);
  return pts(GRADERS.dailyAvg(shortDailyAvg(r)), GRADE_POINTS)
    + pts(GRADERS.totalTicket(shortTotalTicket(r)), GRADE_POINTS)
    + pts(GRADERS.redoPct(shortRedoPct(r)), CAPPED_GRADE_POINTS)
    + pts(GRADERS.workingDays(r.daysWorked), CAPPED_GRADE_POINTS)
    + pts(GRADERS.avgHours(shortAvgHours(r)), AVG_HOURS_POINTS)
    + pts(GRADERS.avgMiles(shortAvgMiles(r)), AVG_MILES_POINTS);
};
// Letter grade from Points: SSS 11, SS 10, S 9, A 8, B 7, C 5–6, D 4 or
// less — shown as medals (SSS royal with a crown, SS diamond, S gold,
// A silver, B bronze, C steel, D iron).
type LetterGrade = "SSS" | "SS" | "S" | "A" | "B" | "C" | "D";
const LETTER_GRADES: LetterGrade[] = ["SSS", "SS", "S", "A", "B", "C", "D"];
const letterGrade = (points: number): LetterGrade =>
  points >= 11 ? "SSS" : points >= 10 ? "SS" : points >= 9 ? "S" : points >= 8 ? "A" : points >= 7 ? "B" : points >= 5 ? "C" : "D";
const LETTER_META: Record<LetterGrade, { medal: string; range: string; bg: string; text: string; rim: string; xlsxFill: string; xlsxFont: string }> = {
  SSS: { medal: "Crown", range: "11 pts", bg: "linear-gradient(135deg,#fef3c7 0%,#f59e0b 20%,#be123c 55%,#581c87 100%)", text: "#fffbeb", rim: "#fde68a", xlsxFill: "FFBE123C", xlsxFont: "FFFFFBEB" },
  SS: { medal: "Diamond", range: "10 pts", bg: "linear-gradient(135deg,#ffffff 0%,#cffafe 22%,#a5b4fc 48%,#f0abfc 72%,#e0f2fe 100%)", text: "#3b0764", rim: "#ffffff", xlsxFill: "FFC7D2FE", xlsxFont: "FF3B0764" },
  S: { medal: "Gold", range: "9 pts", bg: "linear-gradient(135deg,#fff7c2 0%,#fcd34d 30%,#d97706 75%,#92400e 100%)", text: "#451a03", rim: "#fde68a", xlsxFill: "FFFCD34D", xlsxFont: "FF451A03" },
  A: { medal: "Silver", range: "8 pts", bg: "linear-gradient(135deg,#ffffff 0%,#e2e8f0 30%,#94a3b8 75%,#475569 100%)", text: "#0f172a", rim: "#f1f5f9", xlsxFill: "FFE2E8F0", xlsxFont: "FF0F172A" },
  B: { medal: "Bronze", range: "7 pts", bg: "linear-gradient(135deg,#ffe4c4 0%,#e0995e 30%,#b4622a 75%,#6b3410 100%)", text: "#2a1204", rim: "#fcd9b6", xlsxFill: "FFE0995E", xlsxFont: "FF2A1204" },
  C: { medal: "Steel", range: "5–6 pts", bg: "linear-gradient(135deg,#e0f2fe 0%,#7dd3fc 30%,#0369a1 80%,#0c4a6e 100%)", text: "#f0f9ff", rim: "#bae6fd", xlsxFill: "FF7DD3FC", xlsxFont: "FF0C4A6E" },
  D: { medal: "Iron", range: "4 pts or less", bg: "linear-gradient(135deg,#d4d4d8 0%,#71717a 40%,#3f3f46 80%,#18181b 100%)", text: "#fafafa", rim: "#a1a1aa", xlsxFill: "FFA1A1AA", xlsxFont: "FF18181B" },
};

function GradeMedal({ grade, size = "md" }: { grade: LetterGrade; size?: "sm" | "md" }) {
  const meta = LETTER_META[grade];
  // Longer grades (SS, SSS) get a smaller, tighter font to fit the coin.
  const font = size === "sm"
    ? grade.length > 2 ? "text-[7px] tracking-tighter" : grade.length > 1 ? "text-[9px] tracking-tighter" : "text-[11px]"
    : grade.length > 2 ? "text-[10px] tracking-tighter" : grade.length > 1 ? "text-xs tracking-tighter" : "text-sm";
  const dim = `${size === "sm" ? "h-6 w-6" : "h-8 w-8"} ${font}`;
  const crowned = grade === "SSS";
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full font-black ${dim} ${crowned ? (size === "sm" ? "mt-2" : "mt-2.5") : ""}`}
      style={{
        background: meta.bg,
        color: meta.text,
        boxShadow: crowned
          ? "0 0 10px rgba(251,191,36,0.55), 0 1px 4px rgba(0,0,0,0.45), inset 0 1px 1px rgba(255,255,255,0.6)"
          : "0 1px 4px rgba(0,0,0,0.45), inset 0 1px 1px rgba(255,255,255,0.6)",
      }}
      title={`${grade} grade · ${meta.medal} (${meta.range})`}
    >
      {crowned && (
        <Crown
          className={`absolute left-1/2 -translate-x-1/2 ${size === "sm" ? "-top-2.5 h-3 w-3" : "-top-3.5 h-4 w-4"}`}
          fill="#facc15"
          stroke="#92400e"
          strokeWidth={1.5}
          style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.5))" }}
          aria-hidden
        />
      )}
      {/* inner rim, like a struck medal */}
      <span className="absolute inset-[3px] rounded-full" style={{ boxShadow: `inset 0 0 0 1px ${meta.rim}`, opacity: 0.7 }} />
      <span className="relative" style={{ textShadow: crowned ? "0 1px 1px rgba(0,0,0,0.5)" : "0 1px 0 rgba(255,255,255,0.35)" }}>{grade}</span>
    </span>
  );
}

// Hover text for the summary tiles in the short view.
const KPI_HINTS: Record<string, string> = {
  "Technicians": "Technicians in the table (after filters)",
  "Total Tickets": "Sum of Total Ticket (Minor + Major − Redo)",
  "Avg Redo %": "All Redo ÷ all (Minor + Major)",
  "Avg Tickets/Hr": "Total Tickets ÷ total Hours of Work",
  "Flagged": "Technicians with at least one red (Alert) main factor",
};
const fmtPoints =(p: number) => `${p > 0 ? `+${p}` : p < 0 ? `−${-p}` : "0"} pt${Math.abs(p) === 1 ? "" : "s"}`;
const GRADE_SCALE: { factor: string; ranges: Record<Grade, string>; points?: Record<Grade, number> }[] = [
  { factor: "Average Tickets", ranges: { max: "10+", great: "7–9", median: "5–6", effort: "3–4", alert: "2 or less" } },
  { factor: "Total Ticket", ranges: { max: "90+", great: "71–89", median: "60–70", effort: "40–59", alert: "39 or less" } },
  { factor: "Redo %", ranges: { max: "2% or less", great: "4% or less", median: "6% or less", effort: "7–9%", alert: "10%+" }, points: CAPPED_GRADE_POINTS },
  { factor: "Working Days", ranges: { max: "13–14", great: "11–12", median: "10", effort: "8–9", alert: "7 or less" }, points: CAPPED_GRADE_POINTS },
  { factor: "Average Mileage", ranges: { max: "", great: "250+", median: "under 250", effort: "", alert: "" }, points: AVG_MILES_POINTS },
  { factor: "Average Hours", ranges: { max: "", great: "", median: "12 or less", effort: "over 12", alert: "" }, points: AVG_HOURS_POINTS },
];

function GradePill({ grade, children }: { grade: Grade | null; children: ReactNode }) {
  if (!grade) return <span className="inline-flex justify-end min-w-[4.25rem] px-2 py-0.5 tabular-nums text-muted-foreground">{children}</span>;
  return (
    <span
      className={`inline-flex justify-end min-w-[4.25rem] rounded-md px-2 py-0.5 ring-1 ring-inset tabular-nums font-semibold ${GRADE_META[grade].pill}`}
      title={GRADE_META[grade].label}
    >
      {children}
    </span>
  );
}
type GroupBy = "none" | "location" | "manager" | "tier";

interface TechPerfRow {
  id: string;
  techId: string;
  name: string;
  location: string;
  manager: string;
  tier: string;
  isActive: boolean;
  daysWorked: number;
  /** The dates behind daysWorked (punched days + days with an hours correction), ascending. */
  workedDates: string[];
  hoursWorked: number;
  totalTickets: number;
  minorTicketCount: number;
  majorTicketCount: number;
  redoCount: number;
  redoRatePct: number | null;
  miles: number;
  milesPerTicket: number | null;
  ticketsPerHour: number | null;
  /** Count of the technician's scheduled weekly off days (profiles.off_days,
   *  weekday indices 0=Sun..6=Sat) that fall within the current period —
   *  NOT days actually missed, just the normal RDO/weekend pattern. See
   *  this file's header comment on why "unexcused off days" (a real
   *  excused/unexcused absence count) is a separate, still-unbuilt concept. */
  offDaysCount: number;
  /** Raw weekday indices (profiles.off_days) backing offDaysCount — kept
   *  on the row too so the Off Days popup can list the actual dates. */
  offDays: number[];
  /** Count of ticket_reschedules rows this technician themselves created
   *  in the period (migration 0215 — the mobile app's own "Reschedule" +
   *  typed reason action on a ticket they're on). */
  rescheduleCount: number;
  /** Count of this technician's assigned tickets that reached a terminal
   *  CL-Cancelled-style status (statusGroupOf === "cancelled") within the
   *  period — see getTechCancelledTicketCounts. */
  cancelledCount: number;
  /** Count of "damage" signable documents (the HR-initiated Damage/Part
   *  Loss/Tool Penalty payroll-deduction agreement, NOT a technician self-
   *  report — see FillDamagePage.tsx) sent to this technician in the
   *  period. */
  damageAssessmentCount: number;
  /** Timecard correction requests filed for work days in the period. */
  timecardIssueCount: number;
  /** No live source at all (see this file's header comment) — purely
   *  whatever's been manually entered via a technician_daily_performance_
   *  overrides correction, 0 otherwise. */
  ncnsCount: number;
  highRedoAlert: boolean;
  routeMileageAlert: boolean;
  lowUtilizationAlert: boolean;
  /** True if at least one day within the current period has a manual correction (technician_daily_performance_overrides) feeding Total Tickets/Miles/Hours Worked/Damage Assessment/Minor Ticket/Major Ticket/Reschedule/NCNS. */
  hasOverride: boolean;
}

/** One day's mileage_entries dedup result behind a technician's Miles
 *  figure — see the Mileage breakdown popup and this file's load()
 *  comment on the branch-scoping/last-entry-wins fixes this backs. */
interface MileageDayDetail {
  techKey: string;
  isProfileId: boolean;
  date: string;
  miles: number;
  branch: string;
  /** Non-deleted entries this day whose branch matched the technician's own and contributed to (or overwrote) `miles`. */
  entryCount: number;
  /** Non-deleted entries this day tagged to a DIFFERENT branch than the technician's own — seen, but excluded from `miles`. */
  excludedEntryCount: number;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

const todayStr = () => new Date().toISOString().slice(0, 10);
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const monthEnd = (d: string) => {
  const [y, m] = d.split("-").map(Number);
  return new Date(y, m, 0).toISOString().slice(0, 10);
};
const daysBetween = (start: string, end: string) => Math.round((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86400000) + 1;

const fmt1 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

/** Count of dates in [start, end] whose weekday (Date.getDay(): 0=Sun..
 *  6=Sat) is in `offDays` — the same weekday-index convention profiles.
 *  off_days is stored/read with everywhere else (AttendanceMonitoringPage,
 *  timecards.ts, attendanceAlerts.ts). */
const countOffDaysInRange = (offDays: number[] | null | undefined, start: string, end: string): number => {
  if (!offDays || offDays.length === 0) return 0;
  const set = new Set(offDays);
  let count = 0;
  for (let d = start; d <= end; d = addDaysISO(d, 1)) {
    if (set.has(new Date(`${d}T00:00:00`).getDay())) count++;
  }
  return count;
};

/** Signed "+12.3% / -4.5%" display for the Variance column — null (no
 *  team average to compare against, i.e. every visible technician has 0
 *  Total Completion) renders as "—". */
const fmtVariance = (v: number | null): string => (v == null ? "—" : `${v > 0 ? "+" : ""}${fmt1(v)}%`);

/** Repair types (techPayroll.ts's REPAIR_TYPES) that count as a MAJOR
 *  ticket for the Minor/Major Ticket columns — an explicit business rule,
 *  not derivable from anything else. Everything else (2 Man Job included,
 *  and no repair_type set at all) is minor. */
const MAJOR_REPAIR_TYPES = new Set([
  "Sealed System", "Sealed System Follow Up", "Sealed System(R600)", "Drum Replacement", "Major Repair",
]);

export function TechnicianPerformanceReport({ mod }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { uid, displayName, role, extraRoles } = useAuth();

  // Opens on the latest pay period.
  const payPeriods = useMemo(() => payPeriodsThrough(todayStr()), []);
  const [periodMode, setPeriodMode] = useState<PeriodMode>("custom");
  const [customStart, setCustomStart] = useState(() => payPeriods[payPeriods.length - 1].start);
  const [customEnd, setCustomEnd] = useState(() => payPeriods[payPeriods.length - 1].end);
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [csrComposition, setCsrComposition] = useState<CsrTeamComposition | null>(null);
  const [rows, setRows] = useState<TechPerfRow[]>([]);
  const [dailyTickets, setDailyTickets] = useState<TechCompletedTicketDaily[]>([]);
  const [mileageDaily, setMileageDaily] = useState<MileageDayDetail[]>([]);
  /** profileId -> workDate -> hours worked that day, for the current period — mirrors mileageDaily/dailyTickets, kept for the import-template export (see handleDownloadImportTemplate). */
  const [hoursDaily, setHoursDaily] = useState<Map<string, Map<string, number>>>(new Map());
  const [techDimensionByName, setTechDimensionByName] = useState<Map<string, { location: string; manager: string; tier: string }>>(new Map());
  /** profileId -> workDate -> correction, for the current period — see technicianPerformanceOverrides.ts. */
  const [dailyOverrides, setDailyOverrides] = useState<Map<string, Map<string, DailyPerformanceOverride>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ticketListFor, setTicketListFor] = useState<{ id: string; name: string } | null>(null);
  const [mileageListFor, setMileageListFor] = useState<{ id: string; name: string } | null>(null);
  const [offDaysListFor, setOffDaysListFor] = useState<{ id: string; name: string } | null>(null);
  const [workDaysListFor, setWorkDaysListFor] = useState<{ id: string; name: string } | null>(null);
  const [hoursListFor, setHoursListFor] = useState<{ id: string; name: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [templateGenerating, setTemplateGenerating] = useState(false);
  const [importResult, setImportResult] = useState<{ rowsApplied: number; skipped: string[] } | null>(null);

  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState<string[]>([]);
  const [managerFilter, setManagerFilter] = useState<string[]>([]);
  const [tierFilter, setTierFilter] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  // One horizontal-scroll ref PER group's table (not a single shared one) —
  // same floating-scrollbar-pinned-to-the-viewport pattern TicketList.tsx
  // uses, needed here too now that this table has 20+ columns. With Group
  // By active there can be several of these tables on screen at once; a
  // single shared ref would only ever track whichever one mounted last,
  // leaving every other group's wide table with no floating scrollbar at
  // all. Lazily creates one stable RefObject per group key (kept in a
  // useRef Map so it survives re-renders) and reused for both that group's
  // scroll container and its own <FloatingHorizontalScrollbar> below —
  // each one hides itself independently when its own table isn't the one
  // currently in view.
  const groupScrollRefs = useRef(new Map<string, React.RefObject<HTMLDivElement | null>>());
  const getGroupScrollRef = (key: string): React.RefObject<HTMLDivElement | null> => {
    let ref = groupScrollRefs.current.get(key);
    if (!ref) {
      ref = { current: null };
      groupScrollRefs.current.set(key, ref);
    }
    return ref;
  };
  // Highest Points first by default.
  const [sortKey, setSortKey] = useState<SortKey>("shortPoints");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedTechId, setSelectedTechId] = useState<string | null>(null);
  // Per the user's call ("for now"), the table defaults to a short set of
  // columns: Name, Minor/Major Completion, Redo, Mileage, Hours Worked,
  // Working Days. "Show all columns" brings back the full layout.
  // CSV export / import template are unaffected.
  const [showAllColumns, setShowAllColumns] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);

  const periodStart = periodMode === "total" ? FIRST_PAY_PERIOD.start : customStart;
  const periodEnd = periodMode === "total" ? todayStr() : customEnd;
  const periodWeeks = daysBetween(periodStart, periodEnd) / 7;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [allUsers, composition, repairCounts, redoMap, mileageEntries, timecardEntries, dailyCompleted, overrides, reschedules, cancelledCounts, damageDocs, timecardCorrections] = await Promise.all([
        getCompanyUsers(),
        getCsrTeamComposition().catch(() => null),
        getTechCompletedRepairCounts(periodStart, periodEnd),
        // Redo tickets carry no date, so the blanked range (BLANK_LIVE_TIME_FROM
        // onward) is cut off at the fetch: only redos completed before it count live.
        periodStart < BLANK_LIVE_TIME_FROM
          ? getTechRedoTickets(periodStart, periodEnd < BLANK_LIVE_TIME_FROM ? periodEnd : addDaysISO(BLANK_LIVE_TIME_FROM, -1))
          : Promise.resolve(new Map()),
        // Only the period's days — the full history took ~13s to load.
        getMileageEntries(undefined, { start: periodStart, end: periodEnd }),
        getCompanyTimecardEntries(periodStart, periodEnd),
        getTechCompletedTicketsDaily(periodStart, periodEnd),
        getTechnicianPerformanceOverrides(periodStart, periodEnd),
        getCompanyTicketReschedules(periodStart, periodEnd),
        getTechCancelledTicketCounts(periodStart, periodEnd),
        getSignableDocuments("damage").catch(() => []),
        getCorrectionsInRange(periodStart, periodEnd).catch(() => []),
      ]);
      const timecardIssuesByProfileId = new Map<string, number>();
      for (const c of timecardCorrections) timecardIssuesByProfileId.set(c.profileId, (timecardIssuesByProfileId.get(c.profileId) ?? 0) + 1);
      setUsers(allUsers);
      setCsrComposition(composition);
      setDailyTickets(dailyCompleted);
      setDailyOverrides(overrides);

      const cancelledByName = new Map<string, number>();
      for (const c of cancelledCounts) cancelledByName.set(c.technician.trim().toLowerCase(), c.count);

      const techs = allUsers.filter((u) => u.is_active && TECHNICIAN_PAY_ROLES.has(normalizeRole(u.role)));
      const dimensionByName = new Map<string, { location: string; manager: string; tier: string }>();
      for (const t of techs) {
        dimensionByName.set((t.display_name || t.email).trim().toLowerCase(), {
          location: t.assigned_branch || "—",
          manager: t.manager_name || "—",
          tier: t.tier_level || "—",
        });
      }
      setTechDimensionByName(dimensionByName);

      // Total completed tickets per technician (every repair-type category
      // summed), plus the Minor/Major split — see this file's header
      // comment for the MAJOR_REPAIR_TYPES rule.
      const ticketsByName = new Map<string, number>();
      const minorByName = new Map<string, number>();
      const majorByName = new Map<string, number>();
      for (const rc of repairCounts) {
        const key = rc.technician.trim().toLowerCase();
        ticketsByName.set(key, (ticketsByName.get(key) ?? 0) + rc.count);
        const bucket = MAJOR_REPAIR_TYPES.has(rc.repairType) ? majorByName : minorByName;
        bucket.set(key, (bucket.get(key) ?? 0) + rc.count);
      }

      // Same total, broken down per day (getTechCompletedTicketsDaily
      // excludes redo/on-hold the same way getTechCompletedRepairCounts
      // does, but additionally requires a schedule date to bucket a ticket
      // into a day) — used so a manual per-day correction
      // (technician_daily_performance_overrides) can replace just ONE
      // day's contribution. Any ticket that DOES have redo/onHold=false
      // but no schedule date (so it can't appear here) still needs to
      // count toward the total; see `unscheduledTicketsByName` below,
      // which is exactly ticketsByName minus what this breakdown can
      // account for, and always gets added back in untouched — so a
      // technician with zero overrides ends up with the EXACT same total
      // as before this feature existed.
      const ticketsByNameByDay = new Map<string, Map<string, number>>();
      for (const d of dailyCompleted) {
        const key = d.technician.trim().toLowerCase();
        if (!ticketsByNameByDay.has(key)) ticketsByNameByDay.set(key, new Map());
        const days = ticketsByNameByDay.get(key)!;
        days.set(d.date, (days.get(d.date) ?? 0) + 1);
      }
      const unscheduledTicketsByName = new Map<string, number>();
      for (const [key, total] of ticketsByName) {
        const dailySum = Array.from(ticketsByNameByDay.get(key)?.values() ?? []).reduce((s, n) => s + n, 0);
        unscheduledTicketsByName.set(key, Math.max(0, total - dailySum));
      }

      // Same per-day breakdown as ticketsByNameByDay above, split into
      // Minor/Major (Damage Assessment/Reschedule further below) — the
      // period-total-only maps minorByName/majorByName above them had no
      // per-day breakdown at all until migration 0326 gave these 4 figures
      // an override column to replace one day of at a time, same as Total
      // Tickets/Miles/Hours Worked already do.
      const bumpDay = (map: Map<string, Map<string, number>>, key: string, day: string) => {
        if (!map.has(key)) map.set(key, new Map());
        const days = map.get(key)!;
        days.set(day, (days.get(day) ?? 0) + 1);
      };
      const minorByNameByDay = new Map<string, Map<string, number>>();
      const majorByNameByDay = new Map<string, Map<string, number>>();
      for (const d of dailyCompleted) {
        const key = d.technician.trim().toLowerCase();
        bumpDay(MAJOR_REPAIR_TYPES.has(d.repairType) ? majorByNameByDay : minorByNameByDay, key, d.date);
      }
      // Same "leftover" reconciliation as unscheduledTicketsByName above —
      // a completed ticket with no schedule date can't appear in the daily
      // breakdown, but still counts toward minorByName/majorByName's
      // period total, so it's added back in untouched.
      const unscheduledMinorByName = new Map<string, number>();
      for (const [key, total] of minorByName) {
        const dailySum = Array.from(minorByNameByDay.get(key)?.values() ?? []).reduce((s, n) => s + n, 0);
        unscheduledMinorByName.set(key, Math.max(0, total - dailySum));
      }
      const unscheduledMajorByName = new Map<string, number>();
      for (const [key, total] of majorByName) {
        const dailySum = Array.from(majorByNameByDay.get(key)?.values() ?? []).reduce((s, n) => s + n, 0);
        unscheduledMajorByName.set(key, Math.max(0, total - dailySum));
      }

      // Reschedule/Damage Assessment: every row already carries a real
      // date (no "unscheduled" concept the way completed tickets have), so
      // no leftover-reconciliation term is needed for either.
      const rescheduleByProfileIdByDay = new Map<string, Map<string, number>>();
      for (const r of reschedules) bumpDay(rescheduleByProfileIdByDay, r.profileId, r.workDate);
      const damageByProfileIdByDay = new Map<string, Map<string, number>>();
      for (const d of damageDocs) {
        if (!d.recipientId) continue;
        const dateKey = d.createdAt.slice(0, 10);
        if (dateKey < periodStart || dateKey > periodEnd) continue;
        bumpDay(damageByProfileIdByDay, d.recipientId, dateKey);
      }

      // Mileage: one effective total per distinct (technician, work_date) —
      // several entries can share one day's total (one row per ticket that
      // day). Matched exactly to AccountingDashboard's real Tech Activity
      // Report modal, which builds a Map<work_date, mileageEffectiveTotal>
      // and calls .set() on every matching entry in query order
      // (work_date desc, id asc) — so for a day with several entries, the
      // LAST one (highest id / most recently created — e.g. a correction
      // row) wins, not the first. This report used to keep the FIRST
      // entry seen per day and skip the rest, which silently picked a
      // stale total whenever a day's entries didn't all agree — caught by
      // comparing Chris Simpson's Miles (1,445.8 here) against Accounting's
      // Mileage (1,683.6) for the identical technician/branch/date range.
      //
      // Also scoped to each technician's OWN assigned branch, matching how
      // the same modal pulls mileage — getMileageEntries(branch) there
      // filters server-side to the branch that payroll run is open for.
      // Without this, a tech with a stray mileage_entries row tagged to a
      // different branch (data entry slip, or a genuine one-off
      // cross-branch job) shows MORE total miles here than what payroll
      // actually counted/paid for them.
      const branchByProfile = new Map<string, string>();
      const branchByName = new Map<string, string>();
      for (const t of techs) {
        if (!t.assigned_branch) continue;
        branchByProfile.set(t.id, t.assigned_branch);
        branchByName.set((t.display_name || t.email).trim().toLowerCase(), t.assigned_branch);
      }

      // Also kept as a flat day-by-day breakdown (mileageDaily state) so a
      // clicked Miles number can show exactly which days/entries it's
      // built from — same transparency purpose as the Total Tickets
      // popup, and how the branch/dedup fixes above were actually caught
      // and verified in the first place.
      const dayTotalsByProfile = new Map<string, Map<string, { miles: number; branch: string; entryCount: number; excludedEntryCount: number }>>();
      const dayTotalsByName = new Map<string, Map<string, { miles: number; branch: string; entryCount: number; excludedEntryCount: number }>>();
      for (const e of mileageEntries) {
        if (e.deletedAt) continue;
        if (e.workDate < periodStart || e.workDate > periodEnd) continue;
        const nameKey = (e.technicianName || "").trim().toLowerCase();
        const techBranch = e.profileId ? branchByProfile.get(e.profileId) : branchByName.get(nameKey);
        const byMap = e.profileId ? dayTotalsByProfile : dayTotalsByName;
        const identity = e.profileId ?? nameKey;
        if (!byMap.has(identity)) byMap.set(identity, new Map());
        const days = byMap.get(identity)!;
        if (techBranch && e.branch !== techBranch) {
          // Doesn't count toward the total, but tracked so the breakdown
          // popup can show it was seen and excluded (which branch it was
          // tagged to), instead of just silently vanishing.
          const prev = days.get(e.workDate);
          days.set(e.workDate, prev ?? { miles: 0, branch: "", entryCount: 0, excludedEntryCount: 0 });
          days.get(e.workDate)!.excludedEntryCount += 1;
          continue;
        }
        const miles = mileageEffectiveTotal(e);
        const prev = days.get(e.workDate);
        days.set(e.workDate, { miles, branch: e.branch, entryCount: (prev?.entryCount ?? 0) + 1, excludedEntryCount: prev?.excludedEntryCount ?? 0 });
      }
      const mileageDailyFlat: MileageDayDetail[] = [];
      for (const [id, days] of dayTotalsByProfile) {
        for (const [date, d] of days) mileageDailyFlat.push({ techKey: id, isProfileId: true, date, miles: d.miles, branch: d.branch, entryCount: d.entryCount, excludedEntryCount: d.excludedEntryCount });
      }
      for (const [name, days] of dayTotalsByName) {
        for (const [date, d] of days) mileageDailyFlat.push({ techKey: name, isProfileId: false, date, miles: d.miles, branch: d.branch, entryCount: d.entryCount, excludedEntryCount: d.excludedEntryCount });
      }
      setMileageDaily(mileageDailyFlat);

      // Hours + distinct days worked per technician, from raw punches —
      // same calcWorkedHours + paid-meal-credit combination used
      // everywhere else pay/hours are computed in this app. Kept per-day
      // (every raw punch already carries its own workDate, so this
      // reconstructs the period sum exactly — no "leftover" term needed
      // the way ticketsByNameByDay above needs one) so a manual per-day
      // correction can replace just one day's hours.
      const hoursByProfileByDay = new Map<string, Map<string, number>>();
      const daysByProfile = new Map<string, Set<string>>();
      const entriesByProfile = new Map<string, typeof timecardEntries>();
      for (const e of timecardEntries) {
        if (!entriesByProfile.has(e.profileId)) entriesByProfile.set(e.profileId, []);
        entriesByProfile.get(e.profileId)!.push(e);
      }
      for (const tech of techs) {
        const entries = entriesByProfile.get(tech.id) ?? [];
        const mealAlwaysPaid = isMealAlwaysPaidRole(tech.role, tech.extra_roles);
        const dayHours = new Map<string, number>();
        const days = new Set<string>();
        for (const e of entries) {
          if (!e.checkIn) continue;
          days.add(e.workDate);
          const uiEntry = { checkIn: e.checkIn, checkOut: e.checkOut, mealStart: e.mealStart, mealEnd: e.mealEnd, notes: "" };
          const hrs = calcWorkedHours(uiEntry) + computeMealTimeCredit(uiEntry, mealAlwaysPaid);
          dayHours.set(e.workDate, (dayHours.get(e.workDate) ?? 0) + hrs);
        }
        hoursByProfileByDay.set(tech.id, dayHours);
        daysByProfile.set(tech.id, days);
      }
      setHoursDaily(hoursByProfileByDay);

      // Merges a technician's live per-day figures with any manual
      // corrections for the same days (technician_daily_performance_
      // overrides) — a corrected day replaces the live value for just
      // that day and that field; every other day keeps computing live.
      // Deliberately per-day (not one override per period) so a
      // correction keeps applying no matter what date range later
      // contains that day — Weekly/Monthly/Custom here are all just a
      // client-side window over the same daily data.
      const sumWithDailyOverride = (
        liveByDay: Map<string, number> | undefined,
        overrideByDay: Map<string, DailyPerformanceOverride> | undefined,
        field: "totalTickets" | "miles" | "hoursWorked" | "damageAssessment" | "minorTicket" | "majorTicket" | "reschedule" | "ncns"
      ): number => {
        const dayKeys = new Set<string>([...(liveByDay?.keys() ?? []), ...(overrideByDay?.keys() ?? [])]);
        let sum = 0;
        for (const day of dayKeys) {
          const overrideVal = overrideByDay?.get(day)?.[field];
          sum += overrideVal != null ? overrideVal : (liveByDay?.get(day) ?? 0);
        }
        return sum;
      };

      // Same as sumWithDailyOverride, but live values dated on/after
      // BLANK_LIVE_TIME_FROM count as 0 (an entered value still counts).
      const blankedDailySum = (
        liveByDay: Map<string, number> | undefined,
        overrideByDay: Map<string, DailyPerformanceOverride> | undefined,
        field: "miles" | "hoursWorked" | "minorTicket" | "majorTicket"
      ): number => {
        const dayKeys = new Set<string>([...(liveByDay?.keys() ?? []), ...(overrideByDay?.keys() ?? [])]);
        let sum = 0;
        for (const day of dayKeys) {
          const overrideVal = overrideByDay?.get(day)?.[field];
          sum += overrideVal != null ? overrideVal : day >= BLANK_LIVE_TIME_FROM ? 0 : (liveByDay?.get(day) ?? 0);
        }
        return sum;
      };

      const computed: TechPerfRow[] = techs.map((t) => {
        const nameKey = (t.display_name || t.email).trim().toLowerCase();
        const techOverrides = overrides.get(t.id);
        const milesByDayForTech = new Map<string, number>();
        for (const [date, d] of dayTotalsByProfile.get(t.id) ?? []) milesByDayForTech.set(date, (milesByDayForTech.get(date) ?? 0) + d.miles);
        for (const [date, d] of dayTotalsByName.get(nameKey) ?? []) milesByDayForTech.set(date, (milesByDayForTech.get(date) ?? 0) + d.miles);

        const totalTickets = sumWithDailyOverride(ticketsByNameByDay.get(nameKey), techOverrides, "totalTickets") + (unscheduledTicketsByName.get(nameKey) ?? 0);
        // Redo has no day-level live breakdown to "replace one day of" the
        // way the 3 figures above do (getTechRedoTickets returns a period
        // total with no date per ticket) — so a correction here isn't a
        // per-day merge, it's a full replacement: if ANY day in the period
        // has a redoCount override set, the whole period's total becomes
        // the SUM of every set override, dropping the live count entirely
        // (a human corrects however many days they can actually attribute
        // redos to, and the total follows from that).
        const redoOverrideEntries = Array.from(techOverrides?.values() ?? []).filter((o) => o.redoCount != null);
        const redoCount = redoOverrideEntries.length > 0
          ? redoOverrideEntries.reduce((s, o) => s + (o.redoCount ?? 0), 0)
          : redoMap.get(nameKey)?.length ?? 0;
        const miles = sumWithDailyOverride(milesByDayForTech, techOverrides, "miles");
        const hoursWorked = sumWithDailyOverride(hoursByProfileByDay.get(t.id), techOverrides, "hoursWorked");
        // Blanked from BLANK_LIVE_TIME_FROM (see blankedDailySum); undated
        // "unscheduled" completions can't be placed before/after it, so they
        // only count when the whole period is before it.
        const periodBeforeBlank = periodEnd < BLANK_LIVE_TIME_FROM;
        const minorTicketCount = blankedDailySum(minorByNameByDay.get(nameKey), techOverrides, "minorTicket") + (periodBeforeBlank ? unscheduledMinorByName.get(nameKey) ?? 0 : 0);
        const majorTicketCount = blankedDailySum(majorByNameByDay.get(nameKey), techOverrides, "majorTicket") + (periodBeforeBlank ? unscheduledMajorByName.get(nameKey) ?? 0 : 0);
        const rescheduleCount = sumWithDailyOverride(rescheduleByProfileIdByDay.get(t.id), techOverrides, "reschedule");
        const damageAssessmentCount = sumWithDailyOverride(damageByProfileIdByDay.get(t.id), techOverrides, "damageAssessment");
        // NCNS has no live source at all (see this file's header comment) —
        // calling sumWithDailyOverride with no live map degrades exactly
        // right on its own: only the days someone actually entered a value
        // for contribute to the sum, everything else contributes 0.
        const ncnsCount = sumWithDailyOverride(undefined, techOverrides, "ncns");
        const hasOverride = Array.from(techOverrides?.values() ?? []).some(
          (o) =>
            o.totalTickets != null || o.redoCount != null || o.miles != null || o.hoursWorked != null ||
            o.damageAssessment != null || o.minorTicket != null || o.majorTicket != null || o.reschedule != null || o.ncns != null
        );
        const overrideWorkedDays = Array.from(techOverrides?.entries() ?? [])
          .filter(([, o]) => o.hoursWorked != null && o.hoursWorked > 0)
          .map(([date]) => date);
        const workedDates = Array.from(new Set([...(daysByProfile.get(t.id) ?? []), ...overrideWorkedDays])).sort();
        const daysWorked = workedDates.length;
        // Mileage / Hours of Work / Working Days / Off Days are blanked from
        // BLANK_LIVE_TIME_FROM onward (per the user's call): live data on
        // those dates counts as 0 unless someone entered a value for the day.
        // Earlier dates keep their live numbers. Ticket counts and the
        // derived metrics above (Mi/Ticket, Tickets/Hr, alerts) still use
        // live data. Nothing is deleted.
        const shownMiles = blankedDailySum(milesByDayForTech, techOverrides, "miles");
        const shownHours = blankedDailySum(hoursByProfileByDay.get(t.id), techOverrides, "hoursWorked");
        const shownWorkedDates = workedDates.filter((d) => d < BLANK_LIVE_TIME_FROM || overrideWorkedDays.includes(d));
        const offDaysUntil = periodEnd < BLANK_LIVE_TIME_FROM ? periodEnd : addDaysISO(BLANK_LIVE_TIME_FROM, -1);
        const shownOffDays = periodStart <= offDaysUntil ? countOffDaysInRange(t.off_days, periodStart, offDaysUntil) : 0;
        const redoRatePct = totalTickets > 0 ? (redoCount / totalTickets) * 100 : null;
        const milesPerTicket = totalTickets > 0 ? miles / totalTickets : null;
        const ticketsPerHour = hoursWorked > 0 ? totalTickets / hoursWorked : null;
        const weeklyEquivalentHours = periodWeeks > 0 ? hoursWorked / periodWeeks : hoursWorked;
        return {
          id: t.id,
          techId: t.technician_id?.trim() || "—",
          name: t.display_name || t.email,
          location: t.assigned_branch || "—",
          manager: t.manager_name || "—",
          tier: t.tier_level || "—",
          isActive: t.is_active,
          daysWorked: shownWorkedDates.length,
          workedDates: shownWorkedDates,
          hoursWorked: shownHours,
          totalTickets,
          minorTicketCount,
          majorTicketCount,
          redoCount,
          redoRatePct,
          miles: shownMiles,
          milesPerTicket,
          ticketsPerHour,
          offDaysCount: shownOffDays,
          offDays: t.off_days ?? [],
          rescheduleCount,
          cancelledCount: cancelledByName.get(nameKey) ?? 0,
          damageAssessmentCount,
          timecardIssueCount: timecardIssuesByProfileId.get(t.id) ?? 0,
          ncnsCount,
          highRedoAlert: redoRatePct != null && redoRatePct > 5,
          routeMileageAlert: milesPerTicket != null && milesPerTicket > 30,
          lowUtilizationAlert: weeklyEquivalentHours < 32,
          hasOverride,
        };
      });
      setRows(computed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load technician performance data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [periodStart, periodEnd]);

  const me = useMemo(() => users.find((u) => u.firebase_uid === uid) || null, [users, uid]);
  const scoped = useMemo(
    () => (me ? visibleAttendanceProfileIds(me, users, csrComposition) : new Set<string>()),
    [me, users, csrComposition],
  );
  const isFullAccess = scoped === null;
  const visibleRows = useMemo(() => (scoped === null ? rows : rows.filter((r) => scoped.has(r.id))), [rows, scoped]);

  const locationOptions = useMemo(() => Array.from(new Set(visibleRows.map((r) => r.location))).sort(), [visibleRows]);
  const managerOptions = useMemo(() => Array.from(new Set(visibleRows.map((r) => r.manager))).sort(), [visibleRows]);
  const tierOptions = useMemo(() => Array.from(new Set(visibleRows.map((r) => r.tier))).sort(), [visibleRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleRows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.id.toLowerCase().includes(q)) return false;
      if (locationFilter.length > 0 && !locationFilter.includes(r.location)) return false;
      if (managerFilter.length > 0 && !managerFilter.includes(r.manager)) return false;
      if (tierFilter.length > 0 && !tierFilter.includes(r.tier)) return false;
      return true;
    });
  }, [visibleRows, search, locationFilter, managerFilter, tierFilter]);

  // "Compare" mode: once 2+ values are picked in one of the Location/
  // Manager/Tier multi-selects, aggregate the (already combined/OR-
  // filtered) rows per selected value so they can be read side by side,
  // instead of only as one merged total. Location takes priority when
  // more than one dimension has 2+ picks, to keep the comparison to a
  // single axis at a time.
  const compareDimension: "location" | "manager" | "tier" | null =
    locationFilter.length >= 2 ? "location" : managerFilter.length >= 2 ? "manager" : tierFilter.length >= 2 ? "tier" : null;

  const compareGroups = useMemo(() => {
    if (!compareDimension) return [];
    const selected = compareDimension === "location" ? locationFilter : compareDimension === "manager" ? managerFilter : tierFilter;
    return selected.map((value) => {
      const groupRows = filteredRows.filter((r) => r[compareDimension] === value);
      const totalTickets = groupRows.reduce((s, r) => s + r.totalTickets, 0);
      const redoCount = groupRows.reduce((s, r) => s + r.redoCount, 0);
      const miles = groupRows.reduce((s, r) => s + r.miles, 0);
      const hoursWorked = groupRows.reduce((s, r) => s + r.hoursWorked, 0);
      return {
        value,
        techCount: groupRows.length,
        totalTickets,
        redoRatePct: totalTickets > 0 ? (redoCount / totalTickets) * 100 : null,
        ticketsPerHour: hoursWorked > 0 ? totalTickets / hoursWorked : null,
        milesPerTicket: totalTickets > 0 ? miles / totalTickets : null,
      };
    });
  }, [compareDimension, locationFilter, managerFilter, tierFilter, filteredRows]);

  // Day-by-day Total Tickets per selected value, for the Compare line
  // chart — same completed-ticket population as the aggregate table
  // above (getTechCompletedTicketsDaily excludes redo/on-hold the same
  // way getTechCompletedRepairCounts does), just bucketed per day instead
  // of summed over the whole period.
  const compareTimeSeries = useMemo(() => {
    if (!compareDimension) return [];
    const selected = compareDimension === "location" ? locationFilter : compareDimension === "manager" ? managerFilter : tierFilter;
    if (selected.length === 0) return [];
    const selectedSet = new Set(selected);

    const dates: string[] = [];
    for (let d = periodStart; d <= periodEnd; d = addDaysISO(d, 1)) dates.push(d);

    const byDate = new Map<string, Map<string, number>>();
    for (const t of dailyTickets) {
      if (t.date < periodStart || t.date > periodEnd) continue;
      const info = techDimensionByName.get(t.technician.trim().toLowerCase());
      const groupValue = info?.[compareDimension];
      if (!groupValue || !selectedSet.has(groupValue)) continue;
      if (!byDate.has(t.date)) byDate.set(t.date, new Map());
      const m = byDate.get(t.date)!;
      m.set(groupValue, (m.get(groupValue) ?? 0) + 1);
    }

    return dates.map((date) => {
      const entry: Record<string, string | number> = { date: `${date.slice(5, 7)}/${date.slice(8, 10)}` };
      const m = byDate.get(date);
      for (const g of selected) entry[g] = m?.get(g) ?? 0;
      return entry;
    });
  }, [compareDimension, locationFilter, managerFilter, tierFilter, dailyTickets, techDimensionByName, periodStart, periodEnd]);

  // The actual tickets behind a clicked Total Tickets count — same
  // name-matched population as ticketsByName in load(), just listed
  // instead of summed, sorted most-recent first.
  const ticketListRows = useMemo(() => {
    if (!ticketListFor) return [];
    const nameKey = ticketListFor.name.trim().toLowerCase();
    return dailyTickets
      .filter((t) => t.technician.trim().toLowerCase() === nameKey)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [ticketListFor, dailyTickets]);

  // The day-by-day breakdown behind a clicked Miles figure — the exact
  // per-day rows load()'s branch-scoped, last-entry-wins dedup produced
  // before they got summed into that technician's `miles` total. A row
  // with excludedEntryCount > 0 had at least one same-day entry tagged to
  // a DIFFERENT branch that was seen but didn't count.
  const mileageListRows = useMemo(() => {
    if (!mileageListFor) return [];
    const nameKey = mileageListFor.name.trim().toLowerCase();
    return mileageDaily
      .filter((d) => (d.isProfileId ? d.techKey === mileageListFor.id : d.techKey === nameKey))
      .filter((d) => d.date < BLANK_LIVE_TIME_FROM) // blanked from this date — see BLANK_LIVE_TIME_FROM
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [mileageListFor, mileageDaily]);

  // The real per-day hours (calcWorkedHours + paid-meal-credit off this
  // technician's own timecard punches, see hoursByProfileByDay in load())
  // behind a clicked Hours Worked total — same "show the days it's built
  // from" transparency the Mileage/Total Tickets breakdowns already give,
  // for whatever Period (Weekly/Monthly/Custom) is currently selected.
  const hoursListRows = useMemo(() => {
    if (!hoursListFor) return [];
    const dayMap = hoursDaily.get(hoursListFor.id);
    if (!dayMap) return [];
    return Array.from(dayMap.entries())
      .filter(([date, hrs]) => hrs > 0 && date < BLANK_LIVE_TIME_FROM)
      .map(([date, hours]) => ({ date, hours }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [hoursListFor, hoursDaily]);

  // The actual dates behind a clicked Off Days count — every date in the
  // period whose weekday falls in this technician's scheduled off_days
  // (Admin User Management's Off Days picker), same rule
  // countOffDaysInRange uses to produce the count itself.
  const offDaysListRows = useMemo(() => {
    if (!offDaysListFor) return [];
    const row = rows.find((r) => r.id === offDaysListFor.id);
    if (!row) return [];
    const offDaySet = new Set(row.offDays);
    const dates: string[] = [];
    for (let d = periodStart; d <= periodEnd && d < BLANK_LIVE_TIME_FROM; d = addDaysISO(d, 1)) {
      if (offDaySet.has(new Date(`${d}T00:00:00`).getDay())) dates.push(d);
    }
    return dates;
  }, [offDaysListFor, rows, periodStart, periodEnd]);

  // The dates behind a clicked Working Days count — exactly the set that
  // produces daysWorked, with that day's hours where there are any.
  const workDaysListRows = useMemo(() => {
    if (!workDaysListFor) return [];
    const row = rows.find((r) => r.id === workDaysListFor.id);
    if (!row) return [];
    const dayHours = hoursDaily.get(workDaysListFor.id);
    return [...row.workedDates]
      .sort((a, b) => b.localeCompare(a))
      .map((date) => ({ date, hours: date < BLANK_LIVE_TIME_FROM ? dayHours?.get(date) ?? null : null }));
  }, [workDaysListFor, rows, hoursDaily]);

  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (r: TechPerfRow): string | number => {
      switch (sortKey) {
        case "techId": return r.techId.toLowerCase();
        case "name": return r.name.toLowerCase();
        case "location": return r.location.toLowerCase();
        case "manager": return r.manager.toLowerCase();
        case "tier": return r.tier.toLowerCase();
        case "daysWorked": return r.daysWorked;
        case "hoursWorked": return r.hoursWorked;
        case "totalTickets": return r.totalTickets;
        case "minorTicketCount": return r.minorTicketCount;
        case "majorTicketCount": return r.majorTicketCount;
        case "rescheduleCount": return r.rescheduleCount;
        case "cancelledCount": return r.cancelledCount;
        case "damageAssessmentCount": return r.damageAssessmentCount;
        case "redoCount": return r.redoCount;
        case "redoRatePct": return r.redoRatePct ?? -1;
        case "miles": return r.miles;
        case "milesPerTicket": return r.milesPerTicket ?? -1;
        case "ticketsPerHour": return r.ticketsPerHour ?? -1;
        case "shortTotalTicket": return shortTotalTicket(r);
        case "shortRedoPct": return shortRedoPct(r) ?? -1;
        case "shortDailyAvg": return shortDailyAvg(r);
        case "shortPoints": return shortPoints(r);
        case "shortAvgHours": return shortAvgHours(r);
        case "shortAvgMiles": return shortAvgMiles(r);
        case "shortErrorCount": return shortErrorCount(r);
      }
    };
    return [...filteredRows].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      const diff = ((av as number) - (bv as number)) * dir;
      // Same Points: the higher Total Ticket ranks first, then by name.
      if (diff === 0 && sortKey === "shortPoints") {
        return (shortTotalTicket(b) - shortTotalTicket(a)) * (dir === -1 ? 1 : -1) || a.name.localeCompare(b.name);
      }
      return diff;
    });
  }, [filteredRows, sortKey, sortDir]);

  const groupedRows = useMemo(() => {
    if (groupBy === "none") return [{ groupName: null as string | null, rows: sortedRows }];
    const key = groupBy === "location" ? "location" : groupBy === "manager" ? "manager" : "tier";
    const groups = new Map<string, TechPerfRow[]>();
    for (const r of sortedRows) {
      const g = r[key];
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(r);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([groupName, rows]) => ({ groupName, rows }));
  }, [sortedRows, groupBy]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const top10Chart = useMemo(
    () => [...filteredRows]
      // Ranked by Points; ties go to the higher Total Ticket.
      .sort((a, b) => shortPoints(b) - shortPoints(a) || shortTotalTicket(b) - shortTotalTicket(a))
      .slice(0, 10)
      .map((r) => ({ name: r.name.split(" ")[0] || r.name, fullName: r.name, value: shortPoints(r) })),
    [filteredRows],
  );

  // Same stat-tile treatment as the Technician Details modal's Daily
  // Activity Log row — a page-level rollup of whatever's currently
  // filtered, so it moves with Location/Manager/Tier/Search like the table
  // below it does.
  const pageKpis = useMemo(() => {
    // Short view: built from the same figures as its columns — Total
    // Ticket (Minor + Major − Redo), Redo % over Minor + Major, the shown
    // Hours of Work, and Flagged = any red (Alert) main factor.
    if (!showAllColumns) {
      const totalTickets = filteredRows.reduce((s, r) => s + shortTotalTicket(r), 0);
      const completed = filteredRows.reduce((s, r) => s + r.minorTicketCount + r.majorTicketCount, 0);
      const totalRedo = filteredRows.reduce((s, r) => s + r.redoCount, 0);
      const totalHours = filteredRows.reduce((s, r) => s + r.hoursWorked, 0);
      const flagged = filteredRows.filter((r) =>
        [
          GRADERS.dailyAvg(shortDailyAvg(r)),
          GRADERS.totalTicket(shortTotalTicket(r)),
          GRADERS.redoPct(shortRedoPct(r)),
          GRADERS.workingDays(r.daysWorked),
        ].includes("alert"),
      ).length;
      return {
        techCount: filteredRows.length,
        totalTickets,
        avgRedoPct: completed > 0 ? (totalRedo / completed) * 100 : null,
        avgTicketsPerHour: totalHours > 0 ? totalTickets / totalHours : null,
        flagged,
      };
    }
    const totalTickets = filteredRows.reduce((s, r) => s + r.totalTickets, 0);
    const totalRedo = filteredRows.reduce((s, r) => s + r.redoCount, 0);
    const totalHours = filteredRows.reduce((s, r) => s + r.hoursWorked, 0);
    const flagged = filteredRows.filter((r) => r.highRedoAlert || r.routeMileageAlert || r.lowUtilizationAlert).length;
    return {
      techCount: filteredRows.length,
      totalTickets,
      avgRedoPct: totalTickets > 0 ? (totalRedo / totalTickets) * 100 : null,
      avgTicketsPerHour: totalHours > 0 ? totalTickets / totalHours : null,
      flagged,
    };
  }, [filteredRows, showAllColumns]);

  // Variance = each technician's Total Completion vs. the average of
  // every technician CURRENTLY in view (Location/Manager/Tier/Search-
  // filtered, same population pageKpis rolls up), as a signed %. Keyed
  // off filteredRows rather than sortedRows since the average itself
  // must not depend on sort order.
  const varianceByRowId = useMemo(() => {
    const map = new Map<string, number | null>();
    const avg = filteredRows.length > 0 ? filteredRows.reduce((s, r) => s + r.totalTickets, 0) / filteredRows.length : 0;
    for (const r of filteredRows) {
      map.set(r.id, avg > 0 ? ((r.totalTickets - avg) / avg) * 100 : null);
    }
    return map;
  }, [filteredRows]);

  const handleExportCsv = () => {
    // Follows the columns on screen, same as the import template.
    if (!showAllColumns) {
      exportToCSV(
        "technician_performance",
        ["Name", "Grade", "Points", "Average Tickets", "Total Ticket", "Redo %", "Working Days", "Average Hours", "Average Mileage", "Error Count", "Minor Comp", "Major Comp", "Redo Count", "Mileage", "Hours of Work"],
        sortedRows.map((r) => {
          const p = shortRedoPct(r);
          const a = shortDailyAvg(r);
          const pts = shortPoints(r);
          return [
            r.name, letterGrade(pts), pts, fmt1(a), shortTotalTicket(r), fmtRedoPct(p), r.daysWorked,
            fmt1(shortAvgHours(r)), fmt1(shortAvgMiles(r)), shortErrorCount(r),
            r.minorTicketCount, r.majorTicketCount, r.redoCount, fmt1(r.miles), fmt1(r.hoursWorked),
          ];
        }),
      );
      return;
    }
    exportToCSV(
      "technician_performance",
      [
        "Name", "Variance", "Damage Assessment", "Minor Ticket", "Major Ticket", "Redo", "Total Completion", "Average Completion",
        "Reschedule", "NCNS", "Cancelled", "Mileage", "Working Days", "Off Days", "Unexcused Off Days Total 2026",
        "Hours Worked", "Location", "Manager", "Tier",
        "Redo Rate %", "Miles/Ticket", "Tickets/Hour", "High Redo", "Route Mileage Audit", "Low Utilization",
      ],
      sortedRows.map((r) => [
        r.name, fmtVariance(varianceByRowId.get(r.id) ?? null), r.damageAssessmentCount, r.minorTicketCount, r.majorTicketCount, r.redoCount, r.totalTickets,
        r.daysWorked > 0 ? fmt1(r.totalTickets / r.daysWorked) : "—", r.rescheduleCount, r.ncnsCount, r.cancelledCount, fmt1(r.miles), r.daysWorked, r.offDaysCount,
        "", fmt1(r.hoursWorked), r.location, r.manager, r.tier,
        r.redoRatePct != null ? fmt1(r.redoRatePct) : "—", r.milesPerTicket != null ? fmt1(r.milesPerTicket) : "—",
        r.ticketsPerHour != null ? fmt1(r.ticketsPerHour) : "—", r.highRedoAlert ? "Yes" : "", r.routeMileageAlert ? "Yes" : "", r.lowUtilizationAlert ? "Yes" : "",
      ]),
    );
  };

  // Import-template export: one row per (technician, day-with-activity-
  // or-existing-correction) within the current period, pre-filled with
  // today's EFFECTIVE (override-applied) Total Tickets — so whoever fills
  // this in only has to change what's actually wrong. A real .xlsx, not
  // CSV — CSV has no concept of cell color (can't satisfy "the header is
  // too plain"), and a raw CSV's non-ASCII characters (an em dash, say)
  // get mangled by Excel's default ANSI import unless a BOM is added,
  // which a real workbook sidesteps entirely. No Profile ID/Technician ID
  // columns — nothing here needs to expose an internal id to a human
  // filling this in; matching on import is by Name (+ Location to break
  // a tie — see handleImportFile) instead.
  const handleDownloadImportTemplate = async () => {
    // Every day in the period gets a row for every technician now (not
    // just days with activity — see the loop below), so an unbounded
    // Custom range could otherwise try to generate an enormous sheet and
    // hang the browser doing it.
    const dayCount = daysBetween(periodStart, periodEnd);
    if (dayCount * sortedRows.length > 20000) {
      setError(`That's ${dayCount} days × ${sortedRows.length} technicians — too many rows for one template. Pick a narrower period.`);
      return;
    }
    setTemplateGenerating(true);
    try {
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      // Recalculate the formula columns as soon as Excel opens the file.
      workbook.calcProperties = { fullCalcOnLoad: true };
      const sheet = workbook.addWorksheet("Import Template");

      // The template follows the columns on screen: the short view gets the
      // same short set (plus Date, which every day row needs), "Show all
      // columns" gets the full layout. handleImportFile reads both sets of
      // header names.
      sheet.columns = !showAllColumns ? [
        { header: "Name", key: "name", width: 26 },
        // Grade/Points: reference block only, never read back.
        { header: "Grade", key: "shortGrade", width: 8 },
        { header: "Points", key: "shortPoints", width: 9 },
        { header: "Date", key: "date", width: 12 },
        // Same order as the table: the main factors, then the
        // breakdown. Average Tickets/Total Ticket/Redo % are formulas and
        // Working Days is a period figure — handleImportFile never reads
        // those four back. Average Tickets is reference-block only (a day
        // row has no working-days figure to divide by).
        { header: "Average Tickets", key: "shortDailyAvg", width: 14, style: { numFmt: "0.0" } },
        { header: "Total Ticket", key: "shortTotalTicket", width: 13 },
        { header: "Redo %", key: "shortRedoPct", width: 10, style: { numFmt: "0.0%" } },
        { header: "Working Days", key: "daysWorked", width: 14 },
        // Reference block only (formulas over Hours/Mileage ÷ Working Days).
        { header: "Average Hours", key: "shortAvgHours", width: 15, style: { numFmt: "0.0" } },
        { header: "Average Mileage", key: "shortAvgMiles", width: 16, style: { numFmt: "#,##0.0" } },
        // Reference block only: timecard issues + damages; never read back.
        { header: "Error Count", key: "shortErrorCount", width: 12 },
        { header: "Minor Comp", key: "minorTicket", width: 13 },
        { header: "Major Comp", key: "majorTicket", width: 13 },
        { header: "Redo Count", key: "redoCount", width: 12 },
        { header: "Mileage", key: "miles", width: 12 },
        { header: "Hours of Work", key: "hoursWorked", width: 15 },
      ] : [
        { header: "Name", key: "name", width: 26 },
        { header: "Variance", key: "variance", width: 12 },
        { header: "Damage Assessment", key: "damageAssessment", width: 18 },
        { header: "Date", key: "date", width: 12 },
        { header: "Minor Ticket", key: "minorTicket", width: 14 },
        { header: "Major Ticket", key: "majorTicket", width: 14 },
        { header: "Redo", key: "redoCount", width: 10 },
        { header: "Total Completion", key: "totalTickets", width: 16 },
        { header: "Average Completion", key: "avgCompletion", width: 18 },
        { header: "Reschedule", key: "reschedule", width: 12 },
        { header: "NCNS", key: "ncns", width: 12 },
        { header: "Cancelled", key: "cancelled", width: 12 },
        { header: "Mileage", key: "miles", width: 12 },
        { header: "Working Days", key: "daysWorked", width: 14 },
        { header: "Off Days", key: "offDays", width: 12 },
        { header: "Unexcused Off Days Total 2026", key: "unexcusedOffDays", width: 26 },
        { header: "Hours Worked", key: "hoursWorked", width: 14 },
        { header: "Location", key: "location", width: 16 },
        { header: "Manager", key: "manager", width: 20 },
        { header: "Tier", key: "tier", width: 12 },
      ];
      // Kept as plain text, never a real Excel date — so it round-trips
      // exactly on re-import (no serial-number/timezone conversion to
      // undo) and so Excel doesn't reformat a typed "2026-09-21" into
      // something else on its own.
      sheet.getColumn("date").numFmt = "@";

      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
        cell.alignment = { vertical: "middle" };
      });
      sheet.views = [{ state: "frozen", ySplit: 1 }];

      // Short view: Total Ticket = Minor + Major − Redo, Redo % = Redo ÷
      // (Minor + Major), Average Tickets = Total Ticket ÷ Working Total Days
      // (reference rows only — a day row has no working-days figure). Real
      // Excel formulas so they update as numbers are typed, each with its
      // current result cached so it shows even before Excel recalculates
      // (e.g. in Protected View).
      const setShortFormulas = (row: import("exceljs").Row, withDailyAvg: boolean) => {
        const n = row.number;
        const col = (key: string) => `${sheet.getColumn(key).letter}${n}`;
        const num = (key: string) => { const v = Number(row.getCell(key).value); return Number.isFinite(v) ? v : 0; };
        const minor = `N(${col("minorTicket")})`, major = `N(${col("majorTicket")})`, redo = `N(${col("redoCount")})`;
        const hasAny = ["minorTicket", "majorTicket", "redoCount"].some((k) => { const v = row.getCell(k).value; return v !== "" && v != null; });
        const total = num("minorTicket") + num("majorTicket") - num("redoCount");
        const completed = num("minorTicket") + num("majorTicket");
        row.getCell("shortTotalTicket").value = {
          formula: `IF(COUNT(${col("minorTicket")}:${col("redoCount")})=0,"",${minor}+${major}-${redo})`,
          result: hasAny ? total : "",
        } as import("exceljs").CellFormulaValue;
        // Blank only while the row is untouched; otherwise 0 rather than a
        // blank when there's nothing to divide by (same as on screen).
        row.getCell("shortRedoPct").value = {
          formula: `IF(COUNT(${col("minorTicket")}:${col("redoCount")})=0,"",IF(${minor}+${major}=0,0,${redo}/(${minor}+${major})))`,
          result: !hasAny ? "" : completed > 0 ? num("redoCount") / completed : 0,
        } as import("exceljs").CellFormulaValue;
        if (withDailyAvg) {
          const days = num("daysWorked");
          row.getCell("shortDailyAvg").value = {
            formula: `IF(N(${col("daysWorked")})=0,0,N(${col("shortTotalTicket")})/N(${col("daysWorked")}))`,
            result: days > 0 ? total / days : 0,
          } as import("exceljs").CellFormulaValue;
          const perDay = (key: string) => ({
            formula: `IF(N(${col("daysWorked")})=0,0,N(${col(key)})/N(${col("daysWorked")}))`,
            result: days > 0 ? num(key) / days : 0,
          }) as import("exceljs").CellFormulaValue;
          row.getCell("shortAvgHours").value = perDay("hoursWorked");
          row.getCell("shortAvgMiles").value = perDay("miles");
        }
      };

      // Green when a technician is above the team average Total
      // Completion, red when below, left unstyled at "—" (no team
      // average to compare against).
      const styleVarianceCell = (cell: import("exceljs").Cell, v: number | null) => {
        if (v == null) return;
        if (v > 0) {
          cell.font = { bold: true, color: { argb: "FF166534" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
        } else if (v < 0) {
          cell.font = { bold: true, color: { argb: "FFB91C1C" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
        } else {
          cell.font = { color: { argb: "FF64748B" } };
        }
      };

      for (const r of sortedRows) {
        // EVERY day in the period gets a row here, not just days that
        // already have some activity — a gap used to read as "there's
        // nothing to correct here," when it actually meant "there's
        // nothing missing a row to correct it with," which is a very
        // different (and much more confusing) thing to a technician who
        // really did work that day but has zero logged for it.
        //
        // Every value column is left BLANK on every day row: for the 9
        // fields that actually support a per-day override (Total
        // Completion/Redo/Mileage/Hours Worked/Damage Assessment/Minor
        // Ticket/Major Ticket/Reschedule/NCNS — migration 0326 added the
        // last 5), blank means "no change" on import, so leaving them
        // blank is what makes re-importing an untouched row a true no-op
        // instead of silently re-asserting a number as a permanent
        // override. The rest (Variance, Average Completion, Cancelled,
        // Working Days, Off Days) are period-level, not per-day, figures
        // that aren't read back on import at all — repeating them on every
        // one of a technician's day rows read as if they were themselves
        // per-day data, so they're blank here too and shown once instead,
        // in the reference block below. Unexcused Off Days Total 2026 is
        // always blank (no live source, no override column either) — a
        // place for HR to type a number by hand, not something this export
        // or the importer reads back.
        for (let date = periodStart; date <= periodEnd; date = addDaysISO(date, 1)) {
          const dayRow = sheet.addRow({
            name: r.name,
            variance: "",
            damageAssessment: "",
            date,
            minorTicket: "",
            majorTicket: "",
            redoCount: "",
            totalTickets: "",
            avgCompletion: "",
            reschedule: "",
            ncns: "",
            cancelled: "",
            miles: "",
            daysWorked: "",
            offDays: "",
            unexcusedOffDays: "",
            hoursWorked: "",
            location: r.location,
            manager: r.manager,
            tier: r.tier,
          });
          if (!showAllColumns) setShortFormulas(dayRow, false);
        }
      }

      // Reference block — every technician currently in view, even ones
      // with no activity/correction this period (so they'd have no
      // day-row above at all). Location/Manager/Tier/Variance/Average
      // Completion/Working Days/Off Days are here purely so a human can
      // tell two same-named technicians apart, or see current totals,
      // before typing a new row; Redo/Total Completion/Mileage/Hours
      // Worked here are the CURRENT totals (reference only — a blank
      // Date keeps this whole block from being read as real data on
      // re-import, see handleImportFile).
      sheet.addRow({});
      const noteRow = sheet.addRow({
        name: showAllColumns
          ? "All technicians — add a row below (Name + Date + at least one value) to correct a day with no activity yet. Damage Assessment/Minor Ticket/Major Ticket/Redo/Total Completion/Reschedule/NCNS/Mileage/Hours Worked below are the CURRENT totals, for reference."
          : "All technicians — add a row below (Name + Date + at least one value) to correct a day with no activity yet. The numbers below are the CURRENT totals, for reference. Grade, Points, Average Tickets, Total Ticket, Redo %, Working Days, Average Hours, Average Mileage and Error Count are calculated, not read back on import. Grade: SSS 11, SS 10, S 9, A 8, B 7, C 5–6, D 4 or less. Points: Maximum 3, Great 2, Median 1, Effort 0, Alert −1 over Average Tickets/Total Ticket/Redo %/Working Days (Redo % and Working Days top out at 2); Average Hours over 12 a day is −1; Average Mileage 250+ a day is +1. Colors: blue Maximum, green Great, yellow Median, orange Effort, red Alert.",
      });
      noteRow.font = { italic: true, color: { argb: "FF64748B" } };
      for (const r of sortedRows) {
        const variance = varianceByRowId.get(r.id) ?? null;
        const row = sheet.addRow({
          name: r.name,
          variance: fmtVariance(variance),
          damageAssessment: r.damageAssessmentCount,
          minorTicket: r.minorTicketCount,
          majorTicket: r.majorTicketCount,
          redoCount: r.redoCount,
          totalTickets: r.totalTickets,
          avgCompletion: r.daysWorked > 0 ? fmt1(r.totalTickets / r.daysWorked) : "—",
          reschedule: r.rescheduleCount,
          ncns: r.ncnsCount,
          cancelled: r.cancelledCount,
          // Real numbers (not fmt1's "3,011" text) so Excel doesn't flag
          // them as numbers-stored-as-text.
          miles: Math.round(r.miles * 10) / 10,
          daysWorked: r.daysWorked,
          offDays: r.offDaysCount,
          hoursWorked: Math.round(r.hoursWorked * 10) / 10,
          location: r.location,
          manager: r.manager,
          tier: r.tier,
        });
        if (showAllColumns) styleVarianceCell(row.getCell("variance"), variance);
        else {
          setShortFormulas(row, true);
          // Same grade colors as the on-screen pills.
          const paint = (key: string, grade: Grade | null) => {
            if (!grade) return;
            const cell = row.getCell(key);
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRADE_META[grade].xlsxFill } };
            cell.font = { bold: true, color: { argb: GRADE_META[grade].xlsxFont } };
          };
          paint("shortDailyAvg", GRADERS.dailyAvg(shortDailyAvg(r)));
          paint("shortTotalTicket", GRADERS.totalTicket(shortTotalTicket(r)));
          paint("shortRedoPct", GRADERS.redoPct(shortRedoPct(r)));
          paint("daysWorked", GRADERS.workingDays(r.daysWorked));
          paint("shortAvgHours", GRADERS.avgHours(shortAvgHours(r)));
          paint("shortAvgMiles", GRADERS.avgMiles(shortAvgMiles(r)));
          row.getCell("shortErrorCount").value = shortErrorCount(r);
          if (shortErrorCount(r) > 0) row.getCell("shortErrorCount").font = { bold: true, color: { argb: "FFB91C1C" } };
          const pts = shortPoints(r);
          const letter = letterGrade(pts);
          row.getCell("shortPoints").value = pts;
          row.getCell("shortPoints").font = { bold: true };
          const gradeCell = row.getCell("shortGrade");
          gradeCell.value = letter;
          gradeCell.alignment = { horizontal: "center" };
          gradeCell.font = { bold: true, color: { argb: LETTER_META[letter].xlsxFont } };
          gradeCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LETTER_META[letter].xlsxFill } };
        }
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Named after the selected period, not today's date — the day-rows
      // themselves are already scoped to periodStart/periodEnd (both feed
      // load(), which everything above is read from), but the filename
      // used to be stamped with today's date regardless, which read as
      // "today's data" even when Weekly/Monthly/Custom was pointed at a
      // past range.
      const periodLabel =
        periodMode === "total" ? `total_${periodStart}_to_${periodEnd}` : `${periodStart}_to_${periodEnd}`;
      a.download = `technician_performance_import_template_${periodLabel}.xlsx`;
      // Attached + revoked a moment later: some browsers ignore a click on a
      // detached link, and revoking in the same tick can cancel the download.
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate the import template.");
    } finally {
      setTemplateGenerating(false);
    }
  };

  const handleImportFile = (file: File) => {
    setImporting(true);
    setImportResult(null);
    setError(null);
    void (async () => {
      try {
        const XLSX = await import("xlsx");
        const buffer = await file.arrayBuffer();
        // CSV cells are kept as plain text: SheetJS otherwise turns
        // "2026-08-27" into UTC midnight, which reads back as 08-26 in US
        // time zones and shifts every row a day early.
        // Real Excel dates (someone retyped the Date cell) come through as
        // serial numbers and are converted below without any time zone.
        const isCsv = /\.csv$/i.test(file.name);
        const workbook = XLSX.read(buffer, { type: "array", raw: isCsv });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[][];
        if (aoa.length < 2) throw new Error("The file has no data rows.");
        const header = aoa[0].map((h) => String(h ?? "").trim().toLowerCase());
        const idx = (label: string) => header.indexOf(label);
        // Accepts both the current header names and the pre-rename ones,
        // so a template downloaded before this column rework (or an old
        // saved copy of one) still imports correctly.
        const idxAny = (...labels: string[]) => {
          for (const label of labels) {
            const i = idx(label);
            if (i !== -1) return i;
          }
          return -1;
        };
        // Also accepts the ER tracking sheet's own headers ("Technician",
        // "Minor CompletedTicket", "Hours Worked with OT", ...). That sheet
        // has both assigned ("Minor Ticket") and completed columns — the
        // completed ones are preferred since that's what Minor/Major Comp
        // mean on this report.
        const nameIdx = idxAny("name", "technician");
        const dateIdx = idx("date");
        // The short view only imports the columns it shows, so a sheet's
        // extra columns (Damage Assessment, Reschedule, NCNS, ...) don't
        // silently write hidden corrections.
        const fullOnly = (i: number) => (showAllColumns ? i : -1);
        const ticketsIdx = fullOnly(idxAny("total completion", "total tickets", "total completion/ claimed"));
        const redoIdx = idxAny("redo", "redo count");
        const milesIdx = idxAny("mileage", "miles");
        // Short-view template headers (Minor Comp/Major Comp/Hours of Work)
        // are accepted alongside the full template's.
        const hoursIdx = idxAny("hours worked", "hours of work", "hours worked with ot");
        const damageAssessmentIdx = fullOnly(idx("damage assessment"));
        const minorTicketIdx = idxAny("minor completedticket", "minor completed ticket", "minor comp", "minor ticket");
        const majorTicketIdx = idxAny("major completedticket", "major completed ticket", "major ompletedticket", "major comp", "major ticket");
        const rescheduleIdx = fullOnly(idx("reschedule"));
        const ncnsIdx = fullOnly(idx("ncns"));
        const locationIdx = idx("location");
        if (nameIdx !== -1 && dateIdx === -1 && idxAny("points", "average tickets", "daily average", "variance") !== -1) {
          throw new Error('This looks like an Export CSV file, which has one total per technician and no "Date" column. Use "Download Import Template" to get a per-day file to fill in and import.');
        }
        if (nameIdx === -1 || dateIdx === -1) {
          throw new Error('This doesn\'t look like a Technician Performance import file — missing "Name"/"Date" columns.');
        }

        // Name -> matching technician(s) currently on the report; Location
        // disambiguates when a name alone isn't unique.
        const byName = new Map<string, TechPerfRow[]>();
        for (const r of rows) {
          const key = r.name.trim().toLowerCase();
          if (!byName.has(key)) byName.set(key, []);
          byName.get(key)!.push(r);
        }

        const cellToStr = (v: unknown): string => {
          if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
          return String(v ?? "").trim();
        };
        const parseNum = (v: unknown): number | undefined => {
          const s = cellToStr(v);
          if (s === "") return undefined;
          const n = Number(s.replace(/,/g, ""));
          return Number.isFinite(n) ? n : undefined;
        };

        const skipped: string[] = [];
        const toWrite: {
          profileId: string;
          workDate: string;
          totalTickets?: number | null;
          redoCount?: number | null;
          miles?: number | null;
          hoursWorked?: number | null;
          damageAssessment?: number | null;
          minorTicket?: number | null;
          majorTicket?: number | null;
          reschedule?: number | null;
          ncns?: number | null;
        }[] = [];
        for (let i = 1; i < aoa.length; i++) {
          const cells = aoa[i];
          const name = cellToStr(cells[nameIdx]);
          const rawDate = cells[dateIdx];
          let date = cellToStr(rawDate);
          if (typeof rawDate === "number" && rawDate > 20000 && rawDate < 80000) {
            const d = XLSX.SSF.parse_date_code(rawDate);
            if (d) date = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
          }
          // Spreadsheet apps often re-save dates as M/D/YYYY.
          const mdy = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (mdy) date = `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
          if (!name || !date) continue;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped.push(`${name} (bad date "${date}")`); continue; }
          const nameKey = name.trim().toLowerCase();
          let candidates = byName.get(nameKey) ?? byName.get(nameKey.replace(/\s*\(trainee\)\s*$/, "")) ?? [];
          if (candidates.length > 1 && locationIdx !== -1) {
            const loc = cellToStr(cells[locationIdx]).toLowerCase();
            const narrowed = candidates.filter((c) => c.location.trim().toLowerCase() === loc);
            if (narrowed.length > 0) candidates = narrowed;
          }
          if (candidates.length === 0) { skipped.push(`${name} (not a technician on this report)`); continue; }
          if (candidates.length > 1) { skipped.push(`${name} (matches ${candidates.length} technicians — add a Location to disambiguate)`); continue; }
          const profileId = candidates[0].id;

          const entry: (typeof toWrite)[number] = { profileId, workDate: date };
          if (ticketsIdx !== -1) { const n = parseNum(cells[ticketsIdx]); if (n !== undefined) entry.totalTickets = n; }
          if (redoIdx !== -1) { const n = parseNum(cells[redoIdx]); if (n !== undefined) entry.redoCount = n; }
          if (milesIdx !== -1) { const n = parseNum(cells[milesIdx]); if (n !== undefined) entry.miles = n; }
          if (hoursIdx !== -1) { const n = parseNum(cells[hoursIdx]); if (n !== undefined) entry.hoursWorked = n; }
          if (damageAssessmentIdx !== -1) { const n = parseNum(cells[damageAssessmentIdx]); if (n !== undefined) entry.damageAssessment = n; }
          if (minorTicketIdx !== -1) { const n = parseNum(cells[minorTicketIdx]); if (n !== undefined) entry.minorTicket = n; }
          if (majorTicketIdx !== -1) { const n = parseNum(cells[majorTicketIdx]); if (n !== undefined) entry.majorTicket = n; }
          if (rescheduleIdx !== -1) { const n = parseNum(cells[rescheduleIdx]); if (n !== undefined) entry.reschedule = n; }
          if (ncnsIdx !== -1) { const n = parseNum(cells[ncnsIdx]); if (n !== undefined) entry.ncns = n; }
          if (
            entry.totalTickets === undefined && entry.redoCount === undefined && entry.miles === undefined && entry.hoursWorked === undefined &&
            entry.damageAssessment === undefined && entry.minorTicket === undefined && entry.majorTicket === undefined &&
            entry.reschedule === undefined && entry.ncns === undefined
          ) continue;
          toWrite.push(entry);
        }
        if (toWrite.length === 0) {
          const why = skipped.length > 0
            ? ` Skipped: ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? `, +${skipped.length - 5} more` : ""}.`
            : rows.length === 0 ? " The report has no technicians loaded yet — wait for it to finish loading and try again." : "";
          throw new Error(`No usable rows found — every row was either unmatched or had no values to import.${why}`);
        }
        await bulkUpsertTechnicianPerformanceOverrides(toWrite, displayName || "HR");
        setImportResult({ rowsApplied: toWrite.length, skipped });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to import the file.");
      } finally {
        setImporting(false);
      }
    })();
  };

  const canImport = role === "ADMIN" || role === "SUPERADMIN" || isFinanceRole(role, extraRoles) || isCompanySuperAdminRole(role, extraRoles);


  const thClass = "px-3 py-2 text-left text-xs text-muted-foreground uppercase cursor-pointer select-none hover:text-foreground";
  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  const selectedTech = useMemo(() => (selectedTechId ? visibleRows.find((r) => r.id === selectedTechId) ?? null : null), [selectedTechId, visibleRows]);

  // Same dailyTickets population the Compare line chart already draws
  // from (getTechCompletedTicketsDaily) — filtered to just this one
  // technician's name for the "View Activity Log" breakdown, so no new
  // fetch is needed to back it.
  const selectedTechDailyLog = useMemo(() => {
    if (!selectedTech) return [];
    const nameKey = selectedTech.name.trim().toLowerCase();
    const counts = new Map<string, number>();
    for (const t of dailyTickets) {
      if (t.date < periodStart || t.date > periodEnd) continue;
      if (t.technician.trim().toLowerCase() !== nameKey) continue;
      counts.set(t.date, (counts.get(t.date) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [selectedTech, dailyTickets, periodStart, periodEnd]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* max-w-[1900px] (not unbounded) — same convention TicketList.tsx's
          own very-wide table uses: wide enough that a big/ultrawide monitor
          actually gets to use the extra room (more of this table's 20+
          columns fit without scrolling), while `w-full` + the responsive
          px-4/sm:px-6 padding still let it shrink correctly on a smaller
          screen — the floating horizontal scrollbar picks up the rest. */}
      <main className="flex-1 max-w-[1900px] mx-auto w-full px-4 sm:px-6 py-8">
        <div className="relative rounded-2xl border border-white/10 bg-gradient-to-br from-blue-600/20 via-indigo-600/10 to-transparent px-6 py-6 mb-5">
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={goBack} className="btn hover:bg-white/15 shrink-0"><ChevronLeft className="h-4 w-4" /></button>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-300/80 mb-0.5">Reports</p>
              <h1 className="text-2xl font-bold">Technician Performance Report</h1>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAllColumns((v) => !v)}
                className="btn text-xs px-2.5 py-1.5"
                title="The table shows a short set of columns by default"
              >
                {showAllColumns ? "Show fewer columns" : "Show all columns"}
              </button>
              {isFullAccess && (
                <button onClick={handleExportCsv} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1.5">
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </button>
              )}
              {canImport && (
                <>
                  <button
                    onClick={() => void handleDownloadImportTemplate()}
                    className="btn text-xs px-2.5 py-1.5 flex items-center gap-1.5"
                    disabled={templateGenerating}
                    title="A per-day Excel file for the current period, pre-filled with today's numbers — hand it to someone to correct, then Import Excel it back."
                  >
                    {templateGenerating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    {templateGenerating ? "Generating…" : "Download Import Template"}
                  </button>
                  <label className="btn text-xs px-2.5 py-1.5 flex items-center gap-1.5 cursor-pointer">
                    {importing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {importing ? "Importing…" : "Import Excel"}
                    <input
                      type="file"
                      accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      className="hidden"
                      disabled={importing}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) handleImportFile(file);
                      }}
                    />
                  </label>
                </>
              )}
              <button onClick={() => void load()} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1.5" disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3 max-w-3xl">
            Total Tickets, Redo Rate %, Tickets/Hour, and Miles/Ticket per technician — computed live from tickets/mileage/timecards, with day-level manual corrections where needed (rows marked <PencilLine className="h-3 w-3 inline -mt-0.5" />). High Redo (&gt;5%), Route Mileage Audit (&gt;30 mi/ticket), and Low Utilization (&lt;32 hrs/week) are flagged automatically.
          </p>
          {importResult && (
            <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              Imported {importResult.rowsApplied} day{importResult.rowsApplied === 1 ? "" : "s"} of corrections.
              {importResult.skipped.length > 0 && (
                <> {importResult.skipped.length} row{importResult.skipped.length === 1 ? "" : "s"} skipped: {importResult.skipped.slice(0, 5).join(", ")}{importResult.skipped.length > 5 ? `, +${importResult.skipped.length - 5} more` : ""}.</>
              )}
            </div>
          )}
        </div>

        {!loading && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
            {[
              { label: "Technicians", icon: UserSquare2, accent: "blue", value: pageKpis.techCount },
              { label: "Total Tickets", icon: Star, accent: "emerald", value: pageKpis.totalTickets },
              { label: "Avg Redo %", icon: MapPin, accent: "amber", value: fmtRedoPct(pageKpis.avgRedoPct) },
              { label: "Avg Tickets/Hr", icon: CalendarClock, accent: "violet", value: pageKpis.avgTicketsPerHour != null ? pageKpis.avgTicketsPerHour.toFixed(2) : "—" },
              { label: "Flagged", icon: UserSquare2, accent: "cyan", value: pageKpis.flagged },
            ].map(({ label, icon: Icon, accent, value }) => (
              <div
                key={label}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                title={showAllColumns ? undefined : KPI_HINTS[label]}
              >
                <div className={`inline-flex p-1.5 rounded-lg mb-2 ${ACCENT_CLASSES[accent].chip}`}>
                  <Icon className={`h-3.5 w-3.5 ${ACCENT_CLASSES[accent].text}`} />
                </div>
                <p className={`text-2xl font-bold tabular-nums ${ACCENT_CLASSES[accent].text}`}>{value}</p>
                <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{label}</p>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-white/10 bg-white/[0.03] mb-4 p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Period</label>
            <div className="flex rounded-md overflow-hidden border border-white/15 text-xs">
              <button type="button" onClick={() => setPeriodMode("total")} className={`px-3 py-1.5 ${periodMode === "total" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground"}`}>Total</button>
              <button type="button" onClick={() => setPeriodMode("custom")} className={`px-3 py-1.5 border-l border-white/15 ${periodMode === "custom" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground"}`}>Custom</button>
            </div>
          </div>
          {periodMode === "custom" ? (
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Pay Period</label>
              <select
                value={`${customStart}|${customEnd}`}
                onChange={(e) => {
                  const [start, end] = e.target.value.split("|");
                  setCustomStart(start);
                  setCustomEnd(end);
                }}
                className="glass-input text-xs py-1.5 px-3 rounded-md"
              >
                {[...payPeriods].reverse().map((p) => (
                  <option key={p.start} value={`${p.start}|${p.end}`}>
                    {fmtPayDate(p.start)} – {fmtPayDate(p.end)}{todayStr() >= p.start && todayStr() <= p.end ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground px-1 pb-1.5 whitespace-nowrap">
              All pay periods · {fmtPayDate(periodStart)} – {fmtPayDate(periodEnd)}
            </div>
          )}
          <div className="flex-1 min-w-[160px]">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tech name or ID…" className="glass-input text-xs py-1.5 px-3 rounded-md w-full" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Location</label>
            <MultiSelect label="Location" options={locationOptions} selected={locationFilter} onChange={setLocationFilter} />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Manager</label>
            <MultiSelect label="Manager" options={managerOptions} selected={managerFilter} onChange={setManagerFilter} />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Tier</label>
            <MultiSelect label="Tier" options={tierOptions} selected={tierFilter} onChange={setTierFilter} />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Group By</label>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className="glass-input text-xs py-1.5 px-3 rounded-md">
              <option value="none">None</option>
              <option value="location">Branch Location</option>
              <option value="manager">Direct Manager</option>
              <option value="tier">Tier Level</option>
            </select>
          </div>
        </div>

        {error && <p className="mb-4 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{error}</p>}

        {loading ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-10 flex items-center justify-center"><BrandedLoader /></div>
        ) : (
          <div className="space-y-4">
            {compareDimension && compareGroups.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <UserSquare2 className="h-4 w-4 text-blue-400" />
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Compare by {compareDimension === "location" ? "Location" : compareDimension === "manager" ? "Manager" : "Tier"}
                  </p>
                </div>
                <p className="text-[10px] text-muted-foreground mb-4">
                  {compareGroups.length} selected — Total Tickets per day, color-coded per {compareDimension}. Period totals are in the table below.
                </p>
                <ResponsiveContainer width="100%" height={260} debounce={200}>
                  <LineChart data={compareTimeSeries} margin={{ left: -10, right: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "#94a3b8", fontSize: 9 }}
                      angle={compareTimeSeries.length > 10 ? -35 : 0}
                      textAnchor={compareTimeSeries.length > 10 ? "end" : "middle"}
                      height={compareTimeSeries.length > 10 ? 45 : 24}
                      interval={compareTimeSeries.length > 20 ? Math.ceil(compareTimeSeries.length / 15) : 0}
                    />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {compareGroups.map((g, i) => (
                      <Line
                        key={g.value}
                        type="monotone"
                        dataKey={g.value}
                        name={g.value}
                        stroke={COMPARE_BAR_FILLS[i % COMPARE_BAR_FILLS.length]}
                        strokeWidth={2}
                        dot={{ r: 2.5 }}
                        activeDot={{ r: 4.5 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
                <div className="overflow-x-auto mt-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">{compareDimension === "location" ? "Location" : compareDimension === "manager" ? "Manager" : "Tier"}</th>
                        <th className="px-3 py-2 text-right text-xs text-muted-foreground uppercase">Techs</th>
                        <th className="px-3 py-2 text-right text-xs text-muted-foreground uppercase">Total Tickets</th>
                        <th className="px-3 py-2 text-right text-xs text-muted-foreground uppercase">Redo %</th>
                        <th className="px-3 py-2 text-right text-xs text-muted-foreground uppercase">Tickets/Hr</th>
                        <th className="px-3 py-2 text-right text-xs text-muted-foreground uppercase">Mi/Ticket</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareGroups.map((g, i) => (
                        <tr key={g.value} className="border-b border-white/5">
                          <td className="px-3 py-2 font-medium flex items-center gap-2">
                            <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ background: COMPARE_BAR_FILLS[i % COMPARE_BAR_FILLS.length] }} />
                            {g.value}
                          </td>
                          <td className="px-3 py-2 text-right">{g.techCount}</td>
                          <td className="px-3 py-2 text-right">{g.totalTickets}</td>
                          <td className="px-3 py-2 text-right">{g.redoRatePct != null ? `${fmt1(g.redoRatePct)}%` : "—"}</td>
                          <td className="px-3 py-2 text-right">{g.ticketsPerHour != null ? g.ticketsPerHour.toFixed(2) : "—"}</td>
                          <td className="px-3 py-2 text-right">{g.milesPerTicket != null ? fmt1(g.milesPerTicket) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {top10Chart.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-1.5 mb-4">
                  <Star className="h-4 w-4 text-emerald-400" />
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top 10 Technicians — Points</p>
                </div>
                <ResponsiveContainer width="100%" height={200} debounce={200}>
                  <BarChart data={top10Chart} margin={{ left: -10 }}>
                    <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      cursor={{ fill: "rgba(148,163,184,0.1)" }}
                      formatter={(v: any) => [v, "Points"]}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} name="Points">
                      {/* Bar color = that technician's medal */}
                      {top10Chart.map((d, i) => <Cell key={i} fill={`#${LETTER_META[letterGrade(d.value)].xlsxFill.slice(2)}`} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {!showAllColumns && (
              <details open className="group rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5">
                <summary className="flex flex-wrap items-center gap-x-4 gap-y-1.5 cursor-pointer list-none select-none">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Grade</span>
                  {GRADE_ORDER.map((g) => (
                    <span key={g} className="inline-flex items-center gap-1.5 text-xs">
                      <span className={`h-2.5 w-2.5 rounded-full ${GRADE_META[g].dot}`} />
                      {GRADE_META[g].label}
                    </span>
                  ))}
                  <span className="ml-auto text-[11px] text-blue-400 group-open:hidden">View scale</span>
                  <span className="ml-auto text-[11px] text-blue-400 hidden group-open:inline">Hide scale</span>
                </summary>
                <div className="overflow-x-auto mt-3">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th className="px-2 py-1.5 text-left text-muted-foreground font-medium" />
                        {GRADE_ORDER.map((g) => (
                          <th key={g} className="px-2 py-1.5 text-center">
                            <span className={`inline-block rounded-md px-2 py-0.5 ring-1 ring-inset font-semibold ${GRADE_META[g].pill}`}>{GRADE_META[g].label}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {GRADE_SCALE.map((s) => (
                        <tr key={s.factor} className="border-t border-white/5">
                          <td className="px-2 py-1.5 font-medium whitespace-nowrap">{s.factor}</td>
                          {GRADE_ORDER.map((g) => (
                            <td key={g} className="px-2 py-1.5 text-center text-muted-foreground whitespace-nowrap">
                              {s.ranges[g] ? (
                                <>
                                  {s.ranges[g]}
                                  <span className="block text-[10px] opacity-70">{fmtPoints((s.points ?? GRADE_POINTS)[g])}</span>
                                </>
                              ) : (
                                <span className="opacity-40">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/5 pt-3">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Grade by Points</span>
                    {LETTER_GRADES.map((g) => (
                      <span key={g} className="inline-flex items-center gap-2 text-xs">
                        <GradeMedal grade={g} size="sm" />
                        <span>
                          <span className="font-semibold">{LETTER_META[g].medal}</span>
                          <span className="text-muted-foreground"> · {LETTER_META[g].range}</span>
                        </span>
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-400" aria-hidden />
                    <p>
                      <span className="font-semibold">Disclaimer:</span> Grades and points are calculated automatically from the data in this report (tickets, timecards, mileage and any imported corrections). Some of that data can be incomplete or wrong — for example a missed clock-in, a ticket not yet closed or synced, or mileage not yet logged — so a grade may not reflect a technician's actual performance. Please verify with the technician's manager before acting on it.
                    </p>
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground">Points = the sum over Average Tickets, Total Ticket, Redo %, Working Days, Average Hours and Average Mileage (−5 to 11). Total Ticket and Working Days are scaled for a 2-week pay period.</p>
                </div>
              </details>
            )}
            {groupedRows.map(({ groupName, rows: groupRows }) => {
              const groupScrollRef = getGroupScrollRef(groupName ?? "__all__");
              return (
              <div key={groupName ?? "all"} className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
                {groupName != null && (
                  <div className="px-4 py-2.5 border-b border-white/10 bg-white/5 flex items-center justify-between">
                    <h2 className="font-semibold text-sm">{groupName}</h2>
                    <span className="text-[10px] text-muted-foreground">
                      {groupRows.length} tech{groupRows.length === 1 ? "" : "s"} · avg redo {fmt1(groupRows.reduce((s, r) => s + (r.redoRatePct ?? 0), 0) / groupRows.length || 0)}%
                    </span>
                  </div>
                )}
                <div className="overflow-x-auto" ref={groupScrollRef}>
                  <table className="w-full text-sm">
                    <thead>
                      {!showAllColumns ? (
                      <>
                      <tr className="bg-white/[0.03]">
                        <th />
                        <th colSpan={9} className="px-3 pt-2 pb-0.5 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-300/80 border-x border-white/10">Main Factors</th>
                        <th colSpan={5} className="px-3 pt-2 pb-0.5 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Breakdown</th>
                      </tr>
                      <tr className="border-b border-white/10 bg-white/5">
                        <th className={thClass} onClick={() => toggleSort("name")}>Name{sortIndicator("name")}</th>
                        <th className={`${thClass} text-center border-l border-white/10`} onClick={() => toggleSort("shortPoints")} title="SSS 11 · SS 10 · S 9 · A 8 · B 7 · C 5–6 · D 4 or less">Grade</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("shortPoints")} title="Maximum 3 · Great 2 · Median 1 · Effort 0 · Alert −1 (Redo % and Working Days max 2), summed over Average Tickets, Total Ticket, Redo % and Working Days; Average Hours over 12 a day −1; Average Mileage 250+ a day +1">Points{sortIndicator("shortPoints")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("shortDailyAvg")} title="Total Ticket ÷ Working Days">Average Tickets{sortIndicator("shortDailyAvg")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("shortTotalTicket")} title="Minor + Major − Redo">Total Ticket{sortIndicator("shortTotalTicket")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("shortRedoPct")} title="Redo ÷ (Minor + Major)">Redo %{sortIndicator("shortRedoPct")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("daysWorked")}>Working Days{sortIndicator("daysWorked")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("shortAvgHours")} title="Hours of Work ÷ Working Days">Average Hours{sortIndicator("shortAvgHours")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("shortAvgMiles")} title="Mileage ÷ Working Days">Average Mileage{sortIndicator("shortAvgMiles")}</th>
                        <th className={`${thClass} text-right border-r border-white/10`} onClick={() => toggleSort("shortErrorCount")} title="Timecard issues (correction requests) + damages (damage documents)">Error Count{sortIndicator("shortErrorCount")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("minorTicketCount")}>Minor Comp{sortIndicator("minorTicketCount")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("majorTicketCount")}>Major Comp{sortIndicator("majorTicketCount")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("redoCount")}>Redo Count{sortIndicator("redoCount")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("miles")}>Mileage{sortIndicator("miles")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("hoursWorked")}>Hours of Work{sortIndicator("hoursWorked")}</th>
                      </tr>
                      </>
                      ) : (
                      <tr className="border-b border-white/10 bg-white/5">
                        <th className={thClass} onClick={() => toggleSort("name")}>Name{sortIndicator("name")}</th>
                        <th className="px-3 py-2 text-right text-xs text-muted-foreground uppercase">Variance</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("damageAssessmentCount")}>Damage Assessment{sortIndicator("damageAssessmentCount")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("minorTicketCount")}>Minor Ticket{sortIndicator("minorTicketCount")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("majorTicketCount")}>Major Ticket{sortIndicator("majorTicketCount")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("redoCount")}>Redo{sortIndicator("redoCount")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("totalTickets")}>Total Completion{sortIndicator("totalTickets")}</th>
                        <th className="px-3 py-2 text-right text-xs text-muted-foreground uppercase">Average Completion</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("rescheduleCount")}>Reschedule{sortIndicator("rescheduleCount")}</th>
                        <th className="px-3 py-2 text-right text-xs text-muted-foreground uppercase">NCNS</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("cancelledCount")}>Cancelled{sortIndicator("cancelledCount")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("miles")}>Mileage{sortIndicator("miles")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("daysWorked")}>Working Days{sortIndicator("daysWorked")}</th>
                        <th className="px-3 py-2 text-right text-xs text-muted-foreground uppercase">Off Days</th>
                        <th className="px-3 py-2 text-right text-xs text-muted-foreground uppercase">Unexcused Off Days Total 2026</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("hoursWorked")}>Hours Worked{sortIndicator("hoursWorked")}</th>
                        <th className={thClass} onClick={() => toggleSort("location")}>Location{sortIndicator("location")}</th>
                        <th className={thClass} onClick={() => toggleSort("manager")}>Manager{sortIndicator("manager")}</th>
                        <th className={thClass} onClick={() => toggleSort("tier")}>Tier{sortIndicator("tier")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("redoRatePct")}>Redo %{sortIndicator("redoRatePct")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("milesPerTicket")}>Mi/Ticket{sortIndicator("milesPerTicket")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("ticketsPerHour")}>Tickets/Hr{sortIndicator("ticketsPerHour")}</th>
                        <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Alerts</th>
                      </tr>
                      )}
                    </thead>
                    <tbody>
                      {groupRows.length === 0 ? (
                        <tr><td colSpan={showAllColumns ? 23 : 15} className="px-4 py-8 text-center text-muted-foreground text-sm">No technicians match.</td></tr>
                      ) : (
                        groupRows.map((r) => {
                          const variance = varianceByRowId.get(r.id) ?? null;
                          // Cells shared by the short and full layouts.
                          const nameCell = (
                            <td className="px-3 py-2 font-medium">
                              <button
                                type="button"
                                onClick={() => { setSelectedTechId(r.id); setShowActivityLog(false); }}
                                className="hover:text-blue-300 hover:underline underline-offset-2 transition inline-flex items-center gap-1.5"
                                title="Click the name to view details"
                              >
                                {r.name}
                                {r.hasOverride && (
                                  <PencilLine className="h-3 w-3 text-amber-400 shrink-0" aria-label="Has manual corrections this period" />
                                )}
                              </button>
                              {/* Short view has no Location column, so the branch rides under the name. */}
                              {!showAllColumns && r.location && r.location !== "—" && (
                                <span className="block text-[10px] font-normal text-muted-foreground leading-tight mt-0.5">{r.location}</span>
                              )}
                            </td>
                          );
                          const milesCell = (
                            <td className="px-3 py-2 text-right">
                              {r.miles > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setMileageListFor({ id: r.id, name: r.name })}
                                  className="text-blue-400 hover:text-blue-300 hover:underline underline-offset-2"
                                  title="View mileage breakdown"
                                >
                                  {fmt1(r.miles)}
                                </button>
                              ) : (
                                fmt1(r.miles)
                              )}
                            </td>
                          );
                          const offDaysCell = (
                            <td className="px-3 py-2 text-right">
                              {r.offDaysCount > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setOffDaysListFor({ id: r.id, name: r.name })}
                                  className="text-blue-400 hover:text-blue-300 hover:underline underline-offset-2"
                                  title="View off-duty dates"
                                >
                                  {r.offDaysCount}
                                </button>
                              ) : (
                                r.offDaysCount
                              )}
                            </td>
                          );
                          const workDaysCell = (
                            <td className="px-3 py-2 text-right">
                              {r.daysWorked > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setWorkDaysListFor({ id: r.id, name: r.name })}
                                  className="text-blue-400 hover:text-blue-300 hover:underline underline-offset-2"
                                  title="View working dates"
                                >
                                  {r.daysWorked}
                                </button>
                              ) : (
                                r.daysWorked
                              )}
                            </td>
                          );
                          const hoursCell = (
                            <td className="px-3 py-2 text-right">
                              {r.hoursWorked > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setHoursListFor({ id: r.id, name: r.name })}
                                  className="text-blue-400 hover:text-blue-300 hover:underline underline-offset-2"
                                  title="View hours breakdown"
                                >
                                  {fmt1(r.hoursWorked)}
                                </button>
                              ) : (
                                fmt1(r.hoursWorked)
                              )}
                            </td>
                          );
                          if (!showAllColumns) {
                            const total = shortTotalTicket(r);
                            const redoPct = shortRedoPct(r);
                            const dailyAvg = shortDailyAvg(r);
                            const points = shortPoints(r);
                            // Clickable figures keep their breakdown popups;
                            // the pill carries the grade color instead of blue.
                            const linkish = (value: ReactNode, onClick: () => void, title: string, clickable: boolean) =>
                              clickable ? (
                                <button type="button" onClick={onClick} className="hover:underline underline-offset-2" title={title}>{value}</button>
                              ) : value;
                            const gradedTd = (grade: Grade | null, content: ReactNode, extra = "") => (
                              <td className={`px-2 py-1.5 text-right ${extra}`}><GradePill grade={grade}>{content}</GradePill></td>
                            );
                            return (
                              <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                                {nameCell}
                                <td className="px-3 py-1 text-center border-l border-white/10">
                                  <GradeMedal grade={letterGrade(points)} />
                                </td>
                                <td className="px-3 py-1.5 text-right">
                                  <span className="inline-flex justify-end min-w-[2.5rem] rounded-md bg-white/10 px-2 py-0.5 tabular-nums font-bold">{points}</span>
                                </td>
                                {gradedTd(GRADERS.dailyAvg(dailyAvg), fmt1(dailyAvg))}
                                {gradedTd(GRADERS.totalTicket(total), total)}
                                {gradedTd(GRADERS.redoPct(redoPct), fmtRedoPct(redoPct))}
                                {gradedTd(GRADERS.workingDays(r.daysWorked), linkish(r.daysWorked, () => setWorkDaysListFor({ id: r.id, name: r.name }), "View working dates", r.daysWorked > 0))}
                                {gradedTd(GRADERS.avgHours(shortAvgHours(r)), fmt1(shortAvgHours(r)))}
                                {gradedTd(GRADERS.avgMiles(shortAvgMiles(r)), fmt1(shortAvgMiles(r)))}
                                <td
                                  className={`px-3 py-2 text-right tabular-nums font-semibold border-r border-white/10 ${shortErrorCount(r) > 0 ? "text-red-300" : "text-muted-foreground"}`}
                                  title={`Timecard issues: ${r.timecardIssueCount} · Damages: ${r.damageAssessmentCount}`}
                                >
                                  {shortErrorCount(r)}
                                </td>
                                <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{r.minorTicketCount}</td>
                                <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{r.majorTicketCount}</td>
                                <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{r.redoCount}</td>
                                <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                                  {linkish(fmt1(r.miles), () => setMileageListFor({ id: r.id, name: r.name }), "View mileage breakdown", r.miles > 0)}
                                </td>
                                <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                                  {linkish(fmt1(r.hoursWorked), () => setHoursListFor({ id: r.id, name: r.name }), "View hours breakdown", r.hoursWorked > 0)}
                                </td>
                              </tr>
                            );
                          }
                          return (
                          <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                            {nameCell}
                            <td className={`px-3 py-2 text-right font-semibold ${variance == null ? "text-muted-foreground" : variance > 0 ? "text-emerald-400" : variance < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                              {fmtVariance(variance)}
                            </td>
                            <td className="px-3 py-2 text-right">{r.damageAssessmentCount}</td>
                            <td className="px-3 py-2 text-right">{r.minorTicketCount}</td>
                            <td className="px-3 py-2 text-right">{r.majorTicketCount}</td>
                            <td className="px-3 py-2 text-right">{r.redoCount}</td>
                            <td className="px-3 py-2 text-right">
                              {r.totalTickets > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setTicketListFor({ id: r.id, name: r.name })}
                                  className="text-blue-400 hover:text-blue-300 hover:underline underline-offset-2"
                                  title="View completed tickets"
                                >
                                  {r.totalTickets}
                                </button>
                              ) : (
                                r.totalTickets
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">{r.daysWorked > 0 ? fmt1(r.totalTickets / r.daysWorked) : "—"}</td>
                            <td className="px-3 py-2 text-right">{r.rescheduleCount}</td>
                            <td className="px-3 py-2 text-right">{r.ncnsCount}</td>
                            <td className="px-3 py-2 text-right">{r.cancelledCount}</td>
                            {milesCell}
                            {workDaysCell}
                            {offDaysCell}
                            <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                            {hoursCell}
                            <td className="px-3 py-2 text-muted-foreground">{r.location}</td>
                            <td className="px-3 py-2 text-muted-foreground">{r.manager}</td>
                            <td className="px-3 py-2 text-muted-foreground">{r.tier}</td>
                            <td className={`px-3 py-2 text-right ${r.highRedoAlert ? "text-red-300 font-semibold" : ""}`}>{r.redoRatePct != null ? `${fmt1(r.redoRatePct)}%` : "—"}</td>
                            <td className={`px-3 py-2 text-right ${r.routeMileageAlert ? "text-amber-300 font-semibold" : ""}`}>{r.milesPerTicket != null ? fmt1(r.milesPerTicket) : "—"}</td>
                            <td className="px-3 py-2 text-right">{r.ticketsPerHour != null ? r.ticketsPerHour.toFixed(2) : "—"}</td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1">
                                {r.highRedoAlert && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/40">High Redo</span>}
                                {r.routeMileageAlert && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">Route Mileage</span>}
                                {r.lowUtilizationAlert && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/40">Low Utilization</span>}
                              </div>
                            </td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {/* Floating horizontal scrollbar — pinned to the bottom of
                    the viewport so the user can scroll THIS group's wide
                    table sideways without first scrolling all the way down.
                    Hides itself automatically when this table isn't the one
                    currently in view (e.g. a different group is on screen),
                    or when its own native scrollbar is already reachable. */}
                <FloatingHorizontalScrollbar targetRef={groupScrollRef} />
              </div>
              );
            })}
          </div>
        )}
      </main>

      {ticketListFor && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setTicketListFor(null)}>
          <div
            className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
              <div>
                <p className="font-semibold text-white">Completed Tickets — {ticketListFor.name}</p>
                <p className="text-xs text-slate-400">{periodStart} – {periodEnd} · {ticketListRows.length} ticket{ticketListRows.length === 1 ? "" : "s"}</p>
              </div>
              <button onClick={() => setTicketListFor(null)} className="text-white/40 hover:text-white/80 transition">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-2">
              {ticketListRows.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No completed tickets in this period.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 uppercase">
                      <th className="px-3 py-2">Ticket #</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Location</th>
                      <th className="px-3 py-2">Repair Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {ticketListRows.map((t) => (
                      <tr key={t.ticketId} className="hover:bg-white/5">
                        <td className="px-3 py-2">
                          <Link to="/ticket/$ticketNo" params={{ ticketNo: t.ticketNo }} target="_blank" rel="noreferrer" className="font-mono text-blue-400 hover:text-blue-300 hover:underline">
                            {t.ticketNo || t.ticketId.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-slate-300">{t.date}</td>
                        <td className="px-3 py-2 text-slate-300">{t.location || "—"}</td>
                        <td className="px-3 py-2 text-slate-300">{t.repairType}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {mileageListFor && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setMileageListFor(null)}>
          <div
            className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
              <div>
                <p className="font-semibold text-white">Mileage Breakdown — {mileageListFor.name}</p>
                <p className="text-xs text-slate-400">{periodStart} – {periodEnd} · {fmt1(mileageListRows.reduce((s, d) => s + d.miles, 0))} total miles</p>
              </div>
              <button onClick={() => setMileageListFor(null)} className="text-white/40 hover:text-white/80 transition">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="px-5 pt-3 text-[11px] text-slate-400">
              One effective total per day — from mileage_entries, source of truth is <span className="text-slate-300">mileageEffectiveTotal()</span> (a manual override replaces the calculated total; an adjustment adds/subtracts). When a day has several entries (one per ticket that day, or a correction), the most recently created one wins — same rule Accounting's Tech Activity Report uses. Only entries tagged to this technician's own branch count; a day flagged "excluded" had another entry seen but tagged to a different branch.
            </p>
            <div className="overflow-y-auto flex-1 p-2">
              {mileageListRows.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No mileage in this period.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 uppercase">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2 text-right">Miles</th>
                      <th className="px-3 py-2">Branch</th>
                      <th className="px-3 py-2 text-right">Entries</th>
                      <th className="px-3 py-2">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {mileageListRows.map((d) => (
                      <tr key={d.date} className="hover:bg-white/5">
                        <td className="px-3 py-2 text-slate-300">{d.date}</td>
                        <td className="px-3 py-2 text-right font-medium">{fmt1(d.miles)}</td>
                        <td className="px-3 py-2 text-slate-300">{d.branch || "—"}</td>
                        <td className="px-3 py-2 text-right text-slate-300">{d.entryCount}</td>
                        <td className="px-3 py-2">
                          {d.excludedEntryCount > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              {d.excludedEntryCount} excluded (different branch)
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {hoursListFor && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setHoursListFor(null)}>
          <div
            className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
              <div>
                <p className="font-semibold text-white">Hours Breakdown — {hoursListFor.name}</p>
                <p className="text-xs text-slate-400">{periodStart} – {periodEnd} · {fmt1(hoursListRows.reduce((s, d) => s + d.hours, 0))} total hours</p>
              </div>
              <button onClick={() => setHoursListFor(null)} className="text-white/40 hover:text-white/80 transition">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="px-5 pt-3 text-[11px] text-slate-400">
              Real hours per day from this technician's own timecard — Check In/Check Out minus any unpaid meal break (<span className="text-slate-300">calcWorkedHours</span>), plus any paid-meal credit their role gets. A day with a manual correction (technician_daily_performance_overrides) shows this raw punched value here regardless — the table's own total already reflects the correction.
            </p>
            <div className="overflow-y-auto flex-1 p-2">
              {hoursListRows.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No punches in this period.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 uppercase">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2 text-right">Hours</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {hoursListRows.map((d) => (
                      <tr key={d.date} className="hover:bg-white/5">
                        <td className="px-3 py-2 text-slate-300">{d.date}</td>
                        <td className="px-3 py-2 text-right font-medium">{fmt1(d.hours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {offDaysListFor && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setOffDaysListFor(null)}>
          <div
            className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-sm max-h-[80vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
              <div>
                <p className="font-semibold text-white">Off Days — {offDaysListFor.name}</p>
                <p className="text-xs text-slate-400">{periodStart} – {periodEnd} · {offDaysListRows.length} day{offDaysListRows.length === 1 ? "" : "s"}</p>
              </div>
              <button onClick={() => setOffDaysListFor(null)} className="text-white/40 hover:text-white/80 transition">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="px-5 pt-3 text-[11px] text-slate-400">
              Scheduled weekly off days (Admin User Management's Off Days picker) falling within this period — not days actually missed.
            </p>
            <div className="overflow-y-auto flex-1 p-2">
              {offDaysListRows.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No off days in this period.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 uppercase">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Day</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {offDaysListRows.map((d) => (
                      <tr key={d} className="hover:bg-white/5">
                        <td className="px-3 py-2 text-slate-300">{d}</td>
                        <td className="px-3 py-2 text-slate-300">{new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {workDaysListFor && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setWorkDaysListFor(null)}>
          <div
            className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-sm max-h-[80vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
              <div>
                <p className="font-semibold text-white">Working Days — {workDaysListFor.name}</p>
                <p className="text-xs text-slate-400">{periodStart} – {periodEnd} · {workDaysListRows.length} day{workDaysListRows.length === 1 ? "" : "s"}</p>
              </div>
              <button onClick={() => setWorkDaysListFor(null)} className="text-white/40 hover:text-white/80 transition">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="px-5 pt-3 text-[11px] text-slate-400">
              Days with a timecard punch, or with hours entered as a manual correction, within this period.
            </p>
            <div className="overflow-y-auto flex-1 p-2">
              {workDaysListRows.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No working days in this period.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 uppercase">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Day</th>
                      <th className="px-3 py-2 text-right">Hours</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {workDaysListRows.map((d) => (
                      <tr key={d.date} className="hover:bg-white/5">
                        <td className="px-3 py-2 text-slate-300">{d.date}</td>
                        <td className="px-3 py-2 text-slate-300">{new Date(`${d.date}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" })}</td>
                        <td className="px-3 py-2 text-right text-slate-300">{d.hours != null && d.hours > 0 ? fmt1(d.hours) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedTech && (
        <TechDetailPanel
          tech={selectedTech}
          dailyLog={selectedTechDailyLog}
          showActivityLog={showActivityLog}
          onToggleActivityLog={() => setShowActivityLog((v) => !v)}
          onClose={() => setSelectedTechId(null)}
        />
      )}
    </div>
  );
}

const ACTIVITY_TILES: { label: string; icon: typeof Star; accent: string; getValue: (t: TechPerfRow) => string | number }[] = [
  { label: "Days Worked", icon: CalendarClock, accent: "blue", getValue: (t) => t.daysWorked },
  { label: "Total Hrs Worked", icon: CalendarClock, accent: "violet", getValue: (t) => fmt1(t.hoursWorked) },
  { label: "Tickets Completed", icon: Star, accent: "emerald", getValue: (t) => t.totalTickets },
  { label: "Redo Count", icon: UserSquare2, accent: "amber", getValue: (t) => t.redoCount },
  { label: "Drive Range (Mi)", icon: MapPin, accent: "cyan", getValue: (t) => fmt1(t.miles) },
];
const ACCENT_CLASSES: Record<string, { chip: string; text: string }> = {
  blue: { chip: "bg-blue-500/10", text: "text-blue-400" },
  violet: { chip: "bg-violet-500/10", text: "text-violet-400" },
  emerald: { chip: "bg-emerald-500/10", text: "text-emerald-400" },
  amber: { chip: "bg-amber-500/10", text: "text-amber-400" },
  cyan: { chip: "bg-cyan-500/10", text: "text-cyan-400" },
};

function TechDetailPanel({
  tech, dailyLog, showActivityLog, onToggleActivityLog, onClose,
}: {
  tech: TechPerfRow;
  dailyLog: [string, number][];
  showActivityLog: boolean;
  onToggleActivityLog: () => void;
  onClose: () => void;
}) {
  // No animation plugin installed in this project (tailwindcss-animate
  // isn't a dependency) — fade/scale it in manually: mount at
  // opacity-0/scale-95, then flip on the next tick so the transition plays.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // A stat tile is a shortcut into the same day-by-day breakdown the "View
  // Activity Log" button opens — clicking one opens it (never closes it)
  // and scrolls it into view, since it's the only detail view this data
  // supports today.
  const activityLogRef = useRef<HTMLDivElement>(null);
  const onOpenActivityLog = () => {
    if (!showActivityLog) onToggleActivityLog();
    requestAnimationFrame(() => activityLogRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  const infoCards = [
    { icon: UserSquare2, label: "Technician ID", value: tech.techId, hint: "Unique technician identifier", accent: "blue" },
    { icon: MapPin, label: "Location", value: tech.location, hint: "Geographical location / branch", accent: "rose" },
    { icon: UserSquare2, label: "Direct Manager", value: tech.manager, hint: "Direct supervisor", accent: "indigo" },
    { icon: Star, label: "Tier Level", value: tech.tier, hint: "Technician classification tier", accent: "amber" },
  ];
  const infoAccent: Record<string, { chip: string; text: string }> = {
    ...ACCENT_CLASSES,
    rose: { chip: "bg-rose-500/10", text: "text-rose-400" },
    indigo: { chip: "bg-indigo-500/10", text: "text-indigo-400" },
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm transition-opacity duration-200 ${entered ? "opacity-100" : "opacity-0"}`}
      onClick={onClose}
    >
      <div
        className={`w-full max-w-5xl max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-slate-950 shadow-[0_20px_70px_rgba(0,0,0,0.55)] transition-all duration-200 ${entered ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative px-7 py-7 bg-gradient-to-br from-blue-600/20 via-indigo-600/10 to-transparent border-b border-white/10">
          <button type="button" onClick={onClose} className="absolute top-5 right-5 text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-white/5 transition" title="Close">
            <X className="h-5 w-5" />
          </button>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-300/80 mb-1">Technician Details</p>
          <div className="flex items-start gap-4">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 ring-4 ring-blue-500/20 flex items-center justify-center text-white font-bold text-xl shrink-0 shadow-lg">
              {initialsFor(tech.name)}
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-2xl font-bold truncate">{tech.name}</h2>
                <span className={`shrink-0 inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full ${tech.isActive ? "bg-green-500/15 text-green-300" : "bg-slate-500/15 text-slate-400"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${tech.isActive ? "bg-green-400" : "bg-slate-500"}`} />
                  {tech.isActive ? "Active" : "Inactive"}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{tech.techId !== "—" ? `${tech.techId} · ` : ""}{tech.tier}</p>
              {(tech.highRedoAlert || tech.routeMileageAlert || tech.lowUtilizationAlert) && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {tech.highRedoAlert && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/40">High Redo</span>}
                  {tech.routeMileageAlert && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">Route Mileage</span>}
                  {tech.lowUtilizationAlert && <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/40">Low Utilization</span>}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-7 grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6 items-start">
          <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {infoCards.map(({ icon: Icon, label, value, hint, accent }) => (
              <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:border-white/20 transition">
                <div className={`inline-flex p-2 rounded-lg mb-2.5 ${infoAccent[accent].chip}`}>
                  <Icon className={`h-4 w-4 ${infoAccent[accent].text}`} />
                </div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
                <p className="text-base font-bold truncate mt-0.5" title={value}>{value}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>
              </div>
            ))}
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <CalendarClock className="h-4 w-4 text-blue-400" />
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Daily Activity Log</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {ACTIVITY_TILES.map(({ label, icon: Icon, accent, getValue }) => (
                <button
                  key={label}
                  type="button"
                  onClick={onOpenActivityLog}
                  title="View the day-by-day breakdown"
                  className="text-left rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:border-white/25 hover:bg-white/[0.06] active:scale-[0.98] transition cursor-pointer"
                >
                  <div className={`inline-flex p-1.5 rounded-lg mb-2 ${ACCENT_CLASSES[accent].chip}`}>
                    <Icon className={`h-3.5 w-3.5 ${ACCENT_CLASSES[accent].text}`} />
                  </div>
                  <p className={`text-2xl font-bold tabular-nums ${ACCENT_CLASSES[accent].text}`}>{getValue(tech)}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{label}</p>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onToggleActivityLog}
              className="btn text-xs w-full mt-4 flex items-center justify-center gap-1.5"
            >
              {showActivityLog ? "Hide Activity Log" : "View Activity Log"}
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showActivityLog ? "rotate-90" : ""}`} />
            </button>
            {showActivityLog && (
              <div ref={activityLogRef} className="mt-3">
                {dailyLog.length === 0 ? (
                  <div className="rounded-xl border border-white/10 py-6">
                    <p className="text-xs text-muted-foreground text-center">No completed tickets logged for this period.</p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 mb-2">
                      <ResponsiveContainer width="100%" height={160} debounce={200}>
                        <BarChart data={[...dailyLog].reverse().map(([date, count]) => ({ date: `${date.slice(5, 7)}/${date.slice(8, 10)}`, count }))} margin={{ left: -20, right: 8 }}>
                          <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                          <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} allowDecimals={false} width={28} />
                          <Tooltip
                            contentStyle={TOOLTIP_STYLE}
                            cursor={{ fill: "rgba(148,163,184,0.1)" }}
                            formatter={(v: any) => [v, "Tickets"]}
                          />
                          <Bar dataKey="count" radius={[3, 3, 0, 0]} name="Tickets">
                            {dailyLog.map((_, i) => <Cell key={i} fill={CHART_BAR_FILL} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="max-h-56 overflow-y-auto rounded-xl border border-white/10 divide-y divide-white/5">
                      {dailyLog.map(([date, count]) => (
                        <div key={date} className="flex items-center justify-between px-4 py-2 text-xs">
                          <span className="text-muted-foreground">{date}</span>
                          <span className="font-semibold">{count} ticket{count === 1 ? "" : "s"}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Ticket Outcomes</p>
            <div className="relative">
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie
                    data={[
                      { name: "Completed", value: Math.max(0, tech.totalTickets - tech.redoCount) },
                      { name: "Redo", value: tech.redoCount },
                    ]}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={68}
                    paddingAngle={tech.redoCount > 0 && tech.totalTickets - tech.redoCount > 0 ? 3 : 0}
                    stroke="none"
                  >
                    <Cell fill="#22c55e" />
                    <Cell fill="#ef4444" />
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any, n: any) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="text-xl font-bold">{tech.redoRatePct != null ? `${fmt1(tech.redoRatePct)}%` : "—"}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Redo Rate</p>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 mt-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-green-500" />Completed</span>
                <span className="font-semibold">{Math.max(0, tech.totalTickets - tech.redoCount)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-red-500" />Redo</span>
                <span className="font-semibold">{tech.redoCount}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
