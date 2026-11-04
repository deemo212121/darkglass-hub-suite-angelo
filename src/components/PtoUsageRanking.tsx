/**
 * PTO Usage — Absent List → PTO Management's third button (next to Paid
 * Leave / Unpaid Leave): everyone ranked by how much leave they've used in
 * their current leave year, most first. "Rank by" switches the leave kind:
 *   PTO (Paid)  → Vacation, against their PTO allowance (ptoYearWindow — from
 *                 the Master List Hire Date, after 1 year of tenure);
 *   Unpaid      → Personal / Unpaid / Holiday / Bereavement, no allowance,
 *                 counted in their hire-anniversary year (from day 1);
 *   Sick Leave  → Sick, against the flat 5-day Sick Leave allowance.
 * Same counting as Self Service, except "Used" here is approved leave that
 * has already started and "Approved" is approved leave still to come — the
 * two together are what Self Service deducts.
 */
import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2 } from "lucide-react";
import { useColumnFunnels } from "@/hooks/useColumnFunnels";
import { usePtoHireDates } from "@/components/PtoBalanceSummary";
import type { ProfileRow } from "@/lib/supabase/users";
import { getRoleDepartmentBreakdown } from "@/lib/roleLabels";
import { localISODate, todayISO } from "@/lib/localDate";
import {
  ptoYearWindow,
  ptoRequestsInYear,
  ptoEligibleDate,
  sickYearWindow,
  sickRequestsInYear,
  type PtoRequestRow,
  type PtoType,
} from "@/lib/supabase/pto";

type Kind = "paid" | "unpaid" | "sick";

const KINDS: { key: Kind; label: string; note: string }[] = [
  { key: "paid", label: "PTO (Paid)", note: "Vacation days, against each person's PTO allowance for their PTO year (from their hire date; eligible after 1 year)." },
  { key: "unpaid", label: "Unpaid", note: "Personal, Unpaid, Holiday and Bereavement days in each person's leave year (from their hire date). No allowance." },
  { key: "sick", label: "Sick Leave", note: "Sick days against the 5-day Sick Leave allowance for each person's leave year (from their hire date)." },
];

const UNPAID_TYPES: PtoType[] = ["personal", "unpaid", "holiday", "bereavement"];

const TYPE_LABEL: Record<PtoType, string> = {
  vacation: "Vacation",
  sick: "Sick",
  personal: "Personal",
  holiday: "Holiday",
  unpaid: "Unpaid",
  bereavement: "Bereavement",
};

const days = (r: Pick<PtoRequestRow, "hoursRequested">) => r.hoursRequested / 8;
const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
/** The window's last day ("end" is the next anniversary, exclusive). */
const lastDayOf = (endExclusive: string) => {
  const d = new Date(`${endExclusive}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return localISODate(d);
};

interface UsageRow {
  profile: ProfileRow;
  name: string;
  department: string;
  branch: string;
  /** null = not eligible for this kind yet (PTO under 1 year) or no hire date on file. */
  window: { start: string; end: string } | null;
  allowance: number | null;
  eligibleOn: string | null;
  used: number;
  approved: number;
  pending: number;
  left: number | null;
  rank: number;
}

type SortKey = "rank" | "name" | "department" | "branch" | "used" | "approved" | "pending" | "left" | "year";

export function PtoUsageRanking({ profiles, requests }: { profiles: ProfileRow[]; requests: PtoRequestRow[] }) {
  const [kind, setKind] = useState<Kind>("paid");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "rank", dir: "asc" });
  const [detail, setDetail] = useState<UsageRow | null>(null);
  const [detailAllYears, setDetailAllYears] = useState(false);

  const profileRefs = useMemo(() => profiles.map((p) => ({ profileId: p.id })), [profiles]);
  const hireDates = usePtoHireDates(profileRefs);
  const today = todayISO();

  const requestsByProfile = useMemo(() => {
    const map = new Map<string, PtoRequestRow[]>();
    for (const r of requests) {
      const list = map.get(r.profileId);
      if (list) list.push(r); else map.set(r.profileId, [r]);
    }
    return map;
  }, [requests]);

  /** This person's requests of the chosen kind inside a window (denied / cancelled left out). */
  const inWindow = (mine: PtoRequestRow[], window: { start: string; end: string }, k: Kind) =>
    k === "paid"
      ? ptoRequestsInYear(mine, window)
      : k === "sick"
      ? sickRequestsInYear(mine, window)
      : mine.filter((r) => UNPAID_TYPES.includes(r.ptoType) && r.status !== "denied" && r.status !== "cancelled" && r.startDate >= window.start && r.startDate < window.end);

  const rows = useMemo<UsageRow[]>(() => {
    if (!hireDates) return [];
    const built = profiles.map((p) => {
      const hire = hireDates.get(p.id) ?? null;
      const mine = requestsByProfile.get(p.id) ?? [];
      const w = kind === "paid" ? ptoYearWindow(hire, p.created_at ?? null, today) : sickYearWindow(hire, p.created_at ?? null, today);
      const inYear = w ? inWindow(mine, w, kind) : [];
      const approvedRows = inYear.filter((r) => r.status === "approved");
      const used = approvedRows.filter((r) => r.startDate <= today).reduce((s, r) => s + days(r), 0);
      const approved = approvedRows.filter((r) => r.startDate > today).reduce((s, r) => s + days(r), 0);
      const pending = inYear.filter((r) => r.status === "pending").reduce((s, r) => s + days(r), 0);
      const allowance = w && kind !== "unpaid" ? w.allowance : null;
      return {
        profile: p,
        name: p.display_name || p.email || "—",
        department: p.department || getRoleDepartmentBreakdown(p.role).department,
        branch: p.assigned_branch || "—",
        window: w ? { start: w.start, end: w.end } : null,
        allowance,
        eligibleOn: kind === "paid" && !w ? ptoEligibleDate(hire, p.created_at ?? null) : null,
        used,
        approved,
        pending,
        left: allowance === null ? null : Math.max(0, allowance - used - approved),
        rank: 0,
      };
    });
    // Ranking: most used first, then most approved / pending; not eligible last.
    built.sort(
      (a, b) =>
        Number(!!b.window) - Number(!!a.window) ||
        b.used - a.used ||
        b.approved - a.approved ||
        b.pending - a.pending ||
        a.name.localeCompare(b.name)
    );
    built.forEach((r, i) => { r.rank = i + 1; });
    return built;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, hireDates, requestsByProfile, kind, today]);

  const yearLabel = (r: UsageRow) =>
    r.window ? `${fmtDate(r.window.start)} – ${fmtDate(lastDayOf(r.window.end))}` : r.eligibleOn ? `Eligible ${fmtDate(r.eligibleOn)}` : "No hire date";
  const leftLabel = (r: UsageRow) => (!r.window ? "Not eligible yet" : r.left === null ? "—" : `${fmtDays(r.left)} / ${fmtDays(r.allowance ?? 0)}`);

  const sorted = useMemo(() => {
    const val = (r: UsageRow): string | number => {
      switch (sort.key) {
        case "rank": return r.rank;
        case "name": return r.name.toLowerCase();
        case "department": return r.department.toLowerCase();
        case "branch": return r.branch.toLowerCase();
        case "used": return r.used;
        case "approved": return r.approved;
        case "pending": return r.pending;
        case "left": return r.left ?? -1;
        case "year": return r.window?.start ?? "9999";
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
    Used: (r) => fmtDays(r.used),
    Approved: (r) => fmtDays(r.approved),
    Pending: (r) => fmtDays(r.pending),
    "Left / Total": (r) => leftLabel(r),
    "Leave Year": (r) => yearLabel(r),
  }, (r) => r.profile.id);

  const shown = funnels.visible;
  const totals = shown.reduce((t, r) => ({ used: t.used + r.used, approved: t.approved + r.approved, pending: t.pending + r.pending }), { used: 0, approved: 0, pending: 0 });

  const toggleSort = (key: SortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" || key === "department" || key === "branch" || key === "year" || key === "rank" ? "asc" : "desc" }));

  const header = (label: string, key: SortKey, align: "left" | "right" | "center" = "left", funnel = true): ReactNode => {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th key={label} className={`px-3 py-3 text-xs font-semibold uppercase text-slate-400 whitespace-nowrap ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"}`} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
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

  const kindNote = KINDS.find((k) => k.key === kind)!.note;

  // The clicked person's requests of this kind — this leave year, or every year.
  const detailRequests = useMemo(() => {
    if (!detail) return [];
    const mine = requestsByProfile.get(detail.profile.id) ?? [];
    const ofKind = mine.filter((r) => (kind === "paid" ? r.ptoType === "vacation" : kind === "sick" ? r.ptoType === "sick" : UNPAID_TYPES.includes(r.ptoType)));
    const list = detailAllYears || !detail.window ? ofKind : ofKind.filter((r) => r.startDate >= detail.window!.start && r.startDate < detail.window!.end);
    return [...list].sort((a, b) => b.startDate.localeCompare(a.startDate));
  }, [detail, detailAllYears, requestsByProfile, kind]);

  const statusPill = (r: PtoRequestRow) => {
    const s = r.status === "approved" ? (r.startDate <= today ? ["Approved · taken", "bg-green-500/15 text-green-300 border-green-500/30"] : ["Approved · upcoming", "bg-cyan-500/15 text-cyan-300 border-cyan-500/30"])
      : r.status === "pending" ? ["Pending", "bg-yellow-500/15 text-yellow-300 border-yellow-500/30"]
      : r.status === "denied" ? ["Rejected", "bg-red-500/15 text-red-300 border-red-500/30"]
      : ["Cancelled", "bg-slate-500/15 text-slate-300 border-slate-500/30"];
    return <span className={`inline-block rounded border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${s[1]}`}>{s[0]}</span>;
  };

  return (
    <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-white">PTO Usage</h2>
        <div className="flex flex-wrap items-center gap-2">
          {funnels.activeCount > 0 && (
            <button type="button" onClick={funnels.clear} className="rounded-md border border-blue-400/30 bg-blue-500/10 px-2 py-1 text-[11px] font-semibold text-blue-200 hover:bg-blue-500/20">
              Clear column filters ({funnels.activeCount})
            </button>
          )}
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Rank by</span>
          <div className="inline-flex rounded-lg border border-white/10 bg-slate-800/40 p-0.5" role="tablist" aria-label="Which leave to rank">
            {KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                role="tab"
                aria-selected={kind === k.key}
                onClick={() => { setKind(k.key); setDetail(null); }}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition ${kind === k.key ? "bg-white/10 text-blue-300" : "text-slate-400 hover:text-white"}`}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        {kindNote} <span className="text-slate-500">Used = approved and already started · Approved = approved, still to come · Pending = waiting for approval.</span>
      </p>

      {!hireDates ? (
        <div className="flex items-center gap-2 py-8 justify-center text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading hire dates…</div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-xs tabular-nums">
            <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300">{shown.length} {shown.length === 1 ? "person" : "people"}</span>
            <span className="rounded-md border border-green-500/30 bg-green-500/5 px-2.5 py-1"><span className="text-slate-400">Used</span> <b className="text-green-300">{fmtDays(totals.used)}</b> days</span>
            <span className="rounded-md border border-cyan-500/30 bg-cyan-500/5 px-2.5 py-1"><span className="text-slate-400">Approved</span> <b className="text-cyan-300">{fmtDays(totals.approved)}</b> days</span>
            <span className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-2.5 py-1"><span className="text-slate-400">Pending</span> <b className="text-yellow-300">{fmtDays(totals.pending)}</b> days</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  {header("#", "rank", "center", false)}
                  {header("Employee", "name")}
                  {header("Department", "department")}
                  {header("Branch", "branch")}
                  {header("Used", "used", "right")}
                  {header("Approved", "approved", "right")}
                  {header("Pending", "pending", "right")}
                  {header("Left / Total", "left", "right")}
                  {header("Leave Year", "year")}
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">{rows.length === 0 ? "No employees to show." : "Nobody matches the column filters."}</td></tr>
                ) : (
                  shown.map((r) => (
                    <tr key={r.profile.id} className={`border-b border-white/5 hover:bg-white/5 ${!r.window ? "opacity-60" : ""}`}>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums ${r.rank <= 3 && r.used > 0 ? "bg-blue-500/20 text-blue-200" : "text-slate-500"}`}>{r.rank}</span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <button type="button" onClick={() => { setDetail(r); setDetailAllYears(false); }} className="font-semibold text-white underline-offset-2 hover:text-blue-300 hover:underline" title="See this person's requests">
                          {r.name}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-300">{r.department}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-300">{r.branch}</td>
                      <td className="px-3 py-2.5 text-right font-bold tabular-nums text-green-300">{fmtDays(r.used)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-cyan-300">{fmtDays(r.approved)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-yellow-300">{fmtDays(r.pending)}</td>
                      <td className={`px-3 py-2.5 text-right whitespace-nowrap tabular-nums ${r.window && r.left === 0 ? "text-red-300 font-semibold" : "text-slate-300"}`}>{leftLabel(r)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-slate-400">{yearLabel(r)}</td>
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
          <div role="dialog" aria-modal="true" aria-label={`${detail.name} — ${KINDS.find((k) => k.key === kind)!.label} requests`} className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-white/10 bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-white">{detail.name}</h3>
                <p className="text-xs text-slate-400">
                  {KINDS.find((k) => k.key === kind)!.label} · {detail.department} · {detail.branch} · Leave year {yearLabel(detail)}
                </p>
              </div>
              <button type="button" autoFocus onClick={() => setDetail(null)} className="text-xl leading-none text-slate-400 hover:text-white" aria-label="Close">×</button>
            </div>
            <div className="space-y-3 overflow-y-auto px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2 text-xs tabular-nums">
                  <span className="rounded-md border border-green-500/30 bg-green-500/5 px-2.5 py-1"><span className="text-slate-400">Used</span> <b className="text-green-300">{fmtDays(detail.used)}</b></span>
                  <span className="rounded-md border border-cyan-500/30 bg-cyan-500/5 px-2.5 py-1"><span className="text-slate-400">Approved</span> <b className="text-cyan-300">{fmtDays(detail.approved)}</b></span>
                  <span className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-2.5 py-1"><span className="text-slate-400">Pending</span> <b className="text-yellow-300">{fmtDays(detail.pending)}</b></span>
                  <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1"><span className="text-slate-400">Left / Total</span> <b className="text-slate-200">{leftLabel(detail)}</b></span>
                </div>
                {detail.window && (
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={detailAllYears} onChange={(e) => setDetailAllYears(e.target.checked)} className="accent-blue-500" />
                    Show every year
                  </label>
                )}
              </div>
              {detailRequests.length === 0 ? (
                <p className="rounded-md border border-white/10 px-3 py-6 text-center text-sm text-slate-400">No {KINDS.find((k) => k.key === kind)!.label} requests {detailAllYears || !detail.window ? "on file" : "in this leave year"}.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-white/10">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        {["Type", "Dates", "Days", "Status", "Submitted", "Approved On"].map((h) => (
                          <th key={h} className={`px-3 py-2 text-xs font-semibold uppercase text-slate-400 whitespace-nowrap ${h === "Days" ? "text-right" : "text-left"}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detailRequests.map((r) => (
                        <tr key={r.id} className="border-b border-white/5">
                          <td className="px-3 py-2 whitespace-nowrap text-slate-200">{TYPE_LABEL[r.ptoType]}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-slate-200">{r.startDate === r.endDate ? fmtDate(r.startDate) : `${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}`}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-200">{fmtDays(days(r))}</td>
                          <td className="px-3 py-2">{statusPill(r)}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-slate-400">{fmtDate(r.createdAt)}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-slate-200">{r.status === "approved" ? fmtDate(r.reviewedAt) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
