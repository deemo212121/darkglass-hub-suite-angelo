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
}

export const MANUFACTURER_JOB_CODES: ManufacturerJobCodes[] = [
  // Warranty companies first — a Square Trade / Assurant claim on a GE appliance takes their codes.
  {
    key: "sqt",
    label: "SQT",
    fieldLabel: "Repair / Job Code 1",
    field: "jobCode",
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

/** The job-code rules for this ticket — pass its Claim To account, claim company, manufacturer and brand, most specific first. */
export function jobCodesFor(...names: (string | null | undefined)[]): ManufacturerJobCodes | null {
  for (const name of names) {
    if (!name) continue;
    const hit = MANUFACTURER_JOB_CODES.find((m) => m.match.test(name));
    if (hit) return hit;
  }
  return null;
}
