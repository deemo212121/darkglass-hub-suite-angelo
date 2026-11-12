import { describe, expect, it } from "vitest";
import { isNewSince, toNewWageItem, type NewWageDoc } from "./newPromotions";

const doc = (over: Partial<NewWageDoc>): NewWageDoc => ({
  id: "a",
  documentType: "promotion_form",
  status: "confirmed",
  formData: {},
  createdAt: "2026-11-10T10:00:00Z",
  confirmedAt: "2026-11-12T10:00:00Z",
  pdfUrl: null,
  ...over,
});

describe("toNewWageItem", () => {
  it("reads a promotion form: old → new position and the wage", () => {
    const item = toNewWageItem(doc({
      formData: { employeeName: "Jeryan Luzano", currentPosition: "CSR", newPositionTitle: "Senior CSR", wageAmount: "25", wageBasis: "hourly", effectiveDate: "2026-11-16" },
    }));
    expect(item).toMatchObject({ employeeName: "Jeryan Luzano", oldPosition: "CSR", newPosition: "Senior CSR", newWage: "$25 per hour", effectiveDate: "2026-11-16", status: "confirmed", adjusted: null });
  });

  it("reads a wage-increase letter: new salary and the increase", () => {
    const item = toNewWageItem(doc({
      documentType: "compensation_update",
      formData: { employeeName: "Matt Simmons", newPosition: "Team Lead", startingSalary: "30", salaryIncrease: "+5" },
    }));
    expect(item).toMatchObject({ oldPosition: "", newPosition: "Team Lead", newWage: "$30 (+$5)" });
  });

  it("keeps papers still waiting on signatures, leaves out cancelled ones", () => {
    expect(toNewWageItem(doc({ status: "pending_signature", confirmedAt: null }))?.status).toBe("pending_signature");
    expect(toNewWageItem(doc({ status: "cancelled" }))).toBeNull();
  });

  it("carries Accounting's Adjusted mark", () => {
    expect(toNewWageItem(doc({}), { byName: "Ana", at: "2026-11-12T11:00:00Z" })?.adjusted).toEqual({ byName: "Ana", at: "2026-11-12T11:00:00Z" });
  });
});

describe("isNewSince", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  it("counts papers sent or completed after the list was last opened", () => {
    expect(isNewSince({ createdAt: "2026-11-01T00:00:00Z", confirmedAt: "2026-11-12T11:00:00Z" }, "2026-11-12T10:00:00Z", now)).toBe(true);
    expect(isNewSince({ createdAt: "2026-11-12T11:00:00Z", confirmedAt: null }, "2026-11-12T10:00:00Z", now)).toBe(true);
    expect(isNewSince({ createdAt: "2026-11-01T00:00:00Z", confirmedAt: "2026-11-12T09:00:00Z" }, "2026-11-12T10:00:00Z", now)).toBe(false);
  });
  it("on a first visit, only the last 30 days count", () => {
    expect(isNewSince({ createdAt: "2026-11-01T00:00:00Z", confirmedAt: null }, null, now)).toBe(true);
    expect(isNewSince({ createdAt: "2026-09-01T00:00:00Z", confirmedAt: null }, null, now)).toBe(false);
  });
});
