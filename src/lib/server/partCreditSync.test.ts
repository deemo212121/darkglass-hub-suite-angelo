import { describe, expect, it } from "vitest";
import { marconeCreditUpdates, marconeOrderCreditUpdates, marconeOrderKey, type CreditPartRow } from "./partCreditSync";

const NOW = "2026-11-17T15:00:00.000Z";
const part = (over: Partial<CreditPartRow>): CreditPartRow => ({
  id: "p1", part_no: "5304526183", part_dist: "Marcone-162468", invoice_no: "77992917", ra_no: null, credit_no: null,
  credited_at: null, return_reject_reason: null, return_status: null, credit_checked_at: null, quantity: 1, part_price: 28.26, ...over,
});

describe("Marcone order status → credited parts", () => {
  // 1008819560-10: both parts credited back with no RA — order 77992917 says returned 1 on each line.
  const items = [
    { partNumber: "5304522340", billedPrice: 51.34, returned: 1 },
    { partNumber: "5304526183", billedPrice: 28.26, returned: 1 },
    { partNumber: "140282033103", billedPrice: 28.68, returned: 0 },
  ];

  it("marks each returned part credited, at the price Marcone billed", () => {
    const updates = marconeOrderCreditUpdates([part({ id: "a" }), part({ id: "b", part_no: "5304522340", part_price: 51.34 })], items, NOW);
    expect(updates.map((u) => u.patch)).toEqual([
      { credited_at: NOW, credit_source: "Marcone", credit_checked_at: NOW, credit_qty: 1, credit_amount: 28.26, return_reject_reason: null },
      { credited_at: NOW, credit_source: "Marcone", credit_checked_at: NOW, credit_qty: 1, credit_amount: 51.34, return_reject_reason: null },
    ]);
  });

  it("only notes the check when nothing was returned (a Submitted RA still shows 0)", () => {
    const [u] = marconeOrderCreditUpdates([part({ part_no: "140282033103" })], items, NOW);
    expect(u.patch).toEqual({ credit_checked_at: NOW });
  });

  it("shares one returned line out over our rows, never counting it twice", () => {
    const updates = marconeOrderCreditUpdates([part({ id: "a" }), part({ id: "b" })], [{ partNumber: "5304526183", billedPrice: 28.26, returned: 1 }], NOW);
    expect(updates.map((u) => u.patch.credit_qty ?? null)).toEqual([1, null]);
  });

  it("credits part of a quantity", () => {
    const [u] = marconeOrderCreditUpdates([part({ quantity: 2 })], [{ partNumber: "5304526183", billedPrice: 28.26, returned: 1 }], NOW);
    expect(u.patch).toMatchObject({ credit_qty: 1, credit_amount: 28.26 });
  });

  it("looks orders up by Marcone's invoice #, not a tracking # typed into Invoice No", () => {
    expect(marconeOrderKey(part({ invoice_no: "77992917-1" }))).toBe("77992917");
    expect(marconeOrderKey(part({ invoice_no: "879386185880" }))).toBe("");
    expect(marconeOrderKey(part({ invoice_no: "879386185880", order_no: "77992917" }))).toBe("77992917");
  });

  it("only fills in the amount on a part an RA already credited", () => {
    const [u] = marconeOrderCreditUpdates([part({ credited_at: "2026-10-30T00:00:00Z" })], items, NOW);
    expect(u.patch).toEqual({ credit_checked_at: NOW, credit_qty: 1, credit_amount: 28.26 });
  });
});

describe("Marcone RA credit → amount", () => {
  it("uses our part price (an RA item's own price is 0)", () => {
    const [u] = marconeCreditUpdates([part({ invoice_no: "77860959-1" })], [{ invoiceNumber: 77860959, partNumber: "5304526183", creditMemo: " 78566271", returned: 1 }], NOW);
    expect(u.patch).toMatchObject({ credited_at: NOW, credit_source: "Marcone", credit_qty: 1, credit_amount: 28.26, credit_no: "78566271" });
  });
});
