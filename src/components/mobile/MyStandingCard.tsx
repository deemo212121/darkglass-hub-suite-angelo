import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2 } from "lucide-react";
import {
  GRADERS, GRADE_META, GradeMedal, LETTER_META, fmtPayDate, gradeName, letterGrade, payPeriodsThrough,
  shortAvgHours, shortAvgMiles, shortDailyAvg, shortErrorCount, shortPoints, shortRedoPct, shortTotalTicket,
  type Grade,
} from "@/components/techPerformanceGrading";
import { getMyPerformance, getUncorrectedAutoClockOut, type MyPerformance } from "@/lib/supabase/myPerformance";

const EXPANDED_KEY = "ahs:mobile-standing-expanded";
const fmt1 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
const fmtDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/**
 * Mobile Home → "My standing": the technician's own grade medal, points and
 * main factors (colored like the Technician Performance Report), their
 * error count, and any meeting they still need. Opens on the last COMPLETED
 * pay period (the current one is only partly in); swipe or use the arrows
 * to move between pay periods, from the first one up to the current one.
 */
export function MyStandingCard({ profileId, today }: { profileId: string; today: string }) {
  const periods = payPeriodsThrough(today);
  const lastIdx = periods.length - 1;
  // Start on the most recent pay period that has already ended — e.g.
  // 09/13–09/26 while 09/27–10/10 is still running.
  const completedIdx = periods.map((p) => p.end < today).lastIndexOf(true);
  const [idx, setIdx] = useState(completedIdx >= 0 ? completedIdx : lastIdx);
  // Collapsed to just the rank by default; remembered on this phone.
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(EXPANDED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = (open: boolean) => {
    setExpanded(open);
    try {
      localStorage.setItem(EXPANDED_KEY, open ? "1" : "0");
    } catch {
      /* private mode — just don't remember */
    }
  };
  const period = periods[Math.min(idx, lastIdx)];
  const isCurrent = period.end >= today;
  const label = isCurrent ? "Current pay period" : idx === completedIdx ? "Last pay period" : "Pay period";

  // The last loaded period stays on screen (dimmed) while the next one loads.
  const [loaded, setLoaded] = useState<{ key: string; data: MyPerformance } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${period.start}|${period.end}`;
  const loading = loaded?.key !== key;
  const data = loaded?.data ?? null;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getMyPerformance(profileId, period.start, period.end)
      .then((d) => { if (!cancelled) setLoaded({ key: `${period.start}|${period.end}`, data: d }); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load"); });
    return () => { cancelled = true; };
  }, [profileId, period.start, period.end]);

  const older = () => setIdx((i) => Math.max(0, i - 1));
  const newer = () => setIdx((i) => Math.min(lastIdx, i + 1));
  // Swipe left = newer, swipe right = older. Only a clearly sideways swipe
  // counts, so scrolling Home up/down never flips the pay period.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) newer();
    else older();
  };

  if (error && !data) return null; // don't clutter Home if it can't load
  if (!data) {
    return (
      <div className="mh-card flex items-center gap-2 text-xs text-slate-300">
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

  const rankRow = (
    <div className="mh-standing-hero flex items-center gap-3" style={{ ["--g" as string]: LETTER_META[grade].rim }}>
      <span className="mh-medal">
        <GradeMedal grade={grade} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-bold text-white">{gradeName(grade)}</div>
        <div className="truncate text-xs text-slate-300">
          {points} point{points === 1 ? "" : "s"}
        </div>
      </div>
      <div className={`mh-metric rounded-2xl px-3 py-1.5 text-center ${errors > 0 ? "bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-400/30" : "bg-white/5 text-slate-300"}`}>
        <div className="text-base font-bold tabular-nums leading-tight">{errors}</div>
        <div className="text-[9px] uppercase tracking-wide">Errors</div>
      </div>
    </div>
  );

  // Title + pay period picker — the same in both states.
  const header = (
    <div className="flex items-center justify-between gap-2">
      <span className="mh-card-title">My standing</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={older} disabled={idx === 0} aria-label="Previous pay period" className="-m-2 rounded-md p-3 text-slate-300 disabled:opacity-30">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-right leading-tight">
          <div className={`text-[10px] font-semibold ${isCurrent ? "text-sky-300" : "text-slate-300"}`}>{label}</div>
          <div className="text-[10px] text-slate-400">{fmtPayDate(period.start)} – {fmtPayDate(period.end)}</div>
        </div>
        <button type="button" onClick={newer} disabled={idx >= lastIdx} aria-label="Next pay period" className="-m-2 rounded-md p-3 text-slate-300 disabled:opacity-30">
          <ChevronRight className="h-4 w-4" />
        </button>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
      </div>
    </div>
  );

  // Collapsed (default): the pay period picker and the rank, plus a one-line meeting warning when there is one.
  if (!expanded) {
    return (
      <div className="mh-card" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {header}
        {error && <p className="mt-1 text-[10px] text-red-300">Couldn't load this pay period.</p>}
        <div className={`mt-2.5 ${loading ? "opacity-50 transition-opacity" : "transition-opacity"}`}>{rankRow}</div>
        {openMeetings.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-red-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Meeting required with your Branch Manager
          </div>
        )}
        <button type="button" className="mh-expand" onClick={() => toggle(true)} aria-expanded={false}>
          Show full details <ChevronDown className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="mh-card" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {header}
      {error && <p className="mt-1 text-[10px] text-red-300">Couldn't load this pay period.</p>}
      <div className={loading ? "opacity-50 transition-opacity" : "transition-opacity"}>

      <div className="mt-3">{rankRow}</div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {factors.map((f) => (
          <div key={f.label} className={`mh-metric rounded-2xl px-2 py-2 text-center ring-1 ring-inset ${f.grade ? GRADE_META[f.grade].pill : "bg-white/5 text-slate-200 ring-white/10"}`}>
            <div className="text-sm font-bold tabular-nums">{f.value}</div>
            <div className="text-[9px] uppercase tracking-wide opacity-80">{f.label}</div>
          </div>
        ))}
      </div>

      {openMeetings.length > 0 && (
        <div className="mt-3 rounded-2xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" /> Meeting required with your Branch Manager
          </div>
          <ul className="mt-1 space-y-0.5">
            {openMeetings.map((m) => (
              <li key={m.id}>
                {fmtDay(m.missedDate)} — {m.kind === "missed_time_out" ? "missed Time Out, not corrected in time" : "no clock-in by 10 AM"}
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>
      <p className="mt-2 text-[10px] text-slate-400">{isCurrent ? "This pay period is still running, so the numbers will change." : "From the numbers entered for this pay period."} Some data can be incomplete — ask your manager if something looks wrong.</p>
      <button type="button" className="mh-expand" onClick={() => toggle(false)} aria-expanded>
        Hide details <ChevronUp className="h-4 w-4" />
      </button>
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
      className="mh-card mh-card--warn flex w-full items-center gap-3 text-left"
    >
      <span className="mh-icon-tile mh-icon-tile--warn" aria-hidden>
        <AlertTriangle />
      </span>
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
