/**
 * "Connect Gmail" for Payroll — one connection PER REGION (US/PH each get
 * their own connected Gmail account, matching AccountingDashboard.tsx's
 * US/PH Payroll toggle). Status/disconnect go through Supabase RPCs (see
 * migration 0113_hr_gmail_connections.sql), same pattern as
 * customForms.ts's Google Drive connection wrappers. The actual connect
 * flow and payslip send both go through src/lib/server/gmailBridge.ts
 * instead (a real OAuth redirect, and a privileged send action — neither
 * fits a plain Supabase RPC).
 */
import { supabase } from "./client";
import { auth as firebaseAuth } from "@/lib/firebase/config";

export type GmailRegion = "US" | "PH";

export interface GmailConnectionStatus {
  connected: boolean;
  /** Whoever clicked "Connect Gmail" (an AHS admin) — may differ from the account itself, e.g. an IT admin connecting a shared mailbox. */
  connectedByName: string | null;
  /** The connected Google account's own display name — what payslip recipients will actually see as the sender. */
  connectedAccountName: string | null;
  connectedEmail: string | null;
  connectedAt: string | null;
}

/** Never exposes the stored refresh_token itself — see get_gmail_connection_status() RPC. */
export async function getGmailConnectionStatus(region: GmailRegion): Promise<GmailConnectionStatus> {
  const { data, error } = await supabase.rpc("get_gmail_connection_status", { p_region: region });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as
    | { connected?: boolean; connected_by_name?: string | null; connected_account_name?: string | null; connected_email?: string | null; connected_at?: string | null }
    | null;
  return {
    connected: !!row?.connected,
    connectedByName: row?.connected_by_name ?? null,
    connectedAccountName: row?.connected_account_name ?? null,
    connectedEmail: row?.connected_email ?? null,
    connectedAt: row?.connected_at ?? null,
  };
}

/** Admin/Superadmin only — enforced server-side in the RPC, not just this call site. */
export async function disconnectGmail(region: GmailRegion): Promise<void> {
  const { error } = await supabase.rpc("disconnect_gmail", { p_region: region });
  if (error) throw error;
}

/**
 * Sends ONE employee's payslip for the given period — deliberately no
 * bulk/"send all" variant yet, so this can be tried on a single person
 * before any wider rollout (see gmailBridge.ts's header comment). Which
 * region's connection actually sends it is resolved server-side from the
 * employee's own record, not passed from here.
 *
 * pdfBase64 (no data: prefix, just the raw base64) is optional — when
 * provided, it's attached as a real PDF and the email is just a short
 * cover note; otherwise the server falls back to a plain-text summary.
 */
export async function sendPayslipEmail(params: {
  profileId: string;
  periodStart: string;
  periodEnd: string;
  hoursWorked: number;
  overtimeHours: number;
  hourlyRate: number;
  grossPay: number;
  pdfBase64?: string;
}): Promise<{ sentTo: string }> {
  const idToken = await firebaseAuth?.currentUser?.getIdToken(false);
  if (!idToken) throw new Error("You need to be logged in to send a payslip.");
  const res = await fetch("/api/gmail?action=send-payslip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, ...params }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; sentTo?: string; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error || "Failed to send payslip.");
  return { sentTo: body.sentTo || "" };
}
