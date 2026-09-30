/**
 * Advances a Promotion Paper and Wage Increase document (hr_signable_documents,
 * document_type "compensation_update") to its next signer — Senior →
 * Executive → HR → Employee — or finalizes it once the employee (the last
 * signer) has signed.
 *
 * Needs the service-role key because the signer can't do this themselves:
 * the hr_signable_documents update policy (migration 0201) only lets a
 * non-HR recipient write a row whose recipient_id stays THEMSELVES, so a
 * Senior handing the document to the Executive is rejected by RLS.
 *
 * Only ever moves a document forward along the signer chain HR chose at
 * send time, and only for the caller who is its current recipient and has
 * already signed their own slot — the caller's identity comes from a
 * verified Firebase ID token, never from the request body.
 *
 * POST /api/compensation-update  { idToken, docId }
 *   → { done: true }                                   (employee signed — finalized)
 *   → { done: false, next: { slot, id, name } }        (handed to next signer)
 *   → { done: false, next: { slot: "hr_staff", id: null, name: "HR" } }  (waiting on any HR user)
 */
import { verifyFirebaseToken } from "./supabaseTokenBridge";
import { nextCompensationSlot, type CompensationSignatureSlot, type CompensationUpdateFormData } from "../compensationUpdateTemplate";

interface EnvBag {
  supabaseUrl: string;
  supabaseServiceKey: string;
  firebaseProjectId: string;
}

function readEnv(env?: Record<string, string | undefined>): EnvBag | { error: string } {
  const getEnv = (k: string): string | undefined => env?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);
  const g = globalThis as any;
  const supabaseUrl = (g.__SUPABASE_URL__ && g.__SUPABASE_URL__ !== "" ? g.__SUPABASE_URL__ : undefined) ?? getEnv("VITE_SUPABASE_URL");
  const supabaseServiceKey = (g.__SUPABASE_SERVICE_KEY__ && g.__SUPABASE_SERVICE_KEY__ !== "" ? g.__SUPABASE_SERVICE_KEY__ : undefined) ?? getEnv("SUPABASE_SERVICE_KEY");
  const firebaseProjectId = (g.__FIREBASE_PROJECT_ID__ && g.__FIREBASE_PROJECT_ID__ !== "" ? g.__FIREBASE_PROJECT_ID__ : undefined) ?? getEnv("VITE_FIREBASE_PROJECT_ID");
  if (!supabaseUrl) return { error: "Server missing VITE_SUPABASE_URL" };
  if (!supabaseServiceKey) return { error: "Server missing SUPABASE_SERVICE_KEY" };
  if (!firebaseProjectId) return { error: "Server missing VITE_FIREBASE_PROJECT_ID" };
  return { supabaseUrl, supabaseServiceKey, firebaseProjectId };
}

interface DocRow {
  id: string;
  company_id: string;
  document_type: string;
  form_data: CompensationUpdateFormData;
  signatures: Record<string, unknown>;
  status: string;
  recipient_id: string | null;
  recipient_slot: string;
}

export async function handleCompensationUpdateRequest(request: Request, env?: Record<string, string | undefined>): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const envResult = readEnv(env);
  if ("error" in envResult) return json(envResult, 500);
  const e = envResult;
  const headers = { apikey: e.supabaseServiceKey, Authorization: `Bearer ${e.supabaseServiceKey}` };

  try {
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const idToken = typeof payload.idToken === "string" ? payload.idToken : "";
    const docId = typeof payload.docId === "string" ? payload.docId : "";
    if (!idToken || !docId) return json({ error: "Missing idToken or docId" }, 400);

    // 1. Who is calling — from the verified token, not the request body.
    const claims = await verifyFirebaseToken(idToken, e.firebaseProjectId);
    const profRes = await fetch(`${e.supabaseUrl}/rest/v1/profiles?firebase_uid=eq.${encodeURIComponent(claims.sub)}&select=id,company_id&limit=1`, { headers });
    if (!profRes.ok) throw new Error(`Profile lookup failed (${profRes.status})`);
    const caller = ((await profRes.json()) as { id: string; company_id: string }[])[0];
    if (!caller) return json({ error: "Profile not found" }, 403);

    // 2. The document, and that the caller is its current, already-signed recipient.
    const docRes = await fetch(
      `${e.supabaseUrl}/rest/v1/hr_signable_documents?id=eq.${encodeURIComponent(docId)}&select=id,company_id,document_type,form_data,signatures,status,recipient_id,recipient_slot&limit=1`,
      { headers }
    );
    if (!docRes.ok) throw new Error(`Document lookup failed (${docRes.status})`);
    const doc = ((await docRes.json()) as DocRow[])[0];
    if (!doc || doc.document_type !== "compensation_update" || doc.company_id !== caller.company_id) {
      return json({ error: "Document not found" }, 404);
    }
    if (doc.recipient_id !== caller.id) return json({ error: "This document isn't assigned to you" }, 403);
    const currentSlot = doc.recipient_slot as CompensationSignatureSlot;
    if (doc.status !== "signed" || !doc.signatures?.[currentSlot]) {
      return json({ error: "Sign the document before it can move to the next signer" }, 409);
    }

    const nowIso = new Date().toISOString();
    const next = nextCompensationSlot(currentSlot, doc.form_data);

    // 3a. The employee (last) signed — finalize.
    if (!next) {
      const res = await fetch(`${e.supabaseUrl}/rest/v1/hr_signable_documents?id=eq.${encodeURIComponent(docId)}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "confirmed", confirmed_at: nowIso }),
      });
      if (!res.ok) throw new Error(`Finalize failed (${res.status}): ${await res.text()}`);
      return json({ done: true });
    }

    // 3b. HR isn't picked at send time — the HR step goes to the HR queue
    // (no single recipient); any HR user signs it from the Sent list.
    const signer = doc.form_data?.signers?.[next];
    if (next === "hr_staff" && !signer?.id) {
      const formData = { ...doc.form_data, recipientSlot: next, recipientName: "" };
      const res = await fetch(`${e.supabaseUrl}/rest/v1/hr_signable_documents?id=eq.${encodeURIComponent(docId)}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ recipient_id: null, recipient_name: "HR", recipient_slot: next, form_data: formData, status: "pending_signature" }),
      });
      if (!res.ok) throw new Error(`Hand-off failed (${res.status}): ${await res.text()}`);
      return json({ done: false, next: { slot: next, id: null, name: "HR" } });
    }

    // 3c. Hand it to the next signer HR picked for that slot.
    if (!signer?.id) return json({ error: `No ${next} signer was chosen for this document` }, 409);
    const formData = {
      ...doc.form_data,
      recipientSlot: next,
      recipientName: signer.name,
      recipientNames: { ...(doc.form_data?.recipientNames ?? {}), [next]: signer.name },
    };
    const res = await fetch(`${e.supabaseUrl}/rest/v1/hr_signable_documents?id=eq.${encodeURIComponent(docId)}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient_id: signer.id, recipient_name: null, recipient_slot: next, form_data: formData, status: "pending_signature" }),
    });
    if (!res.ok) throw new Error(`Hand-off failed (${res.status}): ${await res.text()}`);
    return json({ done: false, next: { slot: next, id: signer.id, name: signer.name } });
  } catch (err) {
    console.error("[compensation-update] error:", err);
    return json({ error: err instanceof Error ? err.message : "Failed to advance document" }, 500);
  }
}
