import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, Loader2 } from "lucide-react";
import {
  GRADERS, GRADE_META, GradeMedal, fmtPayDate, gradeName, letterGrade, payPeriodsThrough,
  shortAvgHours, shortAvgMiles, shortDailyAvg, shortErrorCount, shortPoints, shortRedoPct, shortTotalTicket,
  type Grade,
} from "@/components/techPerformanceGrading";
import { getMyPerformance, getUncorrectedAutoClockOut, type MyPerformance } from "@/lib/supabase/myPerformance";

const fmt1 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
const fmtDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/**
 * Mobile Home → "My standing": the technician's own grade medal, points and
 * main factors (colored like the Technician Performance Report) for the
 * current pay period, their error count, and any meeting they still need.
 */
export function MyStandingCard({ profileId, today }: { profileId: string; today: string }) {
  const period = payPeriodsThrough(today).slice(-1)[0];
  const [data, setData] = useState<MyPerformance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMyPerformance(profileId, period.start, period.end)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load"); });
    return () => { cancelled = true; };
  }, [profileId, period.start, period.end]);

  const card = { background: "var(--mt-surface)", border: "1px solid var(--mt-surface-border)", borderRadius: 14 } as const;

  if (error) return null; // don't clutter Home if it can't load
  if (!data) {
    return (
      <div style={card} className="flex items-center gap-2 px-4 py-3 text-xs text-slate-300">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading my standing…
      </div>
    );
  }

  const points = shortPoints(data);
  const grade = letterGrade(points);
  const total = shortTotalTicket(data);
  const redo = shortRedoPct(data);
  const factors: { label: string; value: string; grade: Grade | null }[] = [
    { label: "Avg Tickets", value: fmt1(shortDailyAvg(data)), grade: GRADERS.dailyAvg(shortDailyAvg(data)) },
    { label: "Total Ticket", value: String(total), grade: GRADERS.totalTicket(total) },
    { label: "Redo %", value: `${fmt1(redo ?? 0)}%`, grade: GRADERS.redoPct(redo) },
    { label: "Working Days", value: String(data.daysWorked), grade: GRADERS.workingDays(data.daysWorked) },
    { label: "Avg Hours", value: fmt1(shortAvgHours(data)), grade: GRADERS.avgHours(shortAvgHours(data)) },
    { label: "Avg Mileage", value: fmt1(shortAvgMiles(data)), grade: GRADERS.avgMiles(shortAvgMiles(data)) },
  ];
  const errors = shortErrorCount(data);
  const openMeetings = data.meetings.filter((m) => m.status === "required");

  return (
    <div style={card} className="px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-300">My standing</span>
        <span className="text-[10px] text-slate-400">{fmtPayDate(period.start)} – {fmtPayDate(period.end)}</span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <GradeMedal grade={grade} />
        <div className="flex-1">
          <div className="text-base font-bold text-white">{gradeName(grade)}</div>
          <div className="text-xs text-slate-300">{points} point{points === 1 ? "" : "s"}</div>
        </div>
        <div className={`rounded-lg px-2.5 py-1 text-center ${errors > 0 ? "bg-red-500/15 text-red-300" : "bg-white/5 text-slate-300"}`}>
          <div className="text-base font-bold tabular-nums leading-tight">{errors}</div>
          <div className="text-[9px] uppercase tracking-wide">Errors</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {factors.map((f) => (
          <div key={f.label} className={`rounded-lg px-2 py-1.5 text-center ring-1 ring-inset ${f.grade ? GRADE_META[f.grade].pill : "bg-white/5 text-slate-200 ring-white/10"}`}>
            <div className="text-sm font-bold tabular-nums">{f.value}</div>
            <div className="text-[9px] uppercase tracking-wide opacity-80">{f.label}</div>
          </div>
        ))}
      </div>

      {openMeetings.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" /> Meeting required with your Branch Manager
          </div>
          <ul className="mt-1 space-y-0.5">
            {openMeetings.map((m) => (
              <li key={m.id}>
                {fmtDay(m.missedDate)} — {m.kind === "missed_time_out" ? "missed Time Out, not corrected in time" : "missed clock-in"}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-2 text-[10px] text-slate-400">From the numbers entered for this pay period. Some data can be incomplete — ask your manager if something looks wrong.</p>
    </div>
  );
}

/**
 * Mobile Home banner: the tech's last work day was closed by an automatic
 * clock-out and has no Time Correction yet — fix it before Time In, or it
 * becomes an error with a mandatory correction meeting.
 */
export function FixTimeOutBanner({ profileId, today, onFix }: { profileId: string; today: string; onFix: (date: string) => void }) {
  const [date, setDate] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getUncorrectedAutoClockOut(profileId, today).then((d) => { if (!cancelled) setDate(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [profileId, today]);
  if (!date) return null;
  return (
    <button
      type="button"
      onClick={() => onFix(date)}
      className="flex w-full items-center gap-3 rounded-[14px] border border-orange-400/40 bg-orange-500/15 px-4 py-3 text-left"
    >
      <AlertTriangle className="h-5 w-5 shrink-0 text-orange-300" />
      <div className="flex-1">
        <div className="text-sm font-semibold text-orange-100">Fix your Time Out for {fmtDay(date)}</div>
        <div className="text-[11px] text-orange-200/90">
          You didn't press Time Out — it was recorded automatically. Send a Time Correction before you Time In, or it becomes an error with a
          correction meeting. Maverick Team can help.
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-orange-200" />
    </button>
  );
}
