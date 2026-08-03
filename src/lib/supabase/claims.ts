/**
 * Claims service — reads the `claims` and `claim_authorizations` tables
 * (defined in 0001_init.sql, company-scoped via RLS like everything else,
 * but never queried anywhere in the app until now — both are empty in a
 * fresh company).
 *
 * `claims.brand` and `claims.status` are free text with no DB-level
 * enumeration, so this layer doesn't assume a canonical vocabulary —
 * callers derive filter options from whatever values are actually present
 * in the data. `claim_authorizations.status` DOES have a real check
 * constraint ('requested' | 'pending' | 'approved' | 'denied'), so that
 * one is typed as a fixed union.
 */

import { supabase } from "./client";

export interface Claim {
  id: string;
  claimNo: string | null;
  ticketId: string | null;
  brand: string | null;
  status: string | null;
  amount: number | null;
  submittedAt: string | null;
  scheduledDate: string | null;
  createdBy: string | null;
  createdAt: string;
}

export type ClaimAuthorizationStatus = "requested" | "pending" | "approved" | "denied";

export interface ClaimAuthorization {
  id: string;
  authNo: string | null;
  claimId: string | null;
  ticketId: string | null;
  status: ClaimAuthorizationStatus;
  requestedAt: string | null;
  decidedAt: string | null;
  createdAt: string;
}

function fromClaimRow(r: any): Claim {
  return {
    id: r.id,
    claimNo: r.claim_no,
    ticketId: r.ticket_id,
    brand: r.brand,
    status: r.status,
    amount: r.amount === null ? null : Number(r.amount),
    submittedAt: r.submitted_at,
    scheduledDate: r.scheduled_date,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

function fromAuthRow(r: any): ClaimAuthorization {
  return {
    id: r.id,
    authNo: r.auth_no,
    claimId: r.claim_id,
    ticketId: r.ticket_id,
    status: r.status,
    requestedAt: r.requested_at,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
  };
}

export async function getCompanyClaims(filters?: { startDate?: string; endDate?: string }): Promise<Claim[]> {
  let query = supabase.from("claims").select("*").order("created_at", { ascending: false });
  if (filters?.startDate) query = query.gte("created_at", filters.startDate);
  if (filters?.endDate) query = query.lte("created_at", `${filters.endDate}T23:59:59`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromClaimRow);
}

export async function getCompanyClaimAuthorizations(filters?: { startDate?: string; endDate?: string }): Promise<ClaimAuthorization[]> {
  let query = supabase.from("claim_authorizations").select("*").order("created_at", { ascending: false });
  if (filters?.startDate) query = query.gte("created_at", filters.startDate);
  if (filters?.endDate) query = query.lte("created_at", `${filters.endDate}T23:59:59`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromAuthRow);
}

export async function addClaim(input: { claimNo?: string; brand?: string; status?: string; amount?: number; ticketId?: string }): Promise<void> {
  const { error } = await supabase.from("claims").insert({
    claim_no: input.claimNo?.trim() || null,
    brand: input.brand?.trim() || null,
    status: input.status?.trim() || null,
    amount: input.amount ?? null,
    ticket_id: input.ticketId || null,
    submitted_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}
