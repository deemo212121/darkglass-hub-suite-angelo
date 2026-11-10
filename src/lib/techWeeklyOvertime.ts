interface OvertimeDay {
  date: string;
  regular: number;
  overtime: number;
  paidLeave?: boolean;
}

function startOfWeekSunday(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - day.getUTCDay());
  return day.toISOString().slice(0, 10);
}

/** One Sunday workweek's piece of a technician's OT premium — see EmployeePayrollRow.techWeeklyOt. */
export interface TechWeeklyOt {
  weekStart: string;
  hours: number;
  /** OT hours that earn the premium (training days excluded). */
  premiumHours: number;
  straightPay: number;
  /** Includable pay counted in this week: its week-tagged lines + its hours-share of the untagged pay. */
  includablePay: number;
  regularRate: number;
  premium: number;
}

/**
 * FLSA overtime premium computed per workweek, then summed for the pay
 * period. `taggedIncludable` holds includable pay already tied to a week
 * (custom lines with work_week_start); `untaggedIncludable` is spread over
 * the weeks by hours, which with one hourly rate gives exactly the old
 * period-wide result — so nothing changes until lines are tagged.
 */
export function weeklyOtPremium(
  dailyHours: OvertimeDay[],
  rateForDate: (date: string) => number,
  earnsPremium: (date: string) => boolean,
  taggedIncludable: Map<string, number> | undefined,
  untaggedIncludable: number
): TechWeeklyOt[] {
  const weeks = new Map<string, TechWeeklyOt>();
  for (const day of dailyHours) {
    if (day.paidLeave) continue;
    const weekStart = startOfWeekSunday(day.date);
    const week = weeks.get(weekStart) ?? { weekStart, hours: 0, premiumHours: 0, straightPay: 0, includablePay: 0, regularRate: 0, premium: 0 };
    const dayHours = day.regular + day.overtime;
    week.hours += dayHours;
    week.straightPay += dayHours * rateForDate(day.date);
    if (earnsPremium(day.date)) week.premiumHours += day.overtime;
    weeks.set(weekStart, week);
  }
  const list = [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const totalHours = list.reduce((sum, w) => sum + w.hours, 0);
  // Tagged pay stays in its assigned week. A zero-hour week's pay remains
  // payable through the custom lines, but cannot change another week's OT.
  for (const [weekStart, amount] of taggedIncludable ?? []) {
    const week = weeks.get(weekStart);
    if (week && week.hours > 0) week.includablePay += amount;
  }
  for (const week of list) {
    if (totalHours > 0) week.includablePay += untaggedIncludable * (week.hours / totalHours);
    week.regularRate = week.hours > 0 ? (week.straightPay + week.includablePay) / week.hours : 0;
    week.premium = week.premiumHours * week.regularRate * 0.5;
  }
  return list;
}

