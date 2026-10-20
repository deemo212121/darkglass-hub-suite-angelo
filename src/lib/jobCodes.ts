/**
 * Job codes per manufacturer — the Pre-Claim form's Job Code becomes a
 * dropdown of these when the ticket's manufacturer / brand matches. To add
 * another manufacturer, add one entry: a label (shown as "<label> job code"),
 * what its manufacturer / brand name looks like, and its codes.
 */
export interface ManufacturerJobCodes {
  /** Shown above the field, e.g. "GE job code". */
  label: string;
  /** Matched against the ticket's manufacturer, then its brand. */
  match: RegExp;
  codes: string[];
}

export const MANUFACTURER_JOB_CODES: ManufacturerJobCodes[] = [
  { label: "GE", match: /^\s*(ge|general electric)\b/i, codes: ["MA00", "MG00", "SS00", "SG00"] },
];

/** The job-code list for this ticket's manufacturer (or brand), if there is one. */
export function jobCodesFor(manufacturer?: string | null, brand?: string | null): ManufacturerJobCodes | null {
  for (const name of [manufacturer, brand]) {
    if (!name) continue;
    const hit = MANUFACTURER_JOB_CODES.find((m) => m.match.test(name));
    if (hit) return hit;
  }
  return null;
}
