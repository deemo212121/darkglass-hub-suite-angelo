/**
 * ServicePower call -> AHS rows (customers + tickets payloads).
 *
 * Pure (no Supabase client), so the browser pulls (supabase/tickets.ts) and
 * the server's hourly auto-pull (server/servicePowerAutoPull.ts) build
 * exactly the same rows.
 */
import type { Ticket } from "./ticketData";

export const bool = (v: unknown) => v === "Y" || v === "y" || v === true;

/**
 * Coerce whatever ServicePower handed us as a schedule date into a
 * Postgres-friendly `YYYY-MM-DD` string (the `tickets.schedule_date`
 * column is a `date`, not a `timestamp`).
 *
 * SP serialises the value in a handful of shapes — we already format
 * it down to `MM/DD/YY` upstream in formatServicePowerDate, but for
 * defensive parsing we accept either form here.
 *
 * Returns null when the input is empty or unparseable so the column
 * stores SQL NULL rather than a garbled date string.
 */
export function parseScheduleDateForSql(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  // YYYY-MM-DD (with optional time tail we ignore).
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const m = iso[2].padStart(2, "0");
    const d = iso[3].padStart(2, "0");
    return `${iso[1]}-${m}-${d}`;
  }
  // MM/DD/YY or MM/DD/YYYY (US format, our formatter's output).
  const us = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) {
    const m = us[1].padStart(2, "0");
    const d = us[2].padStart(2, "0");
    const y = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${y}-${m}-${d}`;
  }
  // Compact YYYYMMDD.
  const c = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (c) return `${c[1]}-${c[2]}-${c[3]}`;
  return null;
}

// ServicePower's ServiceLocation codes (IH = In Home, OS = On Site, DO = Drop
// Off, etc.) used to leak into ticket.location in an older sync. They're NOT
// valid branch names — strip them at read time so the UI shows "—" instead
// while we wait for the next sync to overwrite the column with the real
// resolved branch. Both upper- and lower-case forms are listed so a
// case-insensitive check via toLowerCase actually matches the short codes.
const SP_SERVICE_LOCATION_CODES = new Set([
  "ih","os","do","on","dc","dr","is","od",
  "in home","on site","drop off","drop-off","in-home","unknown",
]);

export function sanitizeLocation(raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (SP_SERVICE_LOCATION_CODES.has(v.toLowerCase())) return "";
  return v;
}

export function buildServicePowerPayloads(input: Partial<Ticket>): {
  customerPayload: Record<string, unknown>;
  ticketPayload: Record<string, unknown>;
} {
  // Customer payload (ServicePower-owned fields).
  const customerPayload: Record<string, unknown> = {
    first_name: input.firstName ?? "",
    last_name: input.lastName ?? "",
    full_name:
      input.customer || [input.firstName, input.lastName].filter(Boolean).join(" "),
    phone: input.phone ?? "",
    second_phone: input.secondPhone ?? "",
    email: input.email ?? "",
    address: input.address ?? "",
    address2: input.address2 ?? "",
    city: input.city ?? "",
    state: input.state ?? "",
    zip: input.zip ?? "",
    country: input.country ?? "",
  };

  // Ticket payload (source, product, work order details).
  const ticketPayload: Record<string, unknown> = {
    ticket_source: input.ticketSource ?? "ServicePower",
    warranty: input.warranty ?? null,
    manufacturer: input.manufacturer ?? null,
    account: input.account ?? null,
    // ServicePower's servicer/account number (e.g. "GSL00002") — NOT the
    // warranty company name above. Required as claimSubmission's
    // serviceCenterNumber; a blank value here gets ServicePower's claim
    // API to reject the claim outright with "Invalid manufacturerName/
    // serviceCenterNumber" (migration 0212 — this column didn't exist
    // before, so every sync silently dropped the value convertCallToTicket
    // had already computed).
    account_no: input.accountNo ?? null,
    claim_company: input.claimCompany ?? null,
    location: sanitizeLocation(String(input.location ?? "")) || null,
    model: input.model ?? null,
    model_version: input.modelVersion ?? null,
    serial: input.serial ?? null,
    product_type: input.productType ?? null,
    purchase_date: input.purchaseDate || null,
    status: input.status ?? null,
    type: input.type ?? null,
    technician: input.technician ?? null,
    // Schedule date sync rule:
    //   - On the first import (no existing row), we honor SP's
    //     ScheduleDate so the Work Map / ticket detail header
    //     immediately reflect when SP says the appointment is.
    //   - On re-sync we never overwrite a date the CSR may have
    //     edited (see the "preserve CSR date" branch below).
    //   - Empty SP dates are stored as null so the UI shows "—".
    schedule_date: parseScheduleDateForSql(input.schedule),
    // ServicePower's appointment window — stored on tickets.time_slot.
    // Prefer the caller-provided frame-normalised value (e.g. "8-12") so
    // the Work Planner column matches; fall back to the raw schedulePeriod
    // string if the caller didn't normalise. Empty values become null so
    // the column doesn't accumulate "" placeholders.
    time_slot: (() => {
      const raw =
        ((input as any).timeSlot as string | undefined) ||
        (input.schedulePeriod as string | undefined) ||
        "";
      const trimmed = String(raw).trim();
      return trimmed ? trimmed : null;
    })(),
    call_received_date: input.callReceivedDate || null,
    customer_pref: bool(input.customerPref),
    redo: bool(input.redo),
    problem_description: input.problemDescription ?? input.internalNote ?? null,
    // Case number (migration 0056) — nsaSync.ts computes this from the NSA
    // dispatch's caseNumber, but this payload never read input.caseNumber
    // (or, before 0056, input.originalTicketNo, which is what it used to
    // be called) at all, so it silently never made it to Supabase. The
    // ticket detail page only ever showed it correctly for NSA tickets
    // because of a separate live re-fetch straight from the NSA API on
    // every page view — every other view (Work Map, Ticket List, reports)
    // never saw it.
    case_number: input.caseNumber || null,
    // NSA dispatch fields (see migration 0055) — nsaSync.ts has always
    // computed these from the NSA API response, but they were silently
    // dropped here before, since this payload had no handling for any
    // nsa*-prefixed field.
    nsa_status: input.nsaStatus || null,
    nsa_route_name: input.nsaRouteName || null,
    nsa_group_name: input.nsaGroupName || null,
    nsa_deductible: input.nsaDeductible || null,
    nsa_schedule_ack: input.nsaScheduleAck || null,
    nsa_special_instructions: input.nsaSpecialInstructions || null,
    nsa_valid_coverage: input.nsaValidCoverage || null,
    nsa_required_coverage: input.nsaRequiredCoverage || null,
    nsa_required_part: input.nsaRequiredPart || null,
    nsa_pre_auth: input.nsaPreAuth || null,
    nsa_master_code: input.nsaMasterCode || null,
    nsa_coverage_exclusions: input.nsaCoverageExclusions || null,
    // NSA extended fields (see migration 0057) — previously had no column.
    nsa_latitude: input.nsaLatitude ?? null,
    nsa_longitude: input.nsaLongitude ?? null,
    nsa_status_code: input.nsaStatusCode || null,
    nsa_dispatch_codes: input.nsaDispatchCodes ?? null,
    nsa_has_part_bom: input.nsaHasPartBOM ?? null,
    nsa_part_bom_required: input.nsaPartBOMRequired ?? null,
    nsa_sf_can_add_part: input.nsaSfCanAddPart ?? null,
    nsa_sf_can_order_parts: input.nsaSfCanOrderParts ?? null,
    nsa_program: input.nsaProgram || null,
    nsa_api_close: input.nsaApiClose ?? null,
    nsa_hash: input.nsaHash || null,
    nsa_legacy_file_name: input.nsaLegacyFileName || null,
    nsa_datetime_depot_received: input.nsaDatetimeDepotReceived || null,
    nsa_schedule_ack_by_user_id: input.nsaScheduleAckByUserId || null,
    nsa_schedule_ack_by_user_name: input.nsaScheduleAckByUserName || null,
    updated_at: new Date().toISOString(),
  };
  return { customerPayload, ticketPayload };
}
