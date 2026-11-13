import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase/client", () => ({ supabase: {} }));

import { isModuleAllowed, isTechScopeSubject, isTechScopedViewer, leadersTitleFitsRoles } from "@/lib/roleLabels";
import { hydrateModuleRoleGates, MODULE_LEVEL_GATE_SLUG } from "@/lib/moduleAccess";
import { canAccessSubmodule } from "@/lib/submoduleAccess";

describe("Technical Assistant Director's technician-only HR / Accounting view", () => {
  const gates = {
    [`hr:${MODULE_LEVEL_GATE_SLUG}`]: ["ADMIN", "HR"],
    [`accounting:${MODULE_LEVEL_GATE_SLUG}`]: ["ADMIN", "FINANCE"],
    "hr:absent-list": ["ADMIN", "HR"],
    "accounting:accounting-dashboard": ["ADMIN", "FINANCE"],
  };
  const page = (slug: string) => ({ slug });

  it("opens just the listed pages when no other role opens the module", () => {
    hydrateModuleRoleGates(gates);
    const tad = "TECHNICAL_ASSISTANT_DIRECTOR";
    expect(isTechScopedViewer(tad, ["TECHNICIAN"], "hr")).toBe(true);
    expect(isModuleAllowed(tad, "hr", ["TECHNICIAN"])).toBe(true);
    expect(isModuleAllowed(tad, "accounting", [])).toBe(true);
    for (const slug of ["training-list", "absent-list", "flash-tech", "technician-form-checklist", "clock-in-codes"]) {
      expect(canAccessSubmodule(tad, [], "hr", page(slug))).toBe(true);
    }
    for (const slug of ["hr-dashboard", "hr-paperworks", "incentives", "user-management"]) {
      expect(canAccessSubmodule(tad, [], "hr", page(slug))).toBe(false);
    }
    expect(canAccessSubmodule(tad, [], "accounting", page("accounting-dashboard"))).toBe(true);
    expect(canAccessSubmodule(tad, [], "accounting", page("paystubs"))).toBe(false);
    expect(isTechScopedViewer(tad, [], "claims")).toBe(false);
  });

  it("keeps the full view for someone another role already lets in", () => {
    hydrateModuleRoleGates(gates);
    expect(isTechScopedViewer("TECHNICAL_ASSISTANT_DIRECTOR", ["ADMIN"], "hr")).toBe(false);
    expect(canAccessSubmodule("TECHNICAL_ASSISTANT_DIRECTOR", ["ADMIN"], "hr", page("hr-paperworks"))).toBe(true);
    hydrateModuleRoleGates({});
    expect(isTechScopedViewer("TECHNICAL_ASSISTANT_DIRECTOR", [], "hr")).toBe(false);
  });

  it("shows technicians and their managers, not directors or office staff", () => {
    expect(["TECHNICIAN", "TECHNICIAN_MANAGER", "BRANCH_MANAGER", "Senior Branch Manager"].map(isTechScopeSubject)).toEqual([true, true, true, true]);
    expect(["TECHNICAL_DIRECTOR", "TECHNICAL_ASSISTANT_DIRECTOR", "CSR_AGENT", "HR", null].map(isTechScopeSubject)).toEqual([false, false, false, false, false]);
  });
});

describe("leadersTitleFitsRoles", () => {
  it("drops a title left over from before a promotion", () => {
    expect(leadersTitleFitsRoles("Branch Manager", ["TECHNICAL_ASSISTANT_DIRECTOR", "TECHNICIAN"])).toBe(false);
    expect(leadersTitleFitsRoles("Team Leader", ["CSR_MANAGER"])).toBe(false);
    expect(leadersTitleFitsRoles("Branch Manager", ["SENIOR_BRANCH_MANAGER", "TECHNICIAN"])).toBe(false);
  });

  it("keeps a title that is the role, or the role without its department", () => {
    expect(leadersTitleFitsRoles("Branch Manager", ["BRANCH_MANAGER", "TECHNICIAN_MANAGER", "TECHNICIAN"])).toBe(true);
    expect(leadersTitleFitsRoles("Technical Director", ["TECHNICAL_DIRECTOR", "ADMIN", "TECHNICIAN"])).toBe(true);
    expect(leadersTitleFitsRoles("Team Leader", ["PARTS_TEAM_LEADER", "EBAY"])).toBe(true);
    expect(leadersTitleFitsRoles("Manager", ["CLAIMS_MANAGER"])).toBe(true);
    expect(leadersTitleFitsRoles("Manager", ["CSR Manager"])).toBe(true);
    expect(leadersTitleFitsRoles("Senior Manager", ["ADMIN", "HR", "FINANCE", "CSR_MANAGER", "SENIOR_MANAGER"])).toBe(true);
  });

  it("keeps a title of its own, or one on an Admin with no job role", () => {
    expect(leadersTitleFitsRoles("Pre Auth", ["CLAIMS"])).toBe(true);
    expect(leadersTitleFitsRoles("Lead Manager", ["CSR_TEAM_LEADER"])).toBe(true);
    expect(leadersTitleFitsRoles("Senior Manager", ["ADMIN"])).toBe(true);
  });
});
