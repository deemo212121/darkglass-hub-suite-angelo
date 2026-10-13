/**
 * Reports Library — imported spreadsheet reports shown to leadership inside
 * AHS (see supabase/migrations/0371_reports_library.sql). Deliberately its
 * own island: nothing here reads or writes attendance, PTO, payroll or any
 * other live table, and nothing else reads these. Admin / SuperAdmin only,
 * enforced by RLS.
 */
import { supabase } from "./client";
import type { ReportSheet } from "@/lib/reportWorkbook";

export interface ExecutiveReportSummary {
  id: string;
  title: string;
  period: string | null;
  source: string | null;
  notes: string | null;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
  uploadedByName: string | null;
  createdAt: string;
}

export interface ExecutiveReport extends ExecutiveReportSummary {
  sheets: ReportSheet[];
}

const SUMMARY_SELECT = "id, title, period, source, notes, file_name, file_type, file_size, created_at, uploader:uploaded_by (display_name, username)";

function summaryFromRow(r: any): ExecutiveReportSummary {
  return {
    id: r.id,
    title: r.title,
    period: r.period ?? null,
    source: r.source ?? null,
    notes: r.notes ?? null,
    fileName: r.file_name,
    fileType: r.file_type ?? null,
    fileSize: r.file_size ?? null,
    uploadedByName: r.uploader?.display_name || r.uploader?.username || null,
    createdAt: r.created_at,
  };
}

/** Postgres 42P01 / PostgREST PGRST205 — migration 0371 hasn't been run yet. */
function missingTableMessage(error: { code?: string; message: string }): string {
  return error.code === "42P01" || error.code === "PGRST205" ? "The Reports Library needs migration 0371 in Supabase — run it, then refresh." : error.message;
}

export async function listExecutiveReports(): Promise<ExecutiveReportSummary[]> {
  const { data, error } = await supabase.from("executive_reports").select(SUMMARY_SELECT).order("created_at", { ascending: false });
  if (error) throw new Error(missingTableMessage(error));
  return (data ?? []).map(summaryFromRow);
}

export async function getExecutiveReport(id: string): Promise<ExecutiveReport | null> {
  const { data, error } = await supabase.from("executive_reports").select(`${SUMMARY_SELECT}, sheets`).eq("id", id).maybeSingle();
  if (error) throw new Error(missingTableMessage(error));
  return data ? { ...summaryFromRow(data), sheets: (data.sheets ?? []) as ReportSheet[] } : null;
}

export async function createExecutiveReport(input: {
  title: string;
  period: string;
  source: string;
  notes: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  sheets: ReportSheet[];
  fileBase64: string;
}): Promise<string> {
  const { data, error } = await supabase
    .from("executive_reports")
    .insert({
      title: input.title,
      period: input.period || null,
      source: input.source || null,
      notes: input.notes || null,
      file_name: input.fileName,
      file_type: input.fileType || null,
      file_size: input.fileSize,
      sheets: input.sheets,
    })
    .select("id")
    .single();
  if (error) throw new Error(missingTableMessage(error));
  const { error: fileError } = await supabase.from("executive_report_files").insert({ report_id: data.id, file_base64: input.fileBase64 });
  if (fileError) {
    // Don't leave a report whose Download can never work.
    await supabase.from("executive_reports").delete().eq("id", data.id);
    throw new Error(missingTableMessage(fileError));
  }
  return data.id as string;
}

export async function deleteExecutiveReport(id: string): Promise<void> {
  const { error } = await supabase.from("executive_reports").delete().eq("id", id);
  if (error) throw new Error(missingTableMessage(error));
}

/** The original uploaded file, as a Blob for Download. */
export async function getExecutiveReportFile(id: string, fileType: string | null): Promise<Blob> {
  const { data, error } = await supabase.from("executive_report_files").select("file_base64").eq("report_id", id).maybeSingle();
  if (error) throw new Error(missingTableMessage(error));
  if (!data) throw new Error("The original file for this report wasn't found.");
  const binary = atob(data.file_base64 as string);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: fileType || "application/octet-stream" });
}
