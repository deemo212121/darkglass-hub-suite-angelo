/**
 * Shared branch abbreviation + color assignment for the Parts pages'
 * Branch Summary widgets (Part Receive, Part Return, ...) — single source
 * so every page's badges/donuts use the exact same short codes and the
 * exact same per-branch color, instead of each page keeping its own copy
 * that can silently drift out of sync with the others.
 */
import { LOCATIONS } from "@/lib/locations";

// Short display codes for the per-branch summary badges — the company's
// own official abbreviation table, not an invented shorthand.
export const BRANCH_ABBREV: Record<string, string> = {
  Asheville: "AV",
  Atlanta: "ATL",
  Birmingham: "BM",
  "Cape Girardeau": "CG",
  Chattanooga: "CH",
  Columbus: "CB",
  Dallas: "DAL",
  Destin: "DT",
  Huntsville: "HV",
  "Jackson, MS": "JS",
  "Jackson, TN": "JT",
  Jacksonville: "JV",
  Jonesboro: "JB",
  Knoxville: "KV",
  "Lake Charles": "LC",
  "Little Rock": "LR",
  Louisville: "LOU",
  Memphis: "MP",
  Mobile: "MB",
  Montgomery: "MG",
  Nashville: "NV",
  "New Orleans": "NO",
  Norfolk: "NF",
  Philippines: "PHL",
  Raleigh: "RL",
  Richmond: "RD",
  "San Antonio": "SA",
  Savannah: "SV",
  "St. Louis": "SL",
  Tallahassee: "TL",
  Wilmington: "WM",
};
export function branchAbbrev(location: string): string {
  return BRANCH_ABBREV[location] || location.slice(0, 3).toUpperCase();
}

// A fixed palette cycled by each branch's position in LOCATIONS (not by
// sort order, which changes with the data) so a given branch always gets
// the same color badge-to-badge, chart-to-chart, and session-to-session.
export const BRANCH_CHIP_COLORS = [
  { bg: "bg-blue-500/15", border: "border-blue-400/40", text: "text-blue-300" },
  { bg: "bg-purple-500/15", border: "border-purple-400/40", text: "text-purple-300" },
  { bg: "bg-teal-500/15", border: "border-teal-400/40", text: "text-teal-300" },
  { bg: "bg-amber-500/15", border: "border-amber-400/40", text: "text-amber-300" },
  { bg: "bg-rose-500/15", border: "border-rose-400/40", text: "text-rose-300" },
  { bg: "bg-emerald-500/15", border: "border-emerald-400/40", text: "text-emerald-300" },
  { bg: "bg-cyan-500/15", border: "border-cyan-400/40", text: "text-cyan-300" },
  { bg: "bg-indigo-500/15", border: "border-indigo-400/40", text: "text-indigo-300" },
  { bg: "bg-fuchsia-500/15", border: "border-fuchsia-400/40", text: "text-fuchsia-300" },
  { bg: "bg-lime-500/15", border: "border-lime-400/40", text: "text-lime-300" },
  { bg: "bg-orange-500/15", border: "border-orange-400/40", text: "text-orange-300" },
  { bg: "bg-sky-500/15", border: "border-sky-400/40", text: "text-sky-300" },
];
export function branchChipColor(location: string) {
  const idx = LOCATIONS.indexOf(location as (typeof LOCATIONS)[number]);
  return BRANCH_CHIP_COLORS[(idx >= 0 ? idx : 0) % BRANCH_CHIP_COLORS.length];
}

// Hex twins of BRANCH_CHIP_COLORS, same order/index — the badges use
// Tailwind utility classes (translucent fills), which recharts' <Cell
// fill> can't consume directly, so a Location donut needs this solid-hex
// version of the exact same per-branch color assignment to stay visually
// identical to the badges right next to it.
export const BRANCH_DONUT_HEX = ["#3b82f6", "#a855f7", "#14b8a6", "#f59e0b", "#f43f5e", "#10b981", "#06b6d4", "#6366f1", "#d946ef", "#84cc16", "#f97316", "#0ea5e9"];
export function branchDonutHex(location: string): string {
  const idx = LOCATIONS.indexOf(location as (typeof LOCATIONS)[number]);
  return BRANCH_DONUT_HEX[(idx >= 0 ? idx : 0) % BRANCH_DONUT_HEX.length];
}
