/**
 * Time correction exemptions (migration 0355) — a correction marked Exempt
 * doesn't count toward the person's monthly limit on Employee Monitoring →
 * Exceeded → Time Corrections. Rows are never deleted: removing an
 * exemption stamps removed_*, so every exempt/undo stays on record.
 */
import { supabase } from "./client";
import { logActivity } from "./hrActivityLog";

export interface CorrectionExemption {
  id: string;
  correctionId: string;
  reason: string;
  exemptedByName: string | null;
  exemptedAt: string;
  removedAt: string | null;
  removedByName: string | null;
  removedReason: string | null;
}

function mapRow(r: any): CorrectionExemption {
  return {
    id: r.id,
    correctionId: r.correction_id,
    reason: r.reason,
    exemptedByName: r.exempted_by_name ?? null,
    exemptedAt: r.exempted_at,
    removedAt: r.removed_at ?? null,
    removedByName: r.removed_by_name ?? null,
    removedReason: r.removed_reason ?? null,
  };
}

const isMissingTable = (msg: string) => /timecard_correction_exemptions/.test(msg) && /does not exist|schema cache/i.test(msg);

/** Every exemption record (active and removed), newest first. Empty if migration 0355 hasn't been run yet. */
export async function getCorrectionExemptions(): Promise<CorrectionExemption[]> {
  const all: CorrectionExemption[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("timecard_correction_exemptions")
      .select("id, correction_id, reason, exempted_by_name, exempted_at, removed_at, removed_by_name, removed_reason")
      .order("exempted_at", { ascending: false })
      .range(from, from + 999);
    if (error) {
      if (!isMissingTable(error.message)) console.error("getCorrectionExemptions error:", error.message);
      return all;
    }
    all.push(...(data ?? []).map(mapRow));
    if (!data || data.length < 1000) return all;
  }
}

export async function exemptCorrection(input: {
  correctionId: string;
  reason: string;
  byName: string;
  /** For the activity log, e.g. "Bradley Hollowell — Oct 2". */
  label: string;
}): Promise<CorrectionExemption> {
  const { data, error } = await supabase
    .from("timecard_correction_exemptions")
    .insert({ correction_id: input.correctionId, reason: input.reason.trim(), exempted_by_name: input.byName })
    .select("id, correction_id, reason, exempted_by_name, exempted_at, removed_at, removed_by_name, removed_reason")
    .single();
  if (error) {
    if (isMissingTable(error.message)) throw new Error("Exemptions aren't set up yet — run migration 0355 in Supabase first.");
    throw new Error(error.message);
  }
  void logActivity({
    action: "time_correction_exempted",
    targetType: "timecard_correction",
    targetId: input.correctionId,
    targetLabel: input.label,
    details: { reason: input.reason.trim() },
  });
  return mapRow(data);
}

export async function removeCorrectionExemption(input: {
  exemptionId: string;
  correctionId: string;
  reason: string;
  byName: string;
  byProfileId: string | null;
  label: string;
}): Promise<void> {
  const { error } = await supabase
    .from("timecard_correction_exemptions")
    .update({
      removed_at: new Date().toISOString(),
      removed_by: input.byProfileId,
      removed_by_name: input.byName,
      removed_reason: input.reason.trim() || null,
    })
    .eq("id", input.exemptionId);
  if (error) throw new Error(error.message);
  void logActivity({
    action: "time_correction_exemption_removed",
    targetType: "timecard_correction",
    targetId: input.correctionId,
    targetLabel: input.label,
    details: { reason: input.reason.trim() },
  });
}
