import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase/client", () => ({ supabase: {} }));

import { getModule } from "@/lib/modules";
import { hydrateModuleRoleGates } from "@/lib/moduleAccess";
import { canAccessSubmodule } from "@/lib/submoduleAccess";
import { hasDashboardAccess } from "@/lib/dashboardAccess";
import { CANDIDATE_EMAIL_SENDER_ROLES } from "@/lib/hiringEmails";
import {
  ROLE_LABELS,
  ROLE_OPTIONS,
  canFastTrackConductNote,
  getRoleDepartmentBreakdown,
  isAttendanceFullAccessRole,
  isJotformHrRole,
  rolesIncludedVia,
  withIncludedRoles,
} from "@/lib/roleLabels";

describe("HR Manager", () => {
  it("is a User Type, filed under HR", () => {
    expect(ROLE_LABELS.HR_MANAGER).toBe("HR Manager");
    expect(ROLE_OPTIONS.some((o) => o.value === "HR_MANAGER" && o.label === "HR Manager")).toBe(true);
    expect(getRoleDepartmentBreakdown("HR_MANAGER")).toEqual({ department: "HR", roleLabel: "Manager" });
  });

  it("holds HR, as a primary or extra role", () => {
    expect(withIncludedRoles(["HR_MANAGER"])).toEqual(["HR_MANAGER", "HR"]);
    expect(withIncludedRoles(["TECHNICIAN", "HR_MANAGER"])).toContain("HR");
    expect(rolesIncludedVia(["ADMIN", "HR"])).toContainEqual({ role: "HR_MANAGER", via: "HR" });
  });

  it("opens every page HR opens, company overrides included", () => {
    expect(hasDashboardAccess(["ADMIN", "HR"], "HR_MANAGER", [])).toBe(true);
    expect(hasDashboardAccess(["ADMIN", "HR"], "TECHNICIAN", ["HR_MANAGER"])).toBe(true);
    expect(hasDashboardAccess(["ADMIN", "FINANCE"], "HR_MANAGER", [])).toBe(false);
    const hr = getModule("hr")!;
    for (const slug of ["hr-dashboard", "hr-paperworks", "staff-list"]) {
      const tile = hr.submodules.find((s) => s.slug === slug);
      if (!tile) continue;
      expect(canAccessSubmodule("HR_MANAGER", [], "hr", tile)).toBe(canAccessSubmodule("HR", [], "hr", tile));
    }
    hydrateModuleRoleGates({ "hr:__module_access__": ["ADMIN", "HR"] });
    const dash = hr.submodules.find((s) => s.slug === "hr-dashboard");
    if (dash) expect(canAccessSubmodule("HR_MANAGER", [], "hr", dash)).toBe(true);
    hydrateModuleRoleGates({});
  });

  it("gets HR's role checks", () => {
    expect(canFastTrackConductNote("HR_MANAGER")).toBe(true);
    expect(isJotformHrRole("HR_MANAGER")).toBe(true);
    expect(isAttendanceFullAccessRole("HR_MANAGER")).toBe(true);
    expect(CANDIDATE_EMAIL_SENDER_ROLES.has("HR_MANAGER")).toBe(true);
  });
});
