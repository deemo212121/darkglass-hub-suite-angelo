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