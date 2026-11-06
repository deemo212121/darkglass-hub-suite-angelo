import { describe, expect, it } from "vitest";
import { canRevertDecision, isRevertSuperAdmin, statusAfterRevert } from "./decisionRevertRules";

describe("canRevertDecision", () => {
  it("lets the person who decided", () => {
    expect(canRevertDecision("me", "me", false)).toBe(true);
  });
  it("doesn't let anyone else, including an Admin or HR", () => {
    expect(canRevertDecision("someone", "me", false)).toBe(false);
    expect(canRevertDecision(null, "me", false)).toBe(false);
    expect(canRevertDecision("someone", null, false)).toBe(false);
    expect(canRevertDecision(null, null, false)).toBe(false);
  });
  it("lets a Super Admin revert anything, even with no decider on record", () => {
    expect(canRevertDecision("someone", "me", true)).toBe(true);
    expect(canRevertDecision(null, null, true)).toBe(true);
  });
});

describe("isRevertSuperAdmin", () => {
  it("spots it as a primary or extra role, however it's written", () => {
    expect(isRevertSuperAdmin(["HR", "SUPERADMIN"])).toBe(true);
    expect(isRevertSuperAdmin(["superadmin"])).toBe(true);
    expect(isRevertSuperAdmin(["Super Admin".replace(" ", "")])).toBe(true);
    expect(isRevertSuperAdmin(["SUPERSUPERADMIN"])).toBe(true);
  });
  it("doesn't count Admin or HR", () => {
    expect(isRevertSuperAdmin(["ADMIN", "HR", null, undefined])).toBe(false);
    expect(isRevertSuperAdmin([])).toBe(false);
  });
});

describe("statusAfterRevert (any two of three approve)", () => {
  const s = (manager: any, hr: any, accounting: any) => ({ manager, hr, accounting });
  it("goes back to pending when one of two approvals is reverted", () => {
    expect(statusAfterRevert(s("approved", "approved", "pending"), "manager")).toBe("pending");
  });
  it("stays approved when two others still approve it", () => {
    expect(statusAfterRevert(s("approved", "approved", "approved"), "hr")).toBe("approved");
  });
  it("goes back to pending when the only rejection is reverted", () => {
    expect(statusAfterRevert(s("rejected", "pending", "pending"), "manager")).toBe("pending");
  });
  it("goes to approved when a rejection is reverted and two others already approved", () => {
    expect(statusAfterRevert(s("approved", "rejected", "approved"), "hr")).toBe("approved");
  });
  it("stays rejected when another step also rejected it", () => {
    expect(statusAfterRevert(s("rejected", "rejected", "pending"), "manager")).toBe("rejected");
    expect(statusAfterRevert(s("approved", "rejected", "pending"), "manager")).toBe("rejected");
  });
});
