/**
 * Password checks (migration 0441) — reads and writes. Only a Super Admin
 * can write (RLS); everyone in the company reads. The store and rules live
 * in ../passwordChecks.ts.
 */
import { supabase } from "./client";
import type { PasswordCheckFrequency, PasswordCheckSetting, PasswordCheckType } from "../passwordChecks";

export interface PasswordCheckEvent {
  id: string;
  key: string;
  label: string;
  action: "added" | "changed" | "removed" | "password_set" | "password_viewed";
  detail: string;
  actorName: string | null;
  createdAt: string;
}

const COLUMNS = "id, check_key, label, enabled, frequency, password_type, password_set_at, password_set_by_name, updated_by_name, updated_at";

export function mapPasswordCheck(r: any): PasswordCheckSetting {
  return {
    id: r.id,
    key: r.check_key,
    label: r.label ?? "",
    enabled: r.enabled !== false,
    frequency: r.frequency === "once_per_session" ? "once_per_session" : "every_time",
    passwordType: r.password_type === "set" ? "set" : "own",
    passwordSetAt: r.password_set_at ?? null,
    passwordSetByName: r.password_set_by_name ?? null,
    updatedByName: r.updated_by_name ?? null,
    updatedAt: r.updated_at ?? null,
  };
}

export async function getPasswordChecks(): Promise<PasswordCheckSetting[]> {
  const { data, error } = await supabase.from("password_checks").select(COLUMNS).order("label");
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapPasswordCheck);
}

export async function getPasswordCheckEvents(): Promise<PasswordCheckEvent[]> {
  const { data, error } = await supabase
    .from("password_check_events")
    .select("id, check_key, label, action, detail, actor_name, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    key: r.check_key,
    label: r.label ?? "",
    action: r.action,
    detail: r.detail ?? "",
    actorName: r.actor_name ?? null,
    createdAt: r.created_at,
  }));
}

/** Adds the setting, or changes the saved one (pass its id). */
export async function savePasswordCheck(
  input: { key: string; label: string; enabled: boolean; frequency: PasswordCheckFrequency; passwordType: PasswordCheckType },
  existingId?: string,
): Promise<PasswordCheckSetting> {
  const fields = { label: input.label, enabled: input.enabled, frequency: input.frequency, password_type: input.passwordType };
  const q = existingId
    ? supabase.from("password_checks").update(fields).eq("id", existingId)
    : supabase.from("password_checks").insert({ check_key: input.key, ...fields });
  const { data, error } = await q.select(COLUMNS).single();
  if (error) throw new Error(error.message);
  return mapPasswordCheck(data);
}

export async function removePasswordCheck(id: string): Promise<void> {
  const { error } = await supabase.from("password_checks").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Super Admin: set (or change) the check's own password — it switches the check to that password. Only a hash is kept. */
export async function setPasswordCheckPassword(key: string, label: string, password: string): Promise<void> {
  const { error } = await supabase.rpc("set_password_check_password", { p_key: key, p_label: label, p_password: password });
  if (error) throw new Error(error.message);
}

/** Is this the check's set password? (10 wrong tries in 15 minutes locks it for that person.) */
export async function verifyPasswordCheck(key: string, password: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("verify_password_check", { p_key: key, p_password: password });
  if (error) throw new Error(error.message);
  return data === true;
}

/** Super Admin: the check's set password (migration 0442). Recorded as "Password shown". */
export async function revealPasswordCheckPassword(key: string): Promise<string> {
  const { data, error } = await supabase.rpc("reveal_password_check_password", { p_key: key });
  if (error) {
    if (/reveal_password_check_password|schema cache|does not exist/i.test(error.message)) throw new Error("Show password needs migration 0442_password_check_show_password.sql — run it in Supabase.");
    throw new Error(error.message);
  }
  return String(data ?? "");
}
