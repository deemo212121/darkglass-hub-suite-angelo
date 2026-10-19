/**
 * Tax lines on the Tech Activity Report (migration 0395) — shown below
 * Total Payment, each a percentage of it or a fixed amount. Display-only
 * for Net Pay After Tax: they never feed Total Payment / Gross Pay.
 */
import { supabase } from "./client";

export type TechTaxMode = "percent" | "fixed";

export interface TechTaxLine {
  id: string;
  label: string;
  mode: TechTaxMode;
  /** Percent (e.g. 7.65) when mode is "percent", dollars when "fixed". */
  amount: number;
  sortOrder: number;
}

const COLUMNS = "id, label, mode, amount, sort_order";

const missingTableMessage = (message: string) =>
  /tech_tax_lines/i.test(message) ? "Tax lines need database migration 0395 — ask an admin to run it." : message;

function mapTaxLine(r: any): TechTaxLine {
  return {
    id: r.id,
    label: r.label ?? "",
    mode: r.mode === "fixed" ? "fixed" : "percent",
    amount: Number(r.amount) || 0,
    sortOrder: Number(r.sort_order) || 0,
  };
}

/** The dollar amount a tax line takes off, given the Total Payment it applies to. */
export function taxLineAmount(line: Pick<TechTaxLine, "mode" | "amount">, totalPayment: number): number {
  return line.mode === "percent" ? Math.round(totalPayment * line.amount) / 100 : line.amount;
}

/** One technician's tax lines for a period, in display order. */
export async function getTechTaxLines(profileId: string, periodStart: string, periodEnd: string): Promise<TechTaxLine[]> {
  if (!profileId || !periodStart || !periodEnd) return [];
  const { data, error } = await supabase
    .from("tech_tax_lines")
    .select(COLUMNS)
    .eq("profile_id", profileId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("getTechTaxLines error:", error.message);
    return [];
  }
  return (data ?? []).map(mapTaxLine);
}

export async function addTechTaxLine(profileId: string, periodStart: string, periodEnd: string, sortOrder: number): Promise<TechTaxLine> {
  const { data, error } = await supabase
    .from("tech_tax_lines")
    .insert({ profile_id: profileId, period_start: periodStart, period_end: periodEnd, sort_order: sortOrder, label: "Tax" })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(missingTableMessage(error.message));
  return mapTaxLine(data);
}

export async function updateTechTaxLine(id: string, fields: { label?: string; mode?: TechTaxMode; amount?: number }): Promise<void> {
  if (Object.keys(fields).length === 0) return;
  const { error } = await supabase.from("tech_tax_lines").update(fields).eq("id", id);
  if (error) throw new Error(missingTableMessage(error.message));
}

export async function deleteTechTaxLine(id: string): Promise<void> {
  const { error } = await supabase.from("tech_tax_lines").delete().eq("id", id);
  if (error) throw new Error(missingTableMessage(error.message));
}
