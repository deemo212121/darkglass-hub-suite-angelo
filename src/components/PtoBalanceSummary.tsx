/**
 * Under a PTO request's Type (PTO Management — Employee Monitoring's tab and
 * Attendance Monitoring's): that employee's balance for the year the request
 * falls in — days approved, days pending, days left (only approved days come
 * off; pending ones show as "5 days left (3 days pending)") — so a reviewer sees
 * before approving whether it goes past their allowance, and that the extra
 * days would be unpaid.
 *
 *  - Vacation: the PTO year and allowance from pto.ts (ptoYearWindow — 5 days
 *    in the first eligible year, +1 each year after, reset on the hire
 *    anniversary). Before the 1-year mark there's no allowance: all unpaid.
 *  - Sick: its own 5 days a year (sickYearWindow) — always unpaid.
 *  - Personal / Unpaid / Holiday / Bereavement: no allowance; the year's
 *    approved and pending unpaid requests are counted so the manager sees how
 *    much unpaid time off the person already has.
 *
 * "Over" for one request = what it adds past the allowance after the days
 * already approved and the pending requests submitted before it (first come,
 * first served), so two pending requests don't both claim the last days.
 */
import { useEffect, useMemo, useState } from "react";
import { getHireDatesByProfileIds } from "@/lib/supabase/users";
import {
  ptoEligibleDate,
  ptoRequestsInYear,
  ptoYearWindow,
  sickRequestsInYear,
  sickYearWindow,
  type PtoRequestRow,
} from "@/lib/supabase/pto";
import { formatISODate } from "@/lib/localDate";

type Req = Pick<PtoRequestRow, "id" | "profileId" | "ptoType" | "status" | "startDate" | "hoursRequested" | "createdAt">;

const days = (r: Pick<Req, "hoursRequested">) => r.hoursRequested / 8;
const fmtDays = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} day${n === 1 ? "" : "s"}`;
const fmtDate = (iso: string) => formatISODate(iso, { month: "short", day: "numeric", year: "numeric" });

/**
 * Hire dates for everyone with a request in `requests` (refetched when the
 * set of people changes); null until loaded, so no balance shows against the
 * wrong anchor date in the meantime.
 */
export function usePtoHireDates(requests: Pick<Req, "profileId">[]): Map<string, string> | null {
  const ids = useMemo(() => Array.from(new Set(requests.map((r) => r.profileId))).sort(), [requests]);
  const key = ids.join(",");
  const [loaded, setLoaded] = useState<{ key: string; hireDates: Map<string, string> } | null>(null);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    getHireDatesByProfileIds(key.split(",")).then((hireDates) => { if (!cancelled) setLoaded({ key, hireDates }); });
    return () => { cancelled = true; };
  }, [key]);
  // A new person's request keeps the earlier dates until theirs arrives — only the very first load waits.
  return loaded?.hireDates ?? null;
}

/** What this request adds past `allowance`, given the year's other approved days and earlier pending requests. */
function overBy(request: Req, inYear: Req[], allowance: number): number {
  const before = inYear
    .filter((r) => r.id !== request.id && (r.status === "approved" || (r.status === "pending" && r.createdAt < request.createdAt)))
    .reduce((sum, r) => sum + days(r), 0);
  return Math.min(days(request), Math.max(0, before + days(request) - allowance));
}

export function PtoBalanceSummary({
  request,
  requests,
  hireDate,
  createdAt,
}: {
  request: Req;
  /** Every PTO request on file (any employee) — the employee's own are picked out here. */
  requests: Req[];
  hireDate: string | null | undefined;
  /** profiles.created_at — the fallback anchor when no Hire Date is on file, same as pto.ts. */
  createdAt: string | null | undefined;
}) {
  const own = requests.filter((r) => r.profileId === request.profileId);
  const sum = (rows: Req[], status: "approved" | "pending") => rows.filter((r) => r.status === status).reduce((t, r) => t + days(r), 0);
  const line = "text-[11px] leading-snug text-slate-400";
  const warn = (text: string) => (
    <span className="mt-0.5 inline-block rounded border border-red-500/40 bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">⚠ {text}</span>
  );

  if (request.ptoType === "vacation") {
    const year = ptoYearWindow(hireDate, createdAt, request.startDate);
    if (!year) {
      const eligible = ptoEligibleDate(hireDate, createdAt);
      return (
        <div className="mt-1">
          <div className={line}>No PTO balance yet{eligible ? ` — eligible ${fmtDate(eligible)}` : ""}</div>
          {request.status !== "denied" && request.status !== "cancelled" && warn(`All ${fmtDays(days(request))} unpaid`)}
        </div>
      );
    }
    const inYear = ptoRequestsInYear(own, year);
    const approved = sum(inYear, "approved");
    const pending = sum(inYear, "pending");
    // Only approved days come off the balance — pending ones show beside it.
    const left = year.allowance - approved;
    const over = request.status === "denied" || request.status === "cancelled" ? 0 : overBy(request, inYear, year.allowance);
    return (
      <div className="mt-1" title={`PTO Year ${year.tenureYear}: ${fmtDate(year.start)} – ${fmtDate(year.end)} (resets on the hire anniversary)`}>
        <div className={line}>
          <span className="text-green-300">{fmtDays(approved)} approved</span> · <span className="text-yellow-300">{fmtDays(pending)} pending</span> of {year.allowance}
        </div>
        <div className={line}>{left >= 0 ? `${fmtDays(left)} left` : `${fmtDays(-left)} over`}{pending > 0 ? ` (${fmtDays(pending)} pending)` : ""} · Year {year.tenureYear}</div>
        {over > 0 && warn(`${fmtDays(over)} past balance — unpaid`)}
      </div>
    );
  }

  if (request.ptoType === "sick") {
    const year = sickYearWindow(hireDate, createdAt, request.startDate);
    if (!year) return null;
    const inYear = sickRequestsInYear(own, year);
    const approved = sum(inYear, "approved");
    const pending = sum(inYear, "pending");
    const over = request.status === "denied" || request.status === "cancelled" ? 0 : overBy(request, inYear, year.allowance);
    return (
      <div className="mt-1" title={`Sick leave year: ${fmtDate(year.start)} – ${fmtDate(year.end)} — ${year.allowance} days, unpaid`}>
        <div className={line}>
          <span className="text-green-300">{fmtDays(approved)} approved</span> · <span className="text-yellow-300">{fmtDays(pending)} pending</span> of {year.allowance} sick
        </div>
        <div className={line}>Unpaid · {fmtDays(Math.max(0, year.allowance - approved))} left{pending > 0 ? ` (${fmtDays(pending)} pending)` : ""}</div>
        {over > 0 && warn(`${fmtDays(over)} past the ${year.allowance}-day sick allowance`)}
      </div>
    );
  }

  // Personal / Unpaid / Holiday / Bereavement — no allowance; show the year's unpaid time off so far.
  const year = sickYearWindow(hireDate, createdAt, request.startDate);
  const inYear = own.filter(
    (r) => r.ptoType !== "vacation" && r.ptoType !== "sick" && (!year || (r.startDate >= year.start && r.startDate < year.end)),
  );
  const approvedRows = inYear.filter((r) => r.status === "approved");
  const pendingRows = inYear.filter((r) => r.status === "pending");
  return (
    <div className="mt-1" title={year ? `Employment year ${fmtDate(year.start)} – ${fmtDate(year.end)}` : undefined}>
      <div className={line}>
        Unpaid this year: <span className="text-green-300">{approvedRows.length} approved ({fmtDays(sum(approvedRows, "approved"))})</span> ·{" "}
        <span className="text-yellow-300">{pendingRows.length} pending ({fmtDays(sum(pendingRows, "pending"))})</span>
      </div>
    </div>
  );
}
