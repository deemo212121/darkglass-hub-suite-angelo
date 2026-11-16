/**
 * Daily Mileage → Import: reads miles per technician per day out of a
 * spreadsheet however it's laid out. Three shapes are recognised:
 *
 *   by technician — one row per technician, the days across the top
 *                   (the same shape as the page's grid)
 *   by day        — one row per day, the technicians across the top
 *   list          — one row per entry: a technician, a date and miles column
 *
 * Dates can be real Excel dates, "2026-11-03", "11/3/2026", "11/3", "Nov 3",
 * "3-Nov", "Mon 11/3", or bare day numbers 1–31 (read in the month on
 * screen). Two entries for the same technician and day are added together,
 * e.g. a list with one line per trip. Pure — the page reads the file with
 * the xlsx library and hands the rows in here.
 */
import { aliasTechName, nameMatchKey, namesOverlap } from "@/lib/techNameMatch";

export type MileageSheetLayout = "by-technician" | "by-day" | "list";

export interface ImportedMiles {
  name: string;
  date: string;
  miles: number;
}

export interface MileageSheetParse {
  layout: MileageSheetLayout;
  entries: ImportedMiles[];
  /** Cells that looked like miles but couldn't be read, or rows without a name / date. */
  skipped: number;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const text = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/**
 * A header or cell as a date, or null. `ym` ("2026-11") gives the year for
 * dates written without one, and the month for bare day numbers when
 * `dayNumbers` is set.
 */
export function readDate(v: unknown, ym: string, dayNumbers = false): string | null {
  const [hy, hm] = ym.split("-").map(Number);
  if (v instanceof Date && !isNaN(v.getTime())) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === "number") {
    if (dayNumbers && Number.isInteger(v) && v >= 1 && v <= 31) return iso(hy, hm, v);
    // Excel day numbers for 2000–2100.
    if (v > 36500 && v < 73500) {
      const d = new Date(Math.round((v - 25569) * 86400000));
      return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }
  const s = text(v).toLowerCase().replace(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s*/, "");
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(s);
  if (m) return iso(m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : hy, +m[1], +m[2]);
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(s);
  if (m && MONTHS.includes(m[1])) return iso(m[3] ? +m[3] : hy, MONTHS.indexOf(m[1]) + 1, +m[2]);
  m = /^(\d{1,2})[\s-]([a-z]{3})[a-z]*(?:[\s-](\d{2,4}))?$/.exec(s);
  if (m && MONTHS.includes(m[2])) return iso(m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : hy, MONTHS.indexOf(m[2]) + 1, +m[1]);
  if (dayNumbers && /^\d{1,2}$/.test(s)) return iso(hy, hm, +s);
  return null;
}

/** A miles cell: number, "212", "1,248.5", "212 mi". Blank → null (no entry); anything else → NaN. */
export function readMilesCell(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : NaN;
  const s = text(v).replace(/,/g, "").replace(/\s*(mi|miles)$/i, "");
  if (s === "" || s === "-" || s === "—") return null;
  const n = Number(s);
  return isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : NaN;
}

const NAME_HEADER = /\b(name|technician|tech|driver|employee)\b/i;
const DATE_HEADER = /\b(date|day)\b/i;
const MILES_HEADER = /\b(miles?|mileage|mi|distance)\b/i;
/** Columns that are totals or rates, never a day. */
const TOTAL_HEADER = /\b(total|sum|rate|pay|amount|avg|average)\b/i;

/** Which cells in a row read as dates (index → date). Bare day numbers count only as a run of 5+ in a row. */
function dateCells(row: unknown[], ym: string): Map<number, string> {
  const out = new Map<number, string>();
  row.forEach((v, i) => { const d = readDate(v, ym); if (d) out.set(i, d); });
  if (out.size >= 2) return out;
  const nums = new Map<number, string>();
  row.forEach((v, i) => { const t = text(v); if (/^\d{1,2}$/.test(t)) { const d = readDate(Number(t), ym, true); if (d) nums.set(i, d); } });
  return nums.size >= 5 ? nums : out;
}

/**
 * Finds the layout and reads every entry. `ym` is the month on screen
 * ("2026-11"), used for dates written without a year and for bare day
 * numbers. Returns null when nothing in the sheet looks like miles by day.
 */
export function parseMileageSheet(grid: unknown[][], ym: string): MileageSheetParse | null {
  const rows = grid.filter((r) => Array.isArray(r) && r.some((c) => text(c) !== ""));
  const top = rows.slice(0, 15);

  // List: a header row with a name, a date and a miles column.
  for (let h = 0; h < top.length; h++) {
    const hdr = top[h].map(text);
    const nameCol = hdr.findIndex((c) => NAME_HEADER.test(c));
    const dateCol = hdr.findIndex((c, i) => i !== nameCol && DATE_HEADER.test(c) && !TOTAL_HEADER.test(c));
    const milesCol = hdr.findIndex((c, i) => i !== nameCol && i !== dateCol && MILES_HEADER.test(c) && !/rate|pay|amount/i.test(c));
    if (nameCol < 0 || dateCol < 0 || milesCol < 0) continue;
    const entries: ImportedMiles[] = [];
    let skipped = 0;
    for (const r of rows.slice(h + 1)) {
      const name = text(r[nameCol]);
      const date = readDate(r[dateCol], ym);
      const miles = readMilesCell(r[milesCol]);
      if (miles === null && !name) continue;
      if (!name || !date || miles === null || Number.isNaN(miles)) { skipped++; continue; }
      entries.push({ name, date, miles });
    }
    if (entries.length) return { layout: "list", entries: combine(entries), skipped };
  }

  // By technician: a header row with dates across it; names down a text column.
  for (let h = 0; h < top.length; h++) {
    const dates = dateCells(top[h], ym);
    if (dates.size < 2) continue;
    const hdr = top[h].map(text);
    const dayCols = [...dates].filter(([i]) => !TOTAL_HEADER.test(hdr[i]));
    const body = rows.slice(h + 1);
    let nameCol = hdr.findIndex((c, i) => NAME_HEADER.test(c) && !dates.has(i));
    if (nameCol < 0) nameCol = [...Array(Math.max(...body.map((r) => r.length), 0)).keys()].find((i) => !dates.has(i) && body.some((r) => /[a-z]{2,}/i.test(text(r[i])))) ?? -1;
    if (nameCol < 0) continue;
    const entries: ImportedMiles[] = [];
    let skipped = 0;
    for (const r of body) {
      const name = text(r[nameCol]);
      if (!name || TOTAL_HEADER.test(name)) continue;
      for (const [i, date] of dayCols) {
        const miles = readMilesCell(r[i]);
        if (miles === null) continue;
        if (Number.isNaN(miles)) { skipped++; continue; }
        entries.push({ name, date, miles });
      }
    }
    if (entries.length) return { layout: "by-technician", entries: combine(entries), skipped };
  }

  // By day: dates down one column; technician names across the header row above them.
  const width = Math.max(...rows.map((r) => r.length), 0);
  for (let c = 0; c < Math.min(width, 5); c++) {
    const first = rows.findIndex((r) => readDate(r[c], ym));
    if (first < 1 || rows.slice(first).filter((r) => readDate(r[c], ym)).length < 2) continue;
    const hdr = rows[first - 1].map(text);
    const techCols = hdr.map((t, i) => ({ t, i })).filter(({ t, i }) => i !== c && /[a-z]{2,}/i.test(t) && !TOTAL_HEADER.test(t) && !DATE_HEADER.test(t));
    if (!techCols.length) continue;
    const entries: ImportedMiles[] = [];
    let skipped = 0;
    for (const r of rows.slice(first)) {
      const date = readDate(r[c], ym);
      if (!date) continue;
      for (const { t, i } of techCols) {
        const miles = readMilesCell(r[i]);
        if (miles === null) continue;
        if (Number.isNaN(miles)) { skipped++; continue; }
        entries.push({ name: t, date, miles });
      }
    }
    if (entries.length) return { layout: "by-day", entries: combine(entries), skipped };
  }
  return null;
}

/** Same technician, same day → one entry with the miles added up. */
function combine(entries: ImportedMiles[]): ImportedMiles[] {
  const map = new Map<string, ImportedMiles>();
  for (const e of entries) {
    const k = `${e.name.toLowerCase()}|${e.date}`;
    const have = map.get(k);
    if (have) have.miles = Math.round((have.miles + e.miles) * 10) / 10;
    else map.set(k, { ...e });
  }
  return [...map.values()];
}

/**
 * The person a sheet name is: same name once spelling is evened out (A'Dejaun
 * = Adejaun, nicknames from TECH_NAME_ALIASES), else the one person whose
 * name contains it or is contained in it ("Erick Guzman" ↔ "Erick Guzman
 * Juarez"). Two possible people → null, picked by hand on the import screen.
 */
export function matchTechnician<T extends { id: string; name: string }>(sheetName: string, people: T[]): T | null {
  const key = nameMatchKey(aliasTechName(sheetName));
  if (!key) return null;
  const exact = people.filter((p) => nameMatchKey(p.name) === key);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const loose = people.filter((p) => namesOverlap(aliasTechName(sheetName), p.name));
  return loose.length === 1 ? loose[0] : null;
}
