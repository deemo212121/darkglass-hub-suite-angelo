/**
 * Admin → Errors & Improvements (migration 0409): the running list of
 * things that need doing — errors to fix, improvements, to-dos — each with
 * who added it and a Confirm (who confirmed it, when; can be undone).
 * Admin / SuperAdmin only (RLS).
 */
import { supabase } from "./client";

export type ErrorImprovementKind = "error" | "improvement" | "todo";

export interface ErrorImprovementItem {
  id: string;
  kind: ErrorImprovementKind;
  area: string;
  title: string;
  details: string;
  addedByName: string;
  createdAt: string;
  confirmedAt: string | null;
  confirmedByName: string | null;
}

const TABLE = "admin_errors_improvements";

const fromRow = (r: any): ErrorImprovementItem => ({
  id: r.id,
  kind: r.kind,
  area: r.area ?? "",
  title: r.title ?? "",
  details: r.details ?? "",
  addedByName: r.added_by_name ?? "",
  createdAt: r.created_at,
  confirmedAt: r.confirmed_at ?? null,
  confirmedByName: r.confirmed_by_name ?? null,
});

/** A plain message when migration 0409 hasn't been run yet. */
function explain(error: { message: string; code?: string }): Error {
  if (error.code === "PGRST205" || error.code === "42P01" || /admin_errors_improvements/.test(error.message)) {
    return new Error("This page needs migration 0409 (Errors & Improvements) in Supabase — run it, then reload.");
  }
  return new Error(error.message);
}

export async function listErrorsImprovements(): Promise<ErrorImprovementItem[]> {
  const { data, error } = await supabase.from(TABLE).select("*").order("created_at", { ascending: true });
  if (error) throw explain(error);
  return (data ?? []).map(fromRow);
}

export async function addErrorImprovement(
  input: { kind: ErrorImprovementKind; area: string; title: string; details: string },
  by: { companyId: string; profileId: string | null; name: string },
): Promise<ErrorImprovementItem> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      company_id: by.companyId,
      kind: input.kind,
      area: input.area.trim(),
      title: input.title.trim(),
      details: input.details.trim(),
      added_by: by.profileId,
      added_by_name: by.name,
    })
    .select("*")
    .single();
  if (error) throw explain(error);
  return fromRow(data);
}

export async function updateErrorImprovement(
  id: string,
  input: { kind: ErrorImprovementKind; area: string; title: string; details: string },
): Promise<ErrorImprovementItem> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ kind: input.kind, area: input.area.trim(), title: input.title.trim(), details: input.details.trim(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw explain(error);
  return fromRow(data);
}

/** Confirm (by = who) or undo the confirmation (by = null). */
export async function setErrorImprovementConfirmed(
  id: string,
  by: { profileId: string | null; name: string } | null,
): Promise<ErrorImprovementItem> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      confirmed_at: by ? new Date().toISOString() : null,
      confirmed_by: by?.profileId ?? null,
      confirmed_by_name: by?.name ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw explain(error);
  return fromRow(data);
}

export async function deleteErrorImprovement(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw explain(error);
}
