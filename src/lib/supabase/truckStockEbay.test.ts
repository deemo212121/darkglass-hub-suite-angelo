import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({ supabase: {} }));

import { allocateOnEbay, ebayPartKey, ebayStockKey } from "./truckStockEbay";

describe("ebayPartKey / ebayStockKey", () => {
  it("ignores case and spaces in the part #, and spelling of the branch", () => {
    expect(ebayPartKey(" wb44x39448 ")).toBe("WB44X39448");
    expect(ebayStockKey("Jackson, MS", "WB44X39448 ")).toBe(ebayStockKey("jackson ms", "wb44x39448"));
  });
  it("keeps dashes — DC93-00904D is not DC9300904D", () => {
    expect(ebayPartKey("DC93-00904D")).not.toBe(ebayPartKey("DC9300904D"));
  });
  it("is blank (never matches) without a branch or part #", () => {
    expect(ebayStockKey("", "W123")).toBe("");
    expect(ebayStockKey("Mobile", "  ")).toBe("");
  });
});

describe("allocateOnEbay", () => {
  const row = (id: string, branch: string, partNo: string, quantity: number, status: "in_stock" | "ebay" = "in_stock") => ({ id, branch, partNo, quantity, status });

  it("puts a branch's listed units on its row, never more than it holds", () => {
    const onEbay = new Map([[ebayStockKey("Mobile", "W1"), 1], [ebayStockKey("Mobile", "W2"), 5]]);
    const got = allocateOnEbay([row("a", "Mobile", "W1", 3), row("b", "Mobile", "W2", 2), row("c", "Atlanta", "W1", 4)], onEbay);
    expect(got.get("a")).toBe(1);
    expect(got.get("b")).toBe(2);
    expect(got.has("c")).toBe(false);
  });

  it("with the branch spelled two ways, fills the IN STOCK row with the most units first", () => {
    const onEbay = new Map([[ebayStockKey("Jackson, MS", "W1"), 3]]);
    const got = allocateOnEbay(
      [row("x", "Jackson,MS", "W1", 1), row("y", "Jackson, MS", "w1", 2), row("z", "Jackson MS", "W1", 5, "ebay")],
      onEbay,
    );
    expect(got.get("y")).toBe(2);
    expect(got.get("x")).toBe(1);
    expect(got.has("z")).toBe(false);
  });

  it("returns nothing when nothing is listed", () => {
    expect(allocateOnEbay([row("a", "Mobile", "W1", 3)], new Map()).size).toBe(0);
  });
});
