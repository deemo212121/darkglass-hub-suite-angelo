/**
 * Computes the actual calendar date of each U.S. federal holiday for a
 * given year (the "3rd Monday of January" kind of rule) — used to seed
 * HolidayCalendarTab.tsx's company_holidays table the first time a year is
 * viewed. Every seeded row is then a normal editable row (see migration
 * 0252), so "move the holiday" for a specific year is just editing that row.
 */

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** nth (1-based) occurrence of `weekday` (0=Sun..6=Sat) in `month` (0-based) of `year`. */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}

/** LAST occurrence of `weekday` in `month` of `year` (e.g. Memorial Day). */
function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  const last = new Date(year, month, lastDay);
  const back = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, lastDay - back);
}

export function usFederalHolidaysForYear(year: number): { name: string; date: string }[] {
  return [
    { name: "New Year's Day", date: toISODate(new Date(year, 0, 1)) },
    { name: "Martin Luther King Jr. Day", date: toISODate(nthWeekdayOfMonth(year, 0, 1, 3)) },
    { name: "Washington's Birthday (Presidents' Day)", date: toISODate(nthWeekdayOfMonth(year, 1, 1, 3)) },
    { name: "Memorial Day", date: toISODate(lastWeekdayOfMonth(year, 4, 1)) },
    { name: "Juneteenth National Independence Day", date: toISODate(new Date(year, 5, 19)) },
    { name: "Independence Day", date: toISODate(new Date(year, 6, 4)) },
    { name: "Labor Day", date: toISODate(nthWeekdayOfMonth(year, 8, 1, 1)) },
    { name: "Columbus Day", date: toISODate(nthWeekdayOfMonth(year, 9, 1, 2)) },
    { name: "Veterans Day", date: toISODate(new Date(year, 10, 11)) },
    { name: "Thanksgiving Day", date: toISODate(nthWeekdayOfMonth(year, 10, 4, 4)) },
    { name: "Christmas Day", date: toISODate(new Date(year, 11, 25)) },
  ];
}
