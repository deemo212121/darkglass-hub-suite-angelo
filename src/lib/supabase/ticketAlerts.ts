/**
 * Ticket Alerts — real, cross-device alert messages for a ticket (backed by
 * `ticket_alerts`, migration 0001 + 0074). Replaces what used to be a
 * localStorage-only "Alert Message" feature on the desktop ticket page —
 * that never synced across browsers, let alone to a technician's phone.
 *
 * Two independent visibility flags per alert:
 *   showInternal — shows inline at the top of the desktop ticket page.
 *   mobilePopup  — pops up for a technician the moment they open this
 *                  ticket on the mobile app (see getUndismissedMobilePopupAlerts).
 *
 * Dismissals are tracked per (alert, technician) in ticket_alert_dismissals
 * (migration 0074) — same one-row-per-(profile, thing) pointer shape as
 * message_reads (Announcements/Messenger "read" tracking) — so a NEW alert,
 * or an alert a *different* tech hasn't seen yet, still pops up correctly.
 */

import { supabase } from "./client";

export interface TicketAlert {
  id: string;
  text: string;
  createdBy: string | null;
  createdAt: string;
  showInternal: boolean;
  mobilePopup: boolean;
}

function rowToAlert(row: any): TicketAlert {
  return {
    id: row.id,
    text: row.text ?? "",
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? "",
    showInternal: row.show_internal !== false,
    mobilePopup: row.mobile_popup === true,
  };
}

/** Get every alert for a ticket, newest first. */
export async function getTicketAlerts(ticketId: string): Promise<TicketAlert[]> {
  const { data, error } = await supabase
    .from("ticket_alerts")
    .select("id, text, created_by, created_at, show_internal, mobile_popup")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getTicketAlerts error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []).map(rowToAlert);
}

/** Add an alert to a ticket. company_id auto-stamped server-side. */
export async function addTicketAlert(
  ticketId: string,
  fields: { text: string; showInternal: boolean; mobilePopup: boolean; createdBy?: string | null }
): Promise<TicketAlert> {
  const { data, error } = await supabase
    .from("ticket_alerts")
    .insert({
      ticket_id: ticketId,
      text: fields.text,
      show_internal: fields.showInternal,
      mobile_popup: fields.mobilePopup,
      created_by: fields.createdBy ?? null,
    })
    .select("id, text, created_by, created_at, show_internal, mobile_popup")
    .single();
  if (error) {
    console.error("addTicketAlert error:", error.message);
    throw new Error(error.message);
  }
  return rowToAlert(data);
}

export async function removeTicketAlert(alertId: string): Promise<void> {
  const { error } = await supabase.from("ticket_alerts").delete().eq("id", alertId);
  if (error) {
    console.error("removeTicketAlert error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * Mobile-popup alerts for this ticket that this technician hasn't dismissed
 * yet. Two plain queries diffed in JS (same shape getUnreadCounts in
 * messaging.ts already uses) rather than a subquery — the alert list for a
 * ticket is always small, so this stays cheap.
 */
export async function getUndismissedMobilePopupAlerts(
  ticketId: string,
  profileId: string
): Promise<TicketAlert[]> {
  const { data: alertRows, error: alertErr } = await supabase
    .from("ticket_alerts")
    .select("id, text, created_by, created_at, show_internal, mobile_popup")
    .eq("ticket_id", ticketId)
    .eq("mobile_popup", true)
    .order("created_at", { ascending: false });
  if (alertErr) {
    console.error("getUndismissedMobilePopupAlerts alerts error:", alertErr.message);
    throw new Error(alertErr.message);
  }
  const alerts = (alertRows ?? []).map(rowToAlert);
  if (alerts.length === 0) return [];

  const { data: dismissedRows, error: dismissErr } = await supabase
    .from("ticket_alert_dismissals")
    .select("alert_id")
    .eq("profile_id", profileId)
    .in("alert_id", alerts.map((a) => a.id));
  if (dismissErr) {
    console.error("getUndismissedMobilePopupAlerts dismissals error:", dismissErr.message);
    throw new Error(dismissErr.message);
  }
  const dismissed = new Set((dismissedRows ?? []).map((r: any) => r.alert_id as string));
  return alerts.filter((a) => !dismissed.has(a.id));
}

/** Mark an alert as dismissed (seen) by this technician. */
export async function dismissTicketAlert(alertId: string, profileId: string): Promise<void> {
  const { error } = await supabase
    .from("ticket_alert_dismissals")
    .upsert(
      { alert_id: alertId, profile_id: profileId },
      { onConflict: "alert_id,profile_id" }
    );
  if (error) {
    console.error("dismissTicketAlert error:", error.message);
    throw new Error(error.message);
  }
}
