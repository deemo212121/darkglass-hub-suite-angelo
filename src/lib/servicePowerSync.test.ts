import { describe, expect, it } from "vitest";
import { isOpenCall } from "./servicePowerSync";

// Main CallStatus values ServicePower returned for Oct–Nov 2026 calls.
describe("isOpenCall", () => {
  it("keeps Accepted and Open calls, whatever the sub-status", () => {
    expect(isOpenCall({ callStatus: "ACCEPTED", callSubStatus: "APPOINTMENT SCHEDULED" })).toBe(true);
    expect(isOpenCall({ callStatus: "ACCEPTED", callSubStatus: "WAITING ON CUSTOMER" })).toBe(true);
    expect(isOpenCall({ callStatus: "OPEN", callSubStatus: "OPEN" })).toBe(true);
    expect(isOpenCall({ callStatus: " accepted " })).toBe(true);
    expect(isOpenCall({ callStatus: "ACCEPTED / ACCEPTED" })).toBe(true);
  });

  it("leaves out Claimed, Completed, Cancelled and Rejected calls", () => {
    expect(isOpenCall({ callStatus: "CLAIMED", callSubStatus: "CLAIMED" })).toBe(false);
    expect(isOpenCall({ callStatus: "COMPLETED", callSubStatus: "JOB COMPLETED" })).toBe(false);
    expect(isOpenCall({ callStatus: "CANCELLED", callSubStatus: "COMPLETED" })).toBe(false);
    expect(isOpenCall({ callStatus: "REJECTED" })).toBe(false);
    expect(isOpenCall({ callStatus: "" })).toBe(false);
    expect(isOpenCall(null)).toBe(false);
  });
});
