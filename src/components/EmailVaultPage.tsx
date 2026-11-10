/**
 * Admin → Email Vault — company email logins: the address, its password,
 * and the people who use that mailbox (migration 0436).
 *
 * Who can open it: Super Admin always; anyone else only once a Super Admin
 * adds them under Manage Access (by person, not by role). Everyone with
 * access can add, edit and delete emails; only a Super Admin changes who has
 * access. Passwords aren't part of the list — each one is fetched when
 * someone clicks Show or Copy, and the database records that on the History
 * tab along with every add / edit / delete and access change. All of this
 * is enforced by RLS and the email_vault_* functions too — this page only
 * mirrors it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Check, ChevronLeft, Copy, Eye, EyeOff, History, KeyRound, Mail, Pencil, Plus, Trash2, UserPlus, Users, X } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { useSmartBack } from "@/hooks/useSmartBack";
import { AppModal } from "@/components/ui-kit/AppModal";
import { EmptyState } from "@/components/ui-kit/EmptyState";
import { TableSkeleton } from "@/components/ui-kit/TableSkeleton";
import { isEmailVaultSuperAdmin } from "@/lib/submoduleAccess";
import { hydrateEmailVaultGrant } from "@/lib/moduleAccess";
import { getCompanyUsers, getMyProfileId, type ProfileRow } from "@/lib/supabase/users";
import {
  getEmailVaultEntries,
  addEmailVaultEntry,
  updateEmailVaultEntry,
  deleteEmailVaultEntry,
  revealEmailVaultPassword,
  getEmailVaultAccess,
  grantEmailVaultAccess,
  removeEmailVaultAccess,
  setEmailVaultPasswordAccess,
  getMyEmailVaultPasswordAccess,
  getEmailVaultEvents,
  type EmailVaultEntry,
  type EmailVaultAccessRow,
  type EmailVaultEvent,
} from "@/lib/supabase/emailVault";

type Props = { mod: ModuleDef; sub: SubModuleDef };

/** A shown password hides itself again after this long. */
const REVEAL_MS = 30_000;

const EVENT_LABEL: Record<EmailVaultEvent["action"], string> = {
  added: "Added",
  edited: "Edited",
  password_changed: "Changed password",
  deleted: "Deleted",
  viewed: "Viewed password",
  copied: "Copied password",
  access_granted: "Gave access",
  access_removed: "Removed access",
  access_changed: "Changed access",
};

function nameOf(u: ProfileRow | undefined): string {
  return u ? u.display_name || u.email || u.username || "Unknown" : "Unknown";
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** navigator.clipboard only exists on https / localhost — fall back for the LAN dev address. */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(el);
  if (!ok) throw new Error("Your browser blocked copying — use Show and copy it by hand.");
}

/** Searchable checklist of company accounts, by profile id. */
function PeoplePicker({ users, value, onChange, exclude }: { users: ProfileRow[]; value: string[]; onChange: (next: string[]) => void; exclude?: Set<string> }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users
      .filter((u) => !exclude?.has(u.id))
      .filter((u) => !needle || nameOf(u).toLowerCase().includes(needle) || (u.email || "").toLowerCase().includes(needle));
  }, [users, q, exclude]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="rounded-md border border-[var(--color-panel-border)]">
      <input className="glass-input text-sm w-full rounded-b-none border-0 border-b border-[var(--color-panel-border)]" placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="max-h-56 overflow-y-auto py-1">
        {shown.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">No one matches.</p>
        ) : (
          shown.map((u) => {
            const checked = value.includes(u.id);
            return (
              <button key={u.id} type="button" onClick={() => toggle(u.id)} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-white/10">
                <span className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${checked ? "bg-primary border-primary" : "border-white/30"}`}>
                  {checked && <Check className="h-3 w-3 text-white" />}
                </span>
                <span className="flex-1 truncate">{nameOf(u)}</span>
                <span className="text-[10px] text-muted-foreground uppercase shrink-0">{u.role}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export function EmailVaultPage({ mod, sub }: Props) {
  const { uid, role, extraRoles } = useAuth();
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const isSuperAdmin = isEmailVaultSuperAdmin(role, extraRoles);

  const [myId, setMyId] = useState<string | null>(null);
  const [entries, setEntries] = useState<EmailVaultEntry[]>([]);
  const [access, setAccess] = useState<EmailVaultAccessRow[]>([]);
  const [events, setEvents] = useState<EmailVaultEvent[]>([]);
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<"emails" | "history">("emails");
  const [search, setSearch] = useState("");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<string | null>(null);

  const [editing, setEditing] = useState<EmailVaultEntry | "new" | null>(null);
  const [form, setForm] = useState({ email: "", password: "", people: [] as string[] });
  const [showFormPassword, setShowFormPassword] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<EmailVaultEntry | null>(null);
  const [managingAccess, setManagingAccess] = useState(false);
  const [grantPick, setGrantPick] = useState<string[]>([]);
  /** Level for people added in Manage access. */
  const [grantWithPassword, setGrantWithPassword] = useState(false);
  /** Can I show / copy / set passwords? (Email and password, or Super Admin.) */
  const [canSeePasswords, setCanSeePasswords] = useState(false);
  const [busy, setBusy] = useState(false);

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const activeUsers = useMemo(() => users.filter((u) => u.is_active).sort((a, b) => nameOf(a).localeCompare(nameOf(b))), [users]);
  const superAdmins = useMemo(() => activeUsers.filter((u) => isEmailVaultSuperAdmin(u.role, u.extra_roles)), [activeUsers]);

  const refreshEvents = useCallback(() => {
    void getEmailVaultEvents().then(setEvents, (e) => console.error("Email Vault history:", e));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, acc, ev, userRows, pid, seePasswords] = await Promise.all([
        getEmailVaultEntries(),
        getEmailVaultAccess(),
        getEmailVaultEvents(),
        getCompanyUsers(),
        uid ? getMyProfileId(uid) : Promise.resolve(null),
        getMyEmailVaultPasswordAccess().catch(() => false),
      ]);
      setCanSeePasswords(seePasswords);
      setEntries(rows);
      setAccess(acc);
      setEvents(ev);
      setUsers(userRows);
      setMyId(pid);
    } catch (e: any) {
      setError(e?.message || "Couldn't load the Email Vault.");
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((e) => e.email.toLowerCase().includes(needle) || e.people.some((id) => nameOf(userById.get(id)).toLowerCase().includes(needle)));
  }, [entries, search, userById]);

  const hidePassword = (id: string) => setRevealed((r) => { const next = { ...r }; delete next[id]; return next; });

  const showPassword = async (entry: EmailVaultEntry) => {
    if (revealed[entry.id] !== undefined) { hidePassword(entry.id); return; }
    setRevealing(entry.id);
    try {
      const password = await revealEmailVaultPassword(entry.id);
      setRevealed((r) => ({ ...r, [entry.id]: password }));
      setTimeout(() => hidePassword(entry.id), REVEAL_MS);
      refreshEvents();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't show the password.");
    } finally {
      setRevealing(null);
    }
  };

  const copyPassword = async (entry: EmailVaultEntry) => {
    setRevealing(entry.id);
    try {
      const password = await revealEmailVaultPassword(entry.id, true);
      if (!password) { toast.error("No password saved for this email."); return; }
      await copyText(password);
      toast.success(`Password for ${entry.email} copied.`);
      refreshEvents();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't copy the password.");
    } finally {
      setRevealing(null);
    }
  };

  const openForm = (entry: EmailVaultEntry | "new") => {
    setEditing(entry);
    setForm(entry === "new" ? { email: "", password: "", people: [] } : { email: entry.email, password: "", people: entry.people });
    setShowFormPassword(false);
  };

  const saveForm = async () => {
    if (!editing) return;
    const email = form.email.trim();
    if (!email) { toast.error("Enter the email address."); return; }
    if (editing === "new" && canSeePasswords && !form.password) { toast.error("Enter the password."); return; }
    setBusy(true);
    try {
      if (editing === "new") {
        await addEmailVaultEntry({ email, password: canSeePasswords ? form.password : "", people: form.people });
        toast.success(`${email} added.`);
      } else {
        await updateEmailVaultEntry(editing.id, { email, people: form.people, password: canSeePasswords && form.password ? form.password : undefined });
        hidePassword(editing.id);
        toast.success(`${email} saved.`);
      }
      setEditing(null);
      setEntries(await getEmailVaultEntries());
      refreshEvents();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  const runDelete = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await deleteEmailVaultEntry(confirmDelete.id);
      toast.success(`${confirmDelete.email} deleted.`);
      setEntries((rows) => rows.filter((r) => r.id !== confirmDelete.id));
      setConfirmDelete(null);
      refreshEvents();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't delete.");
    } finally {
      setBusy(false);
    }
  };

  const grantedIds = useMemo(() => new Set(access.map((a) => a.profileId)), [access]);
  const notGrantable = useMemo(() => new Set([...grantedIds, ...superAdmins.map((u) => u.id)]), [grantedIds, superAdmins]);

  const addAccess = async () => {
    if (grantPick.length === 0) return;
    setBusy(true);
    try {
      for (const id of grantPick) await grantEmailVaultAccess(id, grantWithPassword);
      toast.success(`Gave ${grantPick.map((id) => nameOf(userById.get(id))).join(", ")} ${grantWithPassword ? "email and password" : "email only"} access.`);
      setGrantPick([]);
      setAccess(await getEmailVaultAccess());
      refreshEvents();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't give access.");
      setAccess(await getEmailVaultAccess().catch(() => access));
    } finally {
      setBusy(false);
    }
  };

  const changeLevel = async (profileId: string, canSeePassword: boolean) => {
    setBusy(true);
    try {
      await setEmailVaultPasswordAccess(profileId, canSeePassword);
      toast.success(`${nameOf(userById.get(profileId))} can now see ${canSeePassword ? "emails and passwords" : "emails only"}.`);
      setAccess((rows) => rows.map((r) => (r.profileId === profileId ? { ...r, canSeePassword } : r)));
      refreshEvents();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't change their access.");
    } finally {
      setBusy(false);
    }
  };

  const removeAccess = async (profileId: string) => {
    setBusy(true);
    try {
      await removeEmailVaultAccess(profileId);
      toast.success(`Removed ${nameOf(userById.get(profileId))}'s access.`);
      setAccess((rows) => rows.filter((r) => r.profileId !== profileId));
      // A Super Admin who also had a grant keeps access through their role.
      if (profileId === myId && !isSuperAdmin) hydrateEmailVaultGrant(false);
      refreshEvents();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't remove access.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-6">
          <button type="button" onClick={goBack} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" /> {mod.label}
          </button>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-display font-bold tracking-tight mb-2">{sub.title}</h1>
            <p className="text-lg text-muted-foreground">
              Company email logins and who uses each one. Passwords stay hidden — every Show and Copy is recorded on the History tab.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isSuperAdmin && (
              <button type="button" onClick={() => setManagingAccess(true)} className="btn hover:bg-white/15">
                <Users className="h-4 w-4" /> Manage Access
              </button>
            )}
            <button type="button" onClick={() => openForm("new")} className="btn btn-primary">
              <Plus className="h-4 w-4" /> Add Email
            </button>
          </div>
        </div>
      </div>

      {error && <div className="panel mb-4 border-red-500/30 bg-red-500/5 text-sm text-red-300 px-4 py-3">{error}</div>}

      <div className="flex flex-wrap items-center gap-1 mb-3">
        {(["emails", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`text-sm px-3 py-1.5 rounded-md border transition ${tab === t ? "bg-blue-600 text-white border-blue-600" : "border-[var(--color-panel-border)] text-muted-foreground hover:text-foreground"}`}
          >
            {t === "emails" ? `Emails (${entries.length})` : "History"}
          </button>
        ))}
      </div>

      {tab === "emails" && (
        <div className="panel p-3 mb-3">
          <input className="glass-input text-sm w-full sm:max-w-sm" placeholder="Search email or person…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}

      <div className="panel p-0 overflow-x-auto">
        {loading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : tab === "history" ? (
          events.length === 0 ? (
            <EmptyState icon={<History />} title="No activity yet" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground border-b border-[var(--color-panel-border)]">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">By</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id} className="border-b border-[var(--color-panel-border)]/60">
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(ev.createdAt)}</td>
                    <td className={`px-3 py-2 font-medium ${ev.action === "deleted" || ev.action === "access_removed" ? "text-red-300" : ev.action === "viewed" || ev.action === "copied" ? "text-amber-300" : ""}`}>{EVENT_LABEL[ev.action] ?? ev.action}</td>
                    <td className="px-3 py-2">{ev.actorName || "—"}</td>
                    <td className="px-3 py-2">{ev.email || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{ev.detail || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Mail />}
            title={entries.length === 0 ? "No emails yet" : "No emails match"}
            hint={entries.length === 0 ? "Add the first email login with Add Email." : undefined}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground border-b border-[var(--color-panel-border)]">
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Password</th>
                <th className="px-3 py-2">People with access</th>
                <th className="px-3 py-2">Last updated</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => {
                const shown = revealed[entry.id];
                return (
                  <tr key={entry.id} className="border-b border-[var(--color-panel-border)]/60 align-top">
                    <td className="px-3 py-2 font-medium break-all">{entry.email}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs min-w-[7rem] break-all" title={canSeePasswords ? undefined : "You can see email addresses only — a Super Admin can give you password access."}>{shown !== undefined ? shown || "(none)" : "••••••••"}</span>
                        {canSeePasswords && (
                          <>
                            <button type="button" className="btn btn-sm hover:bg-white/15" title={shown !== undefined ? "Hide" : "Show"} disabled={revealing === entry.id} onClick={() => void showPassword(entry)}>
                              {shown !== undefined ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                            <button type="button" className="btn btn-sm hover:bg-white/15" title="Copy password" disabled={revealing === entry.id} onClick={() => void copyPassword(entry)}>
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {entry.people.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {entry.people.map((id) => (
                            <span key={id} className="rounded-full border border-[var(--color-panel-border)] bg-white/5 px-2 py-0.5 text-xs">{nameOf(userById.get(id))}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                      {fmtDateTime(entry.updatedAt)}
                      {entry.updatedBy && <div>by {nameOf(userById.get(entry.updatedBy))}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button type="button" className="btn btn-sm hover:bg-white/15" title="Edit" onClick={() => openForm(entry)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" className="btn btn-sm hover:bg-white/15 text-red-300" title="Delete" onClick={() => setConfirmDelete(entry)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <AppModal
          title={editing === "new" ? "Add Email" : "Edit Email"}
          icon={<KeyRound className="h-4 w-4" />}
          size="lg"
          busy={busy}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => void saveForm()} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            </>
          }
        >
          <div className="space-y-4">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</span>
              <input type="email" autoComplete="off" className="glass-input text-sm w-full mt-1" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="name@company.com" />
            </label>
            {!canSeePasswords ? (
              <p className="text-xs text-muted-foreground">You can see email addresses only, so the password is left for someone with password access to set.</p>
            ) : (
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Password</span>
              <div className="mt-1 flex gap-1.5">
                <input
                  type={showFormPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className="glass-input text-sm w-full font-mono"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder={editing === "new" ? "" : "Leave blank to keep the current password"}
                />
                <button type="button" className="btn hover:bg-white/15" title={showFormPassword ? "Hide" : "Show"} onClick={() => setShowFormPassword((s) => !s)}>
                  {showFormPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
            )}
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">People with access to this email</span>
              {form.people.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {form.people.map((id) => (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-panel-border)] bg-white/5 px-2 py-0.5 text-xs">
                      {nameOf(userById.get(id))}
                      <button type="button" title="Remove" onClick={() => setForm((f) => ({ ...f, people: f.people.filter((p) => p !== id) }))}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2">
                <PeoplePicker users={activeUsers} value={form.people} onChange={(people) => setForm((f) => ({ ...f, people }))} />
              </div>
            </div>
          </div>
        </AppModal>
      )}

      {confirmDelete && (
        <AppModal
          title="Delete this email?"
          description={`${confirmDelete.email} and its password will be removed from the vault. The History tab keeps a record.`}
          tone="warning"
          size="sm"
          busy={busy}
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirmDelete(null)} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-danger" onClick={() => void runDelete()} disabled={busy}>{busy ? "Deleting…" : "Delete"}</button>
            </>
          }
        />
      )}

      {managingAccess && isSuperAdmin && (
        <AppModal
          title="Who can open the Email Vault"
          description="Super Admins always can, and see passwords. Add anyone else as Email only or Email and password — they'll see Email Vault under Admin the next time they open the app."
          icon={<Users className="h-4 w-4" />}
          size="lg"
          busy={busy}
          onClose={() => { setManagingAccess(false); setGrantPick([]); }}
          footer={<button type="button" className="btn" onClick={() => { setManagingAccess(false); setGrantPick([]); }} disabled={busy}>Done</button>}
        >
          <div className="space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Always — Super Admin</p>
              <div className="flex flex-wrap gap-1">
                {superAdmins.map((u) => (
                  <span key={u.id} className="rounded-full border border-[var(--color-panel-border)] bg-white/5 px-2 py-0.5 text-xs">{nameOf(u)}</span>
                ))}
              </div>
            </div>
            {access.some((a) => a.canSeePassword === null) && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Email only / Email and password needs database migration 0439_email_vault_password_access.sql. Until then everyone below can see passwords.
              </p>
            )}
            {([
              { level: true, title: "Can see email and password", empty: "No one yet.", move: "Email only", moveTitle: "Keep their access, but hide passwords from them" },
              { level: false, title: "Can see email only", empty: "No one yet.", move: "Allow password", moveTitle: "Let them show and copy passwords too" },
            ] as const).map((group) => {
              const people = access.filter((a) => (a.canSeePassword ?? true) === group.level);
              return (
                <div key={String(group.level)}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{group.title} ({people.length})</p>
                  {people.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{group.empty}</p>
                  ) : (
                    <ul className="divide-y divide-[var(--color-panel-border)] rounded-md border border-[var(--color-panel-border)]">
                      {people.map((a) => (
                        <li key={a.profileId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                          <span className="flex-1 min-w-[10rem]">
                            {nameOf(userById.get(a.profileId))}
                            <span className="block text-xs text-muted-foreground">
                              Added {fmtDateTime(a.grantedAt)}{a.grantedBy ? ` by ${nameOf(userById.get(a.grantedBy))}` : ""}
                            </span>
                          </span>
                          {a.canSeePassword !== null && (
                            <button type="button" className="btn btn-sm hover:bg-white/15" title={group.moveTitle} onClick={() => void changeLevel(a.profileId, !group.level)} disabled={busy}>
                              {group.level ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {group.move}
                            </button>
                          )}
                          <button type="button" className="btn btn-sm hover:bg-white/15 text-red-300" onClick={() => void removeAccess(a.profileId)} disabled={busy}>
                            <X className="h-3.5 w-3.5" /> Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Add people</p>
              <PeoplePicker users={activeUsers} value={grantPick} onChange={setGrantPick} exclude={notGrantable} />
              <div className="mt-2 flex flex-wrap items-center justify-end gap-3">
                <div role="radiogroup" aria-label="What they can see" className="mr-auto flex flex-wrap gap-3 text-sm">
                  <label className="inline-flex items-center gap-1.5">
                    <input type="radio" name="vault-level" checked={!grantWithPassword} onChange={() => setGrantWithPassword(false)} /> Email only
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input type="radio" name="vault-level" checked={grantWithPassword} onChange={() => setGrantWithPassword(true)} /> Email and password
                  </label>
                </div>
                <button type="button" className="btn btn-primary" onClick={() => void addAccess()} disabled={busy || grantPick.length === 0}>
                  <UserPlus className="h-4 w-4" /> {grantPick.length > 1 ? `Give access to ${grantPick.length} people` : "Give access"}
                </button>
              </div>
            </div>
          </div>
        </AppModal>
      )}
    </main>
  );
}
