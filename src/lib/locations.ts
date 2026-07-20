export const WORK_MAP_LOCATIONS = [
  "Asheville",
  "Atlanta",
  "Birmingham",
  "Cape Girardeau",
  "Chattanooga",
  "Columbus",
  "Dallas",
  "Destin",
  "Huntsville",
  "Jackson,MS",
  "Jackson, TN",
  "Jacksonville",
  "Jonesboro",
  "Knoxville",
  "Lake Charles",
  "Little Rock",
  "Louisville",
  "Memphis",
  "Mobile",
  "Montgomery",
  "Nashville",
  "New Orleans",
  "Norfolk",
  "Philippines",
  "Raleigh",
  "Richmond",
  "San Antonio",
  "Savannah",
  "St. Louis",
  "Tallanassee",
  "Wilmington",
] as const;

export const LOCATIONS = [
  "Asheville",
  "Atlanta",
  "Birmingham",
  "Cape Girardeau",
  "Chattanooga",
  "Columbus",
  "Dallas",
  "Destin",
  "Huntsville",
  "Jackson, MS",
  "Jackson, TN",
  "Jacksonville",
  "Jonesboro",
  "Knoxville",
  "Lake Charles",
  "Little Rock",
  "Louisville",
  "Memphis",
  "Mobile",
  "Montgomery",
  "Nashville",
  "New Orleans",
  "Norfolk",
  "Philippines",
  "Raleigh",
  "Richmond",
  "San Antonio",
  "Savannah",
  "St. Louis",
  "Tallahassee",
  "Wilmington",
] as const;

// Region groupings for branch-level reporting (Operations Daily Report).
// Keyed on the canonical LOCATIONS spellings above, since that's what's
// actually stored in tickets.location — not the loosely-formatted names a
// business user might type (e.g. "Dallas TX", "Jackson MS").
export const REGIONS = ["CENTRAL", "WEST", "EAST"] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_LOCATIONS: Record<Region, string[]> = {
  CENTRAL: [
    "Birmingham",
    "Chattanooga",
    "Columbus",
    "Destin",
    "Knoxville",
    "Mobile",
    "Montgomery",
    "Nashville",
    "Tallahassee",
  ],
  WEST: [
    "Cape Girardeau",
    "Dallas",
    "Jackson, MS",
    "Jackson, TN",
    "Jonesboro",
    "Lake Charles",
    "Little Rock",
    "Memphis",
    "New Orleans",
    "San Antonio",
    "St. Louis",
  ],
  EAST: [
    "Asheville",
    "Atlanta",
    "Huntsville",
    "Jacksonville",
    "Norfolk",
    "Raleigh",
    "Richmond",
    "Savannah",
    "Wilmington",
  ],
};

// Real synced ticket.location values sometimes drop the space after a
// comma (e.g. "Jackson,MS" instead of "Jackson, MS") — match loosely.
// Exported since other location lookups (e.g. getOfficeCoordinates in
// ticket.$ticketNo.tsx) need the exact same normalization for the same
// reason — LOCATIONS_DATA stores "Jackson,MS" without the space, but
// canonicalBranchLabel() normalizes real ticket.location values to the
// spaced "Jackson, MS" form, so a strict string match between the two
// never succeeds.
export function normalizeLocationForRegionMatch(v: string): string {
  return (v || "").trim().replace(/,\s+/g, ",");
}

export function locationRegion(location: string): Region | null {
  const v = normalizeLocationForRegionMatch(location);
  for (const region of REGIONS) {
    if (REGION_LOCATIONS[region].some((loc) => normalizeLocationForRegionMatch(loc) === v)) return region;
  }
  return null;
}

export const TECHNICIANS_BY_LOCATION: Record<string, readonly string[]> = {
  Atlanta: ["Abel Severino", "Abraham Im", "Gerrell Berg", "Jordan Brown", "Joshua Silva", "Kevin Khaiphanliane", "Nathan Napora"],
  Birmingham: ["David Sims", "Kenny Shin", "Zonate Grant"],
  "Cape Girardeau": ["Alaska Olinger", "Deprece Harris", "Matthew Nichols"],
  Chattanooga: ["Austin Ferguson", "Christian Andrews", "Seven Grinis"],
  Columbus: ["A'Dejaun Tyson", "Matt Simmons", "Percy Smith"],
  Dallas: ["Lashamus Dowell"],
  Destin: ["Garrett McCarley"],
  Huntsville: ["Dylan Lano", "Jordan Stanley", "Nathan Wagner"],
  "Jackson, MS": ["Anthony Leonard Cavett", "Antonio Smith", "Mikkel Brown", "Terry Davis", "Tywon Ross"],
  "Jackson, TN": ["Brandon Phillips", "Christian Clark", "Gabriel Talley", "Jaylon Yarbrough", "Justin Parker"],
  Jacksonville: ["Bradley Hollowell", "Zakarya Moradi"],
  Jonesboro: ["Jason Bateman"],
  Knoxville: ["Alex Myles", "Joshua Rhinehart", "Zac Coisman"],
  "Lake Charles": ["Danny Thornton"],
  "Little Rock": ["Andre Riddle", "Darius Brown", "Jonathan Knox", "Nocona Detten"],
  Memphis: ["Darrin Stewart", "Darryel Burdette", "Jeff Lucas", "Memphis Admin", "Rico Shaw", "Sean Smith"],
  Mobile: ["Dominic Holman", "Jonathan Colquett", "Jonathon Allen", "Thaddaeus Springfield"],
  Montgomery: ["Andy Oh"],
  Nashville: ["Baolin Henry Zhang", "John Godfrey", "Justin Robertson", "Leo Sun", "Nashville Admin", "Steven Kurvink"],
  "New Orleans": ["Cole Mushinsky", "Cooper Shaffett", "Corey Cage", "Joseph Wease", "Kurt Merckel", "Ryder Tourere"],
  Norfolk: ["Chris Simpson", "Edward Lindsey"],
  Raleigh: ["Alexxis Henry", "Damon Ottley", "Javier Camel", "Marc James"],
  Richmond: ["Zachary Gonzalez"],
  "San Antonio": ["Erick Guzman Juarez"],
  Savannah: ["Carlos Ramirez", "Dustin Earls", "Lance Novak"],
  "St. Louis": ["Demarkco Cody", "Derious Nichols", "Jacob Rhodes", "Memphis Admin", "Tony Nguyen", "Troy Willis"],
  Tallahassee: ["Hunter Burch", "Matthew Mccrary"],
  Wilmington: ["Brye'shawn Butler", "Jordan Davis", "Josh Malloch", "Justin Alverez"],
  Asheville: ["Jordan Koetsier"],
  Philippines: [],
};

export function getTechniciansForLocation(location: string) {
  const normalized = normalizeLocationName(location);
  return TECHNICIANS_BY_LOCATION[normalized] ?? [];
}

export const ALL_TECHNICIANS = Array.from(
  new Set(Object.values(TECHNICIANS_BY_LOCATION).flat().filter(Boolean)),
).sort((a, b) => a.localeCompare(b));

export const PARTS_FROM_OPTIONS = [
  "AIG",
  "Electrolux",
  "Encompass",
  "Encompass-Birmingham l Montgomery",
  "GE",
  "LG",
  "Marcone- Birmingham / Montgomery",
  "Marcone-162468",
  "Midea",
  "Miele",
  "NSA",
  "OW",
  "SB",
  "Sharp",
  "SP",
  "Squaretrade",
  "SS",
] as const;

export function normalizeLocationName(location: string) {
  return String(location || "").trim().replace(/\s*,\s*/g, ", ");
}

export function mergeLocationOptions(...groups: Array<Iterable<string>>) {
  const seen = new Set<string>();
  const merged: string[] = [];

  groups.forEach((group) => {
    for (const location of group) {
      const normalized = normalizeLocationName(location);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      merged.push(normalized);
    }
  });

  return merged;
}

/**
 * Parse the `branch_access` profile field into a list of location strings.
 * Formats supported:
 *   - Empty / null → [] (no branches)
 *   - "*"          → all LOCATIONS
 *   - Pipe-separated: "Memphis|Atlanta|Nashville"
 *   - Comma-separated or concatenated: "MemphisAtlanta"
 */
export function parseBranchAccess(value: string | null | undefined): string[] {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  if (raw === "*") return [...LOCATIONS];
  if (raw.includes("|")) {
    return raw.split("|").map((s) => s.trim()).filter(Boolean);
  }
  const found: string[] = [];
  const sorted = [...LOCATIONS].sort((a, b) => b.length - a.length);
  let working = raw;
  while (working.length > 0) {
    working = working.replace(/^[\s,]+/, "");
    if (!working) break;
    const hit = sorted.find((loc) => working.startsWith(loc));
    if (!hit) {
      const next = working.indexOf(",");
      working = next === -1 ? "" : working.slice(next + 1);
      continue;
    }
    found.push(hit);
    working = working.slice(hit.length);
  }
  return Array.from(new Set(found));
}
