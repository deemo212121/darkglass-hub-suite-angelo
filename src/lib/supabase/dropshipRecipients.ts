/**
 * Recently-used Drop-Ship Request recipients (ticket.$ticketNo.tsx's Part
 * Transaction "Send"/"Send Selected") — one row per distinct recipient
 * email, company-wide (see migration 0172), so whoever sends to that
 * distributor next gets the Recipient/CC fields pre-filled instead of
 * retyping them.
 *
 * No company_id param here on purpose — useAuth()'s companyId is the
 * legacy Firebase-era company CODE (e.g. "COMP001"), not the Postgres
 * companies.id UUID this table's company_id column actually references
 * (see migration 0173). Scoping is entirely server-side instead: RLS
 * filters SELECT to the caller's own company, and a BEFORE INSERT
 * trigger stamps company_id from the authenticated session — same
 * idiom hr_activity_log already uses.
 */
import { supabase } from "./client";

export interface DropshipRecipient {
  toEmail: string;
  ccEmails: string[];
  lastUsedAt: string;
}

export async function getRecentDropshipRecipients(limit = 6): Promise<DropshipRecipient[]> {
  const { data, error } = await supabase
    .from("hr_dropship_recipients")
    .select("to_email, cc_emails, last_used_at")
    .order("last_used_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("Failed to load recent drop-ship recipients:", error);
    throw new Error(error.message);
  }
  return (data || []).map((row) => ({
    toEmail: row.to_email as string,
    ccEmails: (row.cc_emails as string[] | null) || [],
    lastUsedAt: row.last_used_at as string,
  }));
}

/** Never throws from the caller's point of view unless awaited — errors are logged either way. */
export async function recordDropshipRecipient(toEmail: string, ccEmails: string[]): Promise<void> {
  const trimmedTo = toEmail.trim().toLowerCase();
  if (!trimmedTo) return;
  const { error } = await supabase
    .from("hr_dropship_recipients")
    .upsert(
      { to_email: trimmedTo, cc_emails: ccEmails, last_used_at: new Date().toISOString() },
      { onConflict: "company_id,to_email" },
    );
  if (error) {
    console.error("Failed to save recent drop-ship recipient:", error);
    throw new Error(error.message);
  }
}
