/**
 * Job codes per claim company / manufacturer — the Pre-Claim form's Job Code
 * becomes a dropdown of these (or, for Electrolux, the Defect Code) when the
 * ticket's Claim To account, claim company, manufacturer or brand matches.
 * To add another company, add one entry.
 */
export interface JobCodeOption {
  /** What is saved and sent to ServicePower. */
  code: string;
  /** What the dropdown shows after the code, e.g. "Successful repair". */
  note?: string;
}

export interface ManufacturerJobCodes {
  key: "ge" | "electrolux" | "sqt" | "assurant";
  /** Shown beside the field label, e.g. "GE job code". */
  label: string;
  /** The field's own label on Pre-Claim. */
  fieldLabel: string;
  /** Which claim field this list fills: the Job Code, or (Electrolux) the Failure/Defect Code. */
  field: "jobCode" | "failureDefectCode";
  /** Matched against the Claim To account, claim company, manufacturer, then brand. */
  match: RegExp;
  /** Empty = a plain text box (only the label changes). */
  codes: JobCodeOption[];
  /** Pre-Claim fills these in when the claim has none yet — still changeable. */
  defaults?: { repairCategory?: string; failureDefectCode?: string };
}

export const MANUFACTURER_JOB_CODES: ManufacturerJobCodes[] = [
  // Warranty companies first — a Square Trade / Assurant claim on a GE appliance takes their codes.
  {
    key: "sqt",
    label: "SQT",
    fieldLabel: "Repair / Job Code 1",
    field: "jobCode",
    defaults: { repairCategory: "Minor on-site service", failureDefectCode: "MECH" },
    match: /square\s*trade|^\s*sqt\b/i,
    codes: [
      { code: "REP", note: "Successful repair" },
      { code: "BER", note: "Unsuccessful repair" },
      { code: "CNR", note: "Customer not responding" },
      { code: "NPF", note: "No problem found" },
      { code: "PNA", note: "Parts needed assessment" },
    ],
  },
  {
    key: "assurant",
    label: "Assurant",
    fieldLabel: "Job Code / Tier Code",
    field: "jobCode",
    match: /assurant/i,
    codes: [
      { code: "MA00", note: "110 · dx only" },
      // One code, two tiers — ServicePower only gets the code.
      { code: "MA02", note: "135 · with parts / 185 · 2-man, stacked" },
      { code: "MA03", note: "230 · SS" },
      { code: "MA04", note: "210 · backtub" },
      { code: "T200", note: "170 · dx only" },
      { code: "T202", note: "195 · with parts" },
      { code: "T203", note: "290 · SS" },
      { code: "T300", note: "210 · dx only" },
      { code: "T302", note: "235 · with parts" },
      { code: "T303", note: "330 · SS" },
      { code: "T400", note: "280 · dx only" },
      { code: "T402", note: "295 · with parts" },
      { code: "T403", note: "390 · SS" },
    ],
  },
  {
    key: "ge",
    label: "GE",
    fieldLabel: "Job Code",
    field: "jobCode",
    match: /^\s*(ge|general electric)\b/i,
    codes: [{ code: "MA00" }, { code: "MG00" }, { code: "SS00" }, { code: "SG00" }],
  },
  {
    // Frigidaire is Electrolux's brand — ServicePower sent a Frigidaire claim back for "Blank/Invalid Defect code".
    key: "electrolux",
    label: "Electrolux",
    fieldLabel: "Defect Code",
    field: "failureDefectCode",
    match: /electrolux|frigidaire/i,
    codes: [],
  },
];

/**
 * ServicePower's Repair Category choices — the codes are the option values
 * on ServicePower's own claim screen (SDDRPRCTG). Pre-Claim saves the name;
 * the claim sends the code.
 */
export const REPAIR_CATEGORIES: { code: string; label: string }[] = [
  { code: "2", label: "Minor on-site service" },
  { code: "3", label: "Intermediate on-site service" },
  { code: "4", label: "Major on-site service" },
  { code: "5", label: "Minor carry-in service" },
  { code: "6", label: "Intermediate carry-in service" },
  { code: "7", label: "Major carry-in service" },
  { code: "8", label: "Minor tech/shop service" },
  { code: "9", label: "Intermediate tech/shop service" },
  { code: "10", label: "Major tech/shop service" },
  { code: "11", label: "Minor stock merchandise service" },
  { code: "12", label: "Intermediate stock merchandise service" },
  { code: "13", label: "Major stock merchandise service" },
];

/** The code ServicePower expects for a saved Repair Category (a name from the list, or already a code). */
export function repairCategoryCode(value?: string | null): string | undefined {
  const v = String(value ?? "").trim();
  if (!v) return undefined;
  const hit = REPAIR_CATEGORIES.find((c) => c.label.toLowerCase() === v.toLowerCase() || c.code === v);
  return hit ? hit.code : v.slice(0, 2);
}

/** The job-code rules for this ticket — pass its Claim To account, claim company, manufacturer and brand, most specific first. */
export function jobCodesFor(...names: (string | null | undefined)[]): ManufacturerJobCodes | null {
  for (const name of names) {
    if (!name) continue;
    const hit = MANUFACTURER_JOB_CODES.find((m) => m.match.test(name));
    if (hit) return hit;
  }
  return null;
}
