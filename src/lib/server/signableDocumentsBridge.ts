/**
 * External (no-login) signing bridge for hr_signable_documents — the
 * "type any name, sendable by link" path (see CustomFormBuilder... no,
 * see ReportHRDaily.tsx's Employee Warning Form "External Link" tab).
 *
 * The normal flow (SignDocumentPage.tsx) requires being logged into AHS
 * as the exact matching profile — fine for real teammates, useless for
 * anyone without an AHS account. This bridge is the anonymous equivalent,
 * same shape as customFormsBridge.ts's public form flow: reads/writes
 * with the service-role key since an anonymous visitor has no Supabase
 * session for RLS to scope to.
 *
 * Deliberately narrow: every operation here 404s unless recipient_id IS
 * NULL on the row — a document created through the normal (real-teammate)
 * flow can never be viewed or signed through this endpoint, so this can't
 * become a backdoor around that flow's login requirement. Migration 0076
 * enforces recipient_id/recipient_name are never both null at the DB
 * level; this bridge additionally requires recipient_id be exactly null
 * (not just falsy) before treating a document as externally signable.
 *
 * Flow:
 *  1. GET  /api/signable-documents?id=xxx — public, returns an external
 *     document's form data + current signatures, 404 otherwise.
 *  2. POST /api/signable-documents?id=xxx&action=sign — public, accepts
 *     the drawn signature (PNG) and the freshly-regenerated PDF as
 *     multipart/form-data, uploads both to Firebase Storage, updates the
 *     row, and notifies the document's creator the same way the Custom
 *     Forms webhook notifies HR.
 */
import { getGoogleAccessToken, uploadFileToStorage } from "./jotformBridge";

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

interface DocRow {
  id: string;
  company_id: string;
  document_type: string;
  form_data: Record<string, unknown>;
  signatures: Record<string, { name: string; url: string; signedAt: string }>;
  status: string;
  recipient_id: string | null;
  recipient_name: string | null;
  recipient_slot: string;
  created_by: string | null;
}

async function fetchExternalDoc(env: EnvBag, id: string): Promise<DocRow | null> {
  const url =
    `${env.supabaseUrl}/rest/v1/hr_signable_documents` +
    `?select=id,company_id,document_type,form_data,signatures,status,recipient_id,recipient_name,recipient_slot,created_by` +
    `&id=eq.${encodeURIComponent(id)}&limit=1`;
  const res = await fetch(url, { headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` } });
  if (!res.ok) throw new Error(`Supabase document lookup failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as DocRow[];
  const row = rows[0];
  // Only ever serves a document created through the external ("type any
  // name") path — see this file's header comment.
  if (!row || row.recipient_id !== null) return null;
  return row;
}

interface NotifyProfileRow {
  id: string;
  firebase_uid: string;
  role: string;
  extra_roles: string[] | null;
}

/**
 * `hr_signable_documents.created_by` is a Supabase profiles.id, not a
 * Firebase uid — the Firestore notifications collection this bridge writes
 * to is keyed by Firebase uid (see NotificationsMenu.tsx's subscribeNotifications(uid, ...),
 * called with useAuth()'s uid). Resolves the creator's real Firebase uid,
 * plus every other active user carrying the HR role — primary or
 * extra_roles, same definition used everywhere else in the app — for the
 * opt-in "notify HR" broadcast (see Notifications Settings, migration 0090),
 * in one query.
 */
async function fetchHrRoleAndCreatorFirebaseUids(
  env: EnvBag,
  companyId: string,
  createdByProfileId: string | null
): Promise<{ creatorFirebaseUid: string | null; hrFirebaseUids: string[] }> {
  const idFilter = createdByProfileId ? `id.eq.${encodeURIComponent(createdByProfileId)},` : "";
  const url =
    `${env.supabaseUrl}/rest/v1/profiles` +
    `?select=id,firebase_uid,role,extra_roles&company_id=eq.${encodeURIComponent(companyId)}&is_active=eq.true` +
    `&or=(${idFilter}role.eq.HR,extra_roles.cs.{HR})`;
  const res = await fetch(url, { headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` } });
  if (!res.ok) throw new Error(`profiles lookup failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as NotifyProfileRow[];
  const creatorRow = createdByProfileId ? rows.find((r) => r.id === createdByProfileId) : undefined;
  const isHrRole = (r: NotifyProfileRow) =>
    r.role?.toUpperCase() === "HR" || (r.extra_roles ?? []).some((x) => x.toUpperCase() === "HR");
  const hrFirebaseUids = rows.filter((r) => isHrRole(r) && r.id !== createdByProfileId).map((r) => r.firebase_uid).filter(Boolean);
  return { creatorFirebaseUid: creatorRow?.firebase_uid ?? null, hrFirebaseUids };
}

async function fetchNotifyHrOnWarningFormSetting(env: EnvBag, companyId: string): Promise<boolean> {
  const url = `${env.supabaseUrl}/rest/v1/companies?select=settings&id=eq.${encodeURIComponent(companyId)}&limit=1`;
  const res = await fetch(url, { headers: { apikey: env.supabaseServiceKey, Authorization: `Bearer ${env.supabaseServiceKey}` } });
  if (!res.ok) return false;
  const rows = (await res.json()) as Array<{ settings?: Record<string, unknown> }>;
  return rows[0]?.settings?.notifyAdminsWarningForm === true;
}

async function writeSignableDocNotification(env: EnvBag, accessToken: string, uid: string, docId: string, fields: { title: string; body: string; link: string }): Promise<void> {
  const dedupeId = `signable_${docId}_signed`;
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${env.projectId}/databases/(default)/documents/notifications/${uid}/items?documentId=${encodeURIComponent(dedupeId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        fields: {
          kind: sv("signable_document_signed"),
          title: sv(fields.title),
          body: sv(fields.body),
          uid: sv(uid),
          isRead: { booleanValue: false },
          createdAt: { timestampValue: new Date().toISOString() },
          link: sv(fields.link),
          submissionId: sv(docId),
        },
      }),
    }
  );
  if (!res.ok && res.status !== 409) throw new Error(`notification write failed (${res.status}): ${await res.text()}`);
}

export async function handleSignableDocumentsRequest(request: Request, env?: Record<string, string | undefined>): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "Missing id" }, 400);

  const envResult = readEnv(env);
  if ("error" in envResult) return json(envResult, 500);
  const envBag = envResult;

  try {
    const doc = await fetchExternalDoc(envBag, id);
    if (!doc) return json({ error: "Document not found." }, 404);

    if (request.method === "GET") {
      return json({
        id: doc.id,
        documentType: doc.document_type,
        formData: doc.form_data,
        signatures: doc.signatures ?? {},
        status: doc.status,
        recipientSlot: doc.recipient_slot,
        recipientName: doc.recipient_name,
      });
    }

    if (request.method !== "POST" || url.searchParams.get("action") !== "sign") {
      return json({ error: "Method not allowed" }, 405);
    }

    if (doc.status !== "pending_signature") {
      return json({ error: "This document has already been signed or is no longer awaiting signature." }, 409);
    }
    if (!envBag.storageBucket) return json({ error: "Server missing VITE_FIREBASE_STORAGE_BUCKET" }, 500);

    const formData = await request.formData();
    const signatureFile = formData.get("signatureFile");
    const pdfFile = formData.get("pdfFile");
    if (!(signatureFile instanceof File) || !(pdfFile instanceof File)) {
      return json({ error: "Missing signature or PDF file." }, 400);
    }

    const accessToken = await getGoogleAccessToken(envBag.serviceAccountEmail, envBag.privateKey);
    const stamp = Date.now();
    const signatureUrl = await uploadFileToStorage(
      envBag.storageBucket,
      accessToken,
      `companies/${doc.company_id}/signable-documents/${doc.id}/signature-${doc.recipient_slot}-${stamp}.png`,
      "image/png",
      new Uint8Array(await signatureFile.arrayBuffer())
    );
    const pdfUrl = await uploadFileToStorage(
      envBag.storageBucket,
      accessToken,
      `companies/${doc.company_id}/signable-documents/${doc.id}/signed-${stamp}.pdf`,
      "application/pdf",
      new Uint8Array(await pdfFile.arrayBuffer())
    );

    const signedAt = new Date().toISOString();
    const signatures = { ...(doc.signatures ?? {}), [doc.recipient_slot]: { name: doc.recipient_name ?? "Signed", url: signatureUrl, signedAt } };

    const patchRes = await fetch(`${envBag.supabaseUrl}/rest/v1/hr_signable_documents?id=eq.${encodeURIComponent(doc.id)}`, {
      method: "PATCH",
      headers: { apikey: envBag.supabaseServiceKey, Authorization: `Bearer ${envBag.supabaseServiceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ signatures, status: "signed", pdf_url: pdfUrl, signed_at: signedAt }),
    });
    if (!patchRes.ok) throw new Error(`hr_signable_documents update failed (${patchRes.status}): ${await patchRes.text()}`);

    try {
      const formTitle = (doc.form_data as { employeeName?: string })?.employeeName ?? "an employee";
      const notifyFields = {
        title: `Signed by ${doc.recipient_name ?? "recipient"}`,
        body: `Employee Warning Form for ${formTitle} has been signed.`,
        link: `/m/dashboard/hr-dashboard?tab=warningForm`,
      };
      const [{ creatorFirebaseUid, hrFirebaseUids }, notifyHrEnabled] = await Promise.all([
        fetchHrRoleAndCreatorFirebaseUids(envBag, doc.company_id, doc.created_by),
        fetchNotifyHrOnWarningFormSetting(envBag, doc.company_id),
      ]);

      if (creatorFirebaseUid) await writeSignableDocNotification(envBag, accessToken, creatorFirebaseUid, doc.id, notifyFields);

      // Opt-in broadcast — see Notifications Settings (migration 0090).
      if (notifyHrEnabled && hrFirebaseUids.length > 0) {
        await Promise.all(
          hrFirebaseUids.map((uid) =>
            writeSignableDocNotification(envBag, accessToken, uid, doc.id, notifyFields).catch((err) =>
              console.error("[signable-documents] hr notification failed for", uid, err)
            )
          )
        );
      }
    } catch (err) {
      console.error("[signable-documents] creator/hr notification failed (signature was still saved):", err);
    }

    return json({ success: true, pdfUrl });
  } catch (err) {
    console.error("[signable-documents] error:", err);
    return json({ error: err instanceof Error ? err.message : "Request failed" }, 500);
  }
}
