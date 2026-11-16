import { supabase } from "./client";

/**
 * Accounting → Daily Mileage (migration 0451): the miles each technician
 * drove, one row per technician per day — the figure Accounting pays, typed
 * or pasted from Finance's workbook. Company and who saved it are stamped by
 * the database.
 */

export interface TechDailyMileage {
  id: string;
  profileId: string;
  workDate: string;
  miles: number;
  notes: string;
  updatedByName: string | null;
  updatedAt: string;
}

const SELECT = "id, profile_id, work_date, miles, notes, updated_by_name, updated_at";
const PAGE_SIZE = 1000;

const fromRow = (r: any): TechDailyMileage => ({
  id: r.id,
  profileId: r.profile_id,
  workDate: r.work_date,
  miles: Number(r.miles) || 0,
  notes: r.notes ?? "",
  updatedByName: r.updated_by_name ?? null,
  updatedAt: r.updated_at,
});

export const isTechDailyMileageMissing = (message: string) => /tech_daily_mileage|schema cache|relation .* does not exist/i.test(message);

/** Every day saved between from and to (inclusive). */
export async function getTechDailyMileage(from: string, to: string): Promise<TechDailyMileage[]> {
  const out: TechDailyMileage[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("tech_daily_mileage")
      .select(SELECT)
      .gte("work_date", from)
      .lte("work_date", to)
      .order("work_date")
      .order("id")
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
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

/** One cell's change: new miles (null clears the day) for a technician and date. */
export interface MileageCellChange {
  profileId: string;
  workDate: string;
  miles: number | null;
  /** The saved row for that day, when there is one. */
  existingId: string | null;
}

/**
 * Saves a batch of cell changes (a typed cell or a pasted block): new days
 * are added, changed days updated, cleared days deleted. Returns the saved
 * rows so the page can show who saved them.
 */
export async function saveTechDailyMileage(changes: MileageCellChange[]): Promise<{ saved: TechDailyMileage[]; deletedIds: string[] }> {
  const inserts = changes.filter((c) => c.miles != null && !c.existingId);
  const updates = changes.filter((c) => c.miles != null && c.existingId);
  const deletes = changes.filter((c) => c.miles == null && c.existingId).map((c) => c.existingId!);
  const saved: TechDailyMileage[] = [];
  for (let i = 0; i < inserts.length; i += 200) {
    const rows = inserts.slice(i, i + 200).map((c) => ({ profile_id: c.profileId, work_date: c.workDate, miles: c.miles }));
    const { data, error } = await supabase.from("tech_daily_mileage").insert(rows).select(SELECT);
    if (error) throw new Error(error.message);
    saved.push(...(data ?? []).map(fromRow));
  }
  for (const c of updates) {
    const { data, error } = await supabase.from("tech_daily_mileage").update({ miles: c.miles }).eq("id", c.existingId!).select(SELECT).single();
    if (error) throw new Error(error.message);
    saved.push(fromRow(data));
  }
  for (let i = 0; i < deletes.length; i += 200) {
    const { error } = await supabase.from("tech_daily_mileage").delete().in("id", deletes.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
  return { saved, deletedIds: deletes };
}
