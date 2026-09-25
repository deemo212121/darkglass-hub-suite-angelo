/**
 * CSR Daily Report — Extension roster/legend, daily AM/PM call counts per
 * extension, and the handful of daily summary numbers with no other source
 * in the app (Inbound/Outbound/Update CSR Calls, Mistakes, HU, MC). See
 * migration 0271/0276. The rest of the summary panel (Total CSR, Handle TK,
 * Schedule, Attempt, Update, GH) is computed client-side in
 * CSRTeamDailyReport.tsx from the main grid — nothing to fetch here.
 */

import { supabase } from "./client";

export interface CsrExtension {
  id: string;
  code: string;
  label: string | null;
  sortOrder: number;
}

export interface CsrExtensionDailyCount {
  extensionId: string;
  reportDate: string;
  amCount: number | null;
  pmCount: number | null;
}

export interface CsrDailyReportTotals {
  reportDate: string;
  inboundCalls: number | null;
  outboundCalls: number | null;
  updateCsrCalls: number | null;
  mistakes: number | null;
  hu: number | null;
  mc: number | null;
}

export async function getCsrExtensions(): Promise<CsrExtension[]> {
  const { data, error } = await supabase
    .from("csr_extensions")
    .select("id, code, label, sort_order")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ id: r.id, code: r.code, label: r.label, sortOrder: r.sort_order }));
}

export async function createCsrExtension(code: string, label: string, sortOrder: number): Promise<string> {
  const { data, error } = await supabase
    .from("csr_extensions")
    .insert({ code, label: label || null, sort_order: sortOrder })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateCsrExtension(id: string, fields: Partial<Pick<CsrExtension, "code" | "label" | "sortOrder">>): Promise<void> {
  const patch: Record<string, unknown> = {};
  if ("code" in fields) patch.code = fields.code;
  if ("label" in fields) patch.label = fields.label || null;
  if ("sortOrder" in fields) patch.sort_order = fields.sortOrder;
  const { error } = await supabase.from("csr_extensions").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteCsrExtension(id: string): Promise<void> {
  const { error } = await supabase.from("csr_extensions").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function getCsrExtensionDailyCounts(reportDate: string): Promise<CsrExtensionDailyCount[]> {
  const { data, error } = await supabase
    .from("csr_extension_daily_counts")
    .select("extension_id, report_date, am_count, pm_count")
    .eq("report_date", reportDate);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ extensionId: r.extension_id, reportDate: r.report_date, amCount: r.am_count, pmCount: r.pm_count }));
}

export async function upsertCsrExtensionDailyCount(extensionId: string, reportDate: string, fields: Partial<Pick<CsrExtensionDailyCount, "amCount" | "pmCount">>): Promise<void> {
  const patch: Record<string, unknown> = { extension_id: extensionId, report_date: reportDate };
  if ("amCount" in fields) patch.am_count = fields.amCount;
  if ("pmCount" in fields) patch.pm_count = fields.pmCount;
  const { error } = await supabase.from("csr_extension_daily_counts").upsert(patch, { onConflict: "extension_id,report_date" });
  if (error) throw new Error(error.message);
}

export async function getCsrDailyReportTotals(reportDate: string): Promise<CsrDailyReportTotals | null> {
  const { data, error } = await supabase
    .from("csr_daily_report_totals")
    .select("report_date, inbound_calls, outbound_calls, update_csr_calls, mistakes, hu, mc")
    .eq("report_date", reportDate)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    reportDate: data.report_date,
    inboundCalls: data.inbound_calls,
    outboundCalls: data.outbound_calls,
    updateCsrCalls: data.update_csr_calls,
    mistakes: data.mistakes,
    hu: data.hu,
    mc: data.mc,
  };
}

export type CsrDailyReportTotalsFields = Partial<Pick<CsrDailyReportTotals, "inboundCalls" | "outboundCalls" | "updateCsrCalls" | "mistakes" | "hu" | "mc">>;

export async function upsertCsrDailyReportTotals(reportDate: string, fields: CsrDailyReportTotalsFields): Promise<void> {
  const patch: Record<string, unknown> = { report_date: reportDate };
  if ("inboundCalls" in fields) patch.inbound_calls = fields.inboundCalls;
  if ("outboundCalls" in fields) patch.outbound_calls = fields.outboundCalls;
  if ("updateCsrCalls" in fields) patch.update_csr_calls = fields.updateCsrCalls;
  if ("mistakes" in fields) patch.mistakes = fields.mistakes;
  if ("hu" in fields) patch.hu = fields.hu;
  if ("mc" in fields) patch.mc = fields.mc;
  const { error } = await supabase.from("csr_daily_report_totals").upsert(patch, { onConflict: "company_id,report_date" });
  if (error) throw new Error(error.message);
}
