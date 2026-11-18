import { describe, expect, it } from "vitest";
import { DAILY_MILEAGE_VENDOR, mileageBillLine, planMileageSync, type MileageSyncTrip } from "./mileageExpenseSync";

const BRANCHES = ["Savannah", "Jackson,MS", "Columbus"];

const trip = (over: Partial<MileageSyncTrip> = {}): MileageSyncTrip => ({
  id: "t1", profileId: "p1", person: "Matt Simmons", workDate: "2026-11-05", eligibleMiles: 100,
  tripBranch: "", homeBranch: "Savannah", hasCarIq: true, rate: 0.2, vehicle: "", ticketRefs: "", problem: "",
  ...over,
});

const bill = (over: Record<string, unknown> = {}) => ({
  id: "b1", branch: "Savannah", category: "cariq_mileage", expenseDate: "2026-11-01", amount: 20, vendor: DAILY_MILEAGE_VENDOR,
  lineItems: [mileageBillLine(trip())], ...over,
});

describe("planMileageSync", () => {
  it("Car IQ → CarIQ line, no Car IQ → NON CarIQ line, priced at the day's rate", () => {
    const plan = planMileageSync([trip(), trip({ id: "t2", hasCarIq: false, rate: 0.5, eligibleMiles: 10 })], [], BRANCHES);
    expect(plan.create.map((g) => [g.category, g.total])).toEqual([["cariq_mileage", 20], ["non_cariq_mileage", 5]]);
  });

  it("trip branch wins over the tech's branch, and 'Jackson, MS' matches Jackson,MS", () => {
    const plan = planMileageSync([trip({ tripBranch: "Jackson, MS" })], [], BRANCHES);
    expect(plan.create[0].branch).toBe("Jackson,MS");
  });

  it("one bill per branch × month × line", () => {
    const plan = planMileageSync([trip(), trip({ id: "t2" }), trip({ id: "t3", workDate: "2026-12-01" })], [], BRANCHES);
    expect(plan.create.map((g) => [g.month, g.trips.length])).toEqual([["2026-11", 2], ["2026-12", 1]]);
  });

  it("already synced and unchanged → nothing to do", () => {
    const plan = planMileageSync([trip()], [bill()], BRANCHES);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
  });

  it("an edited trip rewrites its bill", () => {
    const plan = planMileageSync([trip({ eligibleMiles: 150 })], [bill()], BRANCHES);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0].total).toBe(30);
  });

  it("a bill whose trips are all gone is removed", () => {
    const plan = planMileageSync([], [bill()], BRANCHES);
    expect(plan.remove).toEqual(["b1"]);
    expect(plan.update).toEqual([]);
  });

  it("…unless it has a receipt — then it stays at $0", () => {
    const plan = planMileageSync([], [bill({ receipts: [{ url: "u", path: "p", name: "r.pdf" }] })], BRANCHES);
    expect(plan.remove).toEqual([]);
    expect(plan.update.map((g) => [g.billId, g.total, g.trips.length])).toEqual([["b1", 0, 0]]);
  });

  it("never removes a bill typed by hand", () => {
    const plan = planMileageSync([], [bill({ vendor: "Typed" })], BRANCHES);
    expect(plan.remove).toEqual([]);
    expect(plan.update).toEqual([]);
  });

  it("a bill typed by hand is left alone", () => {
    const plan = planMileageSync([trip()], [bill({ vendor: "Typed", lineItems: [] })], BRANCHES);
    expect(plan.create).toEqual([]);
    expect(plan.manual).toHaveLength(1);
  });

  it("can't place: Car IQ not set, bad branch, trip problem", () => {
    const plan = planMileageSync(
      [trip({ id: "a", hasCarIq: null, rate: null }), trip({ id: "b", tripBranch: "Nowhere" }), trip({ id: "c", homeBranch: "" }), trip({ id: "d", problem: "Add reason" })],
      [],
      BRANCHES,
    );
    expect(plan.create).toEqual([]);
    expect(plan.stray.map((s) => [s.trip.id, s.fix]).sort()).toEqual([["a", "carIq"], ["b", "trip"], ["c", "branch"], ["d", "trip"]]);
  });

  it("zero eligible miles are skipped", () => {
    expect(planMileageSync([trip({ eligibleMiles: 0 })], [], BRANCHES).create).toEqual([]);
  });
});
