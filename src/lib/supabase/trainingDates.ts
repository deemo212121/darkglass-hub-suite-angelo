import { supabase } from "./client";

/** Page through all training records so older hires aren't lost at the API row limit. */
export async function getTrainingDates(companyId: string) {
  const rows: { email: string | null; phone: string | null; training_start_date: string | null; training_end_date: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("hr_candidates")
      .select("email, phone, training_start_date, training_end_date")
      .eq("company_id", companyId).order("id").range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}
