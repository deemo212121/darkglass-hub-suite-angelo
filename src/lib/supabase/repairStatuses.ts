/**
 * Repair Statuses — Admin-configurable status labels/colors/permissions
 * (migration 0146). Backs RepairStatusesPage.tsx. Company-scoped, one row
 * per status code. allowed_roles is a saved reference for "who can use
 * this status" — not enforced anywhere else in the app yet.
 */
import { supabase } from "./client";

export interface RepairStatus {
  id: string;
  code: string;
  description: string;
  overallStatus: string;
  initialStatus: string;
  color: string;
  fontBold: boolean;
  followUpDashboard: string;
  allowedRoles: string[];
  csrRescheduleStatus: boolean;
  partPendingStatus: boolean;
  cxRequestsReschedule: boolean;
  dispatchCompletedStatus: boolean;
  mobileSearch: boolean;
  hideInMobile: boolean;
  servicePowerStatus: string;
  sortOrder: number;
}

const SELECT_COLUMNS =
  "id, code, description, overall_status, initial_status, color, font_bold, follow_up_dashboard, allowed_roles, csr_reschedule_status, part_pending_status, cx_requests_reschedule, dispatch_completed_status, mobile_search, hide_in_mobile, service_power_status, sort_order";

function rowToRepairStatus(row: any): RepairStatus {
  return {
    id: row.id,
    code: row.code ?? "",
    description: row.description ?? "",
    overallStatus: row.overall_status ?? "Pending",
    initialStatus: row.initial_status ?? "",
    color: row.color ?? "#888888",
    fontBold: !!row.font_bold,
    followUpDashboard: row.follow_up_dashboard ?? "",
    allowedRoles: (row.allowed_roles as string[] | null) ?? [],
    csrRescheduleStatus: !!row.csr_reschedule_status,
    partPendingStatus: !!row.part_pending_status,
    cxRequestsReschedule: !!row.cx_requests_reschedule,
    dispatchCompletedStatus: !!row.dispatch_completed_status,
    mobileSearch: !!row.mobile_search,
    hideInMobile: !!row.hide_in_mobile,
    servicePowerStatus: row.service_power_status ?? "",
    sortOrder: row.sort_order ?? 0,
  };
}

/** Every repair status for the caller's company, in display order. */
export async function getRepairStatuses(): Promise<RepairStatus[]> {
  const { data, error } = await supabase
    .from("repair_statuses")
    .select(SELECT_COLUMNS)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("getRepairStatuses error:", error.message);
    return [];
  }
  return (data ?? []).map(rowToRepairStatus);
}

/** Create or update a repair status. Pass `id` to update an existing row; omit it to insert a new one. */
export async function upsertRepairStatus(
  input: Partial<Omit<RepairStatus, "id">> & { id?: string; code: string; description: string }
): Promise<RepairStatus> {
  const payload: Record<string, unknown> = {
    ...(input.id ? { id: input.id } : {}),
    code: input.code,
    description: input.description,
    overall_status: input.overallStatus ?? "Pending",
    initial_status: input.initialStatus ?? null,
    color: input.color ?? "#888888",
    font_bold: input.fontBold ?? false,
    follow_up_dashboard: input.followUpDashboard ?? null,
    allowed_roles: input.allowedRoles ?? [],
    csr_reschedule_status: input.csrRescheduleStatus ?? false,
    part_pending_status: input.partPendingStatus ?? false,
    cx_requests_reschedule: input.cxRequestsReschedule ?? false,
    dispatch_completed_status: input.dispatchCompletedStatus ?? false,
    mobile_search: input.mobileSearch ?? false,
    hide_in_mobile: input.hideInMobile ?? false,
    service_power_status: input.servicePowerStatus || null,
    ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
  };
  const { data, error } = await supabase
    .from("repair_statuses")
    .upsert(payload, { onConflict: "company_id,code" })
    .select(SELECT_COLUMNS)
    .single();
  if (error) {
    console.error("upsertRepairStatus error:", error.message);
    throw new Error(error.message);
  }
  return rowToRepairStatus(data);
}

export async function deleteRepairStatus(id: string): Promise<void> {
  const { error } = await supabase.from("repair_statuses").delete().eq("id", id);
  if (error) {
    console.error("deleteRepairStatus error:", error.message);
    throw new Error(error.message);
  }
}
