/**
 * State minimum wage reference table (2026), from the "TECH TIER - min
 * state" workbook Accounting supplied. `rate: null` means the state sets
 * its minimum wage by county rather than a single statewide number (New
 * York, Oregon) — Finance enters the correct county-specific value by hand
 * for those on the Branch Rates tab instead of it being auto-suggested.
 * Only the states actually present in that workbook are listed here (it
 * omits Alaska, Hawaii, and DC) — never guess a rate for a state that
 * wasn't in the source file.
 */
export interface StateMinWage {
  state: string;
  rate: number | null;
}

/** Federal minimum wage floor (unchanged since 2009) — every state below
 *  observes at least this, and it's the company-wide baseline hourly rate
 *  for technician-tier roles (special case: employees on a fixed annual
 *  salary instead of hourly pay). See EmployeePayrollDetailModal.tsx's
 *  Add Rate Change guard. */
export const FEDERAL_MIN_WAGE = 7.25;

export const STATE_MIN_WAGE_2026: StateMinWage[] = [
  { state: "Alabama", rate: 7.25 },
  { state: "Arizona", rate: 15.15 },
  { state: "Arkansas", rate: 11 },
  { state: "California", rate: 16.9 },
  { state: "Colorado", rate: 15.16 },
  { state: "Connecticut", rate: 16.94 },
  { state: "Delaware", rate: 15 },
  { state: "Florida", rate: 14 },
  { state: "Georgia", rate: 7.25 },
  { state: "Idaho", rate: 7.25 },
  { state: "Illinois", rate: 15 },
  { state: "Indiana", rate: 7.25 },
  { state: "Iowa", rate: 7.25 },
  { state: "Kansas", rate: 7.25 },
  { state: "Kentucky", rate: 7.25 },
  { state: "Louisiana", rate: 7.25 },
  { state: "Maine", rate: 15.1 },
  { state: "Maryland", rate: 15 },
  { state: "Massachusetts", rate: 15 },
  { state: "Michigan", rate: 13.73 },
  { state: "Minnesota", rate: 11.41 },
  { state: "Mississippi", rate: 7.25 },
  { state: "Missouri", rate: 15 },
  { state: "Montana", rate: 10.85 },
  { state: "Nebraska", rate: 15 },
  { state: "Nevada", rate: 12 },
  { state: "New Hampshire", rate: 7.25 },
  { state: "New Jersey", rate: 15.92 },
  { state: "New Mexico", rate: 12 },
  { state: "New York", rate: null },
  { state: "North Carolina", rate: 7.25 },
  { state: "North Dakota", rate: 7.25 },
  { state: "Ohio", rate: 11 },
  { state: "Oklahoma", rate: 7.25 },
  { state: "Oregon", rate: null },
  { state: "Pennsylvania", rate: 7.25 },
  { state: "Rhode Island", rate: 16 },
  { state: "South Carolina", rate: 7.25 },
  { state: "South Dakota", rate: 11.85 },
  { state: "Tennessee", rate: 7.25 },
  { state: "Texas", rate: 7.25 },
  { state: "Utah", rate: 7.25 },
  { state: "Vermont", rate: 14.42 },
  { state: "Virginia", rate: 12.77 },
  { state: "Washington", rate: 17.13 },
  { state: "West Virginia", rate: 8.75 },
  { state: "Wisconsin", rate: 7.25 },
  { state: "Wyoming", rate: 7.25 },
];

/** 2-letter USPS abbreviation -> full name, for the states listed above only
 * (no Alaska/Hawaii/DC, same scope note as STATE_MIN_WAGE_2026 itself). */
const STATE_ABBREV_TO_NAME: Record<string, string> = {
  AL: "Alabama", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
  NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/**
 * Resolves a raw customer.state value (usually a 2-letter abbreviation, but
 * tolerates a full name already) to one of the names in STATE_MIN_WAGE_2026.
 * Returns null for anything that doesn't match a known entry — e.g. Alaska,
 * Hawaii, DC, or bad/missing data — rather than guessing, same rule as the
 * table above.
 */
export function normalizeStateName(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const byAbbrev = STATE_ABBREV_TO_NAME[trimmed.toUpperCase()];
  if (byAbbrev) return byAbbrev;
  const match = STATE_MIN_WAGE_2026.find((s) => s.state.toLowerCase() === trimmed.toLowerCase());
  return match ? match.state : null;
}

/**
 * Whichever of the given state names has the higher minimum wage — a
 * conservative tie-break for an ambiguous day/week that touched more than
 * one state (never floors a technician to the lower of the two just because
 * that's where they happened to be first). States with no fixed rate
 * (county-based, e.g. NY/Oregon) are skipped since they can't be compared
 * numerically. Returns null if `states` is empty or none have a fixed rate.
 */
export function highestRateAmong(states: string[]): string | null {
  let best: string | null = null;
  let bestRate = -Infinity;
  for (const s of states) {
    const rate = STATE_MIN_WAGE_2026.find((sw) => sw.state === s)?.rate;
    if (rate != null && rate > bestRate) {
      bestRate = rate;
      best = s;
    }
  }
  return best;
}
