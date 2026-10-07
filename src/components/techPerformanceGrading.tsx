/**
 * Technician Performance grading, shared by the report page and the mobile
 * app: pay periods, the per-factor color scale and points, the letter grade
 * (Master … Needs Attention) and its medal. Moved out of
 * TechnicianPerformanceReport.tsx unchanged.
 */
import type { ReactNode } from "react";
import { Crown } from "lucide-react";
import { addDaysISO } from "@/lib/supabase/timecards";

const fmt1 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

// Pay periods: the first is the irregular 08-27 → 09-12 (2026); after
// that they're back-to-back 14-day periods, Sunday → Saturday, Sundays
// included (09-13 → 09-26, 09-27 → 10-10, ...). Listed up to the one that
// contains (or most recently started before) today.
export const FIRST_PAY_PERIOD = { start: "2026-08-27", end: "2026-09-12" };
export const payPeriodsThrough = (today: string): { start: string; end: string }[] => {
  const periods = [FIRST_PAY_PERIOD];
  let start = addDaysISO(FIRST_PAY_PERIOD.end, 1);
  while (start <= today) {
    periods.push({ start, end: addDaysISO(start, 13) });
    start = addDaysISO(start, 14);
  }
  return periods;
};
export const fmtPayDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;


// Short-view columns, computed straight from what that view shows:
// Total Ticket = Minor + Major − Redo; Redo % = Redo ÷ (Minor + Major).
export const shortTotalTicket = (r: { minorTicketCount: number; majorTicketCount: number; redoCount: number }) =>
  r.minorTicketCount + r.majorTicketCount - r.redoCount;
export const shortRedoPct = (r: { minorTicketCount: number; majorTicketCount: number; redoCount: number }): number | null => {
  const completed = r.minorTicketCount + r.majorTicketCount;
  return completed > 0 ? (r.redoCount / completed) * 100 : null;
};
// Average Tickets = Total Ticket ÷ Working Total Days; 0 with no working
// days (no tickets per day), so it reads and grades like any other 0.
export const shortDailyAvg = (r: { minorTicketCount: number; majorTicketCount: number; redoCount: number; daysWorked: number }): number =>
  r.daysWorked > 0 ? shortTotalTicket(r) / r.daysWorked : 0;
// Average Hours / Average Mileage = Hours of Work / Mileage ÷ Working
// Days (0 with no working days). Shown, not graded or scored.
export const shortAvgHours = (r: { hoursWorked: number; daysWorked: number }): number =>
  r.daysWorked > 0 ? r.hoursWorked / r.daysWorked : 0;
export const shortAvgMiles = (r: { miles: number; daysWorked: number }): number =>
  r.daysWorked > 0 ? r.miles / r.daysWorked : 0;
// Error Count = timecard issues (correction requests) + damages (damage
// documents issued). Shown, not scored.
export const shortErrorCount = (r: { timecardIssueCount: number; damageAssessmentCount: number; missedClockInCount: number }): number =>
  r.timecardIssueCount + r.damageAssessmentCount + r.missedClockInCount;
// Redo % with no tickets reads (and grades) as 0%, same as any other 0.
export const fmtRedoPct = (p: number | null) => `${fmt1(p ?? 0)}%`;

// Performance grades for the six main factors, per the scale ops handed
// over (Maximum / Great / Median / Effort / Alert). The totals' thresholds
// are sized for a 2-week pay period.
export type Grade = "max" | "great" | "median" | "effort" | "alert";
export const GRADE_META: Record<Grade, { label: string; pill: string; dot: string; xlsxFill: string; xlsxFont: string }> = {
  max: { label: "Maximum", pill: "bg-sky-500/15 text-sky-300 ring-sky-400/30", dot: "bg-sky-400", xlsxFill: "FFDBEAFE", xlsxFont: "FF1D4ED8" },
  great: { label: "Great", pill: "bg-emerald-500/15 text-emerald-400 ring-emerald-400/30", dot: "bg-emerald-400", xlsxFill: "FFDCFCE7", xlsxFont: "FF15803D" },
  median: { label: "Median", pill: "bg-yellow-400/15 text-yellow-300 ring-yellow-300/30", dot: "bg-yellow-300", xlsxFill: "FFFEF9C3", xlsxFont: "FFA16207" },
  effort: { label: "Effort", pill: "bg-orange-500/15 text-orange-300 ring-orange-400/30", dot: "bg-orange-400", xlsxFill: "FFFFEDD5", xlsxFont: "FFC2410C" },
  alert: { label: "Alert", pill: "bg-red-500/15 text-red-300 ring-red-400/30", dot: "bg-red-400", xlsxFill: "FFFEE2E2", xlsxFont: "FFB91C1C" },
};
export const GRADE_ORDER: Grade[] = ["max", "great", "median", "effort", "alert"];
/** Solid grade colors for glows / bubble accents (same hues as the pills). */
export const GRADE_HEX: Record<Grade, string> = { max: "#38bdf8", great: "#34d399", median: "#facc15", effort: "#fb923c", alert: "#f87171" };
// Higher is better: thresholds are the minimum for Maximum/Great/Median/Effort.
export const gradeAtLeast = (v: number | null, [max, great, median, effort]: [number, number, number, number]): Grade | null =>
  v == null ? null : v >= max ? "max" : v >= great ? "great" : v >= median ? "median" : v >= effort ? "effort" : "alert";
export const GRADERS = {
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
export const GRADE_POINTS: Record<Grade, number> = { max: 3, great: 2, median: 1, effort: 0, alert: -1 };
export const CAPPED_GRADE_POINTS: Record<Grade, number> = { ...GRADE_POINTS, max: 2 };
export const AVG_HOURS_POINTS: Record<Grade, number> = { max: 0, great: 0, median: 0, effort: -1, alert: 0 };
export const AVG_MILES_POINTS: Record<Grade, number> = { max: 0, great: 1, median: 0, effort: 0, alert: 0 };
export type ShortRowInput = { minorTicketCount: number; majorTicketCount: number; redoCount: number; daysWorked: number; hoursWorked: number; miles: number };
export const shortPoints = (r: ShortRowInput): number => {
  const pts = (g: Grade | null, table: Record<Grade, number>) => (g ? table[g] : 0);
  return pts(GRADERS.dailyAvg(shortDailyAvg(r)), GRADE_POINTS)
    + pts(GRADERS.totalTicket(shortTotalTicket(r)), GRADE_POINTS)
    + pts(GRADERS.redoPct(shortRedoPct(r)), CAPPED_GRADE_POINTS)
    + pts(GRADERS.workingDays(r.daysWorked), CAPPED_GRADE_POINTS)
    + pts(GRADERS.avgHours(shortAvgHours(r)), AVG_HOURS_POINTS)
    + pts(GRADERS.avgMiles(shortAvgMiles(r)), AVG_MILES_POINTS);
};
// Grade from Points: Master 11, Expert 10, Advanced 9, Proficient 8,
// Competent 7, Developing 5–6, Needs Attention 4 or less — shown as medals
// (royal with a crown, diamond, gold, silver, bronze, steel, iron). The
// letter keys (SSS…D) are internal; people see the names.
export type LetterGrade = "SSS" | "SS" | "S" | "A" | "B" | "C" | "D";
export const LETTER_GRADES: LetterGrade[] = ["SSS", "SS", "S", "A", "B", "C", "D"];
export const letterGrade = (points: number): LetterGrade =>
  points >= 11 ? "SSS" : points >= 10 ? "SS" : points >= 9 ? "S" : points >= 8 ? "A" : points >= 7 ? "B" : points >= 5 ? "C" : "D";
export const LETTER_META: Record<LetterGrade, { medal: string; range: string; bg: string; text: string; rim: string; xlsxFill: string; xlsxFont: string }> = {
  SSS: { medal: "👑 Master", range: "11 pts", bg: "linear-gradient(135deg,#fef3c7 0%,#f59e0b 20%,#be123c 55%,#581c87 100%)", text: "#fffbeb", rim: "#fde68a", xlsxFill: "FFBE123C", xlsxFont: "FFFFFBEB" },
  SS: { medal: "💎 Expert", range: "10 pts", bg: "linear-gradient(135deg,#ffffff 0%,#cffafe 22%,#a5b4fc 48%,#f0abfc 72%,#e0f2fe 100%)", text: "#3b0764", rim: "#ffffff", xlsxFill: "FFC7D2FE", xlsxFont: "FF3B0764" },
  S: { medal: "🥇 Advanced", range: "9 pts", bg: "linear-gradient(135deg,#fff7c2 0%,#fcd34d 30%,#d97706 75%,#92400e 100%)", text: "#451a03", rim: "#fde68a", xlsxFill: "FFFCD34D", xlsxFont: "FF451A03" },
  A: { medal: "🥈 Proficient", range: "8 pts", bg: "linear-gradient(135deg,#ffffff 0%,#e2e8f0 30%,#94a3b8 75%,#475569 100%)", text: "#0f172a", rim: "#f1f5f9", xlsxFill: "FFE2E8F0", xlsxFont: "FF0F172A" },
  B: { medal: "🥉 Competent", range: "7 pts", bg: "linear-gradient(135deg,#ffe4c4 0%,#e0995e 30%,#b4622a 75%,#6b3410 100%)", text: "#2a1204", rim: "#fcd9b6", xlsxFill: "FFE0995E", xlsxFont: "FF2A1204" },
  C: { medal: "⚙️ Developing", range: "5–6 pts", bg: "linear-gradient(135deg,#e0f2fe 0%,#7dd3fc 30%,#0369a1 80%,#0c4a6e 100%)", text: "#f0f9ff", rim: "#bae6fd", xlsxFill: "FF7DD3FC", xlsxFont: "FF0C4A6E" },
  D: { medal: "🛡️ Needs Attention", range: "4 pts or less", bg: "linear-gradient(135deg,#d4d4d8 0%,#71717a 40%,#3f3f46 80%,#18181b 100%)", text: "#fafafa", rim: "#a1a1aa", xlsxFill: "FFA1A1AA", xlsxFont: "FF18181B" },
};

/** The grade's name without its emoji ("Master", "Needs Attention", …). */
export const gradeName = (g: LetterGrade) => LETTER_META[g].medal.replace(/^\S+\s+/, "");

export function GradeMedal({ grade, size = "md" }: { grade: LetterGrade; size?: "sm" | "md" }) {
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
      title={`${meta.medal} (${meta.range})`}
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

export const fmtPoints =(p: number) => `${p > 0 ? `+${p}` : p < 0 ? `−${-p}` : "0"} pt${Math.abs(p) === 1 ? "" : "s"}`;
export const GRADE_SCALE: { factor: string; ranges: Record<Grade, string>; points?: Record<Grade, number> }[] = [
  { factor: "Average Tickets", ranges: { max: "10+", great: "7–9", median: "5–6", effort: "3–4", alert: "2 or less" } },
  { factor: "Total Ticket", ranges: { max: "90+", great: "71–89", median: "60–70", effort: "40–59", alert: "39 or less" } },
  { factor: "Redo %", ranges: { max: "2% or less", great: "4% or less", median: "6% or less", effort: "7–9%", alert: "10%+" }, points: CAPPED_GRADE_POINTS },
  { factor: "Working Days", ranges: { max: "13–14", great: "11–12", median: "10", effort: "8–9", alert: "7 or less" }, points: CAPPED_GRADE_POINTS },
  { factor: "Average Mileage", ranges: { max: "", great: "250+", median: "under 250", effort: "", alert: "" }, points: AVG_MILES_POINTS },
  { factor: "Average Hours", ranges: { max: "", great: "", median: "12 or less", effort: "over 12", alert: "" }, points: AVG_HOURS_POINTS },
];

export function GradePill({ grade, children }: { grade: Grade | null; children: ReactNode }) {
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
