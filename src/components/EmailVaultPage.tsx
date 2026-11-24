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
import { Check, ChevronLeft, Columns3, Copy, Eye, EyeOff, History, KeyRound, Loader2, Mail, Pencil, Plug, Plus, RefreshCw, Trash2, UserPlus, Users, X } from "lucide-react";
import { auth as firebaseAuth } from "@/lib/firebase/config";
import { disconnectGmail, disconnectHiringGmail, type GmailRegion } from "@/lib/supabase/gmailConnection";
import { createNotification } from "@/lib/supabase/notifications";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { useSmartBack } from "@/hooks/useSmartBack";
import { AppModal } from "@/components/ui-kit/AppModal";
import { EmptyState } from "@/components/ui-kit/EmptyState";
import { PasswordChecksPanel } from "@/components/PasswordChecksPanel";
import { TableSkeleton } from "@/components/ui-kit/TableSkeleton";
import { TicketColumnFilter } from "@/components/TicketColumnFilter";
import { isEmailVaultSuperAdmin } from "@/lib/submoduleAccess";
import { getRoleDepartmentBreakdown, normalizeRole, withIncludedRoles } from "@/lib/roleLabels";
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
  getEmailVaultPlatforms,
  reorderEmailVaultPlatforms,
  getEmailVaultPersonPlatforms,
  setEmailVaultPersonPlatforms,
  addEmailVaultPlatform,
  removeEmailVaultPlatform,
  type EmailVaultEntry,
  type EmailVaultAccessRow,
  type EmailVaultEvent,
} from "@/lib/supabase/emailVault";

type Props = { mod: ModuleDef; sub: SubModuleDef };

/** A shown password hides itself again after this long. */
const REVEAL_MS = 30_000;

/**
 * The ✓ columns, in the order of the sheet this page replaced (migration
 * 0449 stores the ticked names on each email). Since migration 0466 each
 * company keeps its own list (Columns adds / deletes them) — this is only
 * what shows before 0466 is run. A deleted column's ticks stay saved.
 */
const DEFAULT_VAULT_PLATFORMS = [
  "AHS", "ER", "Discord", "iWallet", "Car IQ", "Encompass", "Marcone", "NSA", "ServicePower", "ServiceBench",
  "Miele", "Onpoint", "GE", "Samsung", "Electrolux", "LG", "LinkedIn", "Wix", "Facebook",
] as const;

const TICKED = "✓";
const BLANK = "(blank)";
const NO_EMAIL = "(no email yet)";

/** A row of the grid: a saved email, or an active person no email is linked to yet. */
type VaultRow = { kind: "email"; entry: EmailVaultEntry } | { kind: "person"; user: ProfileRow };
const rowEmail = (r: VaultRow) => (r.kind === "email" ? r.entry.email : "");

type StaffGroup = "us" | "ph" | "mx";
const STAFF_GROUP_LABEL: Record<StaffGroup, string> = { us: "US Staff", ph: "PH Staff", mx: "Mexico Staff" };

/** There's no country column — PH / Mexico staff are the people on those branches (as on Staff Form Checklist); everyone else is US. */
function staffGroupOf(u: ProfileRow): StaffGroup {
  const branch = (u.assigned_branch || "").trim().toLowerCase();
  return branch === "philippines" ? "ph" : branch === "mexico" ? "mx" : "us";
}

/** Department from the role (Branch Managers count as Technician, like payroll) — the profile's own Department field is mostly blank. */
const departmentOf = (u: ProfileRow) => getRoleDepartmentBreakdown(u.role).department;

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
  column_added: "Added column",
  column_removed: "Deleted column",
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
  // Email Connections (IT / Admin / Super Admin): every Google account the app sends from, and whether it still works.
  const canSeeConnections = withIncludedRoles([role, ...(extraRoles ?? [])]).some((r) => r === "IT" || r === "ADMIN" || r === "SUPERADMIN");
  const [showConnections, setShowConnections] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "connections");
  const [connRows, setConnRows] = useState<Array<{ kind: "slot" | "hiring" | "drive"; region?: string; id?: string; ownerId?: string | null; label: string; usedFor: string; email: string | null; connectedBy?: string | null; connectedAt?: string | null; status: "ok" | "expired" | "error" | "not_connected"; message?: string }> | null>(null);
  const [reconnecting, setReconnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  // Disconnect a slot (Admin / Super Admin / IT — checked by the database). Its emails stop until it's connected again.
  const disconnectSlot = async (r: { region?: string; label: string; email: string | null; usedFor: string }) => {
    if (!r.region) return;
    if (!confirm(`Disconnect ${r.email || "this account"} from ${r.label}?\n\n${r.usedFor} stop until a Google account is connected here again.`)) return;
    setDisconnecting(r.region);
    try {
      await disconnectGmail(r.region as GmailRegion);
      toast.success(`${r.label} disconnected.`);
      await checkConnections();
    } catch (err) {
      toast.error(`Couldn't disconnect: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDisconnecting(null);
    }
  };
  // Hiring panel accounts belong to whoever connected them — IT can remove one, or send its owner a bell to reconnect it.
  const [hiringBusy, setHiringBusy] = useState<string | null>(null);
  const removeHiringAccount = async (r: { id?: string; email: string | null; connectedBy?: string | null }) => {
    if (!r.id) return;
    if (!confirm(`Remove ${r.email || "this Gmail"} from the Hiring panel?${r.connectedBy ? `\n\nIt was connected by ${r.connectedBy}; they can connect it again from HR Dashboard → Hiring.` : ""}`)) return;
    setHiringBusy(r.id);
    try {
      await disconnectHiringGmail(r.id);
      toast.success(`${r.email || "Gmail"} removed from the Hiring panel.`);
      await checkConnections();
    } catch (err) {
      toast.error(`Couldn't remove it: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setHiringBusy(null);
    }
  };
  const notifyHiringOwner = async (r: { id?: string; ownerId?: string | null; email: string | null; connectedBy?: string | null }) => {
    if (!r.id || !r.ownerId) return;
    setHiringBusy(r.id);
    try {
      await createNotification({
        recipientId: r.ownerId,
        senderId: myId,
        senderName: "Email Connections",
        body: `📧 Your Hiring Gmail connection expired (${r.email || "your account"}). Go to HR Dashboard → Hiring, disconnect your email and connect it again. Hiring emails from it won't send until then.`,
        linkTo: "/m/hr/hr-dashboard?tab=hiring",
      });
      toast.success(`${r.connectedBy || "The owner"} was notified to reconnect.`);
    } catch (err) {
      toast.error(`Couldn't notify them: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setHiringBusy(null);
    }
  };

  // Connect a slot: Google sign-in, then back to this view (gmailBridge connect, returnTo=email-vault).
  // When it already has an account, Google pre-picks that one.
  const reconnectSlot = async (region: string, email: string | null) => {
    setReconnecting(region);
    try {
      const idToken = await firebaseAuth?.currentUser?.getIdToken();
      if (!idToken) throw new Error("Could not verify your session — sign in again.");
      const q = new URLSearchParams({ action: "connect", region, idToken, returnTo: "email-vault" });
      if (email) q.set("loginHint", email);
      window.location.href = `/api/gmail?${q.toString()}`;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setReconnecting(null);
    }
  };
  // Coming back from Google after Reconnect: say how it went.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const done = p.get("gmailConnected");
    if (done === null || p.get("view") !== "connections") return;
    if (done === "1") toast.success("Reconnected. Checking every connection again…");
    else toast.error("Reconnect didn't finish — try again, and sign in with the same Google account.");
    p.delete("gmailConnected");
    p.delete("gmailRegion");
    window.history.replaceState(null, "", `${window.location.pathname}?${p.toString()}`);
  }, []);
  const [connError, setConnError] = useState<string | null>(null);
  const [connChecking, setConnChecking] = useState(false);
  const [connCheckedAt, setConnCheckedAt] = useState<string | null>(null);
  const checkConnections = useCallback(async () => {
    setConnChecking(true);
    setConnError(null);
    try {
      const idToken = await firebaseAuth?.currentUser?.getIdToken();
      if (!idToken) throw new Error("Could not verify your session — sign in again.");
      const res = await fetch("/api/gmail?action=check-all-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; rows?: typeof connRows; checkedAt?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || `Check failed (HTTP ${res.status})`);
      setConnRows(data.rows ?? []);
      setConnCheckedAt(data.checkedAt ?? new Date().toISOString());
    } catch (err) {
      setConnError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnChecking(false);
    }
  }, []);
  useEffect(() => {
    if (showConnections && canSeeConnections && connRows === null && !connChecking) void checkConnections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showConnections, canSeeConnections]);
  const [search, setSearch] = useState("");
  /** The ✓ columns (migration 0466); null = not run yet, the built-in list shows and can't be changed. */
  const [platformList, setPlatformList] = useState<string[] | null>(null);
  const platforms: readonly string[] = platformList ?? DEFAULT_VAULT_PLATFORMS;
  const [managingColumns, setManagingColumns] = useState(false);
  /** Ticks on people with "No email yet" (migration 0468); null = not set up, their boxes stay off. */
  const [personTicks, setPersonTicks] = useState<Map<string, string[]> | null>(null);
  /** Header drag-to-reorder: the column being dragged, and the one it's over. */
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [newColumn, setNewColumn] = useState("");
  const [confirmRemoveColumn, setConfirmRemoveColumn] = useState<string | null>(null);
  const [staffFilter, setStaffFilter] = useState<StaffGroup | "all">("all");
  const [deptFilter, setDeptFilter] = useState("");
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
      const [rows, acc, ev, userRows, pid, seePasswords, columns, personRows] = await Promise.all([
        getEmailVaultEntries(),
        getEmailVaultAccess(),
        getEmailVaultEvents(),
        getCompanyUsers(),
        uid ? getMyProfileId(uid) : Promise.resolve(null),
        getMyEmailVaultPasswordAccess().catch(() => false),
        getEmailVaultPlatforms().catch((e) => { console.error("Email Vault columns:", e); return null; }),
        getEmailVaultPersonPlatforms().catch((e) => { console.error("Email Vault person ticks:", e); return null; }),
      ]);
      setPlatformList(columns);
      setPersonTicks(personRows);
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
  /** Active people no email is linked to (by person or by their login email) — listed too, so every active AHS name is on the page. */
  const peopleWithoutEmail = useMemo(() => {
    const linked = new Set(entries.flatMap((e) => ownersOf(e).users.map((u) => u.id)));
    return activeUsers.filter((u) => !linked.has(u.id));
  }, [entries, ownersOf, activeUsers]);
  const rows = useMemo<VaultRow[]>(
    () => [...entries.map((entry) => ({ kind: "email" as const, entry })), ...peopleWithoutEmail.map((user) => ({ kind: "person" as const, user }))],
    [entries, peopleWithoutEmail],
  );
  const rowPeople = useCallback((r: VaultRow) => (r.kind === "email" ? ownersOf(r.entry).users : [r.user]), [ownersOf]);
  const rowNames = useCallback((r: VaultRow) => (r.kind === "email" ? peopleNames(r.entry) : nameOf(r.user)), [peopleNames]);
  /** A row's value in a filterable column — what the funnel lists and matches. */
  const cellValue = useCallback(
    (r: VaultRow, col: string) =>
      col === "name"
        ? rowNames(r) || BLANK
        : col === "email"
          ? rowEmail(r) || NO_EMAIL
          : (r.kind === "email" ? r.entry.platforms : personTicks?.get(r.user.id) ?? []).includes(col) ? TICKED : BLANK,
    [rowNames, personTicks],
  );
  const passesFilters = useCallback(
    (r: VaultRow, skip?: string) => Object.entries(colFilters).every(([col, picked]) => col === skip || picked.size === 0 || picked.has(cellValue(r, col))),
    [colFilters, cellValue],
  );
  /** Search plus the Staff / Department pickers — one person on the row has to fit both. */
  const searched = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (needle && !rowEmail(r).toLowerCase().includes(needle) && !rowNames(r).toLowerCase().includes(needle)) return false;
      if (staffFilter === "all" && !deptFilter) return true;
      return rowPeople(r).some((u) => (staffFilter === "all" || staffGroupOf(u) === staffFilter) && (!deptFilter || departmentOf(u) === deptFilter));
    });
  }, [rows, search, staffFilter, deptFilter, rowNames, rowPeople]);
  // One row per email like the sheet, by who uses it — active people (with
  // the ones who have no email yet in among them), then deactivated people's
  // old mailboxes, then emails nobody is linked to.
  const filtered = useMemo(
    () =>
      searched
        .filter((r) => passesFilters(r))
        .sort((a, b) => (a.kind === "email" ? ownerRank(a.entry) : 0) - (b.kind === "email" ? ownerRank(b.entry) : 0) || rowNames(a).localeCompare(rowNames(b)) || rowEmail(a).localeCompare(rowEmail(b))),
    [searched, passesFilters, rowNames, ownerRank],
  );
  /** Funnel options for a column: its values among rows passing every OTHER filter (Excel's autofilter). */
  const filterOptions = (col: string) => Array.from(new Set(searched.filter((r) => passesFilters(r, col)).map((r) => cellValue(r, col)))).sort((a, b) => a.localeCompare(b));
  const setFilter = (col: string, next: Set<string>) => setColFilters((f) => ({ ...f, [col]: next }));
  const anyFilter = Object.values(colFilters).some((s) => s.size > 0) || staffFilter !== "all" || !!deptFilter;
  const clearFilters = () => { setColFilters({}); setStaffFilter("all"); setDeptFilter(""); };
  /** Active people per staff group, for the picker's counts. */
  const staffCounts = useMemo(() => {
    const counts: Record<StaffGroup, number> = { us: 0, ph: 0, mx: 0 };
    for (const u of activeUsers) counts[staffGroupOf(u)]++;
    return counts;
  }, [activeUsers]);
  const staffChoices: (StaffGroup | "all")[] = ["all", "us", "ph", ...(staffCounts.mx ? (["mx"] as const) : [])];
  /** Departments among the active people in the picked staff group, with how many each. */
  const departmentOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const u of activeUsers) {
      if (staffFilter !== "all" && staffGroupOf(u) !== staffFilter) continue;
      counts.set(departmentOf(u), (counts.get(departmentOf(u)) ?? 0) + 1);
    }
    if (deptFilter && !counts.has(deptFilter)) counts.set(deptFilter, 0);
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
  }, [activeUsers, staffFilter, deptFilter]);
  const shownEmails = filtered.filter((r) => r.kind === "email").length;
  const shownPeople = filtered.length - shownEmails;

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

  /** Tick / untick a platform for someone with no email yet — saved on the person (migration 0468). */
  const togglePersonTick = async (u: ProfileRow, platform: string) => {
    if (!personTicks) return;
    const was = personTicks.get(u.id) ?? [];
    const next = was.includes(platform) ? was.filter((p) => p !== platform) : [...was, platform];
    const key = `person:${u.id}|${platform}`;
    setSavingTick(key);
    setPersonTicks((m) => new Map(m ?? []).set(u.id, next));
    try {
      await setEmailVaultPersonPlatforms(u.id, next);
      refreshEvents();
    } catch (e: any) {
      setPersonTicks((m) => new Map(m ?? []).set(u.id, was));
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

  /** `people` fills in who uses a new email (a "No email yet" row's Add email). */
  const openForm = (entry: EmailVaultEntry | "new", people: string[] = []) => {
    setEditing(entry);
    // A "No email yet" row's Add email starts with the platforms already ticked for that person.
    const ticked = Array.from(new Set(people.flatMap((id) => personTicks?.get(id) ?? [])));
    setForm(entry === "new" ? { email: "", password: "", people, platforms: ticked, passwordLater: false } : { email: entry.email, password: "", people: entry.people, platforms: entry.platforms, passwordLater: false });
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

  /** How many emails have each platform ticked — shown in Columns, incl. ticks kept from a deleted column. */
  const tickCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) for (const p of e.platforms) counts.set(p, (counts.get(p) ?? 0) + 1);
    return counts;
  }, [entries]);
  /** Ticks saved for a name that isn't a column (any more) — Columns offers to add them back. */
  const hiddenTicked = useMemo(() => {
    const shown = new Set(platforms.map((p) => p.toLowerCase()));
    return [...tickCounts.keys()].filter((p) => !shown.has(p.toLowerCase())).sort((a, b) => a.localeCompare(b));
  }, [tickCounts, platforms]);

  const addColumn = async (name: string) => {
    const clean = name.trim();
    if (!clean) { toast.error("Enter the platform name."); return; }
    setBusy(true);
    try {
      await addEmailVaultPlatform(clean);
      setPlatformList(await getEmailVaultPlatforms());
      setNewColumn("");
      toast.success(`Added the ${clean} column.`);
      refreshEvents();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't add that column.");
    } finally {
      setBusy(false);
    }
  };

  /** Drop `from` where `to` is (it takes that spot); saved for everyone right away, put back if saving fails. */
  const moveColumn = async (from: string, to: string) => {
    if (!platformList || from === to) return;
    const before = platformList;
    const next = before.filter((p) => p !== from);
    const at = next.indexOf(to);
    if (at < 0) return;
    next.splice(before.indexOf(from) < before.indexOf(to) ? at + 1 : at, 0, from);
    setPlatformList(next);
    try {
      await reorderEmailVaultPlatforms(next);
    } catch (e: any) {
      setPlatformList(before);
      toast.error(e?.message || "Couldn't save the column order.");
    }
  };

  const removeColumn = async () => {
    if (!confirmRemoveColumn) return;
    const name = confirmRemoveColumn;
    setBusy(true);
    try {
      await removeEmailVaultPlatform(name);
      setPlatformList(await getEmailVaultPlatforms());
      setColFilters((f) => { const next = { ...f }; delete next[name]; return next; });
      setConfirmRemoveColumn(null);
      toast.success(`Deleted the ${name} column.`);
      refreshEvents();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't delete that column.");
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
    <main className="flex-1 w-full px-6 py-8">
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
              Company email logins, who uses each one, and which platforms each email is on — every active AHS person is listed, with "No email yet" until one is added. Passwords stay hidden — every Show and Copy is recorded on the History tab, and so is every tick.{isSuperAdmin ? " Password Checks sets which pages and buttons ask for a password, and which password." : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canViewSettings && (
              <button type="button" onClick={() => setManagingAccess(true)} className="btn hover:bg-white/15">
                <Users className="h-4 w-4" /> Manage Access
              </button>
            )}
            {canSeeConnections && (
              <button type="button" onClick={() => { setShowPasswordChecks(false); setShowConnections((v) => !v); }} aria-pressed={showConnections} className={`btn hover:bg-white/15 ${showConnections ? "!border-sky-400/60 !bg-sky-500/15 text-sky-200" : ""}`}>
                <Plug className="h-4 w-4" /> Email Connections
                {connRows && connRows.some((r) => r.status === "expired" || r.status === "error") && (
                  <span className="ml-1 rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white">{connRows.filter((r) => r.status === "expired" || r.status === "error").length}</span>
                )}
              </button>
            )}
            {canViewSettings && (
              <button type="button" onClick={() => { setShowConnections(false); setShowPasswordChecks((v) => !v); }} aria-pressed={showPasswordChecks} className={`btn hover:bg-white/15 ${showPasswordChecks ? "!border-amber-400/60 !bg-amber-500/15 text-amber-200" : ""}`}>
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

      {/* IT / Admin / Super Admin: Email Connections — is every Google account the app sends from still connected? Its own view of this page. */}
      {showConnections && canSeeConnections ? (
        <section>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <button type="button" className="btn text-sm" onClick={() => setShowConnections(false)}>
              <ChevronLeft className="h-4 w-4" /> Emails
            </button>
            <h2 className="text-xl font-semibold flex items-center gap-2"><Plug className="h-5 w-5 text-sky-300" /> Email Connections</h2>
            <button type="button" className="btn text-sm ml-auto" onClick={() => void checkConnections()} disabled={connChecking}>
              {connChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Check again
            </button>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            Every Google account the app sends email from (or saves files to). <b>Expired</b> means Google no longer accepts its sign-in — its emails stop until someone connects it again on the page that uses it (IT Tickets, Payroll, Hiring …). Checking sends nothing. IT is also sent a bell once a day for each expired one.
            {connCheckedAt && <span className="ml-1 text-xs">Last checked {new Date(connCheckedAt).toLocaleString()}.</span>}
          </p>
          {connError ? (
            <div className="panel border-red-500/30 bg-red-500/5 text-sm text-red-300 px-4 py-3">{connError}</div>
          ) : connRows === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking every connection…</div>
          ) : connRows.length === 0 ? (
            <div className="panel px-4 py-3 text-sm text-muted-foreground">No Google accounts are connected anywhere yet.</div>
          ) : (
            <div className="panel overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs uppercase text-slate-400">
                    <th className="px-3 py-2">Connection</th>
                    <th className="px-3 py-2">Google account</th>
                    <th className="px-3 py-2">Connected by</th>
                    <th className="px-3 py-2">Used for</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {[...connRows].sort((a, b) => { const rank = (x: typeof a) => (x.status === "expired" || x.status === "error" ? 0 : x.status === "ok" ? 1 : 2); return rank(a) - rank(b); }).map((r, i) => (
                    <tr key={`${r.label}-${r.email}-${i}`} className="border-b border-white/5 align-top">
                      <td className="px-3 py-2 font-medium">{r.label}</td>
                      <td className="px-3 py-2 text-slate-300">{r.email || "—"}</td>
                      <td className="px-3 py-2 text-slate-300">
                        {r.connectedBy || "—"}
                        {r.connectedAt && <div className="text-[11px] text-slate-500">{new Date(r.connectedAt).toLocaleString()}</div>}
                      </td>
                      <td className="px-3 py-2 text-slate-400">{r.usedFor}</td>
                      <td className="px-3 py-2">
                        {r.status === "not_connected" ? (
                          <span className="inline-block rounded border border-white/15 bg-white/5 px-2 py-0.5 text-xs font-semibold text-slate-400">Not connected</span>
                        ) : r.status === "ok" ? (
                          <span className="inline-block rounded border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">Working</span>
                        ) : r.status === "expired" ? (
                          <span className="inline-block rounded border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-300" title={r.message}>Expired — connect again</span>
                        ) : (
                          <span className="inline-block rounded border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300" title={r.message}>Couldn't check — hover for details</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {r.kind === "slot" && r.region ? (
                          <div className="inline-flex gap-1.5">
                            {r.status !== "not_connected" && (
                              <button
                                type="button"
                                onClick={() => void disconnectSlot(r)}
                                disabled={disconnecting !== null || reconnecting !== null}
                                title={`Remove ${r.email || "this account"} from ${r.label}`}
                                className="btn text-xs py-1 hover:!border-rose-400/60 hover:!bg-rose-500/15"
                              >
                                {disconnecting === r.region ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} Disconnect
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void reconnectSlot(r.region!, r.email)}
                              disabled={reconnecting !== null || disconnecting !== null}
                              title={r.email ? `Sign in to Google as ${r.email} again — Google pre-picks it` : `Connect a Google account for ${r.label}`}
                              className={`btn text-xs py-1 ${r.status === "expired" || r.status === "error" ? "!border-rose-400/60 !bg-rose-500/20 text-rose-100" : ""}`}
                            >
                              {reconnecting === r.region ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />} Connect
                            </button>
                          </div>
                        ) : r.kind === "hiring" && r.id ? (
                          <div className="inline-flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => void removeHiringAccount(r)}
                              disabled={hiringBusy !== null}
                              title={`Remove ${r.email || "this Gmail"} from the Hiring panel`}
                              className="btn text-xs py-1 hover:!border-rose-400/60 hover:!bg-rose-500/15"
                            >
                              {hiringBusy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} Remove
                            </button>
                            {r.status !== "ok" && r.ownerId && (
                              <button
                                type="button"
                                onClick={() => void notifyHiringOwner(r)}
                                disabled={hiringBusy !== null}
                                title={`Send ${r.connectedBy || "the owner"} a bell asking them to reconnect it (it's their account)`}
                                className="btn text-xs py-1 !border-amber-400/60 !bg-amber-500/15 text-amber-100"
                              >
                                Notify {r.connectedBy ? r.connectedBy.split(" ")[0] : "owner"} to reconnect
                              </button>
                            )}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : /* Super Admin: Password Checks — which pages and buttons ask for a password (migration 0441). Its own view of this page. */
      showPasswordChecks && canViewSettings ? (
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
          <input className="glass-input text-sm w-full sm:max-w-sm" placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Staff">
            {staffChoices.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setStaffFilter(g)}
                aria-pressed={staffFilter === g}
                className={`text-xs px-2.5 py-1.5 rounded-md border transition ${staffFilter === g ? "bg-blue-600 text-white border-blue-600" : "border-[var(--color-panel-border)] text-muted-foreground hover:text-foreground"}`}
              >
                {g === "all" ? `All staff (${activeUsers.length})` : `${STAFF_GROUP_LABEL[g]} (${staffCounts[g]})`}
              </button>
            ))}
          </div>
          <select className="glass-input text-sm py-1.5 px-3 rounded-md" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} aria-label="Department">
            <option value="">All departments</option>
            {departmentOptions.map(([d, n]) => (
              <option key={d} value={d}>{d} ({n})</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            {shownEmails === entries.length ? `${entries.length} emails` : `${shownEmails} of ${entries.length} emails`} · {shownPeople} {shownPeople === 1 ? "person" : "people"} with no email yet · click a box to tick or untick a platform
          </span>
          {anyFilter && (
            <button type="button" className="text-xs font-semibold text-blue-300 hover:underline" onClick={clearFilters}>
              Clear filters
            </button>
          )}
          <button type="button" className="btn btn-sm hover:bg-white/15 ml-auto" onClick={() => setManagingColumns(true)} title="Add or delete the ✓ platform columns">
            <Columns3 className="h-3.5 w-3.5" /> Columns
          </button>
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
            title={rows.length === 0 ? "No emails yet" : "No one matches"}
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
                {platforms.map((platform) => (
                  <th
                    key={platform}
                    draggable={platformList !== null}
                    onDragStart={(e) => { setDragCol(platform); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", platform); }}
                    onDragOver={(e) => { if (!dragCol) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragOver !== platform) setDragOver(platform); }}
                    onDragLeave={() => { if (dragOver === platform) setDragOver(null); }}
                    onDrop={(e) => { e.preventDefault(); const from = dragCol; setDragCol(null); setDragOver(null); if (from) void moveColumn(from, platform); }}
                    onDragEnd={() => { setDragCol(null); setDragOver(null); }}
                    title={platformList !== null ? "Drag to move this column (saved for everyone)" : undefined}
                    className={`w-[84px] min-w-[84px] border-l border-white/20 px-1 py-2 text-center whitespace-nowrap ${platformList !== null ? "cursor-grab active:cursor-grabbing" : ""} ${dragCol === platform ? "opacity-40" : ""} ${dragOver === platform && dragCol && dragCol !== platform ? "bg-blue-400 ring-2 ring-inset ring-white" : ""}`}
                  >
                    <span className="inline-flex items-center justify-center">
                      {platform}
                      <TicketColumnFilter options={filterOptions(platform)} selected={colFilters[platform] ?? new Set()} onChange={(n) => setFilter(platform, n)} label={`Filter by ${platform}`} />
                    </span>
                  </th>
                ))}
                <th className="w-[44px] min-w-[44px] border-l border-white/20 px-1 py-2 text-center">
                  <button type="button" onClick={() => setManagingColumns(true)} title="Add or delete platform columns" aria-label="Add or delete platform columns" className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-white/20">
                    <Plus className="h-4 w-4" />
                  </button>
                </th>
                <th className="border-l border-white/20 px-2 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                // The sheet's green / blue bands, tinted over a solid cell so the frozen columns cover what scrolls under them.
                const cell = `bg-[var(--background)] ${i % 2 ? "shadow-[inset_0_0_0_9999px_rgba(59,130,246,0.08)]" : "shadow-[inset_0_0_0_9999px_rgba(16,185,129,0.08)]"}`;
                if (row.kind === "person") {
                  const u = row.user;
                  return (
                    <tr key={`person:${u.id}`} className="border-b border-[var(--color-panel-border)]/60">
                      <td className={`${STICKY_NAME} ${cell} px-3 py-1.5`} title={`${nameOf(u)} — ${STAFF_GROUP_LABEL[staffGroupOf(u)]} · ${departmentOf(u)}${u.assigned_branch ? ` · ${u.assigned_branch}` : ""}`}>
                        <span className="block truncate">{nameOf(u)}</span>
                      </td>
                      <td className={`${STICKY_EMAIL} ${cell} px-3 py-1.5 truncate italic text-muted-foreground`}>No email yet</td>
                      <td className={`${cell} border-l border-[var(--color-panel-border)] px-3 py-1.5 text-muted-foreground`}>—</td>
                      {platforms.map((platform) => {
                        const on = (personTicks?.get(u.id) ?? []).includes(platform);
                        const key = `person:${u.id}|${platform}`;
                        return (
                          <td key={platform} className={`${cell} border-l border-[var(--color-panel-border)] p-0 text-center`}>
                            {personTicks ? (
                              <button
                                type="button"
                                disabled={savingTick === key}
                                onClick={() => void togglePersonTick(u, platform)}
                                aria-pressed={on}
                                aria-label={`${platform} for ${nameOf(u)}`}
                                title={on ? `On ${platform} — click to untick` : `Click to tick ${platform} for ${nameOf(u)}`}
                                className="flex h-9 w-full items-center justify-center text-base font-bold text-emerald-500 hover:bg-white/10 disabled:cursor-wait"
                              >
                                {savingTick === key ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : on ? TICKED : ""}
                              </button>
                            ) : (
                              <div className="h-9" title="Ticking for people with no email needs database migration 0468" />
                            )}
                          </td>
                        );
                      })}
                      <td className={`${cell} border-l border-[var(--color-panel-border)]`} />
                      <td className={`${cell} border-l border-[var(--color-panel-border)] px-2 py-1.5`}>
                        <div className="flex justify-end">
                          <button type="button" className="btn btn-sm hover:bg-white/15 whitespace-nowrap" title={`Add an email for ${nameOf(u)}`} onClick={() => openForm("new", [u.id])}>
                            <Plus className="h-3.5 w-3.5" /> Add email
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                const entry = row.entry;
                const shown = revealed[entry.id];
                const names = peopleNames(entry);
                const owners = ownersOf(entry);
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
                    {platforms.map((platform) => {
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
                    <td className={`${cell} border-l border-[var(--color-panel-border)]`} />
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
                {platforms.map((platform) => (
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

      {/* Hidden while its Delete confirmation is up (both would close on one Esc), back once that closes. */}
      {managingColumns && !confirmRemoveColumn && (
        <AppModal
          title="Platform columns"
          description="The ✓ columns on the Emails tab. Anyone with access to this page can add or delete one, and it's recorded on History. Deleting a column doesn't untick anything — its ticks stay saved and show again if you add it back."
          icon={<Columns3 className="h-4 w-4" />}
          size="md"
          busy={busy}
          onClose={() => { setManagingColumns(false); setNewColumn(""); }}
          footer={<button type="button" className="btn" onClick={() => { setManagingColumns(false); setNewColumn(""); }} disabled={busy}>Done</button>}
        >
          <div className="space-y-4">
            {platformList === null && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Adding and deleting columns needs database migration 0466_email_vault_platform_columns.sql. Until then these are the built-in columns.
              </div>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => { e.preventDefault(); void addColumn(newColumn); }}
            >
              <input
                className="glass-input text-sm flex-1"
                placeholder="New platform, e.g. Whirlpool"
                maxLength={40}
                value={newColumn}
                onChange={(e) => setNewColumn(e.target.value)}
                disabled={busy || platformList === null}
              />
              <button type="submit" className="btn btn-primary" disabled={busy || platformList === null || !newColumn.trim()}>
                <Plus className="h-4 w-4" /> Add column
              </button>
            </form>
            <div className="max-h-[45vh] overflow-y-auto rounded-md border border-[var(--color-panel-border)]">
              {platforms.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">No columns yet — add the first one above.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-panel-border)]">
                  {platforms.map((p) => {
                    const n = tickCounts.get(p) ?? 0;
                    return (
                      <li key={p} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                        <span className="flex-1 font-medium">{p}</span>
                        <span className="text-xs text-muted-foreground">{n ? `ticked on ${n} email${n === 1 ? "" : "s"}` : "not ticked yet"}</span>
                        <button
                          type="button"
                          className="btn btn-sm hover:bg-white/15 text-red-300"
                          title={`Delete the ${p} column`}
                          aria-label={`Delete the ${p} column`}
                          disabled={busy || platformList === null}
                          onClick={() => setConfirmRemoveColumn(p)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {platformList !== null && hiddenTicked.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Deleted columns with ticks still saved</p>
                <div className="flex flex-wrap gap-1.5">
                  {hiddenTicked.map((p) => (
                    <button key={p} type="button" className="btn btn-sm hover:bg-white/15" disabled={busy} title={`Add the ${p} column back — its ${tickCounts.get(p)} tick(s) show again`} onClick={() => void addColumn(p)}>
                      <Plus className="h-3.5 w-3.5" /> {p} ({tickCounts.get(p)})
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </AppModal>
      )}

      {confirmRemoveColumn && (
        <AppModal
          title={`Delete the ${confirmRemoveColumn} column?`}
          description={
            (tickCounts.get(confirmRemoveColumn) ?? 0) > 0
              ? `It's ticked on ${tickCounts.get(confirmRemoveColumn)} email${tickCounts.get(confirmRemoveColumn) === 1 ? "" : "s"}. The column goes away for everyone, but those ticks stay saved — add ${confirmRemoveColumn} back and they show again. History keeps a record.`
              : "The column goes away for everyone. History keeps a record."
          }
          tone="warning"
          size="sm"
          busy={busy}
          onClose={() => setConfirmRemoveColumn(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirmRemoveColumn(null)} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-danger" onClick={() => void removeColumn()} disabled={busy}>{busy ? "Deleting…" : "Delete column"}</button>
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
