/**
 * Shared helper for the "_____ / _____ / __________ (MM/DD/YYYY)" blank
 * line that recurs, verbatim, across most of the automated forms sharing
 * this PDF template family — confirmed via direct pdf.js text-item
 * inspection on Car IQ, Vehicle Agreement, PTO Ack, Parts Responsibility,
 * and Mileage & Fuel / Meal & Rest Break: every one of these draws that
 * exact string, always ~217–217.5pt wide, just at a different x/y per
 * form. The date value has to be split into three pieces positioned into
 * each blank individually — drawing the whole formatted date as one
 * string (the original bug) overlaps all three blanks and the
 * "(MM/DD/YYYY)" hint text instead of sitting inside them.
 *
 * Offsets were derived by comparing the label's real measured width
 * (217.092pt, from Car IQ's own text item) against pdf-lib's Helvetica-
 * at-12pt metrics for the identical string (240.792pt) — the source
 * PDF's font isn't quite standard Helvetica, so Helvetica-measured
 * prefix widths ("_____ / " and "_____ / _____ / ") are scaled down by
 * that same ratio (≈0.9016) to land in the right spot. Verified visually
 * against a live-rendered fill.
 */
export function dateBlankPositions(labelX: number): { mm: number; dd: number; yyyy: number } {
  return { mm: labelX, dd: labelX + 39.11, yyyy: labelX + 78.21 };
}

export function fmtDateParts(v: string): { mm: string; dd: string; yyyy: string } {
  if (!v) return { mm: "", dd: "", yyyy: "" };
  // A date-only string ("2026-09-17") parses as UTC midnight; reading
  // .getMonth()/.getDate() back out in the browser's local timezone
  // (anything behind UTC, i.e. all of the US) rolls it back a day —
  // "09/17" printing as "09/16". Parsing the y/m/d parts directly into a
  // local Date avoids that. A full timestamp has no such ambiguity and is
  // left to the normal parse.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(v);
  if (isNaN(d.getTime())) return { mm: "", dd: "", yyyy: "" };
  return { mm: String(d.getMonth() + 1).padStart(2, "0"), dd: String(d.getDate()).padStart(2, "0"), yyyy: String(d.getFullYear()) };
}
