import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({ supabase: {} }));

import { getModule } from "@/lib/modules";
import { canAccessSubmodule } from "@/lib/submoduleAccess";
import { payPeriodContaining } from "@/lib/payPeriods";
import {
  cutoffPeriodsForYear,
  inYearAndCutoff,
  isTechDamagesMissing,
  mapTechDamage,
  sortTechDamages,
  techDamageTotals,
  technicianKey,
  yearlyDamageCounts,
  type TechDamage,
} from "./techDamages";

const row = (over: Partial<TechDamage> = {}): TechDamage => ({
  ...mapTechDamage({
    id: "d1",
    company_id: "c1",
    technician_profile_id: "t1",
    technician_name: "Tom Tech",
    damage_date: "2026-03-10",
    house_damage: 0,
    parts_damage: 0,
    total_amount: 0,
    deduction_per_payroll: 0,
    balance: 0,
    status: "ongoing",
    created_at: "2026-03-10T00:00:00Z",
    updated_at: "2026-03-10T00:00:00Z",
  }),
  ...over,
});

describe("mapTechDamage", () => {
  it("reads the database's numbers and file lists", () => {
    const d = mapTechDamage({
      id: "x", company_id: "c", technician_name: "A", damage_date: "2026-05-01",
      house_damage: "120.50", parts_damage: "30", total_amount: "150.50", deduction_per_payroll: "50", balance: "100.50",
      cutoff_date: "2026-10-10", status: "paid",
      damage_files: [{ path: "c/x/damage-1_a.jpg", name: "a.jpg", uploadedAt: "t" }], waiver_files: null,
    });
    expect([d.houseDamage, d.partsDamage, d.totalAmount, d.deductionPerPayroll, d.balance]).toEqual([120.5, 30, 150.5, 50, 100.5]);
    expect(d.status).toBe("paid");
    expect(d.cutoffDate).toBe("2026-10-10");
    expect(d.damageFiles).toHaveLength(1);
    expect(d.waiverFiles).toEqual([]);
  });
});

describe("yearlyDamageCounts", () => {
  it("counts each technician's house and parts damages per year, skipping deleted ones", () => {
    const rows = [
      row({ id: "1", houseDamage: 100 }),
      row({ id: "2", houseDamage: 50, partsDamage: 20 }),
      row({ id: "3", partsDamage: 10 }),
      row({ id: "4", houseDamage: 10, deletedAt: "t" }),
      row({ id: "5", houseDamage: 10, damageDate: "2025-12-30" }),
      row({ id: "6", technicianProfileId: "t2", technicianName: "Other", houseDamage: 5 }),
    ];
    const c = yearlyDamageCounts(rows);
    expect(c.get("t1|2026")).toEqual({ house: 2, parts: 2 });
    expect(c.get("t1|2025")).toEqual({ house: 1, parts: 0 });
    expect(c.get("t2|2026")).toEqual({ house: 1, parts: 0 });
  });
  it("matches people without an account by name", () => {
    const a = row({ technicianProfileId: null, technicianName: " Old Tech " });
    const b = row({ technicianProfileId: null, technicianName: "old tech" });
    expect(technicianKey(a)).toBe(technicianKey(b));
  });
});

describe("cut-off periods", () => {
  it("lists every bi-weekly period ending in the year, newest first", () => {
    const ps = cutoffPeriodsForYear(2026);
    expect(ps.length).toBeGreaterThanOrEqual(26);
    expect(ps.every((p) => p.end.startsWith("2026"))).toBe(true);
    expect(ps.some((p) => p.start === "2026-09-27" && p.end === "2026-10-10")).toBe(true);
    expect(ps[0].end > ps[1].end).toBe(true);
  });
  it("yearly view goes by damage date; cut-off view by cut-off date", () => {
    const oct = payPeriodContaining("2026-10-10").start;
    const d = row({ damageDate: "2025-12-20", cutoffDate: "2026-10-10" });
    expect(inYearAndCutoff(d, 2025, "all")).toBe(true);
    expect(inYearAndCutoff(d, 2026, "all")).toBe(false);
    expect(inYearAndCutoff(d, 2026, oct)).toBe(true);
    expect(inYearAndCutoff(d, 2026, payPeriodContaining("2026-10-24").start)).toBe(false);
    expect(inYearAndCutoff(row({ cutoffDate: null }), 2026, "none")).toBe(true);
    expect(inYearAndCutoff(d, 2025, "none")).toBe(false);
  });
});

describe("sortTechDamages", () => {
  const rows = [
    row({ id: "a", area: "houston", technicianName: "Zed", damageDate: "2026-01-01" }),
    row({ id: "b", area: "", technicianName: "Amy", damageDate: "2026-05-01" }),
    row({ id: "c", area: "Austin", technicianName: "Bo", damageDate: "2026-02-01" }),
    row({ id: "d", area: "Houston", technicianName: "Al", damageDate: "2026-03-01" }),
    row({ id: "e", area: "Houston", technicianName: "Al", damageDate: "2026-04-01" }),
  ];
  const ids = (s: string) => sortTechDamages(rows, s as any).map((r) => r.id).join("");
  it("branch A to Z (any case), then technician, then newest; no branch last", () => expect(ids("branch-asc")).toBe("cedab"));
  it("branch Z to A, no branch still last", () => expect(ids("branch-desc")).toBe("edacb"));
  it("newest first", () => expect(ids("newest")).toBe("bedca"));
  it("doesn't change the list it was given", () => { sortTechDamages(rows, "branch-asc"); expect(rows[0].id).toBe("a"); });
});

describe("techDamageTotals", () => {
  it("adds up the shown rows", () => {
    const t = techDamageTotals([
      row({ houseDamage: 100, partsDamage: 50, totalAmount: 150, deductionPerPayroll: 25, balance: 125 }),
      row({ partsDamage: 40, totalAmount: 40, deductionPerPayroll: 40, balance: 0, status: "paid" }),
    ]);
    expect(t).toEqual({ count: 2, house: 100, parts: 90, total: 190, deduction: 65, balance: 125, ongoing: 1 });
  });
});

describe("isTechDamagesMissing", () => {
  it("spots the not-set-up error only", () => {
    expect(isTechDamagesMissing('relation "public.tech_damages" does not exist')).toBe(true);
    expect(isTechDamagesMissing("Could not find the table 'public.tech_damages' in the schema cache")).toBe(true);
    expect(isTechDamagesMissing("permission denied")).toBe(false);
  });
});

describe("the Tech Damages tile", () => {
  const tile = getModule("accounting")!.submodules.find((s) => s.slug === "tech-damages")! as any;
  const can = (role: string, extra: string[] = []) => canAccessSubmodule(role, extra, "accounting", tile);
  it("is on the Accounting page", () => {
    expect(tile.title).toBe("Tech Damages");
    expect(tile.custom).toBe("tech-damages");
  });
  it("opens for Accounting, Admin and up, and HR", () => {
    for (const role of ["FINANCE", "ACCOUNTING_MANAGER", "ADMIN", "SUPERADMIN", "HR"]) expect(can(role)).toBe(true);
  });
  it("stays shut for technicians and everyone else", () => {
    for (const role of ["TECHNICIAN", "BRANCH_MANAGER", "CSR_AGENT", "PARTS", "IT"]) expect(can(role)).toBe(false);
  });
});
