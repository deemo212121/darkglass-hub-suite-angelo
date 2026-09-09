/**
 * HR Dashboard "Interview Calendar" tab — every candidate currently in
 * "Interviewing" status, plotted on their interview_date (+ optional
 * interview_time, 0228) as a month grid. Read-only here — the date/time
 * itself is set from the Hiring table's Status dialog (ReportHRDaily.tsx);
 * this tab is just where HR sees them laid out on a calendar instead of
 * scanning down the Hiring table's Status column one row at a time.
 */
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react";

export interface InterviewCalendarCandidate {
  id: string;
  name: string;
  position: string | null;
  branch: string | null;
  phone: string | null;
  email: string | null;
  interviewDate: string; // "YYYY-MM-DD"
  interviewTime: string | null; // "HH:MM"
  interviewTimezone: "CST" | "EST" | null;
  interviewerName: string | null;
  notes: string | null;
}

/** "2:30 PM" + "CST" -> "2:30 PM CST"; falls back to "No time set" with no time. */
function formatInterviewTime(time: string | null, timezone: string | null): string {
  if (!time) return "No time set";
  return timezone ? `${formatHHMM(time)} ${timezone}` : formatHHMM(time);
}

interface Props {
  candidates: InterviewCalendarCandidate[];
  onGoToHiring: () => void;
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function addMonths(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "14:30" -> "2:30 PM" — interview_time is stored as plain 24h "HH:MM" text. */
function formatHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

export function InterviewCalendarTab({ candidates, onGoToHiring }: Props) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [detail, setDetail] = useState<InterviewCalendarCandidate | null>(null);

  const monthDate = useMemo(() => addMonths(new Date(), monthOffset), [monthOffset]);
  const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;

  // Sunday-first grid spanning full weeks, padded with the adjacent
  // months' days so every row has 7 cells.
  const weeks = useMemo(() => {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const start = new Date(year, month, 1);
    start.setDate(start.getDate() - start.getDay());
    const lastOfMonth = new Date(year, month + 1, 0);
    const end = new Date(lastOfMonth);
    end.setDate(end.getDate() + (6 - end.getDay()));

    const days: { date: Date; inMonth: boolean }[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      days.push({ date: new Date(d), inMonth: d.getMonth() === month });
    }
    const out: { date: Date; inMonth: boolean }[][] = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [monthDate]);

  const byDate = useMemo(() => {
    const map = new Map<string, InterviewCalendarCandidate[]>();
    for (const c of candidates) {
      const list = map.get(c.interviewDate) ?? [];
      list.push(c);
      map.set(c.interviewDate, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.interviewTime || "99:99").localeCompare(b.interviewTime || "99:99"));
    }
    return map;
  }, [candidates]);

  const monthCandidateCount = useMemo(
    () => candidates.filter((c) => c.interviewDate.slice(0, 7) === monthKey).length,
    [candidates, monthKey]
  );

  const todayStr = toDateStr(new Date());

  return (
    <div className="panel p-0 overflow-hidden">
      <div className="px-4 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-sm flex items-center gap-1.5">
            <CalendarIcon className="h-4 w-4 text-blue-300" /> Interview Calendar
          </h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Every candidate currently Interviewing, laid out on their scheduled date and time. Click a name for details.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setMonthOffset((o) => o - 1)} className="btn text-xs px-2 py-1.5">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs font-medium min-w-[9rem] text-center">
            {monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </span>
          <button type="button" onClick={() => setMonthOffset((o) => o + 1)} className="btn text-xs px-2 py-1.5">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          {monthOffset !== 0 && (
            <button type="button" onClick={() => setMonthOffset(0)} className="btn text-xs px-2.5 py-1.5">
              Today
            </button>
          )}
        </div>
      </div>

      <div className="px-4 py-2 border-b border-white/10 text-xs text-muted-foreground">
        {monthCandidateCount} interview{monthCandidateCount === 1 ? "" : "s"} scheduled this month
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs min-w-[640px]">
          <thead>
            <tr>
              {DOW_LABELS.map((d) => (
                <th key={d} className="border-b border-white/10 px-2 py-1.5 text-left font-semibold text-muted-foreground w-[14.28%]">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => (
              <tr key={wi}>
                {week.map(({ date, inMonth }) => {
                  const dateStr = toDateStr(date);
                  const items = byDate.get(dateStr) ?? [];
                  return (
                    <td
                      key={dateStr}
                      className={`align-top border border-white/5 min-h-28 h-auto p-1 ${inMonth ? "" : "bg-black/20"} ${
                        dateStr === todayStr ? "bg-blue-500/10" : ""
                      }`}
                    >
                      <div className={`text-[10px] mb-1 ${inMonth ? "text-muted-foreground" : "text-muted-foreground/40"}`}>{date.getDate()}</div>
                      {/* Earliest interview of the day first — items is
                          already sorted by interviewTime (byDate above),
                          no-time entries pushed to the end. */}
                      <div className="flex flex-col gap-1">
                        {items.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setDetail(c)}
                            className="text-left text-[10px] leading-tight px-1.5 py-1 rounded bg-yellow-500/20 text-yellow-100 hover:bg-yellow-500/30 space-y-0.5"
                          >
                            <div className="truncate">
                              <span className="text-yellow-200/70">Name:</span> {c.name}
                            </div>
                            <div className="truncate">
                              <span className="text-yellow-200/70">Branch:</span> {c.branch || "—"}
                            </div>
                            <div className="truncate">
                              <span className="text-yellow-200/70">Interviewer:</span> {c.interviewerName || "—"}
                            </div>
                            <div className="truncate">
                              <span className="text-yellow-200/70">Time for the Interview:</span> {formatInterviewTime(c.interviewTime, c.interviewTimezone)}
                            </div>
                            <div className="truncate">
                              <span className="text-yellow-200/70">Status:</span> Interviewing
                            </div>
                          </button>
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {candidates.length === 0 && (
          <div className="px-3 py-6 text-center text-muted-foreground text-xs">No candidates currently Interviewing.</div>
        )}
      </div>

      {detail &&
        createPortal(
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
            <div className="panel w-full max-w-sm p-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">{detail.name}</h3>
                <button type="button" onClick={() => setDetail(null)} className="text-muted-foreground hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-1.5 text-sm">
                <p>
                  <span className="text-muted-foreground">Interview:</span>{" "}
                  {new Date(detail.interviewDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                  {detail.interviewTime ? ` at ${formatHHMM(detail.interviewTime)}${detail.interviewTimezone ? ` ${detail.interviewTimezone}` : ""}` : ""}
                </p>
                {detail.position && (
                  <p>
                    <span className="text-muted-foreground">Position:</span> {detail.position}
                  </p>
                )}
                {detail.branch && (
                  <p>
                    <span className="text-muted-foreground">Branch:</span> {detail.branch}
                  </p>
                )}
                {detail.interviewerName && (
                  <p>
                    <span className="text-muted-foreground">Interviewer:</span> {detail.interviewerName}
                  </p>
                )}
                {detail.phone && (
                  <p>
                    <span className="text-muted-foreground">Phone:</span> {detail.phone}
                  </p>
                )}
                {detail.email && (
                  <p>
                    <span className="text-muted-foreground">Email:</span> {detail.email}
                  </p>
                )}
                {detail.notes && (
                  <p>
                    <span className="text-muted-foreground">Notes:</span> {detail.notes}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 pt-3">
                <button type="button" onClick={onGoToHiring} className="btn text-xs px-3 py-1.5">
                  Go to Hiring
                </button>
                <button type="button" onClick={() => setDetail(null)} className="btn text-xs px-3 py-1.5">
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
