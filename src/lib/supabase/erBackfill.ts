/**
 * ER history backfill (migration 0407) — tickets imported from ER's history
 * (tickets.er_backfill) and visits entered through the ticket page's "Past
 * record from ER" box (visits.er_backfill) are records of work already paid
 * and reported in ER. They must never count toward tech pay (completed
 * repairs, Two Tech, assigned counts, carryovers), auto mileage or Ticket
 * Attendance, whatever period they fall in.
 *
 * The callers filter by these id sets instead of adding `.eq("er_backfill",
 * false)` to every query: a query naming the column fails outright until
 * 0407 has been run, while here a missing column just means "nothing is
 * backfilled yet" (empty set). One small indexed read each, shared and
 * cached briefly — payroll loads ask for them several times in a row.
 */
import { supabase } from "./client";
import { selectAllPages } from "./selectAllPages";

const CACHE_MS = 2 * 60_000;
const cache = new Map<"tickets" | "visits", { at: number; ids: Promise<Set<string>> }>();

function loadIds(table: "tickets" | "visits"): Promise<Set<string>> {
  const hit = cache.get(table);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ids;
  const ids = selectAllPages<{ id: string }>(() => supabase.from(table).select("id").eq("er_backfill", true).order("id")).then(({ data, error }) => {
    if (error) {
      // Before migration 0407 there's no er_backfill column, so nothing is backfilled.
      if (!/er_backfill/i.test(error.message)) console.error(`getErBackfill ${table} ids error:`, error.message);
      return new Set<string>();
    }
    return new Set(data.map((r) => r.id));
  });
  cache.set(table, { at: Date.now(), ids });
  return ids;
}

/** Ids of tickets brought in from ER's history. */
export function getErBackfillTicketIds(): Promise<Set<string>> {
  return loadIds("tickets");
}

/** Ids of visits entered as a past record from ER. */
export function getErBackfillVisitIds(): Promise<Set<string>> {
  return loadIds("visits");
}

/** After an import or a past-record entry, so the next payroll read sees it. */
export function invalidateErBackfillIds(): void {
  cache.clear();
}
