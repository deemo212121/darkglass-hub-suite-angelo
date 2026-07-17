/**
 * Certificate of Employment sent-history — one row per COE sent via
 * "Preview & Send" on the Generate COE tab (ReportHRDaily.tsx). Rows are
 * stamped with company_id/sent_by automatically (see migration 0059).
 */

import { supabase } from "./client";

export interface CoeDocument {
  id: string;
  companyId: string;
  employeeName: string;
  documentUrl: string;
  documentPath: string | null;
  recipientId: string | null;
  recipientName: string | null;
  sentBy: string | null;
  sentByName: string | null;
  createdAt: string;
}

const SELECT =
  "id, company_id, employee_name, document_url, document_path, recipient_id, sent_by, created_at, recipient:recipient_id (display_name, username), sender:sent_by (display_name, username)";

function fromRow(r: any): CoeDocument {
  return {
    id: r.id,
    companyId: r.company_id,
    employeeName: r.employee_name,
    documentUrl: r.document_url,
    documentPath: r.document_path,
    recipientId: r.recipient_id,
    recipientName: r.recipient?.display_name || r.recipient?.username || null,
    sentBy: r.sent_by,
    sentByName: r.sender?.display_name || r.sender?.username || null,
    createdAt: r.created_at,
  };
}

/** All COE sends for the caller's company (RLS-scoped), newest first. */
export async function getCompanyCoeDocuments(): Promise<CoeDocument[]> {
  const { data, error } = await supabase.from("hr_coe_documents").select(SELECT).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

export interface AddCoeDocumentInput {
  employeeName: string;
  documentUrl: string;
  documentPath?: string | null;
  recipientId?: string | null;
}

export async function addCoeDocument(input: AddCoeDocumentInput): Promise<void> {
  const { error } = await supabase.from("hr_coe_documents").insert({
    employee_name: input.employeeName,
    document_url: input.documentUrl,
    document_path: input.documentPath ?? null,
    recipient_id: input.recipientId ?? null,
  });
  if (error) throw error;
}

export async function deleteCoeDocument(id: string): Promise<void> {
  const { error } = await supabase.from("hr_coe_documents").delete().eq("id", id);
  if (error) throw error;
}
