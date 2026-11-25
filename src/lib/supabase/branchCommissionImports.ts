/**
 * Branch Commission imports (migration 0473): each import saves what it
 * wrote over, so Revert puts every touched row back the way it was — rows
 * the import created are removed, rows it changed get their old values.
 */
import { supabase } from "./client";
import { getTechCommissionTally, upsertTechCommissionTally } from "./branchCommissionTech";
import { getBranchPeriods, upsertBranchPeriod, type BranchPeriodRow } from "./branchCommissionBranchPeriod";
import { branchMatchKey } from "@/lib/branchName";

type TechBefore = { completionPct: number; ltpPct: number; completedTickets: number; isTrainee: boolean };
type BranchBefore = Pick<BranchPeriodRow, "flashTech" | "damages" | "damageCount" | "ticketsOverride" | "note" | "paidAt" | "paidBy" | "paidByName">;

export interface ImportSnapshot {
  periods: Array<{ start: string; end: string }>;
  techs: Array<{ profileId: string; start: string; end: string; before: TechBefore | null }>;
  branches: Array<{ branch: string; start: string; end: string; before: BranchBefore | null }>;
}

export interface BranchCommissionImport {
  id: string;
  fileName: string;
  importedByName: string;
  importedAt: string;
  lines: number;
  snapshot: ImportSnapshot;
  revertedAt: string | null;
  revertedByName: string | null;
}

/** Collects the "before" of every row an import is about to write, one week at a time. */
export class ImportRecorder {
  snapshot: ImportSnapshot = { periods: [], techs: [], branches: [] };
  private weeks = new Map<string, Promise<{ techs: Map<string, TechBefore>; branches: Map<string, BranchPeriodRow> }>>();
  private seen = new Set<string>();

  private week(start: string, end: string) {
    const k = `${start}|${end}`;
    if (!this.weeks.has(k)) {
      this.weeks.set(
        k,
        Promise.all([getTechCommissionTally(start, end), getBranchPeriods(start, end).catch(() => [])]).then(([t, b]) => ({
          techs: new Map(t.map((r) => [r.profileId, { completionPct: r.completionPct, ltpPct: r.ltpPct, completedTickets: r.completedTickets, isTrainee: r.isTrainee }])),
          branches: new Map(b.map((r) => [r.branchKey, r])),
        }))
      );
    }
    return this.weeks.get(k)!;
  }
  periodCreated(start: string, end: string) {
    this.snapshot.periods.push({ start, end });
  }
  async tech(profileId: string, start: string, end: string) {
    const k = `t|${profileId}|${start}|${end}`;
    if (this.seen.has(k)) return;
    this.seen.add(k);
    const w = await this.week(start, end);
    this.snapshot.techs.push({ profileId, start, end, before: w.techs.get(profileId) ?? null });
  }
  async branch(branch: string, start: string, end: string) {
    const k = `b|${branchMatchKey(branch)}|${start}|${end}`;
    if (this.seen.has(k)) return;
    this.seen.add(k);
    const r = (await this.week(start, end)).branches.get(branchMatchKey(branch));
    this.snapshot.branches.push({
      branch,
      start,
      end,
      before: r
        ? { flashTech: r.flashTech, damages: r.damages, damageCount: r.damageCount, ticketsOverride: r.ticketsOverride, note: r.note, paidAt: r.paidAt, paidBy: r.paidBy, paidByName: r.paidByName }
        : null,
    });
  }
}

function mapRow(r: any): BranchCommissionImport {
  return {
    id: r.id,
    fileName: r.file_name ?? "",
    importedByName: r.imported_by_name ?? "",
    importedAt: r.imported_at,
    lines: r.lines ?? 0,
    snapshot: { periods: [], techs: [], branches: [], ...(r.snapshot ?? {}) },
    revertedAt: r.reverted_at ?? null,
    revertedByName: r.reverted_by_name ?? null,
  };
}

export async function saveImportRecord(fileName: string, importedByName: string, lines: number, snapshot: ImportSnapshot): Promise<string> {
  const { data, error } = await supabase
    .from("branch_commission_imports")
    .insert({ file_name: fileName, imported_by_name: importedByName, lines, snapshot })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function getImportRecords(limit = 20): Promise<BranchCommissionImport[]> {
  const { data, error } = await supabase
    .from("branch_commission_imports")
    .select("*")
    .order("imported_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

/** Puts every row the import touched back the way it was. Returns the rows it couldn't restore. */
export async function revertImport(rec: BranchCommissionImport, revertedByName: string): Promise<string[]> {
  const failed: string[] = [];
  const s = rec.snapshot;
  for (const t of s.techs) {
    try {
      if (t.before) {
        await upsertTechCommissionTally(t.profileId, t.start, t.end, t.before);
      } else {
        const { error } = await supabase
          .from("branch_commission_tech_tally")
          .delete()
          .eq("profile_id", t.profileId)
          .eq("period_start", t.start)
          .eq("period_end", t.end);
        if (error) throw new Error(error.message);
      }
    } catch (err) {
      failed.push(`Technician ${t.profileId} ${t.start}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const b of s.branches) {
    try {
      if (b.before) {
        await upsertBranchPeriod(b.branch, b.start, b.end, b.before);
      } else {
        const { error } = await supabase
          .from("branch_commission_branch_period")
          .delete()
          .eq("branch_key", branchMatchKey(b.branch))
          .eq("period_start", b.start)
          .eq("period_end", b.end);
        if (error) throw new Error(error.message);
      }
    } catch (err) {
      failed.push(`${b.branch} ${b.start}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const p of s.periods) {
    const { error } = await supabase.from("branch_manager_commission_periods").delete().eq("period_start", p.start).eq("period_end", p.end);
    if (error) failed.push(`Period ${p.start} – ${p.end}: ${error.message}`);
  }
  const { error } = await supabase
    .from("branch_commission_imports")
    .update({ reverted_at: new Date().toISOString(), reverted_by_name: revertedByName })
    .eq("id", rec.id);
  if (error) failed.push(`Marking the import reverted: ${error.message}`);
  return failed;
}
