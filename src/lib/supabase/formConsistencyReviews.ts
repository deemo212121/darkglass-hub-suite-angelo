/**
 * Form Inconsistencies (src/lib/formConsistency.ts) — HR's "Mark as checked"
 * (form_consistency_reviews, migration 0425), and the bell notification HR
 * gets when someone signs a form that disagrees with all of their other
 * signed forms (called from signableDocuments.ts's signDocument).
 */
import { supabase } from "./client";
import { createNotification } from "./notifications";
import { getCompanyHrRoleProfileIds } from "./hrRoleNotify";
import { getSignableDocumentsForRecipient } from "./signableDocuments";
import { CONSISTENCY_FIELD_LABEL, inconsistenciesFor, type ConsistencyField } from "@/lib/formConsistency";

/** HR Paperworks → Form Inconsistencies. */
export const FORM_INCONSISTENCIES_LINK = "/m/hr/hr-paperworks?tab=formInconsistencies";

export interface FormConsistencyReview {
  id: string;
  profileId: string;
  field: ConsistencyField;
  valuesKey: string;
  note: string | null;
  reviewedByName: string | null;
  createdAt: string;
}

const SELECT = "id, profile_id, field, values_key, note, reviewed_by_name, created_at";

function mapRow(r: any): FormConsistencyReview {
  return { id: r.id, profileId: r.profile_id, field: r.field, valuesKey: r.values_key, note: r.note ?? null, reviewedByName: r.reviewed_by_name ?? null, createdAt: r.created_at };
}

/** 42P01 / PGRST205 = the table isn't there yet (migration 0425 not run). */
const isMissingTable = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205";

/** Checked differences — one person's, or everyone's. null when migration 0425 hasn't been run. */
export async function getFormConsistencyReviews(profileId?: string): Promise<FormConsistencyReview[] | null> {
  const all: FormConsistencyReview[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from("form_consistency_reviews").select(SELECT).order("created_at", { ascending: false }).range(from, from + 999);
    if (profileId) q = q.eq("profile_id", profileId);
    const { data, error } = await q;
    if (isMissingTable(error)) return null;
    if (error) throw new Error(error.message);
    all.push(...(data ?? []).map(mapRow));
    if (!data || data.length < 1000) break;
  }
  return all;
}

export async function markInconsistencyChecked(input: { profileId: string; field: ConsistencyField; valuesKey: string; note: string; reviewedByName: string | null }): Promise<FormConsistencyReview> {
  const { data, error } = await supabase
    .from("form_consistency_reviews")
    .insert({ profile_id: input.profileId, field: input.field, values_key: input.valuesKey, note: input.note.trim() || null, reviewed_by_name: input.reviewedByName })
    .select(SELECT)
    .single();
  if (isMissingTable(error)) throw new Error("Run migration 0425 first (Supabase SQL Editor) — it adds the table that remembers checked differences.");
  if (error) throw new Error(error.message);
  return mapRow(data);
}

export async function undoInconsistencyChecked(id: string): Promise<void> {
  const { data, error } = await supabase.from("form_consistency_reviews").delete().eq("id", id).select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Couldn't undo it — you may not have permission.");
}

/**
 * After `profileId` signs `docId`: if that form disagrees with ALL of their
 * other signed forms on a field (its value matches none of them — so it
 * isn't just siding with one side of a difference HR already sees), tell HR
 * in the bell. Differences HR already marked as checked are skipped.
 * Best-effort — never throws; signing has already succeeded.
 */
export async function notifyHrOfNewInconsistencies(input: { docId: string; profileId: string; signerName: string }): Promise<void> {
  try {
    const docs = await getSignableDocumentsForRecipient(input.profileId);
    const checked = new Set((await getFormConsistencyReviews(input.profileId).catch(() => null) ?? []).map((r) => `${r.field}|${r.valuesKey}`));
    const fresh = inconsistenciesFor(docs).filter((inc) => {
      if (checked.has(`${inc.field}|${inc.valuesKey}`)) return false;
      const mine = inc.groups.find((g) => g.forms.some((f) => f.docId === input.docId));
      return !!mine && mine.forms.length === 1;
    });
    if (fresh.length === 0) return;
    const signed = fresh[0].groups.flatMap((g) => g.forms).find((f) => f.docId === input.docId);
    const parts = fresh.map((inc) => {
      const others = inc.groups.flatMap((g) => g.forms).filter((f) => f.docId !== input.docId).map((f) => f.label);
      return `${CONSISTENCY_FIELD_LABEL[inc.field]} (differs from ${[...new Set(others)].join(", ")})`;
    });
    const body = `Form check: ${input.signerName || "Someone"}'s ${signed?.label ?? "form"} doesn't match their other forms — ${parts.join("; ")}. Review it on HR Paperworks → Form Inconsistencies.`;
    const hrIds = (await getCompanyHrRoleProfileIds()).filter((id) => id !== input.profileId);
    await Promise.all(
      hrIds.map((recipientId) =>
        createNotification({ recipientId, senderId: input.profileId, senderName: input.signerName || null, body, linkTo: FORM_INCONSISTENCIES_LINK }).catch((err) =>
          console.error("[formConsistency] notify failed", recipientId, err),
        ),
      ),
    );
  } catch (err) {
    console.error("[formConsistency] cross-check after signing failed (the signature was saved):", err);
  }
}
