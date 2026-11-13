import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase/client", () => ({ supabase: {} }));

import { leadersTitleFitsRoles } from "@/lib/roleLabels";

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
