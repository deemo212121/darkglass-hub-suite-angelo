/**
 * Maps the spreadsheet's short branch codes (AV, ATL, BM, …) to the full
 * branch names defined in `src/lib/locations.ts`. Used during the
 * "Import workbook" step on the Truck Stock page so the rows show up
 * grouped under recognisable city names instead of the cryptic 2- to
 * 3-letter codes the inventory spreadsheet uses internally.
 *
 * Verified mappings (cross-checked against the technicians-by-location
 * roster — e.g. CT contained 91 references to Chattanooga techs):
 *   AV  → Asheville         (only Jordan Koetsier shows up there)
 *   ATL → Atlanta
 *   BM  → Birmingham        (42 Birmingham techs vs 2 from Montgomery)
 *   CT  → Chattanooga       (91 Chattanooga techs)
 *   LR  → Little Rock       (27 Little Rock techs)
 *   MG  → Montgomery        (359 references)
 *   NF  → Norfolk           (33 Norfolk techs)
 *   RL  → Raleigh           (739 Raleigh techs)
 *   RD  → Richmond          (20 Richmond techs)
 *   SV  → Savannah          (406 Savannah techs)
 *   TL  → Tallahassee       (only city visible in the data)
 *
 * Reasonable guesses that the data didn't confirm (no tech names in the
 * truck stock sheets, since most rows are unassigned inventory). Once
 * you confirm in person, just edit this table:
 *   CB  → Columbus
 *   CG  → Cape Girardeau
 *   DT  → Destin
 *   DL  → Dallas
 *   HV  → Huntsville
 *   JS  → Jacksonville
 *   JB  → Jonesboro
 *   JT  → Jackson, TN
 *   JV  → Jacksonville (TODO confirm vs JS — could also be Jacksonville TX)
 *   KV  → Knoxville
 *   LC  → Lake Charles
 *   MB  → Mobile
 *   MP  → Memphis
 *   NO  → New Orleans
 *   NV  → Nashville
 *   SA  → San Antonio
 *   SL  → St. Louis
 *   WM  → Wilmington
 */
export const TRUCK_STOCK_BRANCH_CODE_MAP: Record<string, string> = {
  // Confirmed
  AV: "Asheville",
  ATL: "Atlanta",
  BM: "Birmingham",
  CT: "Chattanooga",
  LR: "Little Rock",
  MG: "Montgomery",
  NF: "Norfolk",
  RL: "Raleigh",
  RD: "Richmond",
  SV: "Savannah",
  TL: "Tallahassee",

  // Best-guess — edit these if you spot a wrong one.
  CB: "Columbus",
  CG: "Cape Girardeau",
  DT: "Destin",
  DL: "Dallas",
  HV: "Huntsville",
  JS: "Jacksonville",
  JB: "Jonesboro",
  JT: "Jackson, TN",
  JV: "Jacksonville",
  KV: "Knoxville",
  LC: "Lake Charles",
  MB: "Mobile",
  MP: "Memphis",
  NO: "New Orleans",
  NV: "Nashville",
  SA: "San Antonio",
  SL: "St. Louis",
  WM: "Wilmington",
};

/**
 * Translate one of the spreadsheet codes to the full branch name. Falls
 * back to the original input if we don't have a mapping yet, so unknown
 * codes still get imported (just under their raw label).
 */
export function resolveTruckStockBranch(code: string): string {
  const trimmed = String(code || "").trim();
  return TRUCK_STOCK_BRANCH_CODE_MAP[trimmed.toUpperCase()] || trimmed;
}
