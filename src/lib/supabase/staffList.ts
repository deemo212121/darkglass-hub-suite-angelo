/**
 * Dashboard "Staff List" submodule — Current Staff (branch-manager
 * summary, migration 0161) and Tier Level (pay-rate table, 0161) are
 * their own small reference tables, seeded once from the user's
 * "Staff List.xlsx" workbook via scripts/staff_list_seed.sql.
 *
 * The per-branch PERSON roster is NOT a table here — see migration 0162:
 * it's a live view of the same profiles Master List already manages
 * (StaffListPage.tsx groups getCompanyUsers() by assigned_branch), so a
 * new hire in User Management shows up automatically with no separate
 * import step. personal_email/work_phone/tier_level/staff_note are 4
 * fields Excel had that profiles didn't — added directly onto profiles
 * by 0154 so editing them here writes to the exact row Master List reads.
 */
import { supabase } from "./client";

export interface StaffListCurrentStaffRow {
  id: string;
  branch: string;
  abbreviation: string | null;
  seniorBranchManager: string | null;
  branchManager: string | null;
  technicalManager: string | null;
  partManager: string | null;
  address: string | null;
  trashCompany: string | null;
  phone: string | null;
  rowSort: number;
}

export interface StaffListTierLevelRow {
  id: string;
  tier: string;
  ticketRate: number | null;
  mile200: number | null;
  mile300: number | null;
  mile400: number | null;
  mileagePay: number | null;
  branchIncentive: string | null;
  distanceHomeComp: string | null;
  rowSort: number;
}

const CURRENT_STAFF_SELECT = "id, branch, abbreviation, senior_branch_manager, branch_manager, technical_manager, part_manager, address, trash_company, phone, row_sort";
const TIER_LEVEL_SELECT = "id, tier, ticket_rate, mile_200, mile_300, mile_400, mileage_pay, branch_incentive, distance_home_comp, row_sort";

function mapCurrentStaff(r: any): StaffListCurrentStaffRow {
  return {
    id: r.id,
    branch: r.branch,
    abbreviation: r.abbreviation,
    seniorBranchManager: r.senior_branch_manager,
    branchManager: r.branch_manager,
    technicalManager: r.technical_manager,
    partManager: r.part_manager,
    address: r.address,
    trashCompany: r.trash_company,
    phone: r.phone,
    rowSort: Number(r.row_sort) || 0,
  };
}

function mapTierLevel(r: any): StaffListTierLevelRow {
  return {
    id: r.id,
    tier: r.tier,
    ticketRate: r.ticket_rate,
    mile200: r.mile_200,
    mile300: r.mile_300,
    mile400: r.mile_400,
    mileagePay: r.mileage_pay,
    branchIncentive: r.branch_incentive,
    distanceHomeComp: r.distance_home_comp,
    rowSort: Number(r.row_sort) || 0,
  };
}

export async function getStaffListCurrentStaff(): Promise<StaffListCurrentStaffRow[]> {
  const { data, error } = await supabase
    .from("staff_list_current_staff")
    .select(CURRENT_STAFF_SELECT)
    .order("row_sort", { ascending: true });
  if (error) {
    console.error("getStaffListCurrentStaff error:", error.message);
    return [];
  }
  return (data ?? []).map(mapCurrentStaff);
}

export async function getStaffListTierLevel(): Promise<StaffListTierLevelRow[]> {
  const { data, error } = await supabase
    .from("staff_list_tier_level")
    .select(TIER_LEVEL_SELECT)
    .order("row_sort", { ascending: true });
  if (error) {
    console.error("getStaffListTierLevel error:", error.message);
    return [];
  }
  return (data ?? []).map(mapTierLevel);
}
