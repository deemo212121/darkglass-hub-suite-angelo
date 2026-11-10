import { describe, expect, it } from "vitest";
import { normalizeTicketExportRow } from "./ticketExportFormat";

describe("ticket grid export", () => {
  it("maps grid fields, preserves ticket text, and interprets US dates", () => {
    const row = normalizeTicketExportRow({ "Ticket No": "033480794138", Status: "TR-Need Triage", "Cx Name": "Test Customer", Schedule: "11/12/2026", Posting: "11/10/2026", Loc: "Richmond", Branch: "4930403", "Src/Brand": "SQUARE TRADE", MfgAbbName: "LG" });
    expect(row).toMatchObject({ TicketNo: "033480794138", StatusDesc: "TR-Need Triage", CxUserName: "Test Customer", ScheduleDate: "2026-11-12", PostingDate: "2026-11-10", LocationName: "Richmond", MfgName: "SQUARE TRADE", MfgAbbName: "LG" });
    expect(row.Branch).toBeUndefined();
  });
  it("leaves legacy dates and columns unchanged", () => {
    const row = { TicketNo: "3890096E1", StatusDesc: "Open", CxUserName: "Test", ScheduleDate: "12/11/2026" };
    expect(normalizeTicketExportRow(row)).toEqual(row);
  });
  it("rejects impossible grid dates", () => {
    expect(() => normalizeTicketExportRow({ "Ticket No": "1", Status: "Open", "Cx Name": "Test", Schedule: "02/30/2026" })).toThrow("Invalid ScheduleDate");
  });
});
