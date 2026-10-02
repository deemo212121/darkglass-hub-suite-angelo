/**
 * Company clock-in code (migration 0344). The company has ONE 4-digit code
 * per day (Central-time date). Technicians, Branch Managers, Senior Branch
 * Managers and Technical (Assistant) Directors type it to Time In
 * (ClockInCodePrompt); a Parts Manager can type it on Part Daily Pickup to
 * clock in a technician (ClockInCodeModal). HR sees it, and who used it, in
 * HR → Clock-In Codes. Making, regenerating and checking all run in the
 * database.
 */
import { supabase } from "./client";

export interface CompanyClockInCode {
  code: string;
  day: string;
  createdAt: string;
}

/** Today's code, made if there isn't one yet. HR / Admin / SuperAdmin only. */
export async function ensureCompanyClockInCode(): Promise<CompanyClockInCode> {
  const { data, error } = await supabase.rpc("ensure_company_clock_in_code");
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("No code returned.");
  return { code: row.out_code, day: String(row.out_date), createdAt: row.out_created_at };
}

/** New code for today — the old one stops working. Returns the new code. */
export async function regenerateCompanyClockInCode(): Promise<string> {
  const { data, error } = await supabase.rpc("regenerate_company_clock_in_code");
  if (error) throw new Error(error.message);
  return String(data);
}

export type RedeemClockInCodeResult = "ok" | "wrong" | "locked" | "no_code" | "not_allowed" | "not_signed_in";

export const REDEEM_MESSAGE: Record<Exclude<RedeemClockInCodeResult, "ok">, string> = {
  wrong: "That code isn't right. Check today's code with HR and try again.",
  locked: "Too many wrong tries. Ask HR for a new code.",
  no_code: "Today's code hasn't been shared yet. Ask HR for today's clock-in code.",
  not_allowed: "You can't clock in this person — they're not at your branch.",
  not_signed_in: "You're not signed in.",
};

/**
 * Does the signed-in user need today's code to Time In? (Technician-level,
 * Branch Manager, Senior Branch Manager, Technical / Technical Assistant
 * Director.) If the check can't run because the migration isn't applied
 * yet, answers false so clock-in keeps working; any other failure (e.g. no
 * connection) is thrown.
 */
export async function isClockInCodeRequired(): Promise<boolean> {
  const { data, error } = await supabase.rpc("clock_in_code_required");
  if (error) {
    if (/clock_in_code_required|does not exist|PGRST202/i.test(error.message + ((error as { code?: string }).code ?? ""))) return false;
    throw new Error(error.message);
  }
  return data === true;
}

/** Check today's code for `profileId`'s Time In (your own, or someone you may clock in). */
export async function redeemClockInCode(profileId: string, code: string): Promise<RedeemClockInCodeResult> {
  const { data, error } = await supabase.rpc("redeem_clock_in_code", { p_target: profileId, p_code: code });
  if (error) throw new Error(error.message);
  return data as RedeemClockInCodeResult;
}

/** Roles that can always see the code (and edit who else can) — not editable. */
export const CLOCK_CODE_ALWAYS_VIEWERS = ["HR", "ADMIN", "SUPERADMIN"] as const;
const DEFAULT_VIEWER_ROLES = ["BRANCH_MANAGER", "SENIOR_BRANCH_MANAGER", "TECHNICAL_DIRECTOR", "TECHNICAL_ASSISTANT_DIRECTOR"];

/** The company's extra roles that can see the code (migration 0347; default before it's run). */
export async function getClockCodeViewerRoles(): Promise<string[]> {
  const { data, error } = await supabase.rpc("get_clock_code_viewer_roles");
  if (error) {
    if (/get_clock_code_viewer_roles|does not exist|PGRST202/i.test(error.message + ((error as { code?: string }).code ?? ""))) return DEFAULT_VIEWER_ROLES;
    throw new Error(error.message);
  }
  return (data as string[] | null) ?? DEFAULT_VIEWER_ROLES;
}

/** Save which roles (besides HR / Admin / SuperAdmin) can see the code. HR / Admin / SuperAdmin only. */
export async function setClockCodeViewerRoles(roles: string[]): Promise<void> {
  const { error } = await supabase.rpc("set_clock_code_viewer_roles", { p_roles: roles });
  if (error) throw new Error(error.message);
}

export interface ClockInCodeEvent {
  id: string;
  profileId: string;
  enteredBy: string | null;
  success: boolean;
  createdAt: string;
}

/** Every code entry for a day, newest first (HR / Admin / SuperAdmin only — RLS). */
export async function getClockInCodeEvents(day: string): Promise<ClockInCodeEvent[]> {
  const { data, error } = await supabase
    .from("clock_in_code_events")
    .select("id, profile_id, entered_by, success, created_at")
    .eq("valid_date", day)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ id: r.id, profileId: r.profile_id, enteredBy: r.entered_by, success: !!r.success, createdAt: r.created_at }));
}
