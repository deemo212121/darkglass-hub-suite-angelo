import { useEffect, useState } from "react";
import { getHolidayNamesInRange } from "@/lib/supabase/pto";

/**
 * Declared company holidays (Holiday Calendar) from last year through next,
 * date → name — for the PTO forms' day count, since PTO can't be filed for a
 * holiday. Empty until loaded (the save itself re-checks).
 */
export function useHolidayNames(): Map<string, string> {
  const [holidays, setHolidays] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    const y = new Date().getFullYear();
    getHolidayNamesInRange(`${y - 1}-01-01`, `${y + 1}-12-31`).then(setHolidays).catch(() => {});
  }, []);
  return holidays;
}
