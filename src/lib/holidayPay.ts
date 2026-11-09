/** Paid holiday time is credited only for scheduled dates without work/PTO credit. */
export interface HolidayPayPolicy {
  date: string;
  hourlyPaid?: boolean | null;
  fixedSalaryPaid?: boolean | null;
}
export function paidHolidayDates(
  holidays: readonly HolidayPayPolicy[], start: string, end: string,
  offDays: readonly number[], creditedDates: Iterable<string>,
  compensationOn: (date: string) => "hourly" | "fixed"
): string[] {
  const credited = new Set(creditedDates);
  const result = new Set<string>();
  for (const holiday of holidays) {
    const date = holiday.date;
    if (date < start || date > end || credited.has(date)) continue;
    if (offDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) continue;
    const paid = compensationOn(date) === "fixed" ? holiday.fixedSalaryPaid : holiday.hourlyPaid;
    if (paid === true) result.add(date);
  }
  return [...result];
}
