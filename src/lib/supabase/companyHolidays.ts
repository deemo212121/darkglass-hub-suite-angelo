/**
 * Company Holidays — see migration 0252. One row per (company, year,
 * holiday), fully editable (including moving a specific year's date) and
 * scoped per country (US/PH) since the two offices don't share a calendar.
 * Read by Absent List / Time Off Calendar (excludes holidays from "who's
 * missing a clock-in") — see HolidayCalendarTab.tsx for the US federal
 * holiday date computation used to seed a year the first time it's viewed.
 */
import { supabase } from "./client";

export interface CompanyHolidayRow {
  id: string;
  year: number;
  country: "US" | "PH";
  name: string;
  date: string; // "YYYY-MM-DD"
  isCustom: boolean;
}

const SELECT_COLUMNS = "id, year, country, name, date, is_custom";

function mapRow(r: any): CompanyHolidayRow {
  return { id: r.id, year: r.year, country: r.country, name: r.name, date: r.date, isCustom: !!r.is_custom };
}

/** All holidays on file for a given year (both countries) — callers filter by country as needed. */
export async function getCompanyHolidays(year: number): Promise<CompanyHolidayRow[]> {
  const { data, error } = await supabase.from("company_holidays").select(SELECT_COLUMNS).eq("year", year).order("date", { ascending: true });
  if (error) {
    console.error("getCompanyHolidays error:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

/** All holidays on file across a date range spanning possibly multiple years — used by Absent List/Time Off Calendar, which both work over date ranges rather than a single year. */
export async function getCompanyHolidaysInRange(startDate: string, endDate: string): Promise<CompanyHolidayRow[]> {
  const { data, error } = await supabase.from("company_holidays").select(SELECT_COLUMNS).gte("date", startDate).lte("date", endDate).order("date", { ascending: true });
  if (error) {
    console.error("getCompanyHolidaysInRange error:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

export async function addCompanyHoliday(input: { year: number; country: "US" | "PH"; name: string; date: string; isCustom: boolean; createdBy: string | null }): Promise<CompanyHolidayRow> {
  const { data, error } = await supabase
    .from("company_holidays")
    .insert({ year: input.year, country: input.country, name: input.name, date: input.date, is_custom: input.isCustom, created_by: input.createdBy })
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

export async function updateCompanyHoliday(id: string, fields: Partial<{ name: string; date: string }>): Promise<void> {
  const payload: Record<string, string> = {};
  if (fields.name !== undefined) payload.name = fields.name;
  if (fields.date !== undefined) payload.date = fields.date;
  const { error } = await supabase.from("company_holidays").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteCompanyHoliday(id: string): Promise<void> {
  const { error } = await supabase.from("company_holidays").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Bulk-insert used when seeding a year's federal holidays for the first time (see HolidayCalendarTab.tsx). */
export async function addCompanyHolidays(rows: { year: number; country: "US" | "PH"; name: string; date: string; isCustom: boolean; createdBy: string | null }[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from("company_holidays").insert(
    rows.map((r) => ({ year: r.year, country: r.country, name: r.name, date: r.date, is_custom: r.isCustom, created_by: r.createdBy }))
  );
  if (error) throw new Error(error.message);
}
