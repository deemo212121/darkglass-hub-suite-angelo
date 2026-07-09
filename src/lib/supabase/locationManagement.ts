/**
 * Supabase service for Location Management (Locations, Part Addresses, Coverage).
 *
 * All reads/writes are company-scoped by RLS; company_id is auto-stamped on
 * insert from the caller's session. The UI keeps its existing camelCase row
 * shapes, so these helpers map to/from the snake_case DB columns.
 */

import { supabase } from "./client";

// ---- UI row shapes (mirror LocationManagementPage.tsx) ----
export type LocationRow = {
  id: string;
  legacyId?: string;
  location: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zipCode: string;
  office: string;
  coordinates?: string;
  phoneNo: string;
  email: string;
  defaultPartDist: string;
  repTech: string;
  officeLocation?: string;
  deliveryRecipientName?: string;
  checkProcessing?: "Y" | "N";
  creditCardProcessing?: "Y" | "N";
  permission?: "Y" | "N";
  sms: "Y" | "N";
  emailFlag: "Y" | "N";
  autoTriage: "Y" | "N";
  encompassPickupWH?: "Y" | "N";
  availableDays?: string[];
  availableTimeSlot?: string;
  coveredTechnicians?: string[];
  // OOW Default Charge
  laborFee?: string;
  partFee?: string;
  tripFee?: string;
  othersFee?: string;
  oowPartActual?: boolean;
};

export type PartAddressRow = {
  id: string;
  name: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zipCode: string;
  location: string;
};

export type CoverageRow = {
  id: string;
  location: string;
  zipCode: string;
  city: string;
  selfSchedule: string;
  daysLater: string;
  tierCode: string;
};

const yn = (v: unknown): "Y" | "N" => (v === "Y" ? "Y" : "N");

// Parse a money-ish string into a number; blank/invalid -> 0.
const numOrZero = (v: unknown): number => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// ===================== Locations =====================
function locFromDb(r: any): LocationRow {
  return {
    id: r.id,
    legacyId: r.legacy_id ?? "",
    location: r.location ?? "",
    address1: r.address1 ?? "",
    address2: r.address2 ?? "",
    city: r.city ?? "",
    state: r.state ?? "",
    zipCode: r.zip_code ?? "",
    office: r.office ?? "",
    coordinates: r.coordinates ?? "",
    phoneNo: r.phone_no ?? "",
    email: r.email ?? "",
    defaultPartDist: r.default_part_dist ?? "",
    repTech: r.rep_tech ?? "",
    officeLocation: r.office_location ?? "",
    deliveryRecipientName: r.delivery_recipient_name ?? "",
    checkProcessing: yn(r.check_processing),
    creditCardProcessing: yn(r.credit_card_processing),
    permission: yn(r.permission),
    sms: yn(r.sms),
    emailFlag: yn(r.email_flag),
    autoTriage: yn(r.auto_triage),
    encompassPickupWH: yn(r.encompass_pickup_wh),
    availableDays: Array.isArray(r.available_days) ? r.available_days : [],
    availableTimeSlot: r.available_time_slot ?? "ANY",
    coveredTechnicians: Array.isArray(r.covered_technicians) ? r.covered_technicians : [],
    laborFee: r.labor_fee != null ? String(r.labor_fee) : "",
    partFee: r.part_fee != null ? String(r.part_fee) : "",
    tripFee: r.trip_fee != null ? String(r.trip_fee) : "",
    othersFee: r.others_fee != null ? String(r.others_fee) : "",
    oowPartActual: r.oow_part_actual === true,
  };
}

function locToDb(row: LocationRow): Record<string, unknown> {
  return {
    legacy_id: row.legacyId || (row.id && !row.id.includes("-") ? row.id : null),
    location: row.location,
    address1: row.address1,
    address2: row.address2,
    city: row.city,
    state: row.state,
    zip_code: row.zipCode,
    office: row.office,
    coordinates: row.coordinates ?? "",
    phone_no: row.phoneNo,
    email: row.email,
    default_part_dist: row.defaultPartDist,
    rep_tech: row.repTech,
    office_location: row.officeLocation ?? "",
    delivery_recipient_name: row.deliveryRecipientName ?? "",
    check_processing: yn(row.checkProcessing),
    credit_card_processing: yn(row.creditCardProcessing),
    permission: yn(row.permission),
    sms: yn(row.sms),
    email_flag: yn(row.emailFlag),
    auto_triage: yn(row.autoTriage),
    encompass_pickup_wh: yn(row.encompassPickupWH),
    available_days: row.availableDays ?? [],
    available_time_slot: row.availableTimeSlot ?? "ANY",
    covered_technicians: row.coveredTechnicians ?? [],
    labor_fee: numOrZero(row.laborFee),
    part_fee: numOrZero(row.partFee),
    trip_fee: numOrZero(row.tripFee),
    others_fee: numOrZero(row.othersFee),
    oow_part_actual: row.oowPartActual === true,
    updated_at: new Date().toISOString(),
  };
}

export async function getLocations(): Promise<LocationRow[]> {
  const { data, error } = await supabase
    .from("location_mgmt_locations")
    .select("*")
    .order("location", { ascending: true });
  if (error) {
    console.error("getLocations error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []).map(locFromDb);
}

/** Insert (no id) or update (uuid id) a location row; returns the saved row. */
export async function upsertLocation(row: LocationRow): Promise<LocationRow> {
  const payload = locToDb(row);
  const isUuid = /^[0-9a-f-]{36}$/i.test(row.id);
  if (isUuid) {
    const { data, error } = await supabase
      .from("location_mgmt_locations")
      .update(payload)
      .eq("id", row.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return locFromDb(data);
  }
  // No uuid id: this is a new row. Guard against the (company_id, location)
  // unique constraint — if a location with this name already exists, update it
  // instead of inserting a duplicate.
  const { data: existing } = await supabase
    .from("location_mgmt_locations")
    .select("id")
    .ilike("location", row.location)
    .maybeSingle();
  if (existing?.id) {
    const { data, error } = await supabase
      .from("location_mgmt_locations")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return locFromDb(data);
  }

  const { data, error } = await supabase
    .from("location_mgmt_locations")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return locFromDb(data);
}

export async function deleteLocation(id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return; // not yet persisted
  const { error } = await supabase.from("location_mgmt_locations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ===================== Part Addresses =====================
function partFromDb(r: any): PartAddressRow {
  return {
    id: r.id,
    name: r.name ?? "",
    address1: r.address1 ?? "",
    address2: r.address2 ?? "",
    city: r.city ?? "",
    state: r.state ?? "",
    zipCode: r.zip_code ?? "",
    location: r.location ?? "",
  };
}

function partToDb(row: PartAddressRow): Record<string, unknown> {
  return {
    legacy_id: row.id && !row.id.includes("-") ? row.id : null,
    name: row.name,
    address1: row.address1,
    address2: row.address2,
    city: row.city,
    state: row.state,
    zip_code: row.zipCode,
    location: row.location,
    updated_at: new Date().toISOString(),
  };
}

export async function getPartAddresses(): Promise<PartAddressRow[]> {
  const { data, error } = await supabase
    .from("location_mgmt_part_addresses")
    .select("*")
    .order("name", { ascending: true });
  if (error) {
    console.error("getPartAddresses error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []).map(partFromDb);
}

export async function upsertPartAddress(row: PartAddressRow): Promise<PartAddressRow> {
  const payload = partToDb(row);
  const isUuid = /^[0-9a-f-]{36}$/i.test(row.id);
  if (isUuid) {
    const { data, error } = await supabase
      .from("location_mgmt_part_addresses")
      .update(payload)
      .eq("id", row.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return partFromDb(data);
  }
  const { data, error } = await supabase
    .from("location_mgmt_part_addresses")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return partFromDb(data);
}

export async function deletePartAddress(id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const { error } = await supabase.from("location_mgmt_part_addresses").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ===================== Coverage =====================
function covFromDb(r: any): CoverageRow {
  return {
    id: r.id,
    location: r.location ?? "",
    zipCode: r.zip_code ?? "",
    city: r.city ?? "",
    selfSchedule: r.self_schedule ?? "",
    daysLater: r.days_later ?? "",
    tierCode: r.tier_code ?? "",
  };
}

function covToDb(row: CoverageRow): Record<string, unknown> {
  return {
    legacy_id: row.id && !row.id.includes("-") ? row.id : null,
    location: row.location,
    zip_code: row.zipCode,
    city: row.city,
    self_schedule: row.selfSchedule,
    days_later: row.daysLater,
    tier_code: row.tierCode,
    updated_at: new Date().toISOString(),
  };
}

export async function getCoverage(): Promise<CoverageRow[]> {
  const { data, error } = await supabase
    .from("location_mgmt_coverage")
    .select("*")
    .order("zip_code", { ascending: true });
  if (error) {
    console.error("getCoverage error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []).map(covFromDb);
}

export async function upsertCoverage(row: CoverageRow): Promise<CoverageRow> {
  const payload = covToDb(row);
  const isUuid = /^[0-9a-f-]{36}$/i.test(row.id);
  if (isUuid) {
    const { data, error } = await supabase
      .from("location_mgmt_coverage")
      .update(payload)
      .eq("id", row.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return covFromDb(data);
  }
  const { data, error } = await supabase
    .from("location_mgmt_coverage")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return covFromDb(data);
}

/** Bulk insert coverage rows (e.g. CSV import). Returns inserted rows. */
export async function insertCoverageBulk(rows: CoverageRow[]): Promise<CoverageRow[]> {
  if (rows.length === 0) return [];
  const payload = rows.map(covToDb);
  const { data, error } = await supabase
    .from("location_mgmt_coverage")
    .insert(payload)
    .select("*");
  if (error) throw new Error(error.message);
  return (data ?? []).map(covFromDb);
}

export async function deleteCoverage(id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const { error } = await supabase.from("location_mgmt_coverage").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
