/**
 * Admin → Password and Email Management (was "Email Vault") — company email logins: the address, its password,
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
import { Check, ChevronLeft, Copy, Eye, EyeOff, History, KeyRound, Loader2, Mail, Pencil, Plus, Trash2, UserPlus, Users, X } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { useSmartBack } from "@/hooks/useSmartBack";
import { AppModal } from "@/components/ui-kit/AppModal";
import { EmptyState } from "@/components/ui-kit/EmptyState";
import { PasswordChecksPanel } from "@/components/PasswordChecksPanel";
import { TableSkeleton } from "@/components/ui-kit/TableSkeleton";
import { TicketColumnFilter } from "@/components/TicketColumnFilter";
import { isEmailVaultSuperAdmin } from "@/lib/submoduleAccess";
import { normalizeRole, withIncludedRoles } from "@/lib/roleLabels";
import { hydrateEmailVaultGrant } from "@/lib/moduleAccess";
import { getCompanyUsers, getMyProfileId, type ProfileRow } from "@/lib/supabase/users";
import {
  getEmailVaultEntries,
  addEmailVaultEntry,
  updateEmailVaultEntry,
  deleteEmailVaultEntry,
  revealEmailVaultPassword,
  setEmailVaultPlatforms,
  getEmailVaultAccess,
  grantEmailVaultAccess,
  removeEmailVaultAccess,
  setEmailVaultPasswordAccess,
  getMyEmailVaultPasswordAccess,
  getEmailVaultNoPasswordIds,
  getEmailVaultEvents,
  type EmailVaultEntry,
  type EmailVaultAccessRow,
  type EmailVaultEvent,
} from "@/lib/supabase/emailVault";

type Props = { mod: ModuleDef; sub: SubModuleDef };

/** A shown password hides itself again after this long. */
const REVEAL_MS = 30_000;

/**
 * The ✓ columns, in the order of the sheet this page replaced (migration
 * 0449 stores the ticked names on each email). Add a platform here and it
 * becomes a column; a name taken out of here stays saved but isn't shown.
 */
const VAULT_PLATFORMS = [
  "AHS", "ER", "Discord", "iWallet", "Car IQ", "Encompass", "Marcone", "NSA", "ServicePower", "ServiceBench",
  "Miele", "Onpoint", "GE", "Samsung", "Electrolux", "LG", "LinkedIn", "Wix", "Facebook",
] as const;

const TICKED = "✓";
const BLANK = "(blank)";

/** Name and Email stay put while the ✓ columns scroll sideways. */
const STICKY_NAME = "sticky left-0 z-10 w-[190px] min-w-[190px] max-w-[190px]";
const STICKY_EMAIL = "sticky left-[190px] z-10 w-[260px] min-w-[260px] max-w-[260px] shadow-[1px_0_0_var(--color-panel-border)]";

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

/** Shown next to anyone whose account is deactivated, wherever their name appears. */
function DeactivatedTag() {
  return (
    <span className="shrink-0 rounded-full border border-red-500/40 bg-red-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-red-300" title="This account is deactivated">
      Deactivated
    </span>
  );
}

/** Searchable checklist of company accounts, by profile id. */
function PeoplePicker({ users, value, onChange, exclude, deactivated }: {
  users: ProfileRow[];
  value: string[];
  onChange: (next: string[]) => void;
  exclude?: Set<string>;
  /** Deactivated accounts — listed only when "Show deactivated" is on (a past employee's mailbox can still be in use). */
  deactivated?: ProfileRow[];
}) {
  const [q, setQ] = useState("");
  const [withDeactivated, setWithDeactivated] = useState(false);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...users, ...(withDeactivated ? deactivated ?? [] : [])]
      .filter((u) => !exclude?.has(u.id))
      .filter((u) => !needle || nameOf(u).toLowerCase().includes(needle) || (u.email || "").toLowerCase().includes(needle));
  }, [users, deactivated, withDeactivated, q, exclude]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="rounded-md border border-[var(--color-panel-border)]">
      <div className="flex items-center border-b border-[var(--color-panel-border)]">
        <input className="glass-input text-sm w-full rounded-b-none border-0" placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} />
        {!!deactivated?.length && (
          <button
            type="button"
            onClick={() => setWithDeactivated((v) => !v)}
            aria-pressed={withDeactivated}
            title={withDeactivated ? "Hide deactivated accounts" : "Also list deactivated accounts"}
            className={`mx-1.5 shrink-0 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium transition ${withDeactivated ? "border-red-400/50 bg-red-500/15 text-red-200" : "border-white/15 text-slate-300 hover:bg-white/10"}`}
          >
            {withDeactivated ? "Hide deactivated" : `Show deactivated (${deactivated.length})`}
          </button>
        )}
      </div>
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
                <span className={`flex-1 truncate ${u.is_active ? "" : "text-slate-400"}`}>{nameOf(u)}</span>
                {!u.is_active && <DeactivatedTag />}
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
  const [showPasswordChecks, setShowPasswordChecks] = useState(false);
  const [search, setSearch] = useState("");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<string | null>(null);

  /** Sheet-style funnel filters: "name", "email", or a platform → picked values. */
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  /** "<entry id>|<platform>" while that tick is saving. */
  const [savingTick, setSavingTick] = useState<string | null>(null);

  const [editing, setEditing] = useState<EmailVaultEntry | "new" | null>(null);
  /** passwordLater: "No password yet" ticked — the email can be saved now and its password filled in later (Edit). */
  const [form, setForm] = useState({ email: "", password: "", people: [] as string[], platforms: [] as string[], passwordLater: false });
  const [showFormPassword, setShowFormPassword] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<EmailVaultEntry | null>(null);
  const [managingAccess, setManagingAccess] = useState(false);
  const [grantPick, setGrantPick] = useState<string[]>([]);
  /** Level for people added in Manage access. */
  const [grantWithPassword, setGrantWithPassword] = useState(false);
  /** Can I show / copy / set passwords? (Email and password, or Super Admin.) */
  const [canSeePasswords, setCanSeePasswords] = useState(false);
  /** Emails with no password saved yet — shown as "(none)" + Set password right away (migration 0459). */
  const [noPasswordIds, setNoPasswordIds] = useState<Set<string>>(new Set());
  const refreshNoPassword = useCallback(() => { void getEmailVaultNoPasswordIds().then(setNoPasswordIds); }, []);
  /** Manage Access / Password Checks: Super Admins change them; Email and password people can look (view only). */
  /** Password Checks: Super Admin and Admin can change them and Show a set password (migration 0460). */
  const canEditPasswordChecks = isSuperAdmin || withIncludedRoles([role, ...(extraRoles ?? [])]).includes("ADMIN");
  const canViewSettings = isSuperAdmin || canSeePasswords || canEditPasswordChecks;
  const [busy, setBusy] = useState(false);

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const activeUsers = useMemo(() => users.filter((u) => u.is_active).sort((a, b) => nameOf(a).localeCompare(nameOf(b))), [users]);
  const deactivatedUsers = useMemo(() => users.filter((u) => !u.is_active).sort((a, b) => nameOf(a).localeCompare(nameOf(b))), [users]);
  /** Account by login email — names an email nobody is linked to yet (most are deactivated people's old mailboxes). */
  const userByLoginEmail = useMemo(() => new Map(users.filter((u) => u.email).map((u) => [u.email.trim().toLowerCase(), u])), [users]);
  const superAdmins = useMemo(() => activeUsers.filter((u) => isEmailVaultSuperAdmin(u.role, u.extra_roles)), [activeUsers]);
  // Manage Access lists only the people who hold Super Admin itself — IT keeps Super Admin's access
  // here (superAdmins above, so they're never offered under Add people) but isn't listed.
  const listedSuperAdmins = useMemo(
    () => superAdmins.filter((u) => [u.role, ...(u.extra_roles ?? [])].some((r) => normalizeRole(r) === "SUPERADMIN")),
    [superAdmins],
  );

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
      if (seePasswords) refreshNoPassword();
      setEntries(rows);
      setAccess(acc);
      setEvents(ev);
      setUsers(userRows);
      setMyId(pid);
    } catch (e: any) {
      setError(e?.message || "Couldn't load Password and Email Management.");
    } finally {
      setLoading(false);
    }
  }, [uid, refreshNoPassword]);

  useEffect(() => { void load(); }, [load]);

  const ownersOf = useCallback(
    (e: EmailVaultEntry): { users: ProfileRow[]; byLogin: boolean } => {
      const linked = e.people.map((id) => userById.get(id)).filter((u): u is ProfileRow => !!u);
      if (linked.length > 0 || e.people.length > 0) return { users: linked.sort((a, b) => nameOf(a).localeCompare(nameOf(b))), byLogin: false };
      const owner = userByLoginEmail.get(e.email.trim().toLowerCase());
      return { users: owner ? [owner] : [], byLogin: !!owner };
    },
    [userById, userByLoginEmail],
  );
  /** Name column text (what search, the funnel and sorting use); deactivated people are marked. */
  const peopleNames = useCallback(
    (e: EmailVaultEntry) => ownersOf(e).users.map((u) => (u.is_active ? nameOf(u) : `${nameOf(u)} (Deactivated)`)).join(", "),
    [ownersOf],
  );
  /** 0 = someone active uses it, 1 = only deactivated people, 2 = nobody. */
  const ownerRank = useCallback((e: EmailVaultEntry) => {
    const owners = ownersOf(e).users;
    return owners.length === 0 ? 2 : owners.some((u) => u.is_active) ? 0 : 1;
  }, [ownersOf]);
  /** A row's value in a filterable column — what the funnel lists and matches. */
  const cellValue = useCallback(
    (e: EmailVaultEntry, col: string) =>
      col === "name" ? peopleNames(e) || BLANK : col === "email" ? e.email : e.platforms.includes(col) ? TICKED : BLANK,
    [peopleNames],
  );
  const passesFilters = useCallback(
    (e: EmailVaultEntry, skip?: string) => Object.entries(colFilters).every(([col, picked]) => col === skip || picked.size === 0 || picked.has(cellValue(e, col))),
    [colFilters, cellValue],
  );
  const searched = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((e) => e.email.toLowerCase().includes(needle) || peopleNames(e).toLowerCase().includes(needle));
  }, [entries, search, peopleNames]);
  // One row per email like the sheet, by who uses it — active people, then
  // deactivated people's old mailboxes, then emails nobody is linked to.
  const filtered = useMemo(
    () =>
      searched
        .filter((e) => passesFilters(e))
        .sort((a, b) => ownerRank(a) - ownerRank(b) || peopleNames(a).localeCompare(peopleNames(b)) || a.email.localeCompare(b.email)),
    [searched, passesFilters, peopleNames, ownerRank],
  );
  /** Funnel options for a column: its values among rows passing every OTHER filter (Excel's autofilter). */
  const filterOptions = (col: string) => Array.from(new Set(searched.filter((e) => passesFilters(e, col)).map((e) => cellValue(e, col)))).sort((a, b) => a.localeCompare(b));
  const setFilter = (col: string, next: Set<string>) => setColFilters((f) => ({ ...f, [col]: next }));
  const anyFilter = Object.values(colFilters).some((s) => s.size > 0);

  /** Tick / untick one platform for one email, right in the grid. */
  const toggleTick = async (entry: EmailVaultEntry, platform: string) => {
    const key = `${entry.id}|${platform}`;
    const next = entry.platforms.includes(platform) ? entry.platforms.filter((p) => p !== platform) : [...entry.platforms, platform];
    setSavingTick(key);
    setEntries((rows) => rows.map((r) => (r.id === entry.id ? { ...r, platforms: next } : r)));
    try {
      await setEmailVaultPlatforms(entry.id, next);
      refreshEvents();
    } catch (e: any) {
      setEntries((rows) => rows.map((r) => (r.id === entry.id ? { ...r, platforms: entry.platforms } : r)));
      toast.error(e?.message || "Couldn't save that tick.");
    } finally {
      setSavingTick(null);
    }
  };

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
    setForm(entry === "new" ? { email: "", password: "", people: [], platforms: [], passwordLater: false } : { email: entry.email, password: "", people: entry.people, platforms: entry.platforms, passwordLater: false });
    setShowFormPassword(false);
  };

  const saveForm = async () => {
    if (!editing) return;
    const email = form.email.trim();
    if (!email) { toast.error("Enter the email address."); return; }
    if (editing === "new" && canSeePasswords && !form.password && !form.passwordLater) {
      toast.error('Enter the password, or tick "No password yet" to fill it in later.');
      return;
    }
    setBusy(true);
    try {
      if (editing === "new") {
        const id = await addEmailVaultEntry({ email, password: canSeePasswords && !form.passwordLater ? form.password : "", people: form.people });
        if (form.platforms.length > 0) await setEmailVaultPlatforms(id, form.platforms);
        toast.success(form.passwordLater || !canSeePasswords ? `${email} added — fill in its password later with Edit.` : `${email} added.`);
      } else {
        await updateEmailVaultEntry(editing.id, { email, people: form.people, password: canSeePasswords && form.password ? form.password : undefined });
        const was = [...editing.platforms].sort().join("|");
        if ([...form.platforms].sort().join("|") !== was) await setEmailVaultPlatforms(editing.id, form.platforms);
        hidePassword(editing.id);
        toast.success(`${email} saved.`);
      }
      setEditing(null);
      setEntries(await getEmailVaultEntries());
      if (canSeePasswords) refreshNoPassword();
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
              Company email logins, who uses each one, and which platforms each email is on. Passwords stay hidden — every Show and Copy is recorded on the History tab, and so is every tick.{isSuperAdmin ? " Password Checks sets which pages and buttons ask for a password, and which password." : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canViewSettings && (
              <button type="button" onClick={() => setManagingAccess(true)} className="btn hover:bg-white/15">
                <Users className="h-4 w-4" /> Manage Access
              </button>
            )}
            {canViewSettings && (
              <button type="button" onClick={() => setShowPasswordChecks((v) => !v)} aria-pressed={showPasswordChecks} className={`btn hover:bg-white/15 ${showPasswordChecks ? "!border-amber-400/60 !bg-amber-500/15 text-amber-200" : ""}`}>
                <KeyRound className="h-4 w-4" /> Password Checks
              </button>
            )}
            <button type="button" onClick={() => openForm("new")} className="btn btn-primary">
              <Plus className="h-4 w-4" /> Add Email
            </button>
          </div>
        </div>
      </div>

      {error && <div className="panel mb-4 border-red-500/30 bg-red-500/5 text-sm text-red-300 px-4 py-3">{error}</div>}

      {/* Super Admin: Password Checks — which pages and buttons ask for a password (migration 0441). Its own view of this page. */}
      {showPasswordChecks && canViewSettings ? (
        <section>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <button type="button" className="btn text-sm" onClick={() => setShowPasswordChecks(false)}>
              <ChevronLeft className="h-4 w-4" /> Emails
            </button>
            <h2 className="text-xl font-semibold flex items-center gap-2"><KeyRound className="h-5 w-5 text-amber-300" /> Password Checks</h2>
          </div>
          <PasswordChecksPanel readOnly={!canEditPasswordChecks} />
        </section>
      ) : (
      <>
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
        <div className="panel p-3 mb-3 flex flex-wrap items-center gap-3">
          <input className="glass-input text-sm w-full sm:max-w-sm" placeholder="Search email or person…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="text-xs text-muted-foreground">
            {filtered.length === entries.length ? `${entries.length} emails` : `${filtered.length} of ${entries.length} emails`} · click a box to tick or untick a platform
          </span>
          {anyFilter && (
            <button type="button" className="text-xs font-semibold text-blue-300 hover:underline" onClick={() => setColFilters({})}>
              Clear column filters
            </button>
          )}
        </div>
      )}

      <div className={`panel p-0 overflow-x-auto ${tab === "emails" ? "max-h-[75vh] overflow-y-auto" : ""}`}>
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
          <table className="w-max min-w-full border-collapse text-sm">
            <thead className="sticky top-0 z-20">
              <tr className="bg-blue-600 text-left text-xs font-semibold text-white">
                <th className={`${STICKY_NAME} bg-blue-600 px-3 py-2`}>
                  <span className="inline-flex items-center">
                    Name
                    <TicketColumnFilter options={filterOptions("name")} selected={colFilters.name ?? new Set()} onChange={(n) => setFilter("name", n)} label="Filter by Name" />
                  </span>
                </th>
                <th className={`${STICKY_EMAIL} bg-blue-600 px-3 py-2`}>
                  <span className="inline-flex items-center">
                    Email
                    <TicketColumnFilter options={filterOptions("email")} selected={colFilters.email ?? new Set()} onChange={(n) => setFilter("email", n)} label="Filter by Email" />
                  </span>
                </th>
                <th className="border-l border-white/20 px-3 py-2 whitespace-nowrap">Email Password</th>
                {VAULT_PLATFORMS.map((platform) => (
                  <th key={platform} className="w-[84px] min-w-[84px] border-l border-white/20 px-1 py-2 text-center whitespace-nowrap">
                    <span className="inline-flex items-center justify-center">
                      {platform}
                      <TicketColumnFilter options={filterOptions(platform)} selected={colFilters[platform] ?? new Set()} onChange={(n) => setFilter(platform, n)} label={`Filter by ${platform}`} />
                    </span>
                  </th>
                ))}
                <th className="border-l border-white/20 px-2 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, i) => {
                const shown = revealed[entry.id];
                const names = peopleNames(entry);
                const owners = ownersOf(entry);
                // The sheet's green / blue bands, tinted over a solid cell so the frozen columns cover what scrolls under them.
                const cell = `bg-[var(--background)] ${i % 2 ? "shadow-[inset_0_0_0_9999px_rgba(59,130,246,0.08)]" : "shadow-[inset_0_0_0_9999px_rgba(16,185,129,0.08)]"}`;
                const rowSaving = !!savingTick?.startsWith(`${entry.id}|`);
                return (
                  <tr key={entry.id} className="border-b border-[var(--color-panel-border)]/60">
                    <td
                      className={`${STICKY_NAME} ${cell} px-3 py-1.5`}
                      title={names ? `${names}${owners.byLogin ? " — their account's login email (nobody is linked to it yet)" : ""}` : undefined}
                    >
                      {owners.users.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {owners.users.map((u) => (
                            <span key={u.id} className={`flex min-w-0 items-center gap-1.5 ${u.is_active ? "" : "text-muted-foreground"}`}>
                              <span className={`truncate ${owners.byLogin ? "italic" : ""}`}>{nameOf(u)}</span>
                              {!u.is_active && <DeactivatedTag />}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className={`${STICKY_EMAIL} ${cell} px-3 py-1.5 truncate font-medium`} title={entry.email}>{entry.email}</td>
                    <td className={`${cell} border-l border-[var(--color-panel-border)] px-3 py-1.5`}>
                      <div className="flex items-center gap-1">
                        {canSeePasswords && noPasswordIds.has(entry.id) && shown === undefined ? (
                          <>
                            <span className="font-mono text-xs min-w-[7rem] text-amber-300" title="No password saved for this email yet">(none)</span>
                            <button type="button" className="btn btn-sm hover:bg-white/15 text-amber-200" title="Set the password for this email" onClick={() => openForm(entry)}>
                              <KeyRound className="h-3.5 w-3.5" /> Set password
                            </button>
                          </>
                        ) : (
                        <>
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
                        </>
                        )}
                      </div>
                    </td>
                    {VAULT_PLATFORMS.map((platform) => {
                      const on = entry.platforms.includes(platform);
                      return (
                        <td key={platform} className={`${cell} border-l border-[var(--color-panel-border)] p-0 text-center`}>
                          <button
                            type="button"
                            disabled={rowSaving}
                            onClick={() => void toggleTick(entry, platform)}
                            aria-pressed={on}
                            aria-label={`${platform} for ${entry.email}`}
                            title={on ? `Used on ${platform} — click to untick` : `Click to tick ${platform}`}
                            className="flex h-9 w-full items-center justify-center text-base font-bold text-emerald-500 hover:bg-white/10 disabled:cursor-wait"
                          >
                            {savingTick === `${entry.id}|${platform}` ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : on ? TICKED : ""}
                          </button>
                        </td>
                      );
                    })}
                    <td className={`${cell} border-l border-[var(--color-panel-border)] px-2 py-1.5`}>
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
      </>
      )}

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
            <div className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Password</span>
              <div className="mt-1 flex gap-1.5">
                <input
                  type={showFormPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className="glass-input text-sm w-full font-mono disabled:opacity-50"
                  value={form.password}
                  disabled={form.passwordLater}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder={form.passwordLater ? "Fill in later with Edit" : editing === "new" ? "" : "Leave blank to keep the current password"}
                />
                <button type="button" className="btn hover:bg-white/15" title={showFormPassword ? "Hide" : "Show"} disabled={form.passwordLater} onClick={() => setShowFormPassword((s) => !s)}>
                  {showFormPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {editing === "new" && (
                <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-blue-500"
                    checked={form.passwordLater}
                    onChange={(e) => { const on = e.target.checked; setForm((f) => ({ ...f, passwordLater: on, password: on ? "" : f.password })); }}
                  />
                  No password yet — someone else will fill it in
                </label>
              )}
            </div>
            )}
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Platforms this email is used on</span>
              <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
                {VAULT_PLATFORMS.map((platform) => (
                  <label key={platform} className="inline-flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={form.platforms.includes(platform)}
                      onChange={(e) => setForm((f) => ({ ...f, platforms: e.target.checked ? [...f.platforms, platform] : f.platforms.filter((x) => x !== platform) }))}
                    />
                    {platform}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">People with access to this email</span>
              {form.people.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {form.people.map((id) => (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-panel-border)] bg-white/5 px-2 py-0.5 text-xs">
                      {nameOf(userById.get(id))}
                      {userById.get(id) && !userById.get(id)!.is_active && <DeactivatedTag />}
                      <button type="button" title="Remove" onClick={() => setForm((f) => ({ ...f, people: f.people.filter((p) => p !== id) }))}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2">
                <PeoplePicker users={activeUsers} deactivated={deactivatedUsers} value={form.people} onChange={(people) => setForm((f) => ({ ...f, people }))} />
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

      {managingAccess && canViewSettings && (
        <AppModal
          title="Who can open Password and Email Management"
          description={isSuperAdmin
            ? "Super Admins always can, and see passwords. Add anyone else as Email only or Email and password — they'll see Password and Email Management under Admin the next time they open the app."
            : "View only — only a Super Admin can add, change or remove people here."}
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
                {listedSuperAdmins.map((u) => (
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
                          {isSuperAdmin && a.canSeePassword !== null && (
                            <button type="button" className="btn btn-sm hover:bg-white/15" title={group.moveTitle} onClick={() => void changeLevel(a.profileId, !group.level)} disabled={busy}>
                              {group.level ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {group.move}
                            </button>
                          )}
                          {isSuperAdmin && (
                            <button type="button" className="btn btn-sm hover:bg-white/15 text-red-300" onClick={() => void removeAccess(a.profileId)} disabled={busy}>
                              <X className="h-3.5 w-3.5" /> Remove
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {isSuperAdmin && (
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
            )}
          </div>
        </AppModal>
      )}
    </main>
  );
}
