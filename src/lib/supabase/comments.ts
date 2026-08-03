/**
 * Supabase ticket-comments service — the shared "Servicer Notes" thread.
 * Used by both the mobile tech app (Comment tab) and the web ticket detail
 * (General Information › Servicer Notes). Company-scoped via RLS.
 */

import { supabase } from "./client";

export interface TicketComment {
  id: string;
  body: string;
  authorName: string;
  authorRole: string;
  /** true = internal (AHS staff only), false = external (also visible to
   * ServicePower / claim portals). Defaults to true on legacy rows. */
  isInternal: boolean;
  createdAt: string;
}

function rowToComment(row: any): TicketComment {
  return {
    id: row.id,
    body: row.body ?? "",
    authorName: row.author_name ?? "",
    authorRole: row.author_role ?? "",
    isInternal: row.is_internal !== false,
    createdAt: row.created_at ?? "",
  };
}

async function getTicketId(ticketNo: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("tickets")
    .select("id")
    .eq("ticket_no", ticketNo)
    .maybeSingle();
  if (error) {
    console.error("comments getTicketId error:", error.message);
    throw new Error(error.message);
  }
  return data?.id ?? null;
}

/** Get the comment thread for a ticket (oldest first). */
export async function getTicketComments(ticketNo: string): Promise<TicketComment[]> {
  const ticketId = await getTicketId(ticketNo);
  if (!ticketId) return [];
  const { data, error } = await supabase
    .from("ticket_comments")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("getTicketComments error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []).map(rowToComment);
}

/** Add a comment to a ticket. company_id auto-stamped server-side. */
export async function addTicketComment(
  ticketNo: string,
  body: string,
  authorName: string,
  authorRole: string
): Promise<TicketComment> {
  const ticketId = await getTicketId(ticketNo);
  if (!ticketId) throw new Error(`Ticket ${ticketNo} not found`);
  const { data, error } = await supabase
    .from("ticket_comments")
    .insert({
      ticket_id: ticketId,
      body,
      author_name: authorName || null,
      author_role: authorRole || null,
    })
    .select("*")
    .single();
  if (error) {
    console.error("addTicketComment error:", error.message);
    throw new Error(error.message);
  }
  return rowToComment(data);
}
