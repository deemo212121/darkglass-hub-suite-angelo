/**
 * Supabase service for Account Management (external vendor accounts used
 * for parts ordering / technician mapping / claims APIs — American Home
 * Shield, ServicePower, Encompass, Marcone, etc).
 *
 * Replaces the previous window.localStorage-only storage: company-scoped,
 * RLS-restricted to this company's Admin/SuperAdmin (see migration 0174 —
 * these rows hold vendor login credentials, not general company data).
 * src/lib/server/servicePowerBridge.ts reads the "Service Power Account"
 * row server-side (service-role) to resolve live API credentials, so
 * saving a new password here takes effect immediately.
 */

import { supabase } from "./client";

export type ExternalServiceAccountRow = {
  id: string;
  type: string;
  accountNo: string;
  displayName: string;
  accountId: string;
  password: string;
  refNo1: string;
  defaultPartDist: string;
  sync: string;
};

function fromDb(r: any): ExternalServiceAccountRow {
  return {
    id: r.id,
    type: r.type ?? "",
    accountNo: r.account_no ?? "",
    displayName: r.display_name ?? "",
    accountId: r.account_id ?? "",
    password: r.password ?? "",
    refNo1: r.ref_no_1 ?? "",
    defaultPartDist: r.default_part_dist ?? "",
    sync: r.sync ?? "",
  };
}

function toDb(row: ExternalServiceAccountRow): Record<string, unknown> {
  return {
    type: row.type,
    account_no: row.accountNo,
    display_name: row.displayName,
    account_id: row.accountId,
    password: row.password,
    ref_no_1: row.refNo1,
    default_part_dist: row.defaultPartDist,
    sync: row.sync,
  };
}

export async function getExternalServiceAccounts(): Promise<ExternalServiceAccountRow[]> {
  const { data, error } = await supabase
    .from("external_service_accounts")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("getExternalServiceAccounts error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []).map(fromDb);
}

/** Insert (no uuid id) or update (uuid id) a row; returns the saved row. */
export async function upsertExternalServiceAccount(row: ExternalServiceAccountRow): Promise<ExternalServiceAccountRow> {
  const payload = toDb(row);
  const isUuid = /^[0-9a-f-]{36}$/i.test(row.id);
  if (isUuid) {
    const { data, error } = await supabase
      .from("external_service_accounts")
      .update(payload)
      .eq("id", row.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return fromDb(data);
  }
  const { data, error } = await supabase
    .from("external_service_accounts")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return fromDb(data);
}

export async function deleteExternalServiceAccount(id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return; // not yet persisted
  const { error } = await supabase.from("external_service_accounts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
