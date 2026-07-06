/**
 * NSA Platform → Supabase Sync
 * ─────────────────────────────
 * Pulls dispatches from the NSA API and upserts them into Supabase `tickets`
 * using the same `upsertTicketFromServicePower` function that ServicePower
 * uses. This keeps ONE canonical ticket store regardless of the source.
 *
 * Field mapping:
 *   NSA dispatchNumber     → tickets.ticket_no       (e.g. "AAN20260636059439")
 *   NSA caseNumber         → tickets.original_ticket_no  (NSA's case/ref #)
 *   NSA status             → mapped to AHS repair status
 *   NSA serviceClass       → tickets.product_type    (e.g. "Major Appliances")
 *   NSA brandName          → tickets.manufacturer
 *   NSA model              → tickets.model
 *   NSA serial             → tickets.serial
 *   NSA scheduleDate       → tickets.schedule_date
 *   NSA timeBlock          → tickets.time_slot       (A/P/D/E → readable)
 *   NSA customer* fields   → customers table
 *   ticket_source          → "NSA"
 *   claim_company          → "NSA"
 */

import { getNsaDispatches, nsaServiceClassLabel, type NsaDispatch } from "./nsaApi";
import { resolveBranchFromCustomer } from "./servicePowerSync";

// ─── Status mapping ──────────────────────────────────────────────────────────
function mapNsaStatus(nsaStatus: string | undefined): string {
  const s = String(nsaStatus ?? "").toLowerCase().trim();
  if (!s) return "CSR-Needs Scheduling";
  if (s.includes("cancel")) return "CL-Cancelled";
  if (s.includes("complet")) return "CL-Ready to Complete";
  if (s.includes("closed")) return "CL-Completed";
  if (s.includes("accept") || s.includes("pending") || s.includes("scheduled"))
    return "CSR-Needs Scheduling";
  if (s.includes("in progress") || s.includes("inprogress")) return "CSR-Acknowledged";
  return "CSR-Needs Scheduling";
}

// ─── Time block → AHS time_slot ──────────────────────────────────────────────
function mapNsaTimeBlock(code: string | undefined): string {
  const map: Record<string, string> = {
    A: "8-12",
    P: "1-5",
    D: "ANYTIME",
    E: "EVENING",
  };
  return map[String(code ?? "").toUpperCase()] ?? "ANYTIME";
}

// ─── Dispatch → Ticket shape ─────────────────────────────────────────────────
function convertDispatchToTicket(d: NsaDispatch): Record<string, any> {
  const consumer = {
    postcode: d.customerZip ?? "",
    postcodeLevel3: d.customerCity ?? "",
    postcodeLevel2: d.customerCity ?? "",
    postcodeLevel1: d.customerState ?? "",
  };

  const resolvedBranch = resolveBranchFromCustomer(consumer);

  // Split full name into first/last best-effort
  const fullName = String(d.customerName ?? "").trim();
  const nameParts = fullName.split(/\s+/);
  const firstName = nameParts.slice(0, -1).join(" ") || fullName;
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";

  // Normalize schedule date to ISO yyyy-mm-dd
  const scheduleRaw = d.scheduleDate ?? "";
  const schedule = scheduleRaw
    ? scheduleRaw.includes("-")
      ? scheduleRaw.slice(0, 10)
      : scheduleRaw.replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3-$1-$2")
    : "";

  return {
    ticketNo: d.dispatchNumber,
    ticketSource: "NSA",
    claimCompany: "NSA",
    account: "NSA",
    originalTicketNo: d.caseNumber ?? "",
    manufacturer: d.brandName ?? d.brandCode ?? "",
    model: d.model ?? "",
    serial: d.serial ?? "",
    productType: nsaServiceClassLabel(d.serviceClass) || d.productType ?? "",
    schedule,
    timeSlot: mapNsaTimeBlock(d.timeBlock),
    schedulePeriod: mapNsaTimeBlock(d.timeBlock),
    status: mapNsaStatus(d.status),
    location: resolvedBranch,
    customer: fullName,
    firstName,
    lastName,
    phone: d.customerPhone ?? "",
    secondPhone: "",
    email: "",
    address: d.customerAddress ?? "",
    address2: "",
    city: d.customerCity ?? "",
    state: d.customerState ?? "",
    zip: d.customerZip ?? "",
    warranty: "",
    internalNote: "",
    problemDescription: "",
  };
}

// ─── Main sync function ───────────────────────────────────────────────────────

export interface NsaSyncResult {
  success: boolean;
  added: number;
  updated: number;
  skipped: number;
  total: number;
  errors: string[];
}

/**
 * Sync NSA dispatches into Supabase tickets.
 *
 * @param options.startDate  ISO date (yyyy-mm-dd). Defaults to 7 days ago.
 * @param options.endDate    ISO date (yyyy-mm-dd). Defaults to today.
 * @param options.status     NSA status filter (optional).
 * @param options.limit      Max dispatches to process (for testing).
 * @param options.skipDispatchNumbers  Set of dispatch numbers already in DB.
 */
export async function syncNsaToSupabase(
  options: {
    startDate?: string;
    endDate?: string;
    status?: string;
    limit?: number;
    skipDispatchNumbers?: Set<string> | string[];
  } = {}
): Promise<NsaSyncResult> {
  const { upsertTicketFromServicePower } = await import("./supabase/tickets");

  const today = new Date();
  const defaultStart = new Date(today);
  defaultStart.setDate(today.getDate() - 7);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const startDate = options.startDate ?? fmt(defaultStart);
  const endDate = options.endDate ?? fmt(today);
  const skipSet = new Set(
    [...(options.skipDispatchNumbers ?? [])].map((v) => String(v).trim())
  );

  const errors: string[] = [];
  let added = 0;
  let updated = 0;
  let skipped = 0;

  let dispatches: NsaDispatch[];
  try {
    dispatches = await getNsaDispatches({
      startDate,
      endDate,
      status: options.status,
      limit: options.limit,
    });
  } catch (err) {
    return {
      success: false,
      added: 0,
      updated: 0,
      skipped: 0,
      total: 0,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }

  const total = dispatches.length;

  for (const dispatch of dispatches) {
    const dispatchNo = String(dispatch.dispatchNumber ?? "").trim();
    if (!dispatchNo) { skipped++; continue; }
    if (skipSet.size && skipSet.has(dispatchNo)) { skipped++; continue; }

    try {
      const ticket = convertDispatchToTicket(dispatch);
      const outcome = await upsertTicketFromServicePower(ticket as any);
      if (outcome === "added") added++;
      else updated++;
    } catch (err) {
      errors.push(
        `${dispatchNo}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return { success: errors.length === 0, added, updated, skipped, total, errors };
}
