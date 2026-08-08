/**
 * IT Tickets — any employee can submit one (My Profile's "Submit IT
 * Ticket" section); RLS (migration 0114) scopes who can see/edit what:
 *  - the original submitter always sees their own ticket (read-only)
 *  - Senior-tier managers see every company ticket (read-only)
 *  - IT/Admin/Superadmin see every ticket and can edit/assign/delete it
 * getItTickets() returns whatever the caller's own RLS visibility allows —
 * the same query serves "My Profile"'s own-tickets list, Senior
 * Managers' read-only view, and IT/Admin's full management view.
 */
import { supabase } from "./client";
import { createNotification } from "./notifications";
import { logModuleActivity } from "./moduleActivityLog";

export type ItTicketPriority = "low" | "normal" | "high" | "urgent";
export type ItTicketStatus = "open" | "in_progress" | "resolved" | "closed";

export interface ItTicketRow {
  id: string;
  companyId: string;
  createdBy: string;
  createdByName: string;
  subject: string;
  description: string;
  priority: ItTicketPriority;
  status: ItTicketStatus;
  assignedTo: string | null;
  assignedToName: string | null;
  resolutionNotes: string | null;
  /** Screenshot the submitter attached, if any — see migration 0149. */
  screenshotUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

const COLUMNS =
  "id, company_id, created_by, created_by_name, subject, description, priority, status, assigned_to, assigned_to_name, resolution_notes, screenshot_url, created_at, updated_at";

function mapRow(row: any): ItTicketRow {
  return {
    id: row.id,
    companyId: row.company_id,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    subject: row.subject,
    description: row.description,
    priority: row.priority,
    status: row.status,
    assignedTo: row.assigned_to,
    assignedToName: row.assigned_to_name,
    resolutionNotes: row.resolution_notes,
    screenshotUrl: row.screenshot_url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Every ticket the caller's RLS visibility allows — see this file's header comment. */
export async function getItTickets(): Promise<ItTicketRow[]> {
  const { data, error } = await supabase.from("it_tickets").select(COLUMNS).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

export async function createItTicket(input: { subject: string; description: string; priority: ItTicketPriority; createdByName: string; screenshotUrl?: string | null }): Promise<void> {
  const { error } = await supabase.from("it_tickets").insert({
    subject: input.subject,
    description: input.description,
    priority: input.priority,
    created_by_name: input.createdByName,
    screenshot_url: input.screenshotUrl || null,
  });
  if (error) throw new Error(error.message);
  void notifyItTicketSubmitted({ subject: input.subject, createdByName: input.createdByName });
  void logModuleActivity({
    module: "it-tickets",
    actorName: input.createdByName,
    action: "it_ticket_submitted",
    targetLabel: input.subject,
    details: { priority: input.priority },
  });
}

/** Roles that should be pinged about a newly submitted IT ticket — IT and
 * Admins only, not the Senior Manager tier (they're view-only on tickets). */
const IT_TICKET_NOTIFY_ROLE_CODES = new Set<string>(["IT", "ADMIN", "SUPERADMIN"]);

async function findItTicketNotifyRecipientIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, extra_roles")
    .eq("is_active", true);
  if (error) {
    console.warn("findItTicketNotifyRecipientIds error:", error.message);
    return [];
  }
  return (data ?? [])
    .filter((r: any) => {
      const roles = [r.role, ...(r.extra_roles ?? [])].map((v: unknown) => String(v ?? "").trim().toUpperCase());
      return roles.some((v) => IT_TICKET_NOTIFY_ROLE_CODES.has(v));
    })
    .map((r: any) => r.id as string);
}

/** Ping every IT/Admin/Superadmin user that a new ticket needs attention. Fire-and-forget — never throws. */
async function notifyItTicketSubmitted(ticket: { subject: string; createdByName: string }): Promise<void> {
  try {
    const recipientIds = await findItTicketNotifyRecipientIds();
    if (recipientIds.length === 0) return;
    const body = `🎫 New IT ticket from ${ticket.createdByName}: "${ticket.subject}"`;
    await Promise.all(
      recipientIds.map((id) =>
        createNotification({
          recipientId: id,
          senderId: null,
          senderName: ticket.createdByName,
          body,
          linkTo: "/m/admin/it-tickets",
        }).catch((err) => console.warn("notifyItTicketSubmitted: failed for recipient", id, err))
      )
    );
  } catch (err) {
    console.warn("notifyItTicketSubmitted skipped:", err);
  }
}

/** IT/Admin/Superadmin only — enforced server-side by the it_tickets_update RLS policy, not just this call site. */
export async function updateItTicket(
  id: string,
  fields: Partial<{ status: ItTicketStatus; priority: ItTicketPriority; assignedTo: string | null; assignedToName: string | null; resolutionNotes: string | null }>
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (fields.status !== undefined) payload.status = fields.status;
  if (fields.priority !== undefined) payload.priority = fields.priority;
  if (fields.assignedTo !== undefined) payload.assigned_to = fields.assignedTo;
  if (fields.assignedToName !== undefined) payload.assigned_to_name = fields.assignedToName;
  if (fields.resolutionNotes !== undefined) payload.resolution_notes = fields.resolutionNotes;
  const { error } = await supabase.from("it_tickets").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
}

/** IT/Admin/Superadmin only — enforced server-side by the it_tickets_delete RLS policy, not just this call site. */
export async function deleteItTicket(id: string): Promise<void> {
  const { error } = await supabase.from("it_tickets").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

const STATUS_UPDATE_MESSAGES: Record<ItTicketStatus, string> = {
  open: "reopened",
  in_progress: "now being worked on",
  resolved: "marked as resolved",
  closed: "closed",
};

/**
 * Bell notification to the original submitter when IT/Admin changes their
 * ticket's status — best-effort, callers should fire-and-forget this so a
 * notification failure never blocks the status update itself.
 */
export async function notifyTicketStatusChange(
  ticket: { id: string; createdBy: string; subject: string },
  newStatus: ItTicketStatus,
  updatedByName: string
): Promise<void> {
  await createNotification({
    recipientId: ticket.createdBy,
    senderId: null,
    senderName: updatedByName || "IT",
    body: `🎫 Your IT ticket "${ticket.subject}" was ${STATUS_UPDATE_MESSAGES[newStatus] ?? newStatus}.`,
    linkTo: "/it-tickets",
  });
}
