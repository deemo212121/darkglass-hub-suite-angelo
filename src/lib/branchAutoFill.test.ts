import { describe, expect, it } from "vitest";
import { EXPENSE_RECORDS_VENDOR, looseDate, matchBranch, strayReason, autoFillCategoryOf, autoFillNote, buildAutoFill, planExpenseRecordSync, toBillLine, usedRecordIds, type AutoFillRecord } from "./branchAutoFill";

describe("planExpenseRecordSync", () => {
  const branches = ["Jackson, MS", "Memphis", "Raleigh"];
  const r = (id: string, over: Partial<AutoFillRecord> = {}): AutoFillRecord => ({
    id, category: "Hotel", reimbursementType: null, status: "Approved", expenseDate: "2026-11-10", amount: 100,
    branch: "Jackson, MS", person: "A", description: "", fromLocation: null, toLocation: null, pickupDate: null, returnDate: null, ...over,
  });
  const bill = (over: Partial<{ id: string; branch: string; category: string; expenseDate: string; amount: number; vendor: string; lineItems: ReturnType<typeof toBillLine>[] }>) => ({
    id: "b", branch: "Jackson, MS", category: "travel_lodging", expenseDate: "2026-11-01", amount: 0, vendor: "", lineItems: [], ...over,
  });

  it("groups new records by branch, month and line; trips by destination; unknown destinations are stray", () => {
    const plan = planExpenseRecordSync([
      r("1"), r("2", { amount: 50, status: "Pending" }), r("3", { expenseDate: "2026-10-05" }),
      r("4", { branch: "Chattanooga", destination: "raleigh" }), r("5", { destination: "SV" }), r("6", { status: "Rejected" }),
    ], [], branches);
    expect(plan.create.map((g) => [g.month, g.branch, g.category, g.total, g.pending])).toEqual([
      ["2026-10", "Jackson, MS", "travel_lodging", 100, 0],
      ["2026-11", "Jackson, MS", "travel_lodging", 150, 1],
      ["2026-11", "Raleigh", "travel_lodging", 100, 0],
    ]);
    expect(plan.stray.map((x) => x.id)).toEqual(["5"]);
  });
  it("adds to a bill it made before, leaves hand-typed ones alone, never re-adds a record", () => {
    const synced = bill({ id: "s", vendor: EXPENSE_RECORDS_VENDOR, amount: 100, lineItems: [toBillLine(r("1"))] });
    const typed = bill({ id: "t", category: "rental_car", amount: 400 });
    const plan = planExpenseRecordSync([r("1"), r("2", { amount: 30 }), r("7", { category: "Car Rental", amount: 380 })], [synced, typed], branches);
    expect(plan.create).toEqual([]);
    expect(plan.append.map((g) => [g.billId, g.total, g.records.map((x) => x.id)])).toEqual([["s", 30, ["2"]]]);
    expect(plan.manual.map((g) => [g.category, g.total, g.billAmounts])).toEqual([["rental_car", 380, [400]]]);
  });
});

const rec = (over: Partial<AutoFillRecord>): AutoFillRecord => ({
  id: "x", category: "Hotel", reimbursementType: null, status: "Approved", expenseDate: "2026-11-10", amount: 100,
  branch: "Jackson, MS", person: "Anthony Cavett", description: "", fromLocation: null, toLocation: null, pickupDate: null, returnDate: null,
  ...over,
});

describe("matchBranch", () => {
  const known = ["Huntsville", "Jackson,MS", "Jackson,TN", "Jacksonville", "Tallahassee", "Mobile"];
  it("ignores spacing, commas and case", () => {
    expect(matchBranch("Jackson, MS", known)).toBe("Jackson,MS");
    expect(matchBranch("Jackson Ms", known)).toBe("Jackson,MS");
    expect(matchBranch("jackson, tn", known)).toBe("Jackson,TN");
  });
  it("knows the branch codes", () => {
    const all = [...known, "Savannah", "Wilmington", "Asheville"];
    expect(matchBranch("SV", all)).toBe("Savannah");
    expect(matchBranch("wm", all)).toBe("Wilmington");
    expect(matchBranch("AV", all)).toBe("Asheville");
    expect(matchBranch("JS", all)).toBe("Jackson,MS");
    expect(matchBranch("SV", known)).toBeNull();
  });
  it("fixes one clear typo", () => {
    expect(matchBranch("Talahasse", known)).toBe("Tallahassee");
    expect(matchBranch("Hunstville", known)).toBe("Huntsville");
  });
  it("won't guess when it isn't clear", () => {
    expect(matchBranch("Jackson", known)).toBeNull();
    expect(matchBranch("10/16", known)).toBeNull();
    expect(matchBranch("Mobil", known)).toBeNull();
    expect(matchBranch("", known)).toBeNull();
  });
  it("says what's wrong", () => {
    expect(strayReason({ branch: "Mobile", destination: "10/16" }).text).toMatch(/date/);
    expect(strayReason({ branch: "Nowhere", destination: null }).field).toBe("branch");
  });
});

describe("Flash Tech trip matching", () => {
  const known = ["Columbus", "Savannah", "Raleigh"];
  const trips = [
    { profileId: "matt", origin: "Columbus", destination: "Savannah", start: "2026-11-08", end: "2026-11-14" },
    { profileId: "matt", origin: "Columbus", destination: "Raleigh", start: "2026-11-15", end: "2026-11-21" },
  ];
  const food = (over: Partial<AutoFillRecord>) => rec({ id: "f", category: "Reimbursement Form", reimbursementType: "Food", branch: "Columbus", profileId: "matt", ...over });
  it("reads typed dates", () => {
    expect(looseDate("11/8", "2026-11-14")).toBe("2026-11-08");
    expect(looseDate("11/14/26", "2026-11-16")).toBe("2026-11-14");
    expect(looseDate("12/30", "2027-01-03")).toBe("2026-12-30");
    expect(looseDate("Raleigh", "2026-11-14")).toBeNull();
  });
  it("charges Food sent during a trip to the trip's destination", () => {
    const plan = planExpenseRecordSync([
      food({ id: "a", expenseDate: "2026-11-14", fromLocation: "11/8", toLocation: "11/14", destination: "11/14" }),
      food({ id: "b", expenseDate: "2026-11-16", fromLocation: "11/15", toLocation: "11/21", destination: "11/21" }),
      food({ id: "c", expenseDate: "2026-11-30", fromLocation: "11/29", toLocation: "11/30", destination: "11/30" }),
      food({ id: "d", expenseDate: "2026-11-10" }),
    ], [], known, trips);
    const where = Object.fromEntries(plan.create.flatMap((g) => g.records.map((x) => [x.id, g.branch])));
    expect(where).toEqual({ a: "Savannah", b: "Raleigh", c: "Columbus", d: "Savannah" });
    expect(plan.create.find((g) => g.branch === "Savannah")!.records[0].tripNote).toMatch(/Columbus → Savannah/);
    expect(plan.stray).toEqual([]);
  });
  it("a typed branch wins over a trip", () => {
    const plan = planExpenseRecordSync([food({ id: "e", expenseDate: "2026-11-10", destination: "Raleigh" })], [], known, trips);
    expect(plan.create[0].branch).toBe("Raleigh");
  });
});

describe("autoFillCategoryOf", () => {
  it("puts each Expense Record on its sheet line", () => {
    expect(autoFillCategoryOf({ category: "Hotel", reimbursementType: null })).toBe("travel_lodging");
    expect(autoFillCategoryOf({ category: "Car Rental", reimbursementType: null })).toBe("rental_car");
    expect(autoFillCategoryOf({ category: "Reimbursement Form", reimbursementType: "Gas" })).toBe("gas");
    expect(autoFillCategoryOf({ category: "Reimbursement Form", reimbursementType: "Food" })).toBe("food");
    expect(autoFillCategoryOf({ category: "Reimbursement Form", reimbursementType: "Flash Tech Allowance" })).toBe("food");
    expect(autoFillCategoryOf({ category: "Reimbursement Form", reimbursementType: "Other" })).toBeNull();
    expect(autoFillCategoryOf({ category: "Office Supply", reimbursementType: null })).toBe("equipment_supplies");
    expect(autoFillCategoryOf({ category: "Supplies", reimbursementType: null })).toBe("equipment_supplies");
    expect(autoFillCategoryOf({ category: "Meals", reimbursementType: null })).toBeNull();
  });
});

describe("buildAutoFill", () => {
  const records = [
    rec({ id: "h1", amount: 803.03 }),
    rec({ id: "h2", amount: 200, status: "Pending" }),
    rec({ id: "h3", amount: 50, status: "Rejected" }),
    rec({ id: "h4", amount: 0 }),
    rec({ id: "h5", amount: 70, expenseDate: "2026-10-31" }),
    rec({ id: "h6", amount: 60, branch: "Memphis" }),
    rec({ id: "c1", category: "Car Rental", amount: 388.8, branch: "jackson, ms " }),
    rec({ id: "g1", category: "Reimbursement Form", reimbursementType: "Gas", amount: 45.5 }),
    rec({ id: "g2", category: "Reimbursement Form", reimbursementType: "Gas", amount: 30 }),
  ];
  it("sums the branch's month, leaving out Rejected, $0, other months and other branches", () => {
    const out = buildAutoFill(records, "Jackson, MS", "2026-11", new Set());
    expect(out.travel_lodging).toMatchObject({ total: 1003.03, pending: 1, alreadyUsed: 0 });
    expect(out.travel_lodging.records.map((r) => r.id)).toEqual(["h1", "h2"]);
    expect(out.rental_car.total).toBe(388.8);
    expect(out.gas.total).toBe(75.5);
    expect(out.food.total).toBe(0);
  });
  it("charges a Flash Tech trip to its destination branch, not the tech's own", () => {
    const trip = [rec({ id: "t1", amount: 500, branch: "Chattanooga", destination: "Jackson, MS" })];
    expect(buildAutoFill(trip, "Jackson, MS", "2026-11", new Set()).travel_lodging.total).toBe(500);
    expect(buildAutoFill(trip, "Chattanooga", "2026-11", new Set()).travel_lodging.total).toBe(0);
  });
  it("skips records already pulled into a saved bill", () => {
    const used = usedRecordIds([{ lineItems: [toBillLine(records[7])] }]);
    const out = buildAutoFill(records, "Jackson, MS", "2026-11", used);
    expect(out.gas).toMatchObject({ total: 30, alreadyUsed: 1 });
    expect(out.gas.records.map((r) => r.id)).toEqual(["g2"]);
  });
  it("writes the note and keeps the record id on the bill line", () => {
    const out = buildAutoFill(records, "Jackson, MS", "2026-11", new Set());
    expect(autoFillNote(out.travel_lodging)).toBe("From AHS Expense Records: 2 records (1 pending)");
    expect(toBillLine(out.travel_lodging.records[1])).toMatchObject({ sourceId: "h2", service: "Hotel (pending)", driver: "Anthony Cavett" });
  });
});
