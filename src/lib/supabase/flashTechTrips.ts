/**
 * Flash Tech Calendar — plots a technician's (or any staff member's)
 * temporary relocation to cover another branch as a date range, and
 * optionally creates matching Pending Hotel/Transportation expense rows
 * (see migration 0130) that flow through the existing Expense Tracking
 * approve/reimburse pipeline unmodified.
 */
import { supabase } from "./client";
import { createExpense, type ExpenseRow } from "./expenses";
import { uploadFlashTechTripReceiptFile, deleteAttachmentByUrl } from "@/lib/firebase/storage";

/** Tier Level values — kept identical to Master List's own Current
 *  Technicians tier dropdown (ReportHRDaily.tsx, profiles.tier_level) so
 *  the two never drift apart; this is the single source of truth for both. */
export const FLASH_TECH_TIER_LEVELS = ["Tier 1", "Tier 2", "Tier 3", "SBM", "BM", "TR", "DR", "TM"];
export const FLASH_TECH_TRIP_TYPES = ["Flashtech", "Education", "Inspection"] as const;
export type FlashTechTripType = (typeof FLASH_TECH_TRIP_TYPES)[number];
/** Upcoming/Open/Closed are auto-computed from the travel dates (see
 *  computeFlashTechTripStatus) unless a manual status_override is set
 *  (migration 0265) — "Cancelled" is the one value nothing ever computes
 *  on its own, so it only ever comes from an explicit override. */
export const FLASH_TECH_STATUSES = ["Upcoming", "Open", "Closed", "Cancelled"] as const;
export type FlashTechStatus = (typeof FLASH_TECH_STATUSES)[number];

/**
 * Status is derived from the trip's own Travel dates against today, not a
 * manually-picked field — per the user's explicit call: "Open" the day it
 * starts, "Upcoming" before that, "Closed" once the end date has passed.
 * A stored `status` column is still written (create + any date edit) so it
 * stays reasonably queryable, but every UI read recomputes fresh from this
 * function instead of trusting that stored value, since a trip nobody
 * touches again would otherwise go stale the moment its date boundary
 * passes (e.g. "Upcoming" long after it actually started).
 */
export function computeFlashTechTripStatus(startDate: string, endDate: string, todayIso: string = new Date().toISOString().slice(0, 10)): FlashTechStatus {
  if (endDate < todayIso) return "Closed";
  if (startDate > todayIso) return "Upcoming";
  return "Open";
}

export interface FlashTechTrip {
  id: string;
  technicianProfileId: string | null;
  technicianName: string;
  /** Snapshotted from the technician's profile at scheduling time (migration 0259) — editable afterward via the Tracker's own Contact Number/Email cells, same as every other tracker-only field. */
  technicianPhone: string | null;
  technicianEmail: string | null;
  originLocation: string;
  destinationLocation: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  notes: string | null;
  /** Yes/No toggle set at scheduling time (migration 0260) — whether this trip needs a rental car at all, separate from the Tracker's own Rental Car/Rate/Vehicle Type detail fields filled in once it's actually booked. */
  carRentalNeeded: boolean;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  /** This trip's linked expense rows, if any were created for it. */
  hotelExpense: ExpenseRow | null;
  transportationExpense: ExpenseRow | null;
  // ── Tracker fields (migration 0257) — fillable straight from the
  // Schedule Trip modal now (createFlashTechTrip), and still editable
  // afterward per-cell from the Tracker view either way. ──
  tierLevel: string | null;
  lodgingStartDate: string | null;
  lodgingEndDate: string | null;
  hotelName: string | null;
  hotelAddress: string | null;
  hotelRate: number | null;
  hotelConfirmation: string | null;
  rentalCar: string | null;
  rentalStartDate: string | null;
  rentalEndDate: string | null;
  rentalRate: number | null;
  vehicleType: string | null;
  otherExpenses: number | null;
  /** Up to 5 receipt attachments (migration 0258 — was a single receiptPath). */
  receiptPaths: string[];
  tripType: FlashTechTripType;
  status: FlashTechStatus;
  /** Manual override (migration 0265) — null means "let the dates decide" (see mapTripRow). Surfaced separately from `status` so the Tracker's dropdown can tell an explicit pick apart from the computed default. */
  statusOverride: FlashTechStatus | null;
  // ── Alternate hotel (migration 0261) — the Tracker's "Technician
  // requested another hotel" toggle plus its own small set of fields,
  // separate from the original hotel_* columns above so the original
  // booking stays on record. ──
  altHotelRequested: boolean;
  altLodgingStartDate: string | null;
  altLodgingEndDate: string | null;
  altHotelAddress: string | null;
  altHotelRate: number | null;
  altHotelConfirmation: string | null;
}

function mapTripRow(row: any): Omit<FlashTechTrip, "hotelExpense" | "transportationExpense"> {
  return {
    id: row.id,
    technicianProfileId: row.technician_profile_id ?? null,
    technicianName: row.technician_name,
    technicianPhone: row.technician_phone ?? null,
    technicianEmail: row.technician_email ?? null,
    originLocation: row.origin_location,
    destinationLocation: row.destination_location,
    startDate: row.start_date,
    endDate: row.end_date,
    notes: row.notes ?? null,
    carRentalNeeded: Boolean(row.car_rental_needed),
    createdBy: row.created_by ?? null,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    tierLevel: row.tier_level ?? null,
    lodgingStartDate: row.lodging_start_date ?? null,
    lodgingEndDate: row.lodging_end_date ?? null,
    hotelName: row.hotel_name ?? null,
    hotelAddress: row.hotel_address ?? null,
    hotelRate: row.hotel_rate != null ? Number(row.hotel_rate) : null,
    hotelConfirmation: row.hotel_confirmation ?? null,
    rentalCar: row.rental_car ?? null,
    rentalStartDate: row.rental_start_date ?? null,
    rentalEndDate: row.rental_end_date ?? null,
    rentalRate: row.rental_rate != null ? Number(row.rental_rate) : null,
    vehicleType: row.vehicle_type ?? null,
    otherExpenses: row.other_expenses != null ? Number(row.other_expenses) : null,
    receiptPaths: Array.isArray(row.receipt_paths) ? row.receipt_paths : [],
    tripType: (row.trip_type ?? "Flashtech") as FlashTechTripType,
    // A manual status_override (migration 0265) wins outright; otherwise
    // freshly computed from the real dates, never the stored `status`
    // column — see computeFlashTechTripStatus's own doc comment for why.
    status: (row.status_override as FlashTechStatus | null) || computeFlashTechTripStatus(row.start_date, row.end_date),
    statusOverride: (row.status_override as FlashTechStatus | null) ?? null,
    altHotelRequested: Boolean(row.alt_hotel_requested),
    altLodgingStartDate: row.alt_lodging_start_date ?? null,
    altLodgingEndDate: row.alt_lodging_end_date ?? null,
    altHotelAddress: row.alt_hotel_address ?? null,
    altHotelRate: row.alt_hotel_rate != null ? Number(row.alt_hotel_rate) : null,
    altHotelConfirmation: row.alt_hotel_confirmation ?? null,
  };
}

function mapExpenseRow(row: any): ExpenseRow {
  return {
    id: row.id,
    profileId: row.profile_id,
    category: row.category,
    expenseDate: row.expense_date,
    amount: Number(row.amount) || 0,
    description: row.description ?? "",
    status: row.status,
    createdBy: row.created_by ?? null,
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ?? null,
    receiptUrl: row.receipt_url ?? null,
    receiptPath: row.receipt_path ?? null,
    orNumber: row.or_number ?? null,
    fromLocation: row.from_location ?? null,
    toLocation: row.to_location ?? null,
    flashTechTripId: row.flash_tech_trip_id ?? null,
    createdAt: row.created_at,
  };
}

// Supabase caps an unbounded select at 1000 rows — a company's full Flash
// Tech trip history can exceed that. Page through in chunks of 1000.
const PAGE_SIZE = 1000;

/** Every Flash Tech trip for the caller's company, with its linked expenses (if any) attached. */
export async function getCompanyFlashTechTrips(): Promise<FlashTechTrip[]> {
  const tripRows: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error } = await supabase
      .from("flash_tech_trips")
      .select(
        "id, technician_profile_id, technician_name, technician_phone, technician_email, origin_location, destination_location, start_date, end_date, notes, car_rental_needed, created_by, created_by_name, created_at, " +
          "tier_level, lodging_start_date, lodging_end_date, hotel_name, hotel_address, hotel_rate, hotel_confirmation, " +
          "rental_car, rental_start_date, rental_end_date, rental_rate, vehicle_type, other_expenses, " +
          "receipt_paths, trip_type, status, " +
          "alt_hotel_requested, alt_lodging_start_date, alt_lodging_end_date, alt_hotel_address, alt_hotel_rate, alt_hotel_confirmation"
      )
      .order("start_date", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("getCompanyFlashTechTrips error:", error.message);
      return [];
    }
    tripRows.push(...(page ?? []));
    if (!page || page.length < PAGE_SIZE) break;
  }
  const trips = tripRows.map(mapTripRow);
  if (trips.length === 0) return [];

  const tripIds = trips.map((t) => t.id);
  const { data: expenseRows, error: expError } = await supabase
    .from("expenses")
    .select(
      "id, profile_id, category, expense_date, amount, description, status, created_by, reviewed_by, reviewed_at, receipt_url, receipt_path, or_number, from_location, to_location, created_at, flash_tech_trip_id, expense_subtype"
    )
    .in("flash_tech_trip_id", tripIds);
  if (expError) console.error("getCompanyFlashTechTrips (expenses) error:", expError.message);

  const hotelByTrip = new Map<string, ExpenseRow>();
  const transportByTrip = new Map<string, ExpenseRow>();
  for (const r of (expenseRows ?? []) as any[]) {
    const mapped = mapExpenseRow(r);
    if (r.expense_subtype === "hotel") hotelByTrip.set(r.flash_tech_trip_id, mapped);
    else if (r.expense_subtype === "transportation") transportByTrip.set(r.flash_tech_trip_id, mapped);
  }

  return trips.map((t) => ({
    ...t,
    hotelExpense: hotelByTrip.get(t.id) ?? null,
    transportationExpense: transportByTrip.get(t.id) ?? null,
  }));
}

/**
 * Schedule a new trip. `includeHotelExpense`/`includeTransportationExpense`
 * (both default true) each create a linked Pending expense row with
 * amount 0 and no receipt — left for whoever handles the actual receipt to
 * fill in later via the normal Expense Tracking edit flow.
 */
export async function createFlashTechTrip(input: {
  technicianProfileId: string | null;
  technicianName: string;
  technicianPhone?: string;
  technicianEmail?: string;
  originLocation: string;
  destinationLocation: string;
  startDate: string;
  endDate: string;
  notes: string;
  carRentalNeeded?: boolean;
  createdBy: string | null;
  createdByName: string | null;
  includeHotelExpense?: boolean;
  includeTransportationExpense?: boolean;
  // ── Tracker fields, now fillable straight from Schedule Trip instead of
  // only afterward via the Tracker's own per-cell editors (per the user's
  // explicit call — the whole point used to be "unknown at scheduling
  // time," but HR often does know these up front). All optional; a blank
  // one just leaves the column empty for the Tracker to fill in later,
  // same as before this existed. ──
  tierLevel?: string | null;
  hotelName?: string | null;
  lodgingStartDate?: string | null;
  lodgingEndDate?: string | null;
  hotelAddress?: string | null;
  hotelRate?: number | null;
  hotelConfirmation?: string | null;
  rentalCar?: string | null;
  rentalStartDate?: string | null;
  rentalEndDate?: string | null;
  rentalRate?: number | null;
  vehicleType?: string | null;
  otherExpenses?: number | null;
  tripType?: FlashTechTripType;
}): Promise<string> {
  const { data, error } = await supabase
    .from("flash_tech_trips")
    .insert({
      technician_profile_id: input.technicianProfileId,
      technician_name: input.technicianName,
      technician_phone: input.technicianPhone || null,
      technician_email: input.technicianEmail || null,
      origin_location: input.originLocation,
      destination_location: input.destinationLocation,
      start_date: input.startDate,
      end_date: input.endDate,
      notes: input.notes || null,
      car_rental_needed: input.carRentalNeeded ?? false,
      created_by: input.createdBy,
      created_by_name: input.createdByName,
      tier_level: input.tierLevel || null,
      hotel_name: input.hotelName || null,
      lodging_start_date: input.lodgingStartDate || null,
      lodging_end_date: input.lodgingEndDate || null,
      hotel_address: input.hotelAddress || null,
      hotel_rate: input.hotelRate ?? null,
      hotel_confirmation: input.hotelConfirmation || null,
      rental_car: input.rentalCar || null,
      rental_start_date: input.rentalStartDate || null,
      rental_end_date: input.rentalEndDate || null,
      rental_rate: input.rentalRate ?? null,
      vehicle_type: input.vehicleType || null,
      other_expenses: input.otherExpenses ?? null,
      trip_type: input.tripType ?? "Flashtech",
      // Not manually picked — see computeFlashTechTripStatus's doc
      // comment. Written once here purely so the stored column starts
      // out correct too; every read recomputes fresh regardless.
      status: computeFlashTechTripStatus(input.startDate, input.endDate),
    })
    .select("id")
    .single();
  if (error) {
    console.error("createFlashTechTrip error:", error.message);
    throw new Error(error.message);
  }

  const tripId = data.id as string;
  const routeLabel = `${input.originLocation} → ${input.destinationLocation}`;
  const tripProfileId = input.technicianProfileId;
  if (!tripProfileId) return tripId; // Nothing to link the placeholder expenses to.

  const subtypeInserts: Array<{ subtype: "hotel" | "transportation"; description: string }> = [];
  if (input.includeHotelExpense !== false) {
    subtypeInserts.push({ subtype: "hotel", description: `Hotel — ${input.technicianName} — ${routeLabel}` });
  }
  if (input.includeTransportationExpense !== false) {
    subtypeInserts.push({ subtype: "transportation", description: `Transportation — ${input.technicianName} — ${routeLabel}` });
  }

  for (const { subtype, description } of subtypeInserts) {
    try {
      await createExpense({
        profileId: tripProfileId,
        category: "Travel",
        expenseDate: input.startDate,
        amount: 0,
        description,
        createdBy: input.createdBy,
        fromLocation: input.originLocation,
        toLocation: input.destinationLocation,
        flashTechTripId: tripId,
        expenseSubtype: subtype,
      });
    } catch (err) {
      console.error(`createFlashTechTrip: failed to create ${subtype} expense:`, err);
    }
  }
  return tripId;
}

export async function updateFlashTechTrip(
  id: string,
  fields: {
    technicianProfileId: string | null;
    technicianName: string;
    originLocation: string;
    destinationLocation: string;
    startDate: string;
    endDate: string;
    notes: string;
    carRentalNeeded: boolean;
  }
): Promise<void> {
  const { error } = await supabase
    .from("flash_tech_trips")
    .update({
      technician_profile_id: fields.technicianProfileId,
      technician_name: fields.technicianName,
      origin_location: fields.originLocation,
      destination_location: fields.destinationLocation,
      start_date: fields.startDate,
      end_date: fields.endDate,
      notes: fields.notes || null,
      car_rental_needed: fields.carRentalNeeded,
      status: computeFlashTechTripStatus(fields.startDate, fields.endDate),
    })
    .eq("id", id);
  if (error) {
    console.error("updateFlashTechTrip error:", error.message);
    throw new Error(error.message);
  }
}

/** Deleting a trip never deletes its linked expenses (on delete set null — see migration 0130), only unlinks them. */
export async function deleteFlashTechTrip(id: string): Promise<void> {
  const { error } = await supabase.from("flash_tech_trips").delete().eq("id", id);
  if (error) {
    console.error("deleteFlashTechTrip error:", error.message);
    throw new Error(error.message);
  }
}

/** Reassigns the Name cell in the Tracker view to a different technician/staff member — same technician_profile_id/technician_name pair updateFlashTechTrip's full form writes, just on its own so the Tracker's other columns aren't resent. */
export async function updateFlashTechTripTechnician(id: string, technicianProfileId: string | null, technicianName: string): Promise<void> {
  const { error } = await supabase
    .from("flash_tech_trips")
    .update({ technician_profile_id: technicianProfileId, technician_name: technicianName })
    .eq("id", id);
  if (error) {
    console.error("updateFlashTechTripTechnician error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * Patches just the trip's own Travel Start/End dates — separate from
 * updateFlashTechTrip's full-form save (which resends every other base
 * field too) so the Tracker's own Travel Date cell can correct a typo'd
 * date without needing the whole Schedule Trip form, same pattern as
 * updateFlashTechTripTechnician above.
 */
export async function updateFlashTechTripDates(id: string, startDate: string, endDate: string): Promise<void> {
  const { error } = await supabase
    .from("flash_tech_trips")
    .update({ start_date: startDate, end_date: endDate, status: computeFlashTechTripStatus(startDate, endDate) })
    .eq("id", id);
  if (error) {
    console.error("updateFlashTechTripDates error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * Patches one or more of the tracker-only columns (migration 0257) — used
 * by the spreadsheet-style Tracker view's per-cell editors, so a single
 * field edit (e.g. just Hotel Rate) doesn't need to resend every other
 * field on the trip the way updateFlashTechTrip's full-form save does.
 */
export async function updateFlashTechTripTrackerFields(
  id: string,
  fields: Partial<{
    technicianPhone: string | null;
    technicianEmail: string | null;
    carRentalNeeded: boolean;
    tierLevel: string | null;
    lodgingStartDate: string | null;
    lodgingEndDate: string | null;
    hotelName: string | null;
    hotelAddress: string | null;
    hotelRate: number | null;
    hotelConfirmation: string | null;
    rentalCar: string | null;
    rentalStartDate: string | null;
    rentalEndDate: string | null;
    rentalRate: number | null;
    vehicleType: string | null;
    otherExpenses: number | null;
    notes: string | null;
    tripType: FlashTechTripType;
    /** null clears back to the auto-computed Upcoming/Open/Closed behavior. */
    statusOverride: FlashTechStatus | null;
    altHotelRequested: boolean;
    altLodgingStartDate: string | null;
    altLodgingEndDate: string | null;
    altHotelAddress: string | null;
    altHotelRate: number | null;
    altHotelConfirmation: string | null;
  }>
): Promise<void> {
  const payload: Record<string, any> = {};
  if ("technicianPhone" in fields) payload.technician_phone = fields.technicianPhone || null;
  if ("technicianEmail" in fields) payload.technician_email = fields.technicianEmail || null;
  if ("carRentalNeeded" in fields) payload.car_rental_needed = fields.carRentalNeeded;
  if ("tierLevel" in fields) payload.tier_level = fields.tierLevel || null;
  if ("lodgingStartDate" in fields) payload.lodging_start_date = fields.lodgingStartDate || null;
  if ("lodgingEndDate" in fields) payload.lodging_end_date = fields.lodgingEndDate || null;
  if ("hotelName" in fields) payload.hotel_name = fields.hotelName || null;
  if ("hotelAddress" in fields) payload.hotel_address = fields.hotelAddress || null;
  if ("hotelRate" in fields) payload.hotel_rate = fields.hotelRate;
  if ("hotelConfirmation" in fields) payload.hotel_confirmation = fields.hotelConfirmation || null;
  if ("rentalCar" in fields) payload.rental_car = fields.rentalCar || null;
  if ("rentalStartDate" in fields) payload.rental_start_date = fields.rentalStartDate || null;
  if ("rentalEndDate" in fields) payload.rental_end_date = fields.rentalEndDate || null;
  if ("rentalRate" in fields) payload.rental_rate = fields.rentalRate;
  if ("vehicleType" in fields) payload.vehicle_type = fields.vehicleType || null;
  if ("otherExpenses" in fields) payload.other_expenses = fields.otherExpenses;
  if ("notes" in fields) payload.notes = fields.notes || null;
  if ("tripType" in fields) payload.trip_type = fields.tripType;
  if ("statusOverride" in fields) payload.status_override = fields.statusOverride;
  if ("altHotelRequested" in fields) payload.alt_hotel_requested = fields.altHotelRequested;
  if ("altLodgingStartDate" in fields) payload.alt_lodging_start_date = fields.altLodgingStartDate || null;
  if ("altLodgingEndDate" in fields) payload.alt_lodging_end_date = fields.altLodgingEndDate || null;
  if ("altHotelAddress" in fields) payload.alt_hotel_address = fields.altHotelAddress || null;
  if ("altHotelRate" in fields) payload.alt_hotel_rate = fields.altHotelRate;
  if ("altHotelConfirmation" in fields) payload.alt_hotel_confirmation = fields.altHotelConfirmation || null;

  const { error } = await supabase.from("flash_tech_trips").update(payload).eq("id", id);
  if (error) {
    console.error("updateFlashTechTripTrackerFields error:", error.message);
    throw new Error(error.message);
  }
}

/** Max receipts per trip (migration 0258) — enforced here client-side; the column itself is a plain unbounded array. */
export const FLASH_TECH_MAX_RECEIPTS = 5;

/** Uploads one receipt and appends it to the trip's receipt_paths — caller passes the trip's CURRENT array (already in state) so this doesn't need a read-before-write round trip. */
export async function uploadFlashTechTripReceipt(companyId: string, tripId: string, file: File, currentPaths: string[]): Promise<string[]> {
  const url = await uploadFlashTechTripReceiptFile(companyId, tripId, file);
  const nextPaths = [...currentPaths, url];
  const { error } = await supabase.from("flash_tech_trips").update({ receipt_paths: nextPaths }).eq("id", tripId);
  if (error) throw new Error(error.message);
  return nextPaths;
}

/** Removes one receipt from the trip's receipt_paths — deletes the Storage file (fail-open, same as removeAttendanceNoteAttachment) and drops it from the array. */
export async function removeFlashTechTripReceipt(tripId: string, receiptUrl: string, currentPaths: string[]): Promise<string[]> {
  await deleteAttachmentByUrl(receiptUrl).catch((err) => {
    console.warn("removeFlashTechTripReceipt: Storage delete failed, clearing DB reference anyway:", err);
  });
  const nextPaths = currentPaths.filter((p) => p !== receiptUrl);
  const { error } = await supabase.from("flash_tech_trips").update({ receipt_paths: nextPaths }).eq("id", tripId);
  if (error) throw new Error(error.message);
  return nextPaths;
}
