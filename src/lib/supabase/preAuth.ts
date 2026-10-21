/**
 * Pre-Auth (ServicePower Request for Authorization / Call Auth) drafts —
 * one per ticket, saved by Claims / Parts / BizOps (migration 0402).
 */
import { supabase } from "./client";

export type YesNo = "Y" | "N" | "";
export type PreAuthStatus = "Draft" | "Ready" | "Sent";

export interface PreAuthPart {
  quantity: string;
  partNumber: string;
  description: string;
  price: string;
}

/** The form, laid out like ServicePower's Call Auth screen. */
export interface PreAuthForm {
  repairDescription: string;
  whyHigherRate: string;
  jobCode: string;
  estHours: string;
  estMinutes: string;
  productRepaired: YesNo;
  partsInWarranty: YesNo;
  laborInWarranty: YesNo;
  oemAuthorized: YesNo;
  additionalMan: YesNo;
  newBrand: string;
  labor: string;
  parts: PreAuthPart[];
  miles: string;
  ratePerMile: string;
  travel: string;
  other: string;
}

export interface PreAuthRequest {
  id: string;
  ticketNo: string;
  status: PreAuthStatus;
  form: PreAuthForm;
  total: number;
  /** Who is handling it (picked on the form). */
  managedByName: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  sentAt: string | null;
  updatedAt: string;
}

export const emptyPreAuthForm = (): PreAuthForm => ({
  repairDescription: "",
  whyHigherRate: "",
  jobCode: "",
  estHours: "",
  estMinutes: "",
  productRepaired: "",
  partsInWarranty: "",
  laborInWarranty: "",
  oemAuthorized: "",
  additionalMan: "",
  newBrand: "",
  labor: "",
  parts: [],
  miles: "",
  ratePerMile: "",
  travel: "",
  other: "",
});

const num = (v: string) => {
  const n = Number(String(v ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Labor + parts (qty × price) + mileage (miles × rate) + travel + other. */
export function preAuthTotals(f: PreAuthForm) {
  const parts = f.parts.reduce((s, p) => s + (num(p.quantity) || 0) * num(p.price), 0);
  const mileage = num(f.miles) * num(f.ratePerMile);
  const labor = num(f.labor);
  const travel = num(f.travel);
  const other = num(f.other);
  return { labor, parts, mileage, travel, other, total: labor + parts + mileage + travel + other };
}

/** What's still missing from the fields ServicePower marks required (✱). */
export function preAuthMissing(f: PreAuthForm): string[] {
  const missing: string[] = [];
  if (!f.repairDescription.trim()) missing.push("Repair Description");
  if (!f.jobCode.trim()) missing.push("Job Code");
  if (!f.estHours.trim() && !f.estMinutes.trim()) missing.push("Estimated time on the job");
  if (!f.productRepaired) missing.push("Is the product repaired?");
  if (!f.partsInWarranty) missing.push("Are the parts in warranty?");
  if (!f.laborInWarranty) missing.push("Is the labor in warranty?");
  if (!f.additionalMan) missing.push("Will there be an additional man on the job?");
  if (!f.newBrand.trim()) missing.push("New Brand");
  f.parts.forEach((p, i) => {
    if ((p.partNumber.trim() || p.description.trim()) && (!p.partNumber.trim() || !num(p.quantity))) missing.push(`Part line ${i + 1}: part # and quantity`);
  });
  return missing;
}

function mapRow(row: any): PreAuthRequest {
  return {
    id: row.id,
    ticketNo: row.ticket_no,
    status: row.status,
    form: { ...emptyPreAuthForm(), ...(row.form ?? {}) },
    total: Number(row.total) || 0,
    managedByName: row.managed_by_name ?? null,
    createdByName: row.created_by_name ?? null,
    updatedByName: row.updated_by_name ?? null,
    sentAt: row.sent_at ?? null,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = "id, ticket_no, status, form, total, managed_by_name, created_by_name, updated_by_name, sent_at, updated_at";

const migrationError = (msg: string) =>
  /pre_auth_requests/.test(msg) ? "Pre-Auth needs migration 0402 — run it in the Supabase SQL Editor first." : msg;

/** Every saved Pre-Auth for the company, keyed by ticket number. */
export async function getPreAuthRequests(): Promise<Map<string, PreAuthRequest>> {
  const out = new Map<string, PreAuthRequest>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("pre_auth_requests").select(COLUMNS).order("updated_at", { ascending: false }).range(from, from + 999);
    if (error) throw new Error(migrationError(error.message));
    for (const r of data ?? []) out.set(r.ticket_no, mapRow(r));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Save (create or update) a ticket's Pre-Auth draft. */
export async function savePreAuthRequest(input: { ticketNo: string; status: PreAuthStatus; form: PreAuthForm; managedByName: string | null; byName: string | null; isNew: boolean }): Promise<PreAuthRequest> {
  const row: Record<string, unknown> = {
    ticket_no: input.ticketNo,
    status: input.status,
    form: input.form,
    total: Math.round(preAuthTotals(input.form).total * 100) / 100,
    managed_by_name: input.managedByName || null,
    updated_by_name: input.byName,
  };
  if (input.isNew) row.created_by_name = input.byName;
  const { data, error } = await supabase.from("pre_auth_requests").upsert(row, { onConflict: "company_id,ticket_no" }).select(COLUMNS).single();
  if (error) throw new Error(migrationError(error.message));
  return mapRow(data);
}

/**
 * Whether this company may send Pre-Auths to ServicePower
 * (companies.settings.spPreAuthSubmitEnabled). Off unless a SuperAdmin turns
 * it on in Admin → Company Settings. `companyCode` is the app's company id
 * (companies.legacy_code).
 */
export async function isPreAuthSubmitEnabled(companyCode: string | null): Promise<boolean> {
  if (!companyCode) return false;
  const { data, error } = await supabase.from("companies").select("settings").eq("legacy_code", companyCode).maybeSingle();
  if (error) return false;
  return (data as any)?.settings?.spPreAuthSubmitEnabled === true;
}

/** Company Settings switch (SuperAdmin) — keeps every other setting as it is. */
export async function setPreAuthSubmitEnabled(companyCode: string, enabled: boolean): Promise<void> {
  const { data, error } = await supabase.from("companies").select("id, settings").eq("legacy_code", companyCode).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Company not found.");
  const settings = { ...(((data as any).settings ?? {}) as Record<string, unknown>), spPreAuthSubmitEnabled: enabled };
  const { data: updated, error: upErr } = await supabase.from("companies").update({ settings }).eq("id", (data as any).id).select("id");
  if (upErr) throw new Error(upErr.message);
  if (!updated?.length) throw new Error("Not allowed — only the company SuperAdmin can change this.");
}

/** Records a send that ServicePower accepted (only reachable once sending is switched on). */
export async function markPreAuthSent(ticketNo: string, response: unknown): Promise<void> {
  const { error } = await supabase
    .from("pre_auth_requests")
    .update({ status: "Sent", sent_at: new Date().toISOString(), sp_response: response })
    .eq("ticket_no", ticketNo);
  if (error) throw new Error(migrationError(error.message));
}
