/**
 * Flash Tech Calendar — plots a technician's (or any staff member's)
 * temporary relocation to cover another branch as a date range, and
 * optionally creates matching Pending Hotel/Transportation expense rows
 * (see migration 0130) that flow through the existing Expense Tracking
 * approve/reimburse pipeline unmodified.
 */
import { supabase } from "./client";
import { createExpense, type ExpenseRow } from "./expenses";

export interface FlashTechTrip {
  id: string;
  technicianProfileId: string | null;
  technicianName: string;
  originLocation: string;
  destinationLocation: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  notes: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  /** This trip's linked expense rows, if any were created for it. */
  hotelExpense: ExpenseRow | null;
  transportationExpense: ExpenseRow | null;
}

function mapTripRow(row: any): Omit<FlashTechTrip, "hotelExpense" | "transportationExpense"> {
  return {
    id: row.id,
    technicianProfileId: row.technician_profile_id ?? null,
    technicianName: row.technician_name,
    originLocation: row.origin_location,
    destinationLocation: row.destination_location,
    startDate: row.start_date,
    endDate: row.end_date,
    notes: row.notes ?? null,
    createdBy: row.created_by ?? null,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
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
        "id, technician_profile_id, technician_name, origin_location, destination_location, start_date, end_date, notes, created_by, created_by_name, created_at"
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
  originLocation: string;
  destinationLocation: string;
  startDate: string;
  endDate: string;
  notes: string;
  createdBy: string | null;
  createdByName: string | null;
  includeHotelExpense?: boolean;
  includeTransportationExpense?: boolean;
}): Promise<void> {
  const { data, error } = await supabase
    .from("flash_tech_trips")
    .insert({
      technician_profile_id: input.technicianProfileId,
      technician_name: input.technicianName,
      origin_location: input.originLocation,
      destination_location: input.destinationLocation,
      start_date: input.startDate,
      end_date: input.endDate,
      notes: input.notes || null,
      created_by: input.createdBy,
      created_by_name: input.createdByName,
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
  if (!tripProfileId) return; // Nothing to link the placeholder expenses to.

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
