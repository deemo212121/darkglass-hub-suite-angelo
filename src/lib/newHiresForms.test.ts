import { describe, expect, it } from "vitest";
import { buildNewHireRows, hireFormFileName, parseHireDate, type HireFormDoc, type HirePerson } from "./newHiresForms";

const person = (id: string, hireDate: string | null, over: Partial<HirePerson> = {}): HirePerson => ({
  id, name: `Person ${id}`, role: "TECHNICIAN", branch: "Dallas", department: "", hireDate, group: "TECH", ...over,
});
const doc = (over: Partial<HireFormDoc>): HireFormDoc => ({
  id: "d", documentType: "w4", status: "confirmed", recipientId: "a", pdfUrl: "https://x/w4.pdf",
  createdAt: "2026-11-10T00:00:00Z", signedAt: null, confirmedAt: null, ...over,
});

describe("parseHireDate", () => {
  it("reads ISO and M/D/YYYY dates", () => {
    expect(parseHireDate("2026-11-10")).toBe("2026-11-10");
    expect(parseHireDate("2026-11-10T05:00:00Z")).toBe("2026-11-10");
    expect(parseHireDate("11/9/2026")).toBe("2026-11-09");
    expect(parseHireDate("")).toBeNull();
    expect(parseHireDate("soon")).toBeNull();
  });
});

describe("buildNewHireRows", () => {
  it("keeps only people hired inside the pay period, both ends included", () => {
    const rows = buildNewHireRows(
      [person("a", "2026-11-08"), person("b", "2026-11-21"), person("c", "2026-11-07"), person("d", "2026-11-22"), person("e", null)],
      [], "2026-11-08", "2026-11-21",
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("shows where each form stands, best copy wins", () => {
    const rows = buildNewHireRows(
      [person("a", "2026-11-10")],
      [
        doc({ id: "w4-old", status: "confirmed" }),
        doc({ id: "w4-resent", status: "pending_signature", createdAt: "2026-11-12T00:00:00Z" }),
        doc({ id: "dd", documentType: "direct_deposit", status: "pending_signature" }),
        doc({ id: "i9x", documentType: "i9", status: "cancelled" }),
      ],
      "2026-11-08", "2026-11-21",
    );
    expect(rows[0].forms.w4?.doc?.id).toBe("w4-old");
    expect(rows[0].forms.w4?.status).toBe("done");
    expect(rows[0].forms.direct_deposit?.status).toBe("awaiting_employee");
    expect(rows[0].forms.i9?.status).toBe("not_sent");
  });
});

describe("hireFormFileName", () => {
  it("names each file by person, form and hire date", () => {
    expect(hireFormFileName({ name: "Juan / Dela Cruz", hireDay: "2026-11-10" }, "w4")).toBe("Juan Dela Cruz - W-4 (hired 2026-11-10).pdf");
  });
});
