/**
 * NSA Platform → Supabase Sync
 * ─────────────────────────────
 * Pulls dispatches from the NSA API and upserts them into Supabase `tickets`
 * using the same `upsertTicketFromServicePower` function that ServicePower uses.
 *
 * Field mapping (based on actual NSA API response):
 *   NSA dispatchNumber        → tickets.ticket_no
 *   NSA caseNumber            → tickets.case_number (0056 — was
 *                                original_ticket_no, which is "Redo
 *                                Ticket #"; a dispatch is never a redo)
 *   NSA brand                 → tickets.manufacturer
 *   NSA model                 → tickets.model
 *   NSA serial                → tickets.serial
 *   NSA version/modelVersion  → tickets.model_version
 *   NSA productCategory       → tickets.product_type
 *   NSA scheduleDate          → tickets.schedule_date
 *   NSA timeSlot (A/P/D/E)    → tickets.time_slot
 *   NSA firstName/lastName    → customers.first_name/last_name
 *   NSA address1/city/etc     → customers.address/city/etc
 *   NSA email                 → customers.email (0057 — was hardcoded to
 *                                "", silently dropping a real value on
 *                                every sync)
 *   NSA countryCode           → customers.country (0057)
 *   NSA status                → mapped AHS repair status
 *   NSA latitude/longitude    → tickets.nsa_latitude/nsa_longitude (0057;
 *                                sent as strings by NSA, parsed to numeric)
 *   NSA statusCode/program/   → tickets.nsa_status_code/nsa_program/
 *     apiClose/hash/            nsa_api_close/nsa_hash/
 *     legacyFileName/           nsa_legacy_file_name/
 *     datetimeDepotReceived/    nsa_datetime_depot_received/
 *     dispatchCodes/            nsa_dispatch_codes/
 *     hasPartBOM/partBOMRequired/ nsa_has_part_bom/nsa_part_bom_required/
 *     sfCanAddPartOrderedBySF/  nsa_sf_can_add_part/
 *     sfCanOrderPartsThroughNSA nsa_sf_can_order_parts (all 0057 — had no
 *                                column before, silently dropped)
 *   NSA customerScheduleAcknowledgedByUserID/ByUserName →
 *     tickets.nsa_schedule_ack_by_user_id/nsa_schedule_ack_by_user_name (0057)
 *   ticket_source             → "NSA"
 */

import { getNsaDispatches, type NsaDispatch } from "./nsaApi";
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
  // Resolve AHS branch from customer zip/city/state
  const consumer = {
    postcode: d.postalCode ?? "",
    postcodeLevel3: d.city ?? "",
    postcodeLevel2: d.city ?? "",
    postcodeLevel1: d.stateProvince ?? "",
  };
  const resolvedBranch = resolveBranchFromCustomer(consumer);

  const firstName = d.firstName ?? "";
  const lastName = d.lastName ?? "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ");

  // Normalize schedule date to ISO yyyy-mm-dd
  const scheduleRaw = d.scheduleDate ?? "";
  const schedule = scheduleRaw
    ? scheduleRaw.includes("-")
      ? scheduleRaw.slice(0, 10)
      : scheduleRaw.replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3-$1-$2")
    : "";

  // Build pre-auth summary string
  const preAuth = [
    d.preAuthLabor != null ? `LABOR: ${d.preAuthLabor}` : "",
    d.preAuthParts != null ? `PARTS: ${d.preAuthParts}` : "",
    d.preAuthTotal != null ? `TOTAL: ${d.preAuthTotal}` : "",
  ].filter(Boolean).join("  ");

  // Coverage from estimateRules
  const validCoverage = d.estimateRules?.validCoverageTypeCodes?.join(", ") ?? "";
  const requiredCoverage = d.estimateRules?.requiredCoverageTypeCodes?.join(", ") ?? "";
  const requiredPart = d.estimateRules?.requirePartsDetails ? "Y" : "N";

  // NSA sends these as strings, but the DB column (and Ticket.nsaLatitude/
  // nsaLongitude) are numeric — parse, dropping anything non-numeric rather
  // than storing "NaN".
  const parseCoord = (v: string | undefined) => {
    const n = parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? n : undefined;
  };

  return {
    ticketNo: d.dispatchNumber,
    ticketSource: "NSA",
    claimCompany: "NSA",
    account: "NSA",
    caseNumber: d.caseNumber ?? "",
    // Product
    manufacturer: d.brand ?? "",
    model: d.model ?? "",
    serial: d.serial ?? "",
    productType: d.productCategory ?? "",
    modelVersion: d.version ?? d.modelVersion ?? "",
    // Schedule
    schedule,
    timeSlot: mapNsaTimeBlock(d.timeSlot),
    schedulePeriod: mapNsaTimeBlock(d.timeSlot),
    // Status
    status: mapNsaStatus(d.status),
    // Branch
    location: resolvedBranch,
    // Customer
    customer: fullName,
    firstName,
    lastName,
    phone: d.homePhone ?? "",
    secondPhone: d.cellPhone ?? "",
    email: d.email ?? "",
    address: d.address1 ?? "",
    address2: d.address2 ?? "",
    city: d.city ?? "",
    state: d.stateProvince ?? "",
    zip: d.postalCode ?? "",
    country: d.countryCode ?? "",
    // Notes
    internalNote: d.complaint ?? d.notes ?? "",
    problemDescription: d.complaint ?? "",
    warranty: "",
    // NSA-specific extras (surfaced on ticket detail page)
    nsaStatus: d.status ?? "",
    nsaRouteName: d.routeName ?? "",
    nsaGroupName: d.groupName ?? "",
    nsaDeductible: d.deductible ?? "",
    nsaScheduleAck: d.customerScheduleAcknowledgedDate ?? "",
    nsaSpecialInstructions: d.specialInstructions ?? "",
    nsaValidCoverage: validCoverage,
    nsaRequiredCoverage: requiredCoverage,
    nsaRequiredPart: requiredPart,
    nsaPreAuth: preAuth,
    nsaMasterCode: d.masterCode ?? "",
    nsaCoverageExclusions: d.coverageExclusions ?? "",
    nsaLatitude: parseCoord(d.latitude),
    nsaLongitude: parseCoord(d.longitude),
    nsaStatusCode: d.statusCode ?? "",
    nsaDispatchCodes: d.dispatchCodes ?? undefined,
    nsaHasPartBOM: d.hasPartBOM ?? undefined,
    nsaPartBOMRequired: d.partBOMRequired ?? undefined,
    nsaSfCanAddPart: d.sfCanAddPartOrderedBySF ?? undefined,
    nsaSfCanOrderParts: d.sfCanOrderPartsThroughNSA ?? undefined,
    nsaProgram: d.program ?? "",
    nsaApiClose: d.apiClose ?? undefined,
    nsaHash: d.hash ?? "",
    nsaLegacyFileName: d.legacyFileName ?? "",
    nsaDatetimeDepotReceived: d.datetimeDepotReceived ?? "",
    nsaScheduleAckByUserId: d.customerScheduleAcknowledgedByUserID ?? "",
    nsaScheduleAckByUserName: d.customerScheduleAcknowledgedByUserName ?? "",
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
 * @param options.skipDispatchNumbers  Dispatch numbers already in DB — skip them.
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
  let added = 0, updated = 0, skipped = 0;

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
      added: 0, updated: 0, skipped: 0, total: 0,
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
      errors.push(`${dispatchNo}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { success: errors.length === 0, added, updated, skipped, total, errors };
}
