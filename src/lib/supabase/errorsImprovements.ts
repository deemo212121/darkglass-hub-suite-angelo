/**
 * Admin → Errors & Improvements (migration 0409): the running list of
 * things that need doing — errors to fix, improvements, to-dos — each with
 * who added it, who's handling it, pictures / files, and a Confirm (who
 * confirmed it, when; can be undone). Handled by and attachments are
 * migration 0411. Admin / SuperAdmin read and add (RLS); only IT changes
 * items, and only IT adds one already confirmed; an item is deleted by
 * whoever added it or a SuperAdmin (0412).
 */
import { supabase } from "./client";

export type ErrorImprovementKind = "error" | "improvement" | "todo";

/** A picture or file on an item; the file is in Firebase Storage at `path`. */
export interface ErrorImprovementAttachment {
  url: string;
  path: string;
  name: string;
  type: string;
  size: number;
}

export interface ErrorImprovementItem {
  id: string;
  kind: ErrorImprovementKind;
  area: string;
  title: string;
  details: string;
  addedBy: string | null;
  addedByName: string;
  createdAt: string;
  assignedTo: string | null;
  assignedToName: string | null;
  attachments: ErrorImprovementAttachment[];
  confirmedAt: string | null;
  confirmedByName: string | null;
}

export interface ErrorImprovementInput {
  kind: ErrorImprovementKind;
  area: string;
  title: string;
  details: string;
  assignedTo: string | null;
  assignedToName: string | null;
  attachments: ErrorImprovementAttachment[];
}

const TABLE = "admin_errors_improvements";

const fromRow = (r: any): ErrorImprovementItem => ({
  id: r.id,
  kind: r.kind,
  area: r.area ?? "",
  title: r.title ?? "",
  details: r.details ?? "",
  addedBy: r.added_by ?? null,
  addedByName: r.added_by_name ?? "",
  createdAt: r.created_at,
  assignedTo: r.assigned_to ?? null,
  assignedToName: r.assigned_to_name ?? null,
  attachments: Array.isArray(r.attachments) ? r.attachments : [],
  confirmedAt: r.confirmed_at ?? null,
  confirmedByName: r.confirmed_by_name ?? null,
});

const isMissingTable = (error: { message: string; code?: string }) =>
  error.code === "PGRST205" || error.code === "42P01" || /relation .*admin_errors_improvements/.test(error.message);
/** Migration 0411 not run yet: PostgREST doesn't know the new columns. */
const isMissing0411Column = (error: { message: string; code?: string }) =>
  (error.code === "PGRST204" || error.code === "42703") && /assigned_to|attachments/.test(error.message);

const ONLY_IT = "Only IT can change items on this list — anyone can add to it.";
const ONLY_OWN_DELETE = "You can delete only the items you added — a SuperAdmin can delete any.";

/** A plain message when migration 0409 / 0411 hasn't been run yet, or RLS (0412) turned the change away. */
function explain(error: { message: string; code?: string }): Error {
  if (isMissingTable(error)) return new Error("This page needs migration 0409 (Errors & Improvements) in Supabase — run it, then reload.");
  if (isMissing0411Column(error)) return new Error("Handled by and attachments need migration 0411 in Supabase — run it, then reload.");
  // An update RLS doesn't allow matches no row, so .single() finds nothing.
  if (error.code === "PGRST116") return new Error(ONLY_IT);
  return new Error(error.message);
}

function fields(input: ErrorImprovementInput) {
  return {
    kind: input.kind,
    area: input.area.trim(),
    title: input.title.trim(),
    details: input.details.trim(),
    assigned_to: input.assignedTo,
    assigned_to_name: input.assignedTo ? input.assignedToName : null,
    attachments: input.attachments,
  };
}

/**
 * Runs a write; if 0411 isn't in yet and this item doesn't use Handled by
 * or attachments, saves it again without those columns so plain items still
 * work in the meantime.
 */
async function writeRow(row: Record<string, unknown>, send: (row: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>) {
  let { data, error } = await send(row);
  if (error && isMissing0411Column(error) && !row.assigned_to && !(row.attachments as unknown[]).length) {
    const { assigned_to: _a, assigned_to_name: _n, attachments: _f, ...rest } = row;
    ({ data, error } = await send(rest));
  }
  if (error) throw explain(error);
  return fromRow(data);
}

export async function listErrorsImprovements(): Promise<ErrorImprovementItem[]> {
  const { data, error } = await supabase.from(TABLE).select("*").order("created_at", { ascending: true });
  if (error) throw explain(error);
  return (data ?? []).map(fromRow);
}

/** `id` is made by the caller, so the attachments can be uploaded into the item's folder before the row exists. */
export async function addErrorImprovement(
  id: string,
  input: ErrorImprovementInput,
  by: { companyId: string; profileId: string | null; name: string },
): Promise<ErrorImprovementItem> {
  return writeRow(
    { id, company_id: by.companyId, ...fields(input), added_by: by.profileId, added_by_name: by.name },
    (row) => supabase.from(TABLE).insert(row).select("*").single(),
  );
}

export async function updateErrorImprovement(id: string, input: ErrorImprovementInput): Promise<ErrorImprovementItem> {
  return writeRow(
    { ...fields(input), updated_at: new Date().toISOString() },
    (row) => supabase.from(TABLE).update(row).eq("id", id).select("*").single(),
  );
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
  const { data, error } = await supabase.from(TABLE).delete().eq("id", id).select("id");
  if (error) throw explain(error);
  // RLS turns a delete away silently — nothing is removed and no error comes back.
  if (!data?.length) throw new Error(ONLY_OWN_DELETE);
}
