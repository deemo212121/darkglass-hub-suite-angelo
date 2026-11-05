/**
 * Form Inconsistencies (src/lib/formConsistency.ts) — HR's "Mark as checked"
 * (form_consistency_reviews, migration 0425), "Send form again" (the person
 * fills a form out once more), and the bell notification HR gets when
 * someone signs a form that disagrees with all of their other signed forms
 * (called from signableDocuments.ts's signDocument).
 */
import { supabase } from "./client";
import { createNotification } from "./notifications";
import { getCompanyHrRoleProfileIds } from "./hrRoleNotify";
import { createSignableDocument, getSignableDocumentsForRecipient, type SignableDocument } from "./signableDocuments";
import { getOrCreateDmThread, sendMessage } from "./messaging";
import { logActivity } from "./hrActivityLog";
import { getAppUrl } from "@/lib/appUrl";
import { SIGNABLE_DOCUMENT_REGISTRY, currentTemplateVersion } from "@/lib/signableDocumentRegistry";
import { CONTRACTOR_AGREEMENT_SHORT_TITLE, contractorAgreementCountryOf } from "@/lib/masterPhContractorAgreementFormTemplate";
import { CONSISTENCY_FIELD_LABEL, inconsistenciesFor, missingInfoFor, type ConsistencyField } from "@/lib/formConsistency";

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
 * The tags a send puts on a form that decide where it's tracked — old / new
 * automation (formSource), the AHS version (brand), the contractor
 * agreement's country. A copy sent again keeps them, so it lands on the same
 * HR Paperworks tab and checklist as the one it replaces.
 */
const SEND_TAGS = ["formSource", "brand", "country"] as const;

/** How the message names each field ("the date of birth on it…"). */
const FIELD_IN_MESSAGE: Record<ConsistencyField, string> = {
  name: "name",
  ssn: "SSN",
  dob: "date of birth",
  address: "address",
  phone: "phone number",
  email: "email",
  license: "driver's license #",
};

/**
 * "Send form again": the person fills out these forms once more. Each gets a
 * fresh copy — the same tags as the signed one (SEND_TAGS), the form's
 * current wording, nothing they typed — or, when a copy sent again earlier is
 * still waiting on them, that copy's link again instead of a duplicate. One
 * message lists the links (no values in it). Their signed copy stays on file;
 * once they sign the new one it's the one Form Inconsistencies counts (only
 * the latest signed copy of each form does).
 */
export async function sendFormsAgain(input: {
  profileId: string;
  personName: string;
  field: ConsistencyField;
  /** Set when the form is missing part of the field rather than disagreeing with the others — the check's hint, e.g. "Missing the state and ZIP". */
  incomplete?: string | null;
  forms: { signed: SignableDocument; waiting: SignableDocument | null }[];
  note: string;
  senderProfileId: string;
  senderName: string | null;
}): Promise<SignableDocument[]> {
  if (input.forms.length === 0) throw new Error("Pick at least one form.");
  const copies: SignableDocument[] = [];
  for (const { signed, waiting } of input.forms) {
    if (waiting) {
      copies.push(waiting);
      continue;
    }
    const tags = Object.fromEntries(SEND_TAGS.filter((k) => signed.formData?.[k] != null && signed.formData[k] !== "").map((k) => [k, signed.formData[k]]));
    const version = currentTemplateVersion(signed.documentType);
    copies.push(
      await createSignableDocument({
        documentType: signed.documentType,
        formData: { employeeId: input.profileId, employeeName: input.personName, ...tags, ...(version ? { templateVersion: version } : {}), sentAgainFrom: signed.id },
        recipientId: input.profileId,
        recipientSlot: "employee",
        pdfUrl: "",
      }),
    );
  }

  // The contractor agreement goes by its country's name (Master Mexico Contractor Agreement…).
  const label = (d: SignableDocument) =>
    d.documentType === "master_ph_contractor_agreement"
      ? CONTRACTOR_AGREEMENT_SHORT_TITLE[contractorAgreementCountryOf(d.formData)]
      : SIGNABLE_DOCUMENT_REGISTRY[d.documentType]?.label ?? d.documentType;
  const what = FIELD_IN_MESSAGE[input.field];
  const note = input.note.trim();
  const why = input.incomplete
    ? `is incomplete — ${input.incomplete.charAt(0).toLowerCase()}${input.incomplete.slice(1)}`
    : `doesn't match your other forms`;
  const body = [
    copies.length === 1
      ? `📋 Please fill out your ${label(copies[0])} again — the ${what} on it ${why}.`
      : `📋 Please fill out these forms again — the ${what} on them ${input.incomplete ? why : "doesn't match your other forms"}.`,
    ...(note ? [`HR's note: ${note}`] : []),
    ...copies.map((d) => `${copies.length === 1 ? "" : `• ${label(d)}: `}${getAppUrl()}${SIGNABLE_DOCUMENT_REGISTRY[d.documentType].internalPath}/${d.id}`),
  ].join("\n");
  const thread = await getOrCreateDmThread(input.senderProfileId, input.profileId);
  await sendMessage({ dmThreadId: thread.id, senderId: input.senderProfileId, senderName: input.senderName || "HR", body });

  for (const d of copies) {
    void logActivity({
      action: "form_sent_again_inconsistency",
      targetType: "employee",
      targetId: input.profileId,
      targetLabel: input.personName,
      details: { documentType: d.documentType, documentId: d.id, field: input.field, ...(note ? { note } : {}) },
    });
  }
  return copies;
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
    // What the form just signed is missing by itself (an address without its state / ZIP…).
    const missing = missingInfoFor(docs).filter((inc) => !checked.has(`${inc.field}|${inc.valuesKey}`) && inc.groups[0]?.forms[0]?.docId === input.docId);
    if (fresh.length === 0 && missing.length === 0) return;
    const signed = [...fresh, ...missing][0].groups.flatMap((g) => g.forms).find((f) => f.docId === input.docId);
    const parts = fresh.map((inc) => {
      const others = inc.groups.flatMap((g) => g.forms).filter((f) => f.docId !== input.docId).map((f) => f.label);
      return `${CONSISTENCY_FIELD_LABEL[inc.field]} (differs from ${[...new Set(others)].join(", ")})`;
    });
    const missingParts = missing.map((inc) => `${CONSISTENCY_FIELD_LABEL[inc.field]} (${(inc.hint ?? "incomplete").toLowerCase()})`);
    const what = [
      ...(parts.length ? [`doesn't match their other forms — ${parts.join("; ")}`] : []),
      ...(missingParts.length ? [`${parts.length ? "and it's" : "is"} missing information — ${missingParts.join("; ")}`] : []),
    ].join(" ");
    const body = `Form check: ${input.signerName || "Someone"}'s ${signed?.label ?? "form"} ${what}. Review it on HR Paperworks → Form Inconsistencies.`;
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
