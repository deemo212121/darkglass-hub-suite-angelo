/**
 * Company Holidays — see migration 0252. One row per (company, year,
 * holiday), fully editable (including moving a specific year's date) and
 * used as a shared calendar by U.S. and Philippines staff.
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
  hourlyPaid?: boolean | null;
  fixedSalaryPaid?: boolean | null;
}

// Wildcard allows calendars to remain readable before migration 0434 is applied.
const SELECT_COLUMNS = "*";

function mapRow(r: any): CompanyHolidayRow {
  return { id: r.id, year: r.year, country: r.country, name: r.name, date: r.date, isCustom: !!r.is_custom, hourlyPaid: r.hourly_paid ?? null, fixedSalaryPaid: r.fixed_salary_paid ?? null };
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

export async function updateCompanyHoliday(id: string, fields: Partial<{ name: string; date: string; hourlyPaid: boolean | null; fixedSalaryPaid: boolean | null }>): Promise<void> {
  const payload: Record<string, string | boolean | null> = {};
  if (fields.name !== undefined) payload.name = fields.name;
  if (fields.date !== undefined) payload.date = fields.date;
  if (fields.hourlyPaid !== undefined) payload.hourly_paid = fields.hourlyPaid;
  if (fields.fixedSalaryPaid !== undefined) payload.fixed_salary_paid = fields.fixedSalaryPaid;
  const { error } = await supabase.from("company_holidays").update(payload).eq("id", id);
  if (error) {
    if (error.code === "PGRST204" || error.code === "42703") throw new Error("Holiday pay settings require database migration 0434_company_holiday_pay_policies.sql.");
    throw new Error(error.message);
  }
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
