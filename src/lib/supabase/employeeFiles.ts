/**
 * Employee files — paystubs uploaded in bulk on Accounting → Paystubs and
 * shown to each employee on Employee Self-Service → My Files (migration
 * 0418). Rows live in employee_files; the PDFs in the private
 * "employee-files" bucket, read through short-lived signed URLs. RLS lets
 * an employee see only their own published files; Finance / HR / Admin
 * manage everything (is_employee_files_admin).
 */
import { supabase } from "./client";
import { auth as firebaseAuth } from "@/lib/firebase/config";

// The PDFs go through /api/employee-files (employeeFilesBridge.ts) — Supabase
// Storage refuses the browser's own token, so the server does it after
// checking who's asking.
async function filesApi(query: string, init: { body?: BodyInit; json?: unknown } = {}): Promise<any> {
  const idToken = await firebaseAuth?.currentUser?.getIdToken(false);
  if (!idToken) throw new Error("Your session expired — sign in again.");
  const res = await fetch(`/api/employee-files?${query}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, ...(init.json !== undefined ? { "Content-Type": "application/json" } : { "Content-Type": "application/pdf" }) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
  return out;
}

async function uploadPdf(path: string, bytes: Uint8Array): Promise<void> {
  await filesApi(`action=upload&path=${encodeURIComponent(path)}`, { body: new Blob([bytes as BlobPart], { type: "application/pdf" }) });
}

async function removePdfs(paths: string[]): Promise<void> {
  await filesApi("action=remove", { json: { paths } }).catch((err) => console.error("Couldn't remove paystub PDF:", err));
}

/** "replaced" = superseded by a corrected file (migration 0419), kept for the record. */
export type EmployeeFileStatus = "unassigned" | "published" | "withdrawn" | "replaced";

export interface EmployeeFileRow {
  id: string;
  profileId: string | null;
  kind: string;
  title: string;
  payDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  storagePath: string;
  batchId: string;
  sourceFileName: string | null;
  sourcePage: number | null;
  nameOnFile: string | null;
  matchNote: string | null;
  status: EmployeeFileStatus;
  uploadedByName: string | null;
  uploadedAt: string;
  confirmedByName: string | null;
  publishedAt: string | null;
  withdrawnByName: string | null;
  withdrawnAt: string | null;
  /** Set on a corrected file: the one it replaced. */
  replacesId: string | null;
  /** Set on a replaced file: when and by whom. */
  replacedAt: string | null;
  replacedByName: string | null;
}

const COLUMNS =
  "id, profile_id, kind, title, pay_date, period_start, period_end, storage_path, batch_id, source_file_name, source_page, name_on_file, match_note, status, uploaded_by_name, uploaded_at, confirmed_by_name, published_at, withdrawn_by_name, withdrawn_at, replaces_id, replaced_at, replaced_by_name";

function mapRow(r: any): EmployeeFileRow {
  return {
    id: r.id,
    profileId: r.profile_id ?? null,
    kind: r.kind,
    title: r.title,
    payDate: r.pay_date ?? null,
    periodStart: r.period_start ?? null,
    periodEnd: r.period_end ?? null,
    storagePath: r.storage_path,
    batchId: r.batch_id,
    sourceFileName: r.source_file_name ?? null,
    sourcePage: r.source_page ?? null,
    nameOnFile: r.name_on_file ?? null,
    matchNote: r.match_note ?? null,
    status: r.status,
    uploadedByName: r.uploaded_by_name ?? null,
    uploadedAt: r.uploaded_at,
    confirmedByName: r.confirmed_by_name ?? null,
    publishedAt: r.published_at ?? null,
    withdrawnByName: r.withdrawn_by_name ?? null,
    withdrawnAt: r.withdrawn_at ?? null,
    replacesId: r.replaces_id ?? null,
    replacedAt: r.replaced_at ?? null,
    replacedByName: r.replaced_by_name ?? null,
  };
}

const PAGE_SIZE = 1000;

/** Every file in the company (Accounting's view), newest pay date first. RLS returns only the caller's own published files to anyone else. */
export async function getCompanyEmployeeFiles(): Promise<EmployeeFileRow[]> {
  const all: EmployeeFileRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("employee_files")
      .select(COLUMNS)
      .order("pay_date", { ascending: false, nullsFirst: false })
      .order("uploaded_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []).map(mapRow));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

/** The signed-in employee's published files, newest first. */
export async function getMyEmployeeFiles(profileId: string): Promise<EmployeeFileRow[]> {
  if (!profileId) return [];
  const { data, error } = await supabase
    .from("employee_files")
    .select(COLUMNS)
    .eq("profile_id", profileId)
    .eq("status", "published")
    .order("pay_date", { ascending: false, nullsFirst: false })
    .order("published_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

export interface NewEmployeeFile {
  profileId: string | null;
  title: string;
  payDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  sourceFileName: string;
  sourcePage: number | null;
  nameOnFile: string | null;
  matchNote: string | null;
  /** true = goes straight to the employee; false = kept as unassigned. */
  publish: boolean;
  bytes: Uint8Array;
}

/**
 * Uploads one batch: each file's PDF to storage, then its row. A file whose
 * upload fails is reported back and skipped — the rest still go through.
 */
export async function saveEmployeeFiles(input: {
  companyId: string;
  actorId: string | null;
  actorName: string | null;
  files: NewEmployeeFile[];
  onProgress?: (done: number, total: number) => void;
}): Promise<{ saved: number; failed: { file: NewEmployeeFile; error: string }[] }> {
  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const failed: { file: NewEmployeeFile; error: string }[] = [];
  let saved = 0;
  for (const [i, f] of input.files.entries()) {
    const safe = (f.nameOnFile || f.sourceFileName || "file").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60);
    const path = `${input.companyId}/${batchId}/${String(i + 1).padStart(3, "0")}-${safe}.pdf`;
    try {
      await uploadPdf(path, f.bytes).catch((err) => {
        throw new Error(`file upload (storage): ${err instanceof Error ? err.message : err}`);
      });
      const publish = f.publish && !!f.profileId;
      const { error } = await supabase.from("employee_files").insert({
        company_id: input.companyId,
        profile_id: f.profileId,
        kind: "paystub",
        title: f.title,
        pay_date: f.payDate,
        period_start: f.periodStart,
        period_end: f.periodEnd,
        storage_path: path,
        batch_id: batchId,
        source_file_name: f.sourceFileName,
        source_page: f.sourcePage,
        name_on_file: f.nameOnFile,
        match_note: f.matchNote,
        status: publish ? "published" : "unassigned",
        uploaded_by: input.actorId,
        uploaded_by_name: input.actorName,
        confirmed_by: publish ? input.actorId : null,
        confirmed_by_name: publish ? input.actorName : null,
        published_at: publish ? now : null,
      });
      if (error) {
        await removePdfs([path]);
        throw new Error(`saving the record (employee_files): ${error.message}`);
      }
      saved++;
    } catch (err) {
      failed.push({ file: f, error: err instanceof Error ? err.message : String(err) });
    }
    input.onProgress?.(i + 1, input.files.length);
  }
  return { saved, failed };
}

/** Assign (or reassign) a file to an employee and publish it to them. */
export async function publishEmployeeFile(id: string, profileId: string, actorId: string | null, actorName: string | null): Promise<void> {
  const { error } = await supabase
    .from("employee_files")
    .update({
      profile_id: profileId,
      status: "published",
      confirmed_by: actorId,
      confirmed_by_name: actorName,
      published_at: new Date().toISOString(),
      withdrawn_by_name: null,
      withdrawn_at: null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Take a published file back from the employee — the row and PDF stay, for the record. */
export async function withdrawEmployeeFile(id: string, actorName: string | null): Promise<void> {
  const { error } = await supabase
    .from("employee_files")
    .update({ status: "withdrawn", withdrawn_by_name: actorName, withdrawn_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Withdraw every published file for one pay date — a whole run sent wrong. Returns how many. */
export async function withdrawEmployeeFilesForPayDate(payDate: string, actorName: string | null): Promise<number> {
  const { data, error } = await supabase
    .from("employee_files")
    .update({ status: "withdrawn", withdrawn_by_name: actorName, withdrawn_at: new Date().toISOString() })
    .eq("pay_date", payDate)
    .eq("status", "published")
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** Fix a file's title / pay date / period without re-uploading it. */
export async function updateEmployeeFileDetails(
  id: string,
  details: { title: string; payDate: string | null; periodStart: string | null; periodEnd: string | null }
): Promise<void> {
  const { error } = await supabase
    .from("employee_files")
    .update({ title: details.title, pay_date: details.payDate, period_start: details.periodStart, period_end: details.periodEnd })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Replace a published file with a corrected PDF (migration 0419): the new
 * one is published to the same person with the same details and points
 * back at the old one, which turns "replaced" — kept, hidden from them.
 */
export async function replaceEmployeeFile(input: {
  old: EmployeeFileRow;
  companyId: string;
  bytes: Uint8Array;
  sourceFileName: string;
  actorId: string | null;
  actorName: string | null;
}): Promise<void> {
  const { old } = input;
  if (!old.profileId) throw new Error("This file isn't assigned to anyone.");
  const now = new Date().toISOString();
  const path = `${input.companyId}/${old.batchId}/corrected-${Date.now()}.pdf`;
  await uploadPdf(path, input.bytes);
  const { data: created, error: insErr } = await supabase
    .from("employee_files")
    .insert({
      company_id: input.companyId,
      profile_id: old.profileId,
      kind: old.kind,
      title: old.title,
      pay_date: old.payDate,
      period_start: old.periodStart,
      period_end: old.periodEnd,
      storage_path: path,
      batch_id: old.batchId,
      source_file_name: input.sourceFileName,
      name_on_file: old.nameOnFile,
      match_note: "corrected copy",
      status: "published",
      uploaded_by: input.actorId,
      uploaded_by_name: input.actorName,
      confirmed_by: input.actorId,
      confirmed_by_name: input.actorName,
      published_at: now,
      replaces_id: old.id,
    })
    .select("id")
    .single();
  if (insErr) {
    await removePdfs([path]);
    throw new Error(insErr.message);
  }
  const { error: updErr } = await supabase
    .from("employee_files")
    .update({ status: "replaced", replaced_at: now, replaced_by_name: input.actorName })
    .eq("id", old.id);
  if (updErr) {
    // Don't leave two live copies — undo the new one.
    await supabase.from("employee_files").delete().eq("id", created.id);
    await removePdfs([path]);
    throw new Error(updErr.message);
  }
}

/** Delete a file outright (row and PDF). */
export async function deleteEmployeeFile(file: Pick<EmployeeFileRow, "id" | "storagePath">): Promise<void> {
  const { error } = await supabase.from("employee_files").delete().eq("id", file.id);
  if (error) throw new Error(error.message);
  await removePdfs([file.storagePath]);
}

/** Bucket is private — a short-lived signed URL, made when the file is opened. */
export async function getEmployeeFileUrl(storagePath: string, download?: string): Promise<string> {
  const { url } = await filesApi(`action=url&path=${encodeURIComponent(storagePath)}${download ? `&download=${encodeURIComponent(download)}` : ""}`, { json: {} });
  return url as string;
}
