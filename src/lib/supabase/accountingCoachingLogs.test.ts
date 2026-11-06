import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({ supabase: {} }));
vi.mock("./messaging", () => ({ getOrCreateDmThread: vi.fn(), sendMessage: vi.fn() }));
vi.mock("./notifications", () => ({ createNotification: vi.fn() }));

import { getModule } from "@/lib/modules";
import { hydrateModuleRoleGates } from "@/lib/moduleAccess";
import { canAccessSubmodule } from "@/lib/submoduleAccess";
import { accountingCoachingLogPath, accountingCoachingStatus, isAccountingCoachingWaitingOn } from "./accountingCoachingLogs";

const filled = {
  summary: "s",
  coachingDiscussion: "d",
  coachActionPlan: "c",
  employeeExplanation: "e",
  employeeActionPlan: "a",
  employeeSignedAt: null as string | null,
  creatorSignedAt: null as string | null,
};
const log = { ...filled, employeeProfileId: "staff", createdBy: "coach", deletedAt: null as string | null };

describe("accountingCoachingStatus", () => {
  it("waits on the coach until I, III and V are filled in", () => {
    expect(accountingCoachingStatus({ ...filled, summary: "  " })).toBe("coach");
    expect(accountingCoachingStatus({ ...filled, coachingDiscussion: "" })).toBe("coach");
    expect(accountingCoachingStatus({ ...filled, coachActionPlan: "" })).toBe("coach");
  });
  it("then on the person coached to fill in II and IV", () => {
    expect(accountingCoachingStatus({ ...filled, employeeExplanation: "" })).toBe("staff");
    expect(accountingCoachingStatus({ ...filled, employeeActionPlan: " " })).toBe("staff");
  });
  it("then their signature, the coach's, then locked", () => {
    expect(accountingCoachingStatus(filled)).toBe("staff_sign");
    expect(accountingCoachingStatus({ ...filled, employeeSignedAt: "t" })).toBe("creator_sign");
    expect(accountingCoachingStatus({ ...filled, employeeSignedAt: "t", creatorSignedAt: "t" })).toBe("locked");
  });
});

describe("isAccountingCoachingWaitingOn", () => {
  it("is the person coached while they have something to do", () => {
    expect(isAccountingCoachingWaitingOn({ ...log, employeeExplanation: "" }, "staff")).toBe(true);
    expect(isAccountingCoachingWaitingOn(log, "staff")).toBe(true);
    expect(isAccountingCoachingWaitingOn({ ...log, employeeSignedAt: "t" }, "staff")).toBe(false);
  });
  it("isn't the person coached while the coach still has to fill in", () => {
    expect(isAccountingCoachingWaitingOn({ ...log, summary: "" }, "staff")).toBe(false);
  });
  it("is the coach only once it's their signature", () => {
    expect(isAccountingCoachingWaitingOn(log, "coach")).toBe(false);
    expect(isAccountingCoachingWaitingOn({ ...log, employeeSignedAt: "t" }, "coach")).toBe(true);
    expect(isAccountingCoachingWaitingOn({ ...log, employeeSignedAt: "t", creatorSignedAt: "t" }, "coach")).toBe(false);
  });
  it("is nobody else, and nobody once deleted", () => {
    expect(isAccountingCoachingWaitingOn(log, "someone")).toBe(false);
    expect(isAccountingCoachingWaitingOn(log, null)).toBe(false);
    expect(isAccountingCoachingWaitingOn({ ...log, deletedAt: "t" }, "staff")).toBe(false);
  });
});

describe("the Coaching Log tile", () => {
  const accounting = getModule("accounting")!;
  const tile = accounting.submodules.find((s) => s.slug === "accounting-coaching-log")! as any;
  const csrTile = getModule("csr")!.submodules.find((s) => s.slug === "coaching-log")! as any;
  const can = (role: string, extra: string[] = []) => canAccessSubmodule(role, extra, "accounting", tile);

  it("is on the Accounting page, as its own page", () => {
    expect(tile.title).toBe("Coaching Log");
    expect(tile.custom).toBe("accounting-coaching-log");
    expect(csrTile.custom).toBe("csr-coaching-log");
  });
  it("links messages to the Accounting page", () => {
    expect(accountingCoachingLogPath("abc")).toBe(`/m/${accounting.slug}/${tile.slug}?log=abc`);
  });
  it("opens for Accounting, Admin and up, and the read-only roles", () => {
    for (const role of ["FINANCE", "ACCOUNTING_MANAGER", "ADMIN", "SUPERADMIN", "HR", "SENIOR_MANAGER"]) expect(can(role)).toBe(true);
    expect(can("TECHNICIAN", ["FINANCE"])).toBe(true);
  });
  it("stays shut for everyone else, CSR included", () => {
    for (const role of ["CSR_AGENT", "CSR_TEAM_LEADER", "CSR_MANAGER", "TECHNICIAN", "PARTS", "MANAGER", "IT"]) expect(can(role)).toBe(false);
  });
  it("doesn't let Accounting into CSR's log", () => {
    expect(canAccessSubmodule("FINANCE", [], "csr", csrTile)).toBe(false);
  });
  it("still answers to Accounting's Whole Module list", () => {
    hydrateModuleRoleGates({ "accounting:__module_access__": ["ADMIN", "FINANCE", "SENIOR_MANAGER", "TECHNICAL_DIRECTOR"] });
    expect(can("FINANCE")).toBe(true);
    expect(can("ACCOUNTING_MANAGER")).toBe(true);
    expect(can("SENIOR_MANAGER")).toBe(true);
    expect(can("HR")).toBe(false);
    expect(can("TECHNICAL_DIRECTOR")).toBe(false);
    hydrateModuleRoleGates({});
  });
});
