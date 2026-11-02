/**
 * Matching a typed person name (profiles.manager_name, a branch's Branch
 * Manager in General Information…) to an account. The name is free text, so
 * an exact match missed real people: "Jerich Leonard Bolico" vs the account
 * "Jerich Bolico", an extra space, "Jr", a middle initial. Everything that
 * resolves a manager by name goes through here so they all agree.
 *
 * No imports — the server jobs (attendanceAlerts.ts, technicianForcedCheckout.ts)
 * use it too.
 */

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

/** Lowercased, punctuation dropped, single spaces: " Arnulfo  Montesclaros, Jr. " -> "arnulfo montesclaros jr". */
export function normName(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
}

/** First and last name only — middle names / initials and Jr / Sr / III left out. */
function firstLast(n: string): string {
  const parts = n.split(" ").filter((w) => !SUFFIXES.has(w));
  return parts.length >= 2 ? `${parts[0]} ${parts[parts.length - 1]}` : parts.join(" ");
}

/**
 * The person `name` refers to: an exact match (ignoring case, spaces and
 * punctuation) first, else the one person with the same first and last name.
 * Two people with the same first and last name and no exact match -> null
 * (can't tell which). Pass only the people who count (e.g. active accounts).
 */
export function findPersonByName<T extends { display_name?: string | null }>(name: string | null | undefined, people: readonly T[]): T | null {
  const n = normName(name);
  if (!n) return null;
  const exact = people.find((p) => normName(p.display_name) === n);
  if (exact) return exact;
  const key = firstLast(n);
  if (!key.includes(" ")) return null;
  const loose = people.filter((p) => firstLast(normName(p.display_name)) === key);
  return loose.length === 1 ? loose[0] : null;
}

/**
 * Does the typed name `name` mean the person called `displayName`? Exact
 * (ignoring case / spaces / punctuation), or the same first and last name —
 * when `people` is given, only if no one else in it shares that first and
 * last name.
 */
export function nameRefersTo(name: string | null | undefined, displayName: string | null | undefined, people?: readonly { display_name?: string | null }[]): boolean {
  const n = normName(name);
  const d = normName(displayName);
  if (!n || !d) return false;
  if (n === d) return true;
  const key = firstLast(n);
  if (!key.includes(" ") || firstLast(d) !== key) return false;
  if (!people) return true;
  if (people.some((p) => normName(p.display_name) === n)) return false; // someone else has the exact name
  return people.filter((p) => firstLast(normName(p.display_name)) === key).length <= 1;
}
