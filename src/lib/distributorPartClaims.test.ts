import { describe, expect, it } from "vitest";
import { distributorInvoiceRef, distributorOf, isUsedPart, matchInvoiceLine, partClaimState, type PartClaimFacts } from "./distributorPartClaims";

const facts = (over: Partial<PartClaimFacts>): PartClaimFacts => ({
  partStatus: "Used",
  ticketStatus: "CL-Ready to Complete",
  creditedAt: "",
  spSubmittedAt: "",
  spPaymentDate: "",
  spClaimStatusCode: "",
  spPaidTotal: null,
  ...over,
});

describe("distributorOf", () => {
  it("reads the distributor out of the account-suffixed names", () => {
    expect(distributorOf("Marcone-162468")).toBe("Marcone");
    expect(distributorOf("Marcone- Birmingham / Montgomery")).toBe("Marcone");
    expect(distributorOf("Encompass-Birmingham / Montgomery")).toBe("Encompass");
    expect(distributorOf("NSA")).toBeNull();
    expect(distributorOf(null)).toBeNull();
  });
});

describe("isUsedPart", () => {
  it("counts Used, Claimed and PAID only", () => {
    expect(["Used", "Claimed", "PAID", " used "].map(isUsedPart)).toEqual([true, true, true, true]);
    expect(["Part Ready", "RA - PNN", "CX Home", "Not Used & Stocked", ""].map(isUsedPart)).toEqual([false, false, false, false, false]);
  });
});

describe("partClaimState", () => {
  it("alerts on a used part whose job is done but was never claimed", () => {
    expect(partClaimState(facts({}))).toBe("not-claimed");
    expect(partClaimState(facts({ ticketStatus: "CL-Cancelled" }))).toBe("not-claimed");
    expect(partClaimState(facts({ ticketStatus: "CL-Need Cancel" }))).toBe("not-claimed");
  });

  it("doesn't alert while the ticket is still being worked", () => {
    expect(partClaimState(facts({ ticketStatus: "OP-Ready for Service" }))).toBe("job-open");
    expect(partClaimState(facts({ ticketStatus: "TR-Need PO" }))).toBe("job-open");
    expect(partClaimState(facts({ ticketStatus: "CL-Parts Back Ordered" }))).toBe("job-open");
  });

  it("counts the claim from the part, the ticket or an AHS submission", () => {
    expect(partClaimState(facts({ partStatus: "Claimed" }))).toBe("claimed");
    expect(partClaimState(facts({ ticketStatus: "CL-Claimed" }))).toBe("claimed");
    expect(partClaimState(facts({ ticketStatus: "CL-Data-Closed" }))).toBe("claimed");
    expect(partClaimState(facts({ spSubmittedAt: "2026-10-19T21:41:57Z" }))).toBe("claimed");
  });

  it("paid when ServicePower paid or the part says PAID; credited beats everything", () => {
    expect(partClaimState(facts({ ticketStatus: "CL-Claimed", spPaymentDate: "2026-10-27" }))).toBe("paid");
    expect(partClaimState(facts({ ticketStatus: "CL-Claimed", spClaimStatusCode: "P", spPaidTotal: 0 }))).toBe("paid");
    expect(partClaimState(facts({ ticketStatus: "CL-Claimed", spClaimStatusCode: "D", spPaidTotal: 0 }))).toBe("claimed");
    expect(partClaimState(facts({ partStatus: "PAID" }))).toBe("paid");
    expect(partClaimState(facts({ partStatus: "Claimed", spPaymentDate: "2026-10-27", creditedAt: "2026-11-01T10:00:00Z" }))).toBe("credited");
  });

  it("returned parts wait for the credit; parts not used yet aren't claim items", () => {
    expect(partClaimState(facts({ partStatus: "RA - PNN" }))).toBe("returned");
    expect(partClaimState(facts({ partStatus: "RA- DMG" }))).toBe("returned");
    expect(partClaimState(facts({ partStatus: "Defective" }))).toBe("returned");
    expect(partClaimState(facts({ partStatus: "RA - PNN", creditedAt: "2026-11-05T10:00:00Z" }))).toBe("credited");
    expect(partClaimState(facts({ partStatus: "Part Ready" }))).toBe("not-used");
    expect(partClaimState(facts({ partStatus: "Not Used & Stocked", ticketStatus: "CL-Claimed" }))).toBe("not-used");
  });
});

describe("distributorInvoiceRef", () => {
  it("Marcone: the leading digits (its order number)", () => {
    expect(distributorInvoiceRef("Marcone", "78397586-1")).toBe("78397586");
    expect(distributorInvoiceRef("Marcone", "75268496-1007618260-10")).toBe("75268496");
    expect(distributorInvoiceRef("Marcone", "76592748- SA-4697837")).toBe("76592748");
    expect(distributorInvoiceRef("Marcone", "1-456874-0626-1")).toBe("");
  });
  it("Encompass: the invoice without our line ending", () => {
    expect(distributorInvoiceRef("Encompass", "1-456874-0626-1")).toBe("1-456874-0626");
    expect(distributorInvoiceRef("Encompass", "25-302334-0626-1")).toBe("25-302334-0626");
    expect(distributorInvoiceRef("Encompass", "1-456874-0626")).toBe("1-456874-0626");
    expect(distributorInvoiceRef("Encompass", "76428779-1")).toBe("");
  });
});

describe("matchInvoiceLine", () => {
  const line = (partNumbers: string[]) => ({ partNumbers, qty: 1, unitPrice: 10, amount: 10, status: "OK", returned: 0 });
  it("matches the part number ignoring case and dashes, original part # too", () => {
    const lines = [line(["ADJ75622509"]), line(["WR55X48305", "WR55X10942"])];
    expect(matchInvoiceLine(lines, "adj-75622509")).toBe(lines[0]);
    expect(matchInvoiceLine(lines, "WR55X10942")).toBe(lines[1]);
    expect(matchInvoiceLine(lines, "WB17X10030")).toBeNull();
    expect(matchInvoiceLine(lines, "")).toBeNull();
  });
});
