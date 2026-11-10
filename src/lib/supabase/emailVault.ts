/**
 * Admin → Email Vault (migration 0436): company email logins, the people
 * who use each mailbox, and who may open the page. Super Admin always has
 * access; everyone else only once a Super Admin adds them (email_vault_access).
 * All of that is enforced by RLS and the email_vault_* functions.
 *
 * Passwords never come down with the list — they sit in a table signed-in
 * users can't read. revealEmailVaultPassword reads one at a time and the
 * database records who viewed or copied it.
 */
import { supabase } from "./client";

export interface EmailVaultEntry {
  id: string;
  email: string;
  /** profiles.id of the people who use this mailbox. */
  people: string[];
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface EmailVaultAccessRow {
  profileId: string;
  grantedBy: string | null;
  grantedAt: string;
}

export type EmailVaultEventAction =
  | "added" | "edited" | "password_changed" | "deleted" | "viewed" | "copied" | "access_granted" | "access_removed";

export interface EmailVaultEvent {
  id: string;
  entryId: string | null;
  email: string | null;
  action: EmailVaultEventAction;
  detail: string | null;
  actorName: string | null;
  createdAt: string;
}

function vaultError(error: { message: string; code?: string }): Error {
  if (error.code === "PGRST202" || error.code === "PGRST205" || error.code === "42P01" || error.code === "42883") {
    return new Error("The Email Vault needs database migration 0436_email_vault.sql.");
  }
  if (error.code === "42501") return new Error("You don't have permission to do that — only a Super Admin can change who has access.");
  return new Error(error.message);
}

export async function getEmailVaultEntries(): Promise<EmailVaultEntry[]> {
  const { data, error } = await supabase
    .from("email_vault_entries")
    .select("id, email, people, created_by, created_at, updated_by, updated_at")
    .order("email", { ascending: true });
  if (error) throw vaultError(error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    email: r.email ?? "",
    people: r.people ?? [],
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedBy: r.updated_by ?? null,
    updatedAt: r.updated_at,
  }));
}

export async function addEmailVaultEntry(input: { email: string; password: string; people: string[] }): Promise<string> {
  const { data, error } = await supabase.rpc("email_vault_add", { p_email: input.email, p_password: input.password, p_people: input.people });
  if (error) throw vaultError(error);
  return data as string;
}

/** `password` undefined = keep the current one. */
export async function updateEmailVaultEntry(id: string, input: { email: string; people: string[]; password?: string }): Promise<void> {
  const { error } = await supabase.rpc("email_vault_update", {
    p_id: id,
    p_email: input.email,
    p_people: input.people,
    p_password: input.password ?? null,
  });
  if (error) throw vaultError(error);
}

export async function deleteEmailVaultEntry(id: string): Promise<void> {
  const { data, error } = await supabase.from("email_vault_entries").delete().eq("id", id).select("id");
  if (error) throw vaultError(error);
  if (!data || data.length === 0) throw new Error("That email couldn't be deleted — it may already be gone, or you no longer have access.");
}

/** One password; the database records the view (or the copy). */
export async function revealEmailVaultPassword(id: string, copy = false): Promise<string> {
  const { data, error } = await supabase.rpc("email_vault_reveal", { p_entry_id: id, p_copy: copy });
  if (error) throw vaultError(error);
  return (data as string) ?? "";
}

/** Whether the signed-in person may open the Email Vault (Super Admin, or added by one). */
export async function getMyEmailVaultAccess(): Promise<boolean> {
  const { data, error } = await supabase.rpc("email_vault_can_access");
  if (error) throw vaultError(error);
  return data === true;
}

/** People a Super Admin added — Super Admins themselves always have access and aren't listed here. */
export async function getEmailVaultAccess(): Promise<EmailVaultAccessRow[]> {
  const { data, error } = await supabase.from("email_vault_access").select("profile_id, granted_by, granted_at").order("granted_at", { ascending: true });
  if (error) throw vaultError(error);
  return (data ?? []).map((r: any) => ({ profileId: r.profile_id, grantedBy: r.granted_by ?? null, grantedAt: r.granted_at }));
}

/** Super Admin only (RLS). */
export async function grantEmailVaultAccess(profileId: string): Promise<void> {
  const { error } = await supabase.from("email_vault_access").insert({ profile_id: profileId });
  if (error) throw vaultError(error);
}

/** Super Admin only (RLS). */
export async function removeEmailVaultAccess(profileId: string): Promise<void> {
  const { data, error } = await supabase.from("email_vault_access").delete().eq("profile_id", profileId).select("profile_id");
  if (error) throw vaultError(error);
  if (!data || data.length === 0) throw new Error("Couldn't remove that person — only a Super Admin can change who has access.");
}

export async function getEmailVaultEvents(limit = 500): Promise<EmailVaultEvent[]> {
  const { data, error } = await supabase
    .from("email_vault_events")
    .select("id, entry_id, email, action, detail, actor_name, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw vaultError(error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    entryId: r.entry_id ?? null,
    email: r.email ?? null,
    action: r.action,
    detail: r.detail ?? null,
    actorName: r.actor_name ?? null,
    createdAt: r.created_at,
  }));
}
