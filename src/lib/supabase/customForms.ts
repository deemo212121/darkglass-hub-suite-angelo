/**
 * In-house Form Maker — form definitions + submissions (see
 * supabase/migrations/0077_hr_custom_forms.sql). Runs alongside the
 * existing Jotform pipeline (jotformSubmissions.ts); this is the
 * self-built equivalent, with submissions stored as structured JSON
 * instead of a per-submission generated PDF.
 *
 * Definitions (hr_custom_forms) are read/written directly through the
 * authenticated client under normal company RLS — same as every other HR
 * table in this app. Submissions can arrive two ways: an internal
 * (authenticated) fill page writes directly here under RLS (functions
 * below); a public (anonymous) fill page instead goes through the
 * api/custom-forms serverless endpoint (service-role key, no RLS needed),
 * since an anonymous visitor has no Supabase session to write under.
 */

import { supabase } from "./client";
import { randomId } from "@/lib/utils";
import type { CustomFormField } from "@/lib/formElements";
import type { DocumentTemplate } from "@/lib/documentTemplates/types";

export type CustomFormAccess = "public" | "internal";
export type CustomFormStatus = "draft" | "published" | "archived";
export type CustomFormSubmissionStatus = "new" | "reviewed" | "archived";

export interface CustomForm {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  access: CustomFormAccess;
  status: CustomFormStatus;
  publicSlug: string | null;
  fields: CustomFormField[];
  documentTemplate: DocumentTemplate | null;
  /** Per-form on/off switch for the Drive auto-upload — only meaningful when documentTemplate is set. Defaults true so existing forms keep uploading until someone flips it off. */
  driveUploadEnabled: boolean;
  /** Firebase uids of the specific accounts to notify on submission — empty means "no explicit picks", falling back to the default (every HR/Admin/Manager account, see findHrFirebaseUids in customFormsBridge.ts). */
  notifyFirebaseUids: string[];
  /** Discord "Incoming Webhook" URL — every submission posts a message here too, alongside the in-app notification. Null means no Discord channel configured for this form. */
  discordWebhookUrl: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A file/signature response value — see ElementDefinition.isFileField in src/lib/formElements. */
export interface CustomFormFileResponse {
  url: string;
  path: string | null;
  fileName: string;
  mimeType: string;
  size: number;
}

/** Deliberately broad — elements store whatever shape suits them (a plain string, an options array, a table grid, an Address/Full Name object, ...). */
export type CustomFormResponseValue = string | string[] | string[][] | number | boolean | Record<string, any> | CustomFormFileResponse | null;

export interface CustomFormSubmission {
  id: string;
  companyId: string;
  formId: string;
  formTitle: string | null;
  submitterName: string | null;
  responses: Record<string, CustomFormResponseValue>;
  status: CustomFormSubmissionStatus;
  submittedAt: string;
  createdAt: string;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  deletedAt: string | null;
  /** The finished document, saved to Storage once the submission is complete (migration 0368) — null until then, or for submissions from before it. */
  pdfUrl: string | null;
  pdfGeneratedAt: string | null;
  /** When HR filled in the form's "Filled in by: Company" fields (e.g. the Authorized Representative's signature). */
  completedAt: string | null;
  completedByName: string | null;
}

const FORM_SELECT = "id, company_id, title, description, access, status, public_slug, fields, document_template, drive_upload_enabled, notify_firebase_uids, discord_webhook_url, created_by, created_at, updated_at";

function formFromRow(r: any): CustomForm {
  return {
    id: r.id,
    companyId: r.company_id,
    title: r.title,
    description: r.description,
    access: r.access,
    status: r.status,
    publicSlug: r.public_slug,
    fields: (r.fields ?? []) as CustomFormField[],
    // An empty design ({ blocks: [] }, what the builder used to save for a
    // form nobody designed) is no template — otherwise its PDF is a blank
    // page instead of the automatic layout.
    documentTemplate: r.document_template?.blocks?.length ? (r.document_template as DocumentTemplate) : null,
    driveUploadEnabled: r.drive_upload_enabled ?? true,
    notifyFirebaseUids: (r.notify_firebase_uids ?? []) as string[],
    discordWebhookUrl: r.discord_webhook_url ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** All custom forms for the caller's company (RLS-scoped), newest first. */
export async function getCustomForms(): Promise<CustomForm[]> {
  const { data, error } = await supabase.from("hr_custom_forms").select(FORM_SELECT).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(formFromRow);
}

export async function getCustomForm(id: string): Promise<CustomForm | null> {
  const { data, error } = await supabase.from("hr_custom_forms").select(FORM_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? formFromRow(data) : null;
}

/** URL-safe slug from a form's title plus a short random suffix, so a title collision never blocks publishing. Once assigned to a form, a slug is never regenerated or cleared — access can be flipped between public/internal any number of times and the link stays the same when it's public again. */
export function generatePublicSlug(title: string): string {
  const base = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "form";
  const suffix = randomId().slice(0, 8);
  return `${base}-${suffix}`;
}

export async function createCustomForm(input: { title: string; description: string; access: CustomFormAccess; fields: CustomFormField[]; documentTemplate?: DocumentTemplate | null; notifyFirebaseUids?: string[]; discordWebhookUrl?: string | null }): Promise<CustomForm> {
  const publicSlug = input.access === "public" ? generatePublicSlug(input.title) : null;
  const { data, error } = await supabase
    .from("hr_custom_forms")
    .insert({ title: input.title, description: input.description || null, access: input.access, fields: input.fields, document_template: input.documentTemplate ?? null, notify_firebase_uids: input.notifyFirebaseUids ?? [], discord_webhook_url: input.discordWebhookUrl?.trim() || null, public_slug: publicSlug })
    .select(FORM_SELECT)
    .single();
  if (error) throw error;
  return formFromRow(data);
}

export async function updateCustomForm(
  id: string,
  input: { title: string; description: string; access: CustomFormAccess; fields: CustomFormField[]; documentTemplate?: DocumentTemplate | null; notifyFirebaseUids?: string[]; discordWebhookUrl?: string | null; currentPublicSlug: string | null }
): Promise<CustomForm> {
  // Access is freely editable at any time (not just at publish) — switching to
  // Public here must not silently leave the form linkless until someone
  // happens to click Publish again, so a slug is generated right away if one
  // doesn't already exist. Switching back to Internal leaves any existing
  // slug in place (dormant, not exposed while access=internal) rather than
  // clearing it, so flipping back to Public later reuses the same link.
  const publicSlug = input.access === "public" ? (input.currentPublicSlug || generatePublicSlug(input.title)) : input.currentPublicSlug;
  const { data, error } = await supabase
    .from("hr_custom_forms")
    .update({ title: input.title, description: input.description || null, access: input.access, fields: input.fields, document_template: input.documentTemplate ?? null, notify_firebase_uids: input.notifyFirebaseUids ?? [], discord_webhook_url: input.discordWebhookUrl?.trim() || null, public_slug: publicSlug })
    .eq("id", id)
    .select(FORM_SELECT)
    .single();
  if (error) throw error;
  return formFromRow(data);
}

/** Publishes a form — also ensures a public_slug exists if access is Public and updateCustomForm somehow didn't set one (defensive; the normal path already guarantees this on every save). */
export async function publishCustomForm(form: CustomForm): Promise<CustomForm> {
  const publicSlug = form.publicSlug ?? (form.access === "public" ? generatePublicSlug(form.title) : null);
  const { data, error } = await supabase
    .from("hr_custom_forms")
    .update({ status: "published", public_slug: publicSlug })
    .eq("id", form.id)
    .select(FORM_SELECT)
    .single();
  if (error) throw error;
  return formFromRow(data);
}

export async function archiveCustomForm(id: string): Promise<void> {
  const { error } = await supabase.from("hr_custom_forms").update({ status: "archived" }).eq("id", id);
  if (error) throw error;
}

export async function setCustomFormDraft(id: string): Promise<void> {
  const { error } = await supabase.from("hr_custom_forms").update({ status: "draft" }).eq("id", id);
  if (error) throw error;
}

/** The "Drive" toggle on the forms list — only meaningful for a form that has a Document Template attached. */
export async function setCustomFormDriveUpload(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.from("hr_custom_forms").update({ drive_upload_enabled: enabled }).eq("id", id);
  if (error) throw error;
}

export async function deleteCustomForm(id: string): Promise<void> {
  const { error } = await supabase.from("hr_custom_forms").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Submissions ----------

const SUBMISSION_SELECT_BASE =
  "id, company_id, form_id, form_title, submitter_name, responses, status, submitted_at, created_at, reviewed_by, reviewed_at, deleted_at, reviewer:reviewed_by (display_name, username)";
const SUBMISSION_SELECT = `${SUBMISSION_SELECT_BASE}, pdf_url, pdf_generated_at, completed_at, completer:completed_by (display_name, username)`;

/** Postgres 42703 / PostgREST PGRST204 — migration 0368's columns aren't there yet; fall back to the base columns so the tab still loads. */
function isMissingColumnError(error: { code?: string } | null): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

function submissionFromRow(r: any): CustomFormSubmission {
  return {
    id: r.id,
    companyId: r.company_id,
    formId: r.form_id,
    formTitle: r.form_title,
    submitterName: r.submitter_name,
    responses: r.responses ?? {},
    status: r.status,
    submittedAt: r.submitted_at,
    createdAt: r.created_at,
    reviewedBy: r.reviewed_by,
    reviewedByName: r.reviewer?.display_name || r.reviewer?.username || null,
    reviewedAt: r.reviewed_at,
    deletedAt: r.deleted_at ?? null,
    pdfUrl: r.pdf_url ?? null,
    pdfGeneratedAt: r.pdf_generated_at ?? null,
    completedAt: r.completed_at ?? null,
    completedByName: r.completer?.display_name || r.completer?.username || null,
  };
}

/** The form's "Filled in by: Company" fields — HR completes these after the person submits. */
export function companyFields(form: Pick<CustomForm, "fields">): CustomFormField[] {
  return form.fields.filter((f) => f.fillBy === "company" && !f.hidden);
}

/** Submitted, but the company's own part (e.g. Authorized Representative signature) isn't filled in yet. */
export function isAwaitingCompany(form: Pick<CustomForm, "fields"> | undefined, submission: Pick<CustomFormSubmission, "completedAt">): boolean {
  return !!form && companyFields(form).length > 0 && !submission.completedAt;
}

const RESTORE_WINDOW_DAYS = 30;
const PAGE_SIZE = 1000;

/** All non-deleted submissions for the caller's company (RLS-scoped), newest first. */
export async function getCustomFormSubmissions(): Promise<CustomFormSubmission[]> {
  const all: CustomFormSubmission[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const query = (cols: string) =>
      supabase
        .from("hr_custom_form_submissions")
        .select(cols)
        .is("deleted_at", null)
        .order("submitted_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
    let { data, error } = await query(SUBMISSION_SELECT);
    if (isMissingColumnError(error)) ({ data, error } = await query(SUBMISSION_SELECT_BASE));
    if (error) throw error;
    all.push(...(data ?? []).map(submissionFromRow));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

/** Soft-deleted submissions still within the 30-day restore window, most recently deleted first. */
export async function getDeletedCustomFormSubmissions(): Promise<CustomFormSubmission[]> {
  const cutoff = new Date(Date.now() - RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const query = (cols: string) =>
    supabase.from("hr_custom_form_submissions").select(cols).not("deleted_at", "is", null).gte("deleted_at", cutoff).order("deleted_at", { ascending: false });
  let { data, error } = await query(SUBMISSION_SELECT);
  if (isMissingColumnError(error)) ({ data, error } = await query(SUBMISSION_SELECT_BASE));
  if (error) throw error;
  return (data ?? []).map(submissionFromRow);
}

/**
 * Direct authenticated write path — internal (logged-in) forms only. Public
 * forms submit through api/custom-forms instead. Returns the inserted row's
 * real id (not the client-generated one FillCustomFormPage.tsx uses for its
 * Storage upload path, which is a separate value and doesn't match this) —
 * callers use it to ask the server to notify HR (see notifyInternalSubmission).
 */
export async function submitCustomFormResponse(input: {
  formId: string;
  formTitle: string;
  submitterName: string | null;
  responses: Record<string, CustomFormResponseValue>;
}): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("hr_custom_form_submissions")
    .insert({
      form_id: input.formId,
      form_title: input.formTitle,
      submitter_name: input.submitterName,
      responses: input.responses,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}

/**
 * Asks the server to notify HR about an internal-form submission that was
 * just written via submitCustomFormResponse above. A separate call rather
 * than folded into that insert because only the server holds the Firebase
 * service-account credentials needed to write into HR's own notifications
 * collection — the client can't do that directly under normal Firestore
 * rules. The server re-reads the submission row itself rather than trusting
 * any client-supplied company/form/submitter fields, so this can't be used
 * to forge a notification for a submission that doesn't actually exist.
 * Best-effort: a failure here shouldn't be surfaced as a submit failure,
 * since the response was already saved successfully — callers should catch
 * and swallow/log, not block on this.
 */
export async function notifyInternalSubmission(submissionId: string): Promise<void> {
  const res = await fetch("/api/custom-forms?notify=internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ submissionId }),
  });
  if (!res.ok) throw new Error(`Notify failed (${res.status}): ${await res.text()}`);
}

/** Posts a one-off test message straight to a Discord webhook URL (before it's even saved on the form) — routed through the server rather than fetched directly from the browser so this doesn't depend on Discord's webhook endpoint allowing cross-origin requests. */
export async function sendDiscordTestMessage(webhookUrl: string): Promise<void> {
  const res = await fetch("/api/custom-forms?action=discord-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ webhookUrl }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Test message failed (${res.status})`);
  }
}

export interface GoogleDriveConnectionStatus {
  connected: boolean;
  connectedByName: string | null;
  connectedAt: string | null;
}

/** Never exposes the stored refresh_token itself — see migration 0063's get_google_drive_connection_status() RPC. */
export async function getGoogleDriveConnectionStatus(): Promise<GoogleDriveConnectionStatus> {
  const { data, error } = await supabase.rpc("get_google_drive_connection_status");
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { connected?: boolean; connected_by_name?: string | null; connected_at?: string | null } | null;
  return { connected: !!row?.connected, connectedByName: row?.connected_by_name ?? null, connectedAt: row?.connected_at ?? null };
}

/** Admin/Superadmin only — enforced server-side in the RPC, not just this call site. */
export async function disconnectGoogleDrive(): Promise<void> {
  const { error } = await supabase.rpc("disconnect_google_drive");
  if (error) throw error;
}

export async function updateCustomFormSubmissionStatus(id: string, status: CustomFormSubmissionStatus, reviewerId: string): Promise<void> {
  const { error } = await supabase
    .from("hr_custom_form_submissions")
    .update({ status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function softDeleteCustomFormSubmission(id: string): Promise<void> {
  const { error } = await supabase.from("hr_custom_form_submissions").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function restoreCustomFormSubmission(id: string): Promise<void> {
  const { error } = await supabase.from("hr_custom_form_submissions").update({ deleted_at: null }).eq("id", id);
  if (error) throw error;
}

/** Records the finished document's Storage URL on the submission. */
export async function saveCustomFormSubmissionPdf(id: string, pdfUrl: string): Promise<void> {
  const { error } = await supabase
    .from("hr_custom_form_submissions")
    .update({ pdf_url: pdfUrl, pdf_generated_at: new Date().toISOString() })
    .eq("id", id);
  if (isMissingColumnError(error)) throw new Error("Saving documents needs migration 0368 in Supabase — run it, then try again.");
  if (error) throw error;
}

/** HR's half of a two-party form: merges the company fields' answers into the submission and stamps who completed it. */
/** One signer's part of a form with several company signers (see customFormSections.ts) — saved, but the submission isn't complete until the last part is in. */
export async function saveCustomFormCompanyPart(id: string, responses: Record<string, CustomFormResponseValue>): Promise<void> {
  const { error } = await supabase.from("hr_custom_form_submissions").update({ responses }).eq("id", id);
  if (error) throw error;
}

export async function completeCustomFormSubmission(id: string, responses: Record<string, CustomFormResponseValue>, completedBy: string): Promise<void> {
  const { error } = await supabase
    .from("hr_custom_form_submissions")
    .update({ responses, completed_at: new Date().toISOString(), completed_by: completedBy })
    .eq("id", id);
  if (isMissingColumnError(error)) throw new Error("Completing submissions needs migration 0368 in Supabase — run it, then try again.");
  if (error) throw error;
}
