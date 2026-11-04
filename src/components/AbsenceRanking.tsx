/**
 * Absences — Absent List → PTO Management's fourth button (next to PTO
 * Usage): everyone ranked by how many days they were absent in a period,
 * most first, counted from the HR Status HR sets on the Absent List.
 *
 * A day counts only if it would still be on the Absent List today — no
 * clock-in (a trainee's punch still awaiting approval counts as one), not on
 * approved leave, not a scheduled rest day, not a company holiday, and not
 * before the person's attendance start date — so an old mark left on a day
 * that was later corrected (a clock-in added, leave approved) doesn't count.
 * About 1,500 "Absent" marks were saved in bulk on Sep 11–12 2026 (they
 * look like the earlier auto-save), half of them on days the person had
 * clocked in; this rule keeps those out.
 *
 *   Unnoticed → "Unnoticed" and its old label "Absent" (no-call / no-show)
 *   Unpaid    → "Unpaid"
 *   Sick      → "Sick"
 *   Other     → "Personal", "Vacation", "Holiday", "Bereavement"
 *
 * Present (No Clock-In), Admin, Not yet Started, Resigned and Terminated
 * aren't absences, and a day nobody has given an HR Status yet isn't counted
 * (many of those are office staff who never clock in).
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2 } from "lucide-react";
import { useColumnFunnels } from "@/hooks/useColumnFunnels";
import type { ProfileRow } from "@/lib/supabase/users";
import { getRoleDepartmentBreakdown } from "@/lib/roleLabels";
import { addDaysISO, todayISO } from "@/lib/localDate";
import { getAttendanceNotes, type AttendanceNoteRow } from "@/lib/supabase/attendanceNotes";
import { getCompanyTimecardEntries } from "@/lib/supabase/timecards";
import { getCompanyTraineeEntries } from "@/lib/supabase/traineeTimecards";
import { getCompanyHolidaysInRange } from "@/lib/supabase/companyHolidays";
import { getRestDayHistory } from "@/lib/supabase/restDayHistory";
import { isRestDayOn, type RestDayHistory } from "@/lib/restDays";
import { getAttendanceStartByProfile } from "@/lib/supabase/attendanceStart";
import { isBeforeAttendanceStart } from "@/lib/attendanceStart";
import type { PtoRequestRow } from "@/lib/supabase/pto";

type Cat = "unnoticed" | "unpaid" | "sick" | "other";
type RankBy = "all" | Cat;
type Preset = "month" | "30d" | "year" | "custom";

const CAT_OF_STATUS: Record<string, Cat> = {
  Unnoticed: "unnoticed",
  Absent: "unnoticed",
  Unpaid: "unpaid",
  Sick: "sick",
  Personal: "other",
  Vacation: "other",
  Holiday: "other",
  Bereavement: "other",
};

const CATS: { key: Cat; label: string; text: string; chip: string }[] = [
  { key: "unnoticed", label: "Unnoticed", text: "text-red-300", chip: "border-red-500/30 bg-red-500/5" },
  { key: "unpaid", label: "Unpaid", text: "text-orange-300", chip: "border-orange-500/30 bg-orange-500/5" },
  { key: "sick", label: "Sick", text: "text-pink-300", chip: "border-pink-500/30 bg-pink-500/5" },
  { key: "other", label: "Other", text: "text-slate-200", chip: "border-white/10 bg-white/5" },
];

const RANK_BY: { key: RankBy; label: string }[] = [
  { key: "all", label: "All absences" },
  { key: "unnoticed", label: "Unnoticed" },
  { key: "unpaid", label: "Unpaid" },
  { key: "sick", label: "Sick" },
];

const PRESETS: { key: Preset; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "30d", label: "Last 30 days" },
  { key: "year", label: "This year" },
  { key: "custom", label: "Custom" },
];

const fmtDate = (iso: string | null | undefined, withWeekday = false) => {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { ...(withWeekday ? { weekday: "short" as const } : {}), month: "short", day: "numeric", year: "numeric" });
};

interface AbsentDay {
  date: string;
  status: string;
  cat: Cat;
  note: string;
}

interface AbsenceRow {
  profile: ProfileRow;
  name: string;
  department: string;
  branch: string;
  counts: Record<Cat, number>;
  total: number;
  last: string | null;
  days: AbsentDay[];
  rank: number;
}

type SortKey = "rank" | "name" | "department" | "branch" | Cat | "total" | "last";

const metric = (r: AbsenceRow, by: RankBy) => (by === "all" ? r.total : r.counts[by]);

export function AbsenceRanking({ profiles, requests }: { profiles: ProfileRow[]; requests: PtoRequestRow[] }) {
  const today = todayISO();
  const [preset, setPreset] = useState<Preset>("year");
  const [range, setRange] = useState({ from: `${today.slice(0, 4)}-01-01`, to: today });
  const [rankBy, setRankBy] = useState<RankBy>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "rank", dir: "asc" });
  const [detail, setDetail] = useState<AbsenceRow | null>(null);

  const pickPreset = (p: Preset) => {
    setPreset(p);
    if (p === "month") setRange({ from: `${today.slice(0, 7)}-01`, to: today });
    else if (p === "30d") setRange({ from: addDaysISO(today, -29), to: today });
    else if (p === "year") setRange({ from: `${today.slice(0, 4)}-01-01`, to: today });
  };
  const validRange = !!range.from && !!range.to && range.from <= range.to;

  // Per-day data for the period: HR Statuses, clock-ins and company holidays.
  const [data, setData] = useState<{
    notes: AttendanceNoteRow[];
    checkedIn: Set<string>;
    holidays: Set<string>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!validRange) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getAttendanceNotes(range.from, range.to),
      getCompanyTimecardEntries(range.from, range.to),
      getCompanyTraineeEntries(range.from, range.to).catch(() => []),
      getCompanyHolidaysInRange(range.from, range.to),
    ])
      .then(([notes, entries, trainee, hol]) => {
        if (cancelled) return;
        setData({
          notes,
          checkedIn: new Set([
            ...entries.filter((e) => e.checkIn).map((e) => `${e.profileId}|${e.workDate}`),
            ...trainee.filter((t) => t.status === "pending" && t.checkIn).map((t) => `${t.profileId}|${t.workDate}`),
          ]),
          holidays: new Set(hol.map((h) => h.date)),
        });
      })
      .catch((err) => console.error("Absences ranking: load failed", err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range.from, range.to, validRange]);

  // Rest-day schedules and attendance start dates — same exclusions the Absent List uses.
  const [restHistory, setRestHistory] = useState<RestDayHistory>(new Map());
  useEffect(() => {
    getRestDayHistory().then(setRestHistory).catch(() => {});
  }, []);
  const profileKey = profiles.map((p) => p.id).join(",");
  const [startById, setStartById] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    let cancelled = false;
    getAttendanceStartByProfile(profiles)
      .then((m) => { if (!cancelled) setStartById(m); })
      .catch(() => { if (!cancelled) setStartById(new Map()); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileKey]);

  const approvedLeaveByProfile = useMemo(() => {
    const map = new Map<string, PtoRequestRow[]>();
    for (const r of requests) {
      if (r.status !== "approved") continue;
      const list = map.get(r.profileId);
      if (list) list.push(r); else map.set(r.profileId, [r]);
    }
    return map;
  }, [requests]);

  const rows = useMemo<AbsenceRow[]>(() => {
    if (!data || !startById) return [];
    const daysByProfile = new Map<string, AbsentDay[]>();
    const byId = new Map(profiles.map((p) => [p.id, p]));
    for (const n of data.notes) {
      const cat = CAT_OF_STATUS[n.hrNote];
      const p = byId.get(n.profileId);
      if (!cat || !p) continue;
      const d = n.noteDate;
      if (d < range.from || d > range.to || d > today) continue;
      if (data.checkedIn.has(`${p.id}|${d}`)) continue; // clocked in that day
      if (data.holidays.has(d)) continue; // company holiday
      if (isRestDayOn(restHistory, p.id, d, p.off_days)) continue; // scheduled rest day
      if (isBeforeAttendanceStart(d, startById.get(p.id))) continue; // hadn't started yet
      if ((approvedLeaveByProfile.get(p.id) ?? []).some((r) => r.startDate <= d && d <= r.endDate)) continue; // approved leave
      const list = daysByProfile.get(p.id);
      const day = { date: d, status: n.hrNote, cat, note: n.content };
      if (list) list.push(day); else daysByProfile.set(p.id, [day]);
    }
    const built: AbsenceRow[] = profiles.map((p) => {
      const days = (daysByProfile.get(p.id) ?? []).sort((a, b) => b.date.localeCompare(a.date));
      const counts: Record<Cat, number> = { unnoticed: 0, unpaid: 0, sick: 0, other: 0 };
      for (const d of days) counts[d.cat]++;
      return {
        profile: p,
        name: p.display_name || p.email || "—",
        department: p.department || getRoleDepartmentBreakdown(p.role).department,
        branch: p.assigned_branch || "—",
        counts,
        total: days.length,
        last: days[0]?.date ?? null,
        days,
        rank: 0,
      };
    });
    // Most days of the chosen kind first, then most absences overall, then most Unnoticed.
    built.sort(
      (a, b) =>
        metric(b, rankBy) - metric(a, rankBy) ||
        b.total - a.total ||
        b.counts.unnoticed - a.counts.unnoticed ||
        a.name.localeCompare(b.name)
    );
    built.forEach((r, i) => { r.rank = i + 1; });
    return built;
  }, [data, startById, profiles, restHistory, approvedLeaveByProfile, range.from, range.to, today, rankBy]);

  const sorted = useMemo(() => {
    const val = (r: AbsenceRow): string | number => {
      switch (sort.key) {
        case "rank": return r.rank;
        case "name": return r.name.toLowerCase();
        case "department": return r.department.toLowerCase();
        case "branch": return r.branch.toLowerCase();
        case "total": return r.total;
        case "last": return r.last ?? "";
        default: return r.counts[sort.key];
      }
    };
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return c * dir || a.rank - b.rank;
    });
  }, [rows, sort]);

  const funnels = useColumnFunnels(sorted, {
    Employee: (r) => r.name,
    Department: (r) => r.department,
    Branch: (r) => r.branch,
    Unnoticed: (r) => String(r.counts.unnoticed),
    Unpaid: (r) => String(r.counts.unpaid),
    Sick: (r) => String(r.counts.sick),
    Other: (r) => String(r.counts.other),
    Total: (r) => String(r.total),
    "Last Absent": (r) => fmtDate(r.last),
  }, (r) => r.profile.id);

  const shown = funnels.visible;
  const totals = shown.reduce(
    (t, r) => ({ unnoticed: t.unnoticed + r.counts.unnoticed, unpaid: t.unpaid + r.counts.unpaid, sick: t.sick + r.counts.sick, other: t.other + r.counts.other, total: t.total + r.total }),
    { unnoticed: 0, unpaid: 0, sick: 0, other: 0, total: 0 }
  );
  const withAbsences = shown.filter((r) => r.total > 0).length;

  const toggleSort = (key: SortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" || key === "department" || key === "branch" || key === "rank" ? "asc" : "desc" }));

  const header = (label: string, key: SortKey, align: "left" | "right" | "center" = "left", funnel = true): ReactNode => {
    const active = sort.key === key;
    const rankCol = key === rankBy || (key === "total" && rankBy === "all");
    const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th key={label} className={`px-3 py-3 text-xs font-semibold uppercase whitespace-nowrap ${rankCol ? "text-slate-200" : "text-slate-400"} ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"}`} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <span className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
          <button type="button" onClick={() => toggleSort(key)} className={`inline-flex items-center gap-1 uppercase hover:text-white ${active ? "text-blue-300" : ""}`} title={`Sort by ${label}`}>
            {label}
            <Icon className="h-3 w-3" />
          </button>
          {funnel && funnels.funnel(label)}
        </span>
      </th>
    );
  };

  const statusText = (cat: Cat) => CATS.find((c) => c.key === cat)!.text;
  const ready = !!data && !!startById;

  return (
    <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-white">Absences</h2>
        <div className="flex flex-wrap items-center gap-2">
          {funnels.activeCount > 0 && (
            <button type="button" onClick={funnels.clear} className="rounded-md border border-blue-400/30 bg-blue-500/10 px-2 py-1 text-[11px] font-semibold text-blue-200 hover:bg-blue-500/20">
              Clear column filters ({funnels.activeCount})
            </button>
          )}
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Rank by</span>
          <div className="inline-flex rounded-lg border border-white/10 bg-slate-800/40 p-0.5" role="tablist" aria-label="Which absences to rank">
            {RANK_BY.map((k) => (
              <button
                key={k.key}
                type="button"
                role="tab"
                aria-selected={rankBy === k.key}
                onClick={() => { setRankBy(k.key); setSort({ key: "rank", dir: "asc" }); }}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition ${rankBy === k.key ? "bg-white/10 text-blue-300" : "text-slate-400 hover:text-white"}`}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Days HR marked on the Absent List that are still absences: no clock-in, not approved leave, a rest day or a company holiday.{" "}
        <span className="text-slate-500">
          Unnoticed includes the old “Absent” label · Other = Personal, Vacation, Holiday, Bereavement · Present (No Clock-In), Admin, Not yet Started, Resigned, Terminated and days with no HR Status yet aren't counted.
        </span>
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Period</span>
        <div className="inline-flex rounded-lg border border-white/10 bg-slate-800/40 p-0.5" role="tablist" aria-label="Period">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={preset === p.key}
              onClick={() => pickPreset(p.key)}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition ${preset === p.key ? "bg-white/10 text-blue-300" : "text-slate-400 hover:text-white"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs text-slate-400">
          From
          <input type="date" value={range.from} max={today} onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, from: e.target.value })); }} className="glass-input" />
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-slate-400">
          To
          <input type="date" value={range.to} max={today} onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, to: e.target.value })); }} className="glass-input" />
        </label>
        {!validRange && <span className="text-xs text-red-300">Pick a From date on or before the To date.</span>}
        {loading && ready && <span className="inline-flex items-center gap-1 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating…</span>}
      </div>

      {!ready ? (
        <div className="flex items-center gap-2 py-8 justify-center text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading absences…</div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-xs tabular-nums">
            <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300">
              {withAbsences} of {shown.length} {shown.length === 1 ? "person" : "people"} absent
            </span>
            {CATS.map((c) => (
              <span key={c.key} className={`rounded-md border px-2.5 py-1 ${c.chip}`}>
                <span className="text-slate-400">{c.label}</span> <b className={c.text}>{totals[c.key]}</b> days
              </span>
            ))}
            <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1"><span className="text-slate-400">Total</span> <b className="text-white">{totals.total}</b> days</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  {header("#", "rank", "center", false)}
                  {header("Employee", "name")}
                  {header("Department", "department")}
                  {header("Branch", "branch")}
                  {CATS.map((c) => <Fragment key={c.key}>{header(c.label, c.key, "right")}</Fragment>)}
                  {header("Total", "total", "right")}
                  {header("Last Absent", "last")}
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">{rows.length === 0 ? "No employees to show." : "Nobody matches the column filters."}</td></tr>
                ) : (
                  shown.map((r) => (
                    <tr key={r.profile.id} className={`border-b border-white/5 hover:bg-white/5 ${r.total === 0 ? "opacity-50" : ""}`}>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums ${r.rank <= 3 && metric(r, rankBy) > 0 ? "bg-blue-500/20 text-blue-200" : "text-slate-500"}`}>{r.rank}</span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {r.total > 0 ? (
                          <button type="button" onClick={() => setDetail(r)} className="font-semibold text-white underline-offset-2 hover:text-blue-300 hover:underline" title="See each absent day">
                            {r.name}
                          </button>
                        ) : (
                          <span className="font-semibold text-white">{r.name}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-300">{r.department}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-300">{r.branch}</td>
                      {CATS.map((c) => (
                        <td key={c.key} className={`px-3 py-2.5 text-right tabular-nums ${r.counts[c.key] ? c.text : "text-slate-600"} ${c.key === rankBy ? "font-bold" : ""}`}>{r.counts[c.key]}</td>
                      ))}
                      <td className={`px-3 py-2.5 text-right tabular-nums ${r.total ? "text-white" : "text-slate-600"} ${rankBy === "all" ? "font-bold" : ""}`}>{r.total}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-slate-400">{fmtDate(r.last)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDetail(null)} onKeyDown={(e) => { if (e.key === "Escape") setDetail(null); }}>
          <div role="dialog" aria-modal="true" aria-label={`${detail.name} — absences`} className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-white/10 bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-white">{detail.name}</h3>
                <p className="text-xs text-slate-400">
                  Absences · {detail.department} · {detail.branch} · {fmtDate(range.from)} – {fmtDate(range.to)}
                </p>
              </div>
              <button type="button" autoFocus onClick={() => setDetail(null)} className="text-xl leading-none text-slate-400 hover:text-white" aria-label="Close">×</button>
            </div>
            <div className="space-y-3 overflow-y-auto px-5 py-4">
              <div className="flex flex-wrap gap-2 text-xs tabular-nums">
                {CATS.map((c) => (
                  <span key={c.key} className={`rounded-md border px-2.5 py-1 ${c.chip}`}>
                    <span className="text-slate-400">{c.label}</span> <b className={c.text}>{detail.counts[c.key]}</b>
                  </span>
                ))}
                <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1"><span className="text-slate-400">Total</span> <b className="text-white">{detail.total}</b></span>
              </div>
              <div className="overflow-x-auto rounded-md border border-white/10">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      {["Date", "HR Status", "Note"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-400 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.days.map((d) => (
                      <tr key={d.date} className="border-b border-white/5 align-top">
                        <td className="px-3 py-2 whitespace-nowrap text-slate-200">{fmtDate(d.date, true)}</td>
                        <td className={`px-3 py-2 whitespace-nowrap font-semibold ${statusText(d.cat)}`}>{d.status}</td>
                        <td className="px-3 py-2 text-slate-300 whitespace-pre-wrap break-words">{d.note || <span className="text-slate-600">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
