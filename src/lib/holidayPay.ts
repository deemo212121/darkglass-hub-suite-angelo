/** Paid holiday time is credited only for scheduled dates without work/PTO credit. */
export interface HolidayPayPolicy {
  date: string;
  hourlyPaid?: boolean | null;
  fixedSalaryPaid?: boolean | null;
}
/** Today's date ("YYYY-MM-DD") in US Central time — payroll's clock. */
export function todayCentralISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * `asOf` (optional): a holiday after this date isn't credited yet — it only
 * counts once it has actually arrived, so a mid-period payroll never shows
 * (or pays) a holiday someone could still leave before.
 */
export function paidHolidayDates(
  holidays: readonly HolidayPayPolicy[], start: string, end: string,
  offDays: readonly number[], creditedDates: Iterable<string>,
  compensationOn: (date: string) => "hourly" | "fixed",
  asOf?: string
): string[] {
  const credited = new Set(creditedDates);
  const result = new Set<string>();
  for (const holiday of holidays) {
    const date = holiday.date;
    if (date < start || date > end || credited.has(date)) continue;
    if (asOf && date > asOf) continue;
    if (offDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) continue;
    const paid = compensationOn(date) === "fixed" ? holiday.fixedSalaryPaid : holiday.hourlyPaid;
    if (paid === true) result.add(date);
  }
  return [...result];
}
