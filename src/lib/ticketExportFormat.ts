/** Display-grid exports use US dates; legacy ServicePower exports use day-first dates. */
const GRID_COLUMNS: Record<string, string> = {
  "Ticket No": "TicketNo", Wty: "WarrantyType", "Src/Brand": "MfgName",
  "Cx Name": "CxUserName", City: "CxCity", Loc: "LocationName",
  Model: "ModelCode", "Internal Note": "NoteInternal", Technician: "TechName",
  "Cx Prefer": "CxPreferredDate", Schedule: "ScheduleDate", Status: "StatusDesc",
  Phone: "CxPhone", Calls: "nCallAttempt", "Diag.": "DiagnosedYn", Posting: "PostingDate",
};

export function isGridTicketHeader(header: string[]): boolean {
  return ["Ticket No", "Status", "Cx Name"].every((key) => header.includes(key));
}

export function normalizeTicketExportRow(row: Record<string, string>): Record<string, string> {
  if (!isGridTicketHeader(Object.keys(row))) return row;
  const result = { ...row };
  for (const [source, target] of Object.entries(GRID_COLUMNS)) {
    if (source in row) result[target] = row[source];
  }
  for (const key of ["ScheduleDate", "CxPreferredDate", "PostingDate"]) {
    const value = result[key] ?? "";
    const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/);
    if (match) {
      const [, month, day, year] = match;
      const date = new Date(Date.UTC(+year, +month - 1, +day));
      if (date.getUTCFullYear() !== +year || date.getUTCMonth() !== +month - 1 || date.getUTCDate() !== +day) {
        throw new Error(`Invalid ${key} date: ${value}`);
      }
      result[key] = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
  }
  // "Branch" in the grid is an identifier, not the location name. Loc maps above.
  delete result.Branch;
  return result;
}
