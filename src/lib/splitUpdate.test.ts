import { describe, expect, it } from "vitest";
import { splitUpdate } from "./splitUpdate";

describe("splitUpdate", () => {
  it("splits body bullets under the commit's topic", () => {
    const text = [
      "Tickets -> No-Coverage Tickets: Add ZIP to a branch and change the status right from the list",
      "",
      "- New Action column, Add ZIP: pick the branch (and city) and the ticket's ZIP",
      "  goes into Location Management -> Covered Zip Codes.",
      "- Status is a dropdown on each row (same statuses as Work Planner).",
      "- The status list now lives in one place (ticketData.ts) for Work Planner",
      "  and this page.",
    ].join("\n");
    expect(splitUpdate(text)).toEqual([
      "Tickets -> No-Coverage Tickets: New Action column, Add ZIP: pick the branch (and city) and the ticket's ZIP goes into Location Management -> Covered Zip Codes.",
      "Tickets -> No-Coverage Tickets: Status is a dropdown on each row (same statuses as Work Planner).",
      "Tickets -> No-Coverage Tickets: The status list now lives in one place (ticketData.ts) for Work Planner and this page.",
    ]);
  });

  it("splits '; ' parts of the first line", () => {
    expect(splitUpdate("Claims: GE job code dropdown on Pre-Claim (label note beside it); Need Claim List red REDO pill")).toEqual([
      "Claims: GE job code dropdown on Pre-Claim (label note beside it)",
      "Claims: Need Claim List red REDO pill",
    ]);
  });

  it("splits an 'Add A, B, and fix C' list, carrying the verb", () => {
    expect(splitUpdate("Add Technician Details panel, Master List funnel filters, and fix chat message/composer spacing")).toEqual([
      "Add Technician Details panel",
      "Add Master List funnel filters",
      "Fix chat message/composer spacing",
    ]);
  });

  it("keeps a list of short names whole, and never splits inside brackets", () => {
    const forms = "Add Damage, Contractor Data, Direct Deposit, and Parts Responsibility automated forms";
    expect(splitUpdate(forms)).toEqual([forms]);
    const one = "Add Recruitment Site tab (Zip Recruiter, Indeed, Branch)";
    expect(splitUpdate(one)).toEqual([one]);
  });

  it("leaves a plain message, and a message with only paragraphs, as one", () => {
    expect(splitUpdate("Fix reviewed payroll sync variable collision")).toEqual(["Fix reviewed payroll sync variable collision"]);
    const para = "Claims -> Marcone & Encompass Parts: invoiced parts by month\n\nNew page in the Claims module.\n\nEach invoice is looked up read-only.";
    expect(splitUpdate(para)).toEqual([para]);
  });

  it("keeps the rest of the message with the first entry", () => {
    const out = splitUpdate("Add Ticket Attendance search filters and Notes; add mobile Ticket Attendance details view\n\nMore words here.");
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("More words here.");
    expect(out[1]).toBe("Add mobile Ticket Attendance details view");
  });
});
