import { supabase } from "./client";
import type { MileageStatus } from "@/lib/dailyMileage";

/**
 * Accounting → Daily Mileage (migrations 0451 + 0453): each technician's
 * trips, one row per trip — the same rows as Finance's "Mileage Record
 * Keeping" workbook (Daily Entry Revised). A day can hold several trips.
 * Company, who saved a trip and who approved it are stamped by the database.
 */

export interface TechMileageTrip {
  id: string;
  profileId: string;
  workDate: string;
  /** Total miles driven. */
  miles: number;
  /** Miles taken off (missing photos, duplicate trip, …) — eligible = miles − excluded. */
  excludedMiles: number;
  exclusionReason: string;
  vehicle: string;
  /** The branch the trip was for; "" = the technician's own branch. */
  branch: string;
  ticketRefs: string;
  totalMapUrl: string;
  eligibleMapUrl: string;
  notes: string;
  status: MileageStatus;
  reviewedByName: string | null;
  reviewedAt: string | null;
  updatedByName: string | null;
  updatedAt: string;
}

/** The fields a person edits on a trip. */
export type TripFields = Pick<
  TechMileageTrip,
  "workDate" | "miles" | "excludedMiles" | "exclusionReason" | "vehicle" | "branch" | "ticketRefs" | "totalMapUrl" | "eligibleMapUrl" | "notes" | "status"
>;

const SELECT =
  "id, profile_id, work_date, miles, excluded_miles, exclusion_reason, vehicle, branch, ticket_refs, total_map_url, eligible_map_url, notes, status, reviewed_by_name, reviewed_at, updated_by_name, updated_at";
/** 0451 only (0453 not run yet) — the page still loads, with the review fields empty. */
const SELECT_0451 = "id, profile_id, work_date, miles, notes, updated_by_name, updated_at";
const PAGE_SIZE = 1000;

const fromRow = (r: any): TechMileageTrip => ({
  id: r.id,
  profileId: r.profile_id,
  workDate: r.work_date,
  miles: Number(r.miles) || 0,
  excludedMiles: Number(r.excluded_miles) || 0,
  exclusionReason: r.exclusion_reason ?? "",
  vehicle: r.vehicle ?? "",
  branch: r.branch ?? "",
  ticketRefs: r.ticket_refs ?? "",
  totalMapUrl: r.total_map_url ?? "",
  eligibleMapUrl: r.eligible_map_url ?? "",
  notes: r.notes ?? "",
  status: (r.status as MileageStatus) ?? "pending",
  reviewedByName: r.reviewed_by_name ?? null,
  reviewedAt: r.reviewed_at ?? null,
  updatedByName: r.updated_by_name ?? null,
  updatedAt: r.updated_at,
});

const toRow = (f: Partial<TripFields>) => {
  const out: Record<string, unknown> = {};
  if (f.workDate !== undefined) out.work_date = f.workDate;
  if (f.miles !== undefined) out.miles = f.miles;
  if (f.excludedMiles !== undefined) out.excluded_miles = f.excludedMiles;
  if (f.exclusionReason !== undefined) out.exclusion_reason = f.exclusionReason;
  if (f.vehicle !== undefined) out.vehicle = f.vehicle;
  if (f.branch !== undefined) out.branch = f.branch;
  if (f.ticketRefs !== undefined) out.ticket_refs = f.ticketRefs;
  if (f.totalMapUrl !== undefined) out.total_map_url = f.totalMapUrl;
  if (f.eligibleMapUrl !== undefined) out.eligible_map_url = f.eligibleMapUrl;
  if (f.notes !== undefined) out.notes = f.notes;
  if (f.status !== undefined) out.status = f.status;
  return out;
};

export const isTechDailyMileageMissing = (message: string) => /tech_daily_mileage|relation .* does not exist/i.test(message) && !/column/i.test(message);
/** 0451 is there but 0453 isn't: a review column is missing. */
export const isTripColumnsMissing = (message: string) => /(excluded_miles|exclusion_reason|vehicle|ticket_refs|map_url|status|reviewed_)/i.test(message) && /column|schema cache/i.test(message);

/** Every trip between from and to (inclusive). `reviewFields` is false when 0453 hasn't been run yet. */
export async function getTechDailyMileage(from: string, to: string): Promise<{ trips: TechMileageTrip[]; reviewFields: boolean }> {
  let select = SELECT;
  const out: TechMileageTrip[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("tech_daily_mileage")
      .select(select)
      .gte("work_date", from)
      .lte("work_date", to)
      .order("work_date")
      .order("created_at")
      .order("id")
      .range(start, start + PAGE_SIZE - 1);
    if (error) {
      if (select === SELECT && isTripColumnsMissing(error.message)) { select = SELECT_0451; start -= PAGE_SIZE; continue; }
      throw new Error(error.message);
    }
    out.push(...(data ?? []).map(fromRow));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { trips: out, reviewFields: select === SELECT };
}

/**
 * Every APPROVED trip (any date) — for Overall Expenses' mileage bills.
 * null before migration 0453 (no approval status yet) or before 0451 — the sync then does nothing.
 */
export async function getApprovedTechMileage(): Promise<TechMileageTrip[] | null> {
  const out: TechMileageTrip[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("tech_daily_mileage")
      .select(SELECT)
      .eq("status", "approved")
      .order("work_date")
      .order("id")
      .range(start, start + PAGE_SIZE - 1);
    if (error) {
      if (isTripColumnsMissing(error.message) || isTechDailyMileageMissing(error.message)) return null;
      throw new Error(error.message);
    }
    out.push(...(data ?? []).map(fromRow));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return out;
}

/** Each profile's current Car IQ flag (employee_info.hasCarIq) — the fallback when their Car IQ history has no entry yet. */
export async function getCarIqFlags(): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, hasCarIq:employee_info->hasCarIq")
      .order("id")
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { id: string; hasCarIq: unknown }[]) if (typeof r.hasCarIq === "boolean") out.set(r.id, r.hasCarIq);
    if (!data || data.length < PAGE_SIZE) break;
  }
  return out;
}

/** One grid cell's change: new total miles (null clears the day) for a technician and date. */
export interface MileageCellChange {
  profileId: string;
  workDate: string;
  miles: number | null;
  /** The day's one trip, when there is one. */
  existingId: string | null;
}

/**
 * Saves a batch of grid cells (a typed cell or a pasted block): a day with no
 * trip gets one, a day's single trip gets the new miles, a cleared cell
 * deletes the trip. Returns the saved rows.
 */
export async function saveTechDailyMileage(changes: MileageCellChange[]): Promise<{ saved: TechMileageTrip[]; deletedIds: string[] }> {
  const inserts = changes.filter((c) => c.miles != null && !c.existingId);
  const updates = changes.filter((c) => c.miles != null && c.existingId);
  const deletes = changes.filter((c) => c.miles == null && c.existingId).map((c) => c.existingId!);
  const saved = await insertTrips(inserts.map((c) => ({ profileId: c.profileId, workDate: c.workDate, miles: c.miles! })));
  for (const c of updates) saved.push(await updateTrip(c.existingId!, { miles: c.miles! }));
  await deleteTrips(deletes);
  return { saved, deletedIds: deletes };
}

/** Adds trips (any fields left out take the table's defaults). Selects the 0451 columns when 0453 isn't run yet. */
export async function insertTrips(trips: (Partial<TripFields> & { profileId: string; workDate: string; miles: number })[]): Promise<TechMileageTrip[]> {
  const saved: TechMileageTrip[] = [];
  for (let i = 0; i < trips.length; i += 200) {
    const rows = trips.slice(i, i + 200).map((t) => ({ profile_id: t.profileId, ...toRow(t) }));
    let { data, error } = await supabase.from("tech_daily_mileage").insert(rows).select(SELECT);
    if (error && isTripColumnsMissing(error.message) && rows.every((r) => Object.keys(r).every((k) => ["profile_id", "work_date", "miles", "notes"].includes(k)))) {
      ({ data, error } = await supabase.from("tech_daily_mileage").insert(rows).select(SELECT_0451));
    }
    if (error) throw new Error(error.message);
    saved.push(...(data ?? []).map(fromRow));
  }
  return saved;
}

export async function updateTrip(id: string, fields: Partial<TripFields>): Promise<TechMileageTrip> {
  let { data, error } = await supabase.from("tech_daily_mileage").update(toRow(fields)).eq("id", id).select(SELECT).single();
  if (error && isTripColumnsMissing(error.message) && Object.keys(fields).every((k) => ["workDate", "miles", "notes"].includes(k))) {
    ({ data, error } = await supabase.from("tech_daily_mileage").update(toRow(fields)).eq("id", id).select(SELECT_0451).single());
  }
  if (error) throw new Error(error.message);
  return fromRow(data);
}

/** Approve / reject / back to pending for several trips at once. */
export async function setTripStatus(ids: string[], status: MileageStatus): Promise<TechMileageTrip[]> {
  const out: TechMileageTrip[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("tech_daily_mileage").update({ status }).in("id", ids.slice(i, i + 200)).select(SELECT);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []).map(fromRow));
  }
  return out;
}

export async function deleteTrips(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from("tech_daily_mileage").delete().in("id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
}
