/**
 * ServicePower pulls on Data Migration (migration 0475):
 *  - sp_pull_log: every ticket a pull added (hourly auto-pull or the button).
 *  - companies.settings.spAutoPull: the hourly auto-pull's sources (off when none).
 */
import { supabase } from "./client";
import { readSpAutoPullSettings, type SpAutoPullSettings } from "@/lib/servicePowerAutoPullRules";

export interface SpPullLogRow {
  id: string;
  ticketNo: string;
  ticketId: string | null;
  source: string;
  callDate: string;
  branch: string;
  mode: "auto" | "manual";
  pulledByName: string;
  pulledAt: string;
}

const needs0475 = (msg: string) =>
  /sp_pull_log|set_company_sp_auto_pull/.test(msg) && /does not exist|schema cache|not find/i.test(msg)
    ? "This needs migration 0475 — run it in the Supabase SQL Editor first."
    : msg;

/** Tickets the pulls added for calls ServicePower received on this day (YYYY-MM-DD), oldest pull first. */
export async function getSpPullLogForCallDate(callDate: string): Promise<SpPullLogRow[]> {
  const { data, error } = await supabase
    .from("sp_pull_log")
    .select("id, ticket_no, ticket_id, source, call_date, branch, mode, pulled_by_name, pulled_at")
    .eq("call_date", callDate)
    .order("pulled_at", { ascending: true })
    .limit(2000);
  if (error) throw new Error(needs0475(error.message));
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    ticketNo: r.ticket_no ?? "",
    ticketId: r.ticket_id ?? null,
    source: r.source ?? "",
    callDate: r.call_date ?? "",
    branch: r.branch ?? "",
    mode: r.mode === "auto" ? "auto" : "manual",
    pulledByName: r.pulled_by_name ?? "",
    pulledAt: r.pulled_at ?? "",
  }));
}

/** The hourly auto-pull's settings for the signed-in company, or null when it's off. */
export async function getSpAutoPullSettings(): Promise<SpAutoPullSettings | null> {
  const { data, error } = await supabase.from("companies").select("settings").limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return readSpAutoPullSettings(data?.settings);
}

/** Admin / Super Admin: turn the auto-pull on for these sources (none = off). */
export async function setSpAutoPullSettings(sources: string[], from?: string): Promise<void> {
  const { error } = await supabase.rpc("set_company_sp_auto_pull", { p_sources: sources, p_from: from || null });
  if (error) throw new Error(needs0475(error.message));
}
