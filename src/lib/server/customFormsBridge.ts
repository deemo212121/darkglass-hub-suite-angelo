/**
 * Public custom-form fill/submit bridge (runtime-agnostic, same shape as
 * jotformBridge.ts). This is the ONLY server-side code this feature needs —
 * "internal" forms are read/written directly by the authenticated Supabase
 * client under normal company RLS (see FillCustomFormPage.tsx), same as
 * every other authenticated feature in this app. "Public" forms have no
 * logged-in visitor to scope RLS to, so instead of opening an anonymous
 * write policy on Supabase, this bridge — reached only through a form's own
 * published public_slug, which is not guessable at scale — does the reads
 * and writes itself with the service-role key, exactly how the existing
 * Jotform webhook already writes hr_jotform_submissions.
 *
 * Reuses getGoogleAccessToken/uploadFileToStorage from jotformBridge.ts
 * (pure, dependency-free helpers with no side effects) rather than
 * duplicating the Web-Crypto JWT signing and GCS upload logic — those two
 * are generic infrastructure, not Jotform-specific. Everything Jotform-
 * specific (rawRequest parsing, generatePDF, file-URL guessing) is NOT
 * reused, since our own form's submit request is already in a shape we
 * control.
 *
 * Flow:
 *  1. GET  /api/custom-forms?slug=xxx — public, returns a published public
 *     form's field schema, 404 otherwise.
 *  2. POST /api/custom-forms?slug=xxx — public, accepts the filled-out
 *     form as multipart/form-data: a `responses` JSON field (non-file
 *     values keyed by field id), a `submitterName` field, and one file part
 *     per file/signature field named `file_<fieldId>`. Uploads any files to
 *     Firebase Storage, writes the hr_custom_form_submissions row with the
 *     service-role key (company_id resolved from the form record, never
 *     trusted from the client), and notifies HR the same way the Jotform
 *     webhook does.
 *
 * No rate-limiting/CAPTCHA yet — the only bar to entry today is knowing a
 * form's specific published slug. Worth adding if abuse shows up in
 * practice; not built preemptively.
 */

import { getGoogleAccessToken, uploadFileToStorage } from "./jotformBridge";
import { postDiscordSubmissionNotice, postDiscordTestMessage } from "./discordNotify";
// Type-only import — erased at compile time, so this never actually pulls
// the (React/JSX-heavy) element registry into this Worker/Node bundle.
// Importing straight from ./types rather than the registry's index.ts
// keeps that decoupling obvious rather than incidental.
import type { CustomFormField } from "@/lib/formElements/types";
import type { DocumentTemplate } from "@/lib/documentTemplates/types";

function sv(s: string) {
  return { stringValue: s };
}

interface EnvBag {
  supabaseUrl: string;
  supabaseServiceKey: string;
  projectId: string;
  serviceAccountEmail: string;
  privateKey: string;
  storageBucket?: string;
}

function readEnv(env?: Record<string, string | undefined>): EnvBag | { error: string } {
  const getEnv = (k: string): string | undefined => env?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);
  const g = globalThis as any;
  const supabaseUrl = (g.__SUPABASE_URL__ && g.__SUPABASE_URL__ !== "" ? g.__SUPABASE_URL__ : undefined) ?? getEnv("VITE_SUPABASE_URL");
  const supabaseServiceKey = (g.__SUPABASE_SERVICE_KEY__ && g.__SUPABASE_SERVICE_KEY__ !== "" ? g.__SUPABASE_SERVICE_KEY__ : undefined) ?? getEnv("SUPABASE_SERVICE_KEY");
  const projectId = (g.__FIREBASE_PROJECT_ID__ && g.__FIREBASE_PROJECT_ID__ !== "" ? g.__FIREBASE_PROJECT_ID__ : undefined) ?? getEnv("VITE_FIREBASE_PROJECT_ID");
  const serviceAccountEmail = (g.__FIREBASE_SA_EMAIL__ && g.__FIREBASE_SA_EMAIL__ !== "" ? g.__FIREBASE_SA_EMAIL__ : undefined) ?? getEnv("FIREBASE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = (g.__FIREBASE_SA_PRIVATE_KEY__ && g.__FIREBASE_SA_PRIVATE_KEY__ !== "" ? g.__FIREBASE_SA_PRIVATE_KEY__ : undefined) ?? getEnv("FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY");
  const storageBucket = (g.__FIREBASE_STORAGE_BUCKET__ && g.__FIREBASE_STORAGE_BUCKET__ !== "" ? g.__FIREBASE_STORAGE_BUCKET__ : undefined) ?? getEnv("VITE_FIREBASE_STORAGE_BUCKET");

  if (!supabaseUrl) return { error: "Server missing VITE_SUPABASE_URL" };
  if (!supabaseServiceKey) return { error: "Server missing SUPABASE_SERVICE_KEY" };
  if (!projectId) return { error: "Server missing VITE_FIREBASE_PROJECT_ID" };
  if (!serviceAccountEmail) return { error: "Server missing FIREBASE_SERVICE_ACCOUNT_EMAIL" };
  if (!privateKey) return { error: "Server missing FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY" };
  return { supabaseUrl, supabaseServiceKey, projectId, serviceAccountEmail, privateKey, storageBucket };
}

interface FormRow {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  fields: CustomFormField[];
  notify_firebase_uids: string[] | null;
  document_template: DocumentTemplate | null;
  drive_upload_enabled: boolean;
  discord_webhook_url: string | null;
}

async function fetchPublishedPublicForm(env: EnvBag, slug: string): Promise<FormRow | null> {
  const url =
    `${env.supabaseUrl}/rest/v1/hr_custom_forms` +
    `?select=id,company_id,title,description,fields,notify_firebase_uids,document_template,drive_upload_enabled,discord_webhook_url` +
    `&public_slug=eq.${encodeURIComponent(slug)}` +
    `&status=eq.published&access=eq.public&limit=1`;
  const res = await fetch(url, { headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` } });
  if (!res.ok) throw new Error(`Supabase form lookup failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as FormRow[];
  return rows[0] ?? null;
}

/**
 * Exported so googleDriveBridge.ts can resolve the same trusted
 * (server-verified, not client-claimed) submission summary for its own
 * "upload the generated PDF" action. Takes just the two fields it actually
 * needs (not the full EnvBag) so a caller with a differently-shaped env bag
 * — googleDriveBridge.ts has no serviceAccountEmail/privateKey, it doesn't
 * need Firestore — can still call this directly.
 */
export async function fetchSubmissionForNotify(env: { supabaseUrl: string; supabaseServiceKey: string }, submissionId: string): Promise<{ companyId: string; formId: string; formTitle: string; submitterName: string | null; responses: Record<string, unknown> } | null> {
  const url =
    `${env.supabaseUrl}/rest/v1/hr_custom_form_submissions` +
    `?select=company_id,form_id,form_title,submitter_name,responses&id=eq.${encodeURIComponent(submissionId)}&limit=1`;
  const res = await fetch(url, { headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` } });
  if (!res.ok) throw new Error(`Supabase submission lookup failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as Array<{ company_id: string; form_id: string; form_title: string; submitter_name: string | null; responses: Record<string, unknown> | null }>;
  const r = rows[0];
  if (!r) return null;
  return { companyId: r.company_id, formId: r.form_id, formTitle: r.form_title, submitterName: r.submitter_name, responses: r.responses ?? {} };
}

/** The form's own explicitly-picked notify list (see CustomFormBuilder.tsx's "Set Notifications" picker) plus its Discord webhook + field list — fetched separately from fetchSubmissionForNotify above since that only reads hr_custom_form_submissions, not the form itself. Used by the internal-submission notify path only; the public path already has the form loaded. */
async function fetchFormNotifyRecipients(env: EnvBag, formId: string): Promise<{ notifyFirebaseUids: string[] | null; discordWebhookUrl: string | null; fields: CustomFormField[] }> {
  const url = `${env.supabaseUrl}/rest/v1/hr_custom_forms?select=notify_firebase_uids,discord_webhook_url,fields&id=eq.${encodeURIComponent(formId)}&limit=1`;
  const res = await fetch(url, { headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` } });
  if (!res.ok) throw new Error(`Supabase form notify-recipients lookup failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as Array<{ notify_firebase_uids: string[] | null; discord_webhook_url: string | null; fields: CustomFormField[] | null }>;
  const r = rows[0];
  return { notifyFirebaseUids: r?.notify_firebase_uids ?? null, discordWebhookUrl: r?.discord_webhook_url ?? null, fields: r?.fields ?? [] };
}

async function insertSubmission(
  env: EnvBag,
  row: { id: string; companyId: string; formId: string; formTitle: string; submitterName: string | null; responses: Record<string, unknown> }
): Promise<void> {
  // id is set explicitly (the same uuid the caller already generated for the
  // Storage file-path namespace and the notification dedupe key) so the
  // "submissionId" returned to the client actually matches the real row —
  // otherwise callers like googleDriveBridge.ts, which look a submission up
  // by that id, would never find it for a public-form submission.
  const res = await fetch(`${env.supabaseUrl}/rest/v1/hr_custom_form_submissions`, {
    method: "POST",
    headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: row.id,
      company_id: row.companyId,
      form_id: row.formId,
      form_title: row.formTitle,
      submitter_name: row.submitterName,
      responses: row.responses,
      submitted_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`hr_custom_form_submissions insert failed (${res.status}): ${await res.text()}`);
}

const CUSTOM_FORM_HR_ROLES = new Set(["HR", "ADMIN", "SUPERADMIN", "MANAGER", "SENIOR_MANAGER"]);

/** Same lookup as findHrFirebaseUids in jotformBridge.ts, duplicated locally rather than exported/imported across bridges — see that file's header comment on why this bridge stays self-contained for its Supabase/Firestore reads. */
async function findHrFirebaseUids(env: EnvBag, companyId: string): Promise<string[]> {
  const url =
    `${env.supabaseUrl}/rest/v1/profiles?select=firebase_uid,role,extra_roles` +
    `&company_id=eq.${encodeURIComponent(companyId)}&is_active=eq.true`;
  const res = await fetch(url, { headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` } });
  if (!res.ok) throw new Error(`Supabase profiles query failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as Array<{ firebase_uid: string | null; role: string | null; extra_roles: string[] | null }>;
  return rows
    .filter((r) => [r.role, ...(r.extra_roles ?? [])].map((v) => String(v ?? "").trim().toUpperCase()).some((v) => CUSTOM_FORM_HR_ROLES.has(v)))
    .map((r) => r.firebase_uid)
    .filter((uid): uid is string => Boolean(uid));
}

/** A form with no explicit picks (see CustomFormBuilder.tsx's "Set Notifications" picker) falls back to the existing default — every HR/Admin/Manager account. Picking specific people narrows that down to just them for that one form. */
async function resolveNotifyRecipients(env: EnvBag, companyId: string, explicitUids: string[] | null | undefined): Promise<string[]> {
  if (explicitUids && explicitUids.length > 0) return explicitUids;
  return findHrFirebaseUids(env, companyId);
}

async function writeNotification(env: EnvBag, accessToken: string, uid: string, docId: string, fields: { title: string; body: string; formId: string; submissionId: string; link: string }): Promise<void> {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${env.projectId}/databases/(default)/documents/notifications/${uid}/items?documentId=${encodeURIComponent(docId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        fields: {
          kind: sv("custom_form_submission"),
          title: sv(fields.title),
          body: sv(fields.body),
          uid: sv(uid),
          isRead: { booleanValue: false },
          createdAt: { timestampValue: new Date().toISOString() },
          link: sv(fields.link),
          formId: sv(fields.formId),
          submissionId: sv(fields.submissionId),
        },
      }),
    }
  );
  if (!res.ok && res.status !== 409) throw new Error(`notification write failed (${res.status}): ${await res.text()}`);
}

// Duplicated from src/lib/formElements (ElementDefinition.isFileField /
// kind === "structural") rather than imported — that registry is
// React/JSX-heavy and this bridge deliberately stays dependency-free (see
// findHrFirebaseUids above for the same reasoning). Keep in sync by hand
// when a new file-bearing or structural element type is added.
const FILE_BEARING_TYPES = new Set(["fileUpload", "signature"]);
const STRUCTURAL_TYPES = new Set(["heading", "paragraph", "divider", "image", "sectionCollapse", "pageBreak", "submitButton"]);

export async function handleCustomFormsRequest(request: Request, env?: Record<string, string | undefined>): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const url = new URL(request.url);

  const envResult = readEnv(env);
  if ("error" in envResult) return json(envResult, 500);
  const envBag = envResult;

  // Internal forms are read/written directly by the authenticated client
  // under RLS (see submitCustomFormResponse) — the server never sees the
  // write itself. This is the one exception: only the server holds the
  // Firebase service-account credentials needed to write into HR's own
  // notifications collection, so the client calls this right after a
  // successful insert to ask the server to notify HR on its behalf.
  if (url.searchParams.get("notify") === "internal") {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      const body = (await request.json()) as { submissionId?: string };
      if (!body.submissionId) return json({ error: "Missing submissionId" }, 400);
      const submission = await fetchSubmissionForNotify(envBag, body.submissionId);
      if (!submission) return json({ error: "Submission not found" }, 404);
      const accessToken = await getGoogleAccessToken(envBag.serviceAccountEmail, envBag.privateKey);
      const formExtras = await fetchFormNotifyRecipients(envBag, submission.formId);
      const hrUids = await resolveNotifyRecipients(envBag, submission.companyId, formExtras.notifyFirebaseUids);
      const dedupeId = `customform_${body.submissionId}`;
      const link = `/m/dashboard/hr-dashboard?tab=customForms`;
      await Promise.all(
        hrUids.map((uid) =>
          writeNotification(envBag, accessToken, uid, dedupeId, {
            title: submission.formTitle,
            body: `Submitted by ${submission.submitterName || "Someone"}`,
            formId: submission.formId,
            submissionId: body.submissionId!,
            link,
          })
        )
      );
      if (formExtras.discordWebhookUrl) {
        try {
          await postDiscordSubmissionNotice(formExtras.discordWebhookUrl, {
            formTitle: submission.formTitle,
            submitterName: submission.submitterName,
            submittedAt: new Date().toISOString(),
            fields: formExtras.fields,
            responses: submission.responses,
          });
        } catch (err) {
          console.error("[custom-forms] Discord notify failed (submission was still saved):", err);
        }
      }
      return json({ success: true });
    } catch (err) {
      console.error("[custom-forms] internal notify error:", err);
      return json({ error: err instanceof Error ? err.message : "Notify failed" }, 500);
    }
  }

  if (url.searchParams.get("action") === "discord-test") {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      const body = (await request.json()) as { webhookUrl?: string };
      if (!body.webhookUrl?.trim()) return json({ error: "Missing webhookUrl" }, 400);
      await postDiscordTestMessage(body.webhookUrl.trim());
      return json({ success: true });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "Discord test failed" }, 500);
    }
  }

  const slug = url.searchParams.get("slug");
  if (!slug) return json({ error: "Missing slug" }, 400);

  try {
    const form = await fetchPublishedPublicForm(envBag, slug);
    if (!form) return json({ error: "Form not found" }, 404);

    if (request.method === "GET") {
      return json({ id: form.id, title: form.title, description: form.description, fields: form.fields, documentTemplate: form.document_template, driveUploadEnabled: form.drive_upload_enabled });
    }

    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const formData = await request.formData();
    const responsesRaw = formData.get("responses");
    const submittedValues = typeof responsesRaw === "string" ? (JSON.parse(responsesRaw) as Record<string, unknown>) : {};
    const submitterName = (formData.get("submitterName") as string | null)?.trim() || null;
    const submissionId = crypto.randomUUID();

    let accessToken: string | null = null;
    const responses: Record<string, unknown> = {};

    for (const field of form.fields) {
      if (STRUCTURAL_TYPES.has(field.type)) continue;
      if (FILE_BEARING_TYPES.has(field.type)) {
        const file = formData.get(`file_${field.id}`);
        if (file instanceof File && file.size > 0) {
          if (!envBag.storageBucket) return json({ error: "Server missing VITE_FIREBASE_STORAGE_BUCKET" }, 500);
          if (!accessToken) accessToken = await getGoogleAccessToken(envBag.serviceAccountEmail, envBag.privateKey);
          const bytes = new Uint8Array(await file.arrayBuffer());
          const objectPath = `companies/${form.company_id}/custom-forms/${form.id}/${submissionId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
          const fileUrl = await uploadFileToStorage(envBag.storageBucket, accessToken, objectPath, file.type || "application/octet-stream", bytes);
          responses[field.id] = { url: fileUrl, path: objectPath, fileName: file.name, mimeType: file.type, size: file.size };
        } else if (field.required) {
          return json({ error: `"${field.label}" is required.` }, 400);
        }
      } else {
        const v = submittedValues[field.id];
        if (field.required && (v === undefined || v === null || v === "" || v === false)) {
          return json({ error: `"${field.label}" is required.` }, 400);
        }
        if (v !== undefined) responses[field.id] = v;
      }
    }

    await insertSubmission(envBag, { id: submissionId, companyId: form.company_id, formId: form.id, formTitle: form.title, submitterName, responses });

    try {
      if (!accessToken) accessToken = await getGoogleAccessToken(envBag.serviceAccountEmail, envBag.privateKey);
      const hrUids = await resolveNotifyRecipients(envBag, form.company_id, form.notify_firebase_uids);
      const dedupeId = `customform_${submissionId}`;
      const link = `/m/dashboard/hr-dashboard?tab=customForms`;
      await Promise.all(
        hrUids.map((uid) =>
          writeNotification(envBag, accessToken!, uid, dedupeId, {
            title: form.title,
            body: `Submitted by ${submitterName || "Someone"}`,
            formId: form.id,
            submissionId,
            link,
          })
        )
      );
    } catch (err) {
      console.error("[custom-forms] notification failed (submission was still saved):", err);
    }

    if (form.discord_webhook_url) {
      try {
        await postDiscordSubmissionNotice(form.discord_webhook_url, {
          formTitle: form.title,
          submitterName,
          submittedAt: new Date().toISOString(),
          fields: form.fields,
          responses,
        });
      } catch (err) {
        console.error("[custom-forms] Discord notify failed (submission was still saved):", err);
      }
    }

    return json({ success: true, submissionId });
  } catch (err) {
    console.error("[custom-forms] error:", err);
    return json({ error: err instanceof Error ? err.message : "Custom form request failed" }, 500);
  }
}
