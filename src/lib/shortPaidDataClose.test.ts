import { describe, expect, it, vi } from "vitest";

// One row set per table, served by a stub of the client's from().select().in() chain.
const tables: Record<string, any[]> = {};
vi.mock("./supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        in: async (col: string, values: string[]) => ({ data: (tables[table] ?? []).filter((r) => values.includes(r[col])), error: null }),
      }),
    }),
  },
}));

import { canDataCloseShortPaid, isDataClosedStatus, shortPaidDataCloseBlocked } from "@/lib/shortPaidDataClose";

const fees = { labor_fee: 100, other_fee: 0, shipping_fee: 0, extra_mile_fee: 0 };

describe("short-paid claims: only Accounting moves them to CL-Data-Closed", () => {
  tables.tickets = [
    { id: "t1", ticket_no: "SHORT" },
    { id: "t2", ticket_no: "FULL" },
    { id: "t3", ticket_no: "NOFEES" },
    { id: "t4", ticket_no: "UNPAID" },
  ];
  tables.ticket_claim_details = [
    { ticket_id: "t1", ...fees, sp_claim_status_code: "P", sp_paid_total: 100 }, // + $50 part = $150 claimed
    { ticket_id: "t2", ...fees, sp_claim_status_code: "P", sp_paid_total: 110 }, // + $10 part = $110 claimed
    { ticket_id: "t3", labor_fee: 0, other_fee: 0, shipping_fee: 0, extra_mile_fee: 0, sp_claim_status_code: "P", sp_paid_total: 5 },
    { ticket_id: "t4", ...fees, sp_claim_status_code: "A", sp_paid_total: 0 },
  ];
  tables.parts = [
    { ticket_id: "t1", part_price: 50, markup: 0, status: "Used" },
    { ticket_id: "t1", part_price: 999, markup: 0, status: "Returned" }, // not claimable
    { ticket_id: "t2", part_price: 10, markup: 0, status: "Claimed" },
  ];
  const all = ["SHORT", "FULL", "NOFEES", "UNPAID"];

  it("blocks only the short-paid claim, for someone who isn't Accounting", async () => {
    expect(await shortPaidDataCloseBlocked("CL-Data-Closed", all, "CLAIMS", [])).toEqual(new Set(["SHORT"]));
  });

  it("lets Accounting, Admin, Super Admin and IT close it", async () => {
    for (const [role, extra] of [["FINANCE", []], ["ACCOUNTING_MANAGER", []], ["CLAIMS", ["FINANCE"]], ["ADMIN", []], ["SUPERADMIN", []], ["IT", []], ["SUPERSUPERADMIN", []]] as const) {
      expect(canDataCloseShortPaid(role, [...extra])).toBe(true);
      expect((await shortPaidDataCloseBlocked("CL-Data-Closed", all, role, [...extra])).size).toBe(0);
    }
    expect(canDataCloseShortPaid("CLAIMS_MANAGER", ["HR"])).toBe(false);
  });

  it("only guards the move to CL-Data-Closed", async () => {
    expect((await shortPaidDataCloseBlocked("CL-Ready to Complete", all, "CLAIMS", [])).size).toBe(0);
    expect(isDataClosedStatus("CL-Data Closed")).toBe(true);
    expect(isDataClosedStatus(" cl-data-closed ")).toBe(true);
    expect(isDataClosedStatus("CL-Claimed")).toBe(false);
  });
});
