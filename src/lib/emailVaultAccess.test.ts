import { afterEach, describe, expect, it } from "vitest";
import { canAccessSubmodule } from "./submoduleAccess";
import { hydrateEmailVaultGrant, hydrateModuleRoleGates } from "./moduleAccess";
import { isModuleAllowed } from "./roleLabels";

const vault = { slug: "email-vault", custom: "email-vault" };
const open = (role: string, extra: string[] = [], trainee = false) => canAccessSubmodule(role, extra, "admin", vault, trainee, false);

afterEach(() => {
  hydrateEmailVaultGrant(null);
  hydrateModuleRoleGates({});
});

describe("Email Vault access", () => {
  it("is Super Admin only by default", () => {
    expect(open("SUPERADMIN")).toBe(true);
    expect(open("TECHNICIAN", ["SUPERADMIN"])).toBe(true);
    expect(open("ADMIN")).toBe(false);
    expect(open("IT")).toBe(false);
    // the platform-only role isn't a company Super Admin (same as is_company_superadmin())
    expect(open("SUPERSUPERADMIN")).toBe(false);
  });
  it("opens for anyone a Super Admin added, and only once that's confirmed", () => {
    expect(open("IT")).toBe(false);
    hydrateEmailVaultGrant(true);
    expect(open("IT")).toBe(true);
    expect(open("ADMIN")).toBe(true);
    hydrateEmailVaultGrant(false);
    expect(open("IT")).toBe(false);
  });
  it("ignores role overrides from Accessibility Management", () => {
    hydrateModuleRoleGates({ "admin:email-vault": ["ADMIN"] });
    expect(open("ADMIN")).toBe(false);
    expect(open("SUPERADMIN")).toBe(true);
  });
  it("still keeps trainees out", () => {
    hydrateEmailVaultGrant(true);
    expect(open("IT", [], true)).toBe(false);
  });
  it("lets a granted CSR agent into the Admin module", () => {
    expect(isModuleAllowed("CSR_AGENT", "admin")).toBe(false);
    hydrateEmailVaultGrant(true);
    expect(isModuleAllowed("CSR_AGENT", "admin")).toBe(true);
    expect(open("CSR_AGENT")).toBe(true);
    // ...but no other Admin page
    expect(canAccessSubmodule("CSR_AGENT", [], "admin", { slug: "account-management", custom: "account-management" }, false, false)).toBe(false);
  });
});
