import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));

import { parseTruckStockTables } from "./truckStockFile";

describe("Import: MISSING / LOST rows (migration 0478)", () => {
  const list = (rows: string[][]) => parseTruckStockTables([{ name: "Sheet1", rows: [["Branch", "Part No", "Qty", "Status", "Notes"], ...rows] }]);

  it("puts MISSING and LOST rows on the Missing list and keeps them out of stock", () => {
    const parsed = list([
      ["Mobile", "WB27X50046", "2", "MISSING", "not on A1"],
      ["Mobile", "W11316914", "1", "Lost", ""],
      ["Mobile", "DC93-00904D", "3", "IN STOCK", ""],
    ]);
    expect(parsed.missing).toEqual([
      expect.objectContaining({ branch: "Mobile", partNo: "WB27X50046", quantity: 2, notes: "MISSING · not on A1" }),
      expect.objectContaining({ branch: "Mobile", partNo: "W11316914", quantity: 1, notes: "Lost" }),
    ]);
    const stock = Object.fromEntries(parsed.parts.map((p) => [p.partNo, p.quantity]));
    expect(stock["DC93-00904D"]).toBe(3);
    expect(stock["WB27X50046"]).toBe(0);
    expect(stock["W11316914"]).toBe(0);
    expect(parsed.skipped).toMatchObject({ Missing: 1, Lost: 1 });
  });

  it("adds the same branch + part together, and drops a 0 count (an exported all-MISSING row)", () => {
    const parsed = list([
      ["Atlanta", "P1", "1", "MISSING", ""],
      ["atlanta", "P1", "2", "LOST", ""],
      ["Atlanta", "P2", "0", "MISSING", ""],
    ]);
    expect(parsed.missing).toHaveLength(1);
    expect(parsed.missing[0]).toMatchObject({ partNo: "P1", quantity: 3 });
  });

  it("leaves Used rows on the Used list, not Missing", () => {
    const parsed = list([["Mobile", "P9", "1", "USED", "TICKET#: 26000774644DF"]]);
    expect(parsed.missing).toHaveLength(0);
    expect(parsed.used).toHaveLength(1);
  });
});
