/** Fixed cutoff salary: one credit per paid date, capped at ten days. */
export function fixedSalaryForPaidDates(perCutoff: number, dates: Iterable<string>): number {
  return perCutoff * Math.min(new Set(dates).size, 10) / 10;
}

/** Approved, eligible Vacation dates only; unpaid requests take precedence. */
export function approvedPaidDates(
  requests: ReadonlyArray<{ status: string; ptoType: string; startDate: string; endDate: string }>,
  start: string, end: string, offDays: readonly number[], eligibleOn: string | null
): string[] {
  const paid = new Set<string>();
  const unpaid = new Set<string>();
  for (const request of requests) {
    if (request.status !== "approved") continue;
    const first = request.startDate > start ? request.startDate : start;
    const last = request.endDate < end ? request.endDate : end;
    for (const day = new Date(`${first}T00:00:00Z`); day.toISOString().slice(0, 10) <= last; day.setUTCDate(day.getUTCDate() + 1)) {
      const date = day.toISOString().slice(0, 10);
      if (offDays.includes(day.getUTCDay())) continue;
      if (request.ptoType === "vacation") {
        if (!eligibleOn || date >= eligibleOn) paid.add(date);
      } else unpaid.add(date);
    }
  }
  return [...paid].filter((date) => !unpaid.has(date));
}
