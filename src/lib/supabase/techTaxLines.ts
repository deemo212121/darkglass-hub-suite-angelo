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

/** The tax lines almost everyone has (Finance, 2026-10-20): Medicare, Social Security, federal and state income tax withholding. */
export const DEFAULT_TAX_LINE_LABELS = ["MCWH", "SSWH", "FITW", "SITW"];

// Loads already running, by profile|period — so two opens at once (or React's
// dev double-effect) share one load instead of both seeding the defaults.
const inFlight = new Map<string, Promise<TechTaxLine[]>>();

/**
 * One technician's tax lines for a period, in display order. When the
 * period has none yet, the four DEFAULT_TAX_LINE_LABELS are created first
 * ($ Fixed, $0) so Finance only fills in amounts and deletes any that
 * don't apply. Deleting all four brings them back the next time the
 * report opens.
 */
export function getTechTaxLines(profileId: string, periodStart: string, periodEnd: string): Promise<TechTaxLine[]> {
  if (!profileId || !periodStart || !periodEnd) return Promise.resolve([]);
  const key = `${profileId}|${periodStart}|${periodEnd}`;
  const running = inFlight.get(key);
  if (running) return running;
  const load = loadOrSeedTechTaxLines(profileId, periodStart, periodEnd).finally(() => inFlight.delete(key));
  inFlight.set(key, load);
  return load;
}

async function loadOrSeedTechTaxLines(profileId: string, periodStart: string, periodEnd: string): Promise<TechTaxLine[]> {
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
  if (data && data.length > 0) return data.map(mapTaxLine);
  const { data: seeded, error: seedError } = await supabase
    .from("tech_tax_lines")
    .insert(
      DEFAULT_TAX_LINE_LABELS.map((label, i) => ({
        profile_id: profileId,
        period_start: periodStart,
        period_end: periodEnd,
        sort_order: i,
        label,
        mode: "fixed",
        amount: 0,
      }))
    )
    .select(COLUMNS);
  if (seedError) {
    console.error("getTechTaxLines seed error:", seedError.message);
    return [];
  }
  return (seeded ?? []).map(mapTaxLine).sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function addTechTaxLine(profileId: string, periodStart: string, periodEnd: string, sortOrder: number): Promise<TechTaxLine> {
  const { data, error } = await supabase
    .from("tech_tax_lines")
    .insert({ profile_id: profileId, period_start: periodStart, period_end: periodEnd, sort_order: sortOrder, label: "Tax", mode: "fixed" })
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
