import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronDown, RefreshCw, Loader2 } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { MODULES } from "@/lib/modules";
import { getCompanyUsers, updateCompanyUser, type ProfileRow } from "@/lib/supabase/users";
import { ROLE_OPTIONS, ROLE_LABELS, normalizeRole } from "@/lib/roleLabels";
import { DASHBOARD_ROLE_GATES } from "@/lib/dashboardAccess";
import { hydrateModuleRoleGates } from "@/lib/moduleAccess";
import { getModuleRoleGateOverrides, setModuleRoleGateOverride } from "@/lib/supabase/moduleRoleGates";
import { NOTIFICATION_TRIGGERS, getNotificationRoleGateOverrides, setNotificationRoleGateOverride } from "@/lib/supabase/notificationRoleGates";
import { getNotificationOptOuts, setUserNotificationOptOut } from "@/lib/supabase/notificationOptOuts";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";

interface Props {
  mod: ModuleDef;
  sub: SubModuleDef;
}

// Fixed per-column pixel widths, shared by the header table and the body
// table below (see the split-table comment further down for why there are
// two <table> elements). table-layout: fixed + identical <colgroup> widths
// is what keeps their columns pixel-aligned as the body scrolls sideways.
const NAME_COL_W = 190;
const ROLE_COL_W = 150;
const CHECKBOX_COL_W = 92;
const COL_WIDTHS = [NAME_COL_W, ROLE_COL_W, ...ROLE_OPTIONS.map(() => CHECKBOX_COL_W)];
const TABLE_WIDTH = COL_WIDTHS.reduce((sum, w) => sum + w, 0);

function ColGroup() {
  return (
    <colgroup>
      {COL_WIDTHS.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    </colgroup>
  );
}

// Second grid, further down the page: which roles may open each gated
// Dashboard submodule. Only the submodule-title column differs in width
// from the first grid's Name column; role columns reuse CHECKBOX_COL_W so
// both grids line up visually.
const GATE_NAME_COL_W = 260;
const GATE_COL_WIDTHS = [GATE_NAME_COL_W, ...ROLE_OPTIONS.map(() => CHECKBOX_COL_W)];
const GATE_TABLE_WIDTH = GATE_COL_WIDTHS.reduce((sum, w) => sum + w, 0);

function GateColGroup() {
  return (
    <colgroup>
      {GATE_COL_WIDTHS.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    </colgroup>
  );
}

// Fourth grid, further down still: per-user notification opt-outs. One
// column per NOTIFICATION_TRIGGERS entry — wider than a role-code column
// since trigger labels are longer than role labels.
const TRIGGER_COL_W = 170;
const OPTOUT_COL_WIDTHS = [NAME_COL_W, ROLE_COL_W, ...NOTIFICATION_TRIGGERS.map(() => TRIGGER_COL_W)];
const OPTOUT_TABLE_WIDTH = OPTOUT_COL_WIDTHS.reduce((sum, w) => sum + w, 0);

function OptOutColGroup() {
  return (
    <colgroup>
      {OPTOUT_COL_WIDTHS.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    </colgroup>
  );
}

// Every role code, for the display-only fallback of a (module, submodule)
// that has neither an override nor (for Dashboard) a hardcoded default —
// shown as "every role checked" so an unrestricted row visually reads as
// "everyone currently has access," not as "nobody does."
const ALL_ROLE_VALUES = ROLE_OPTIONS.map((r) => r.value);

interface GateRow {
  moduleSlug: string;
  moduleLabel: string;
  slug: string;
  title: string;
}

/**
 * Bulk secondary-role ("Accessibility") assignment grid — one row per
 * company user, one checkbox column per assignable role (ROLE_OPTIONS, the
 * same list the individual user edit page's "User Type" multi-select uses).
 * A checked box means that role is held in extra_roles; the primary role
 * (shown as its own read-only column) is NOT editable here — changing
 * someone's primary role stays a deliberate, one-at-a-time action on their
 * own profile page, since it drives RLS and is a bigger deal than granting
 * an additional permission. This page only ever touches extra_roles.
 */
export function AccessibilityManagementPage({ mod, sub }: Props) {
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  // `${profileId}:${roleCode}` of the one checkbox currently saving, so only
  // that cell shows a spinner/disables instead of freezing the whole grid.
  const [savingCell, setSavingCell] = useState<string | null>(null);
  // Which Primary Role groups are expanded — every group starts collapsed
  // (just its one header row) so browsing all 207+ users doesn't force a
  // long scroll before you reach the group you actually came to edit.
  // Only applies when not searching — a search always shows a flat matching
  // list, so a collapsed group can never hide a result you typed for.
  const [expandedRoleGroups, setExpandedRoleGroups] = useState<Set<string>>(new Set());

  // Dashboard-submodule role-gate grid (second section, below).
  const [dashboardGates, setDashboardGates] = useState<Record<string, string[]>>({});
  const [gatesLoading, setGatesLoading] = useState(true);
  const [savingGateCell, setSavingGateCell] = useState<string | null>(null);
  const gateTableScrollRef = useRef<HTMLDivElement>(null);
  const gateHeaderScrollRef = useRef<HTMLDivElement>(null);
  // The TRUE override map (no "open to everyone" rows filled in) — kept
  // separate from dashboardGates (which fills in ALL_ROLE_VALUES for
  // display on untouched rows) so hydrateModuleRoleGates never mistakes a
  // merely-displayed default for a real override.
  const rawOverridesRef = useRef<Record<string, string[]>>({});
  // Which modules' submodule rows are expanded — every module starts
  // collapsed (just its one header row) so the ~74-row grid across all 6
  // modules doesn't force a long scroll before you reach the one module
  // you actually came to edit.
  const [expandedGateModules, setExpandedGateModules] = useState<Set<string>>(new Set());

  // Notification role-gate grid (third section, below) — which role(s)
  // get notified by each of the app's role-configurable notification
  // triggers (see notificationRoleGates.ts for the full list and why
  // only some notifications qualify — several go to named individuals
  // or back to whoever requested something, not a configurable role).
  const [notificationGates, setNotificationGates] = useState<Record<string, string[]>>({});
  const [notificationGatesLoading, setNotificationGatesLoading] = useState(true);
  const [savingNotificationCell, setSavingNotificationCell] = useState<string | null>(null);
  const notificationTableScrollRef = useRef<HTMLDivElement>(null);
  const notificationHeaderScrollRef = useRef<HTMLDivElement>(null);

  const loadNotificationGates = async () => {
    setNotificationGatesLoading(true);
    try {
      const overrides = await getNotificationRoleGateOverrides();
      const effective: Record<string, string[]> = {};
      for (const trigger of NOTIFICATION_TRIGGERS) {
        effective[trigger.key] = overrides[trigger.key] ?? trigger.defaultRoles;
      }
      setNotificationGates(effective);
    } finally {
      setNotificationGatesLoading(false);
    }
  };

  useEffect(() => {
    void loadNotificationGates();
  }, []);

  const handleNotificationGateToggle = async (triggerKey: string, roleCode: string, checked: boolean) => {
    const prev = notificationGates[triggerKey] ?? [];
    const next = checked ? Array.from(new Set([...prev, roleCode])) : prev.filter((r) => r !== roleCode);

    setNotificationGates((p) => ({ ...p, [triggerKey]: next }));
    const cellKey = `${triggerKey}:${roleCode}`;
    setSavingNotificationCell(cellKey);
    try {
      await setNotificationRoleGateOverride(triggerKey, next);
    } catch (err) {
      setNotificationGates((p) => ({ ...p, [triggerKey]: prev }));
      alert(`Failed to update notification access: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingNotificationCell(null);
    }
  };

  // Per-user notification opt-outs (fourth section, below) — layered on
  // top of Notification Access by Role: a user's role can make them a
  // candidate, but an admin can exclude a specific person here anyway.
  // Reuses this page's own `users`/`roleGroups`/`filtered`/`search`/
  // `expandedRoleGroups` state from the first grid above — same people,
  // just different columns/checkboxes.
  const [notificationOptOuts, setNotificationOptOuts] = useState<Record<string, Set<string>>>({});
  const [optOutsLoading, setOptOutsLoading] = useState(true);
  const [savingOptOutCell, setSavingOptOutCell] = useState<string | null>(null);
  const optOutTableScrollRef = useRef<HTMLDivElement>(null);
  const optOutHeaderScrollRef = useRef<HTMLDivElement>(null);

  const loadNotificationOptOuts = async () => {
    setOptOutsLoading(true);
    try {
      setNotificationOptOuts(await getNotificationOptOuts());
    } finally {
      setOptOutsLoading(false);
    }
  };

  useEffect(() => {
    void loadNotificationOptOuts();
  }, []);

  // Checkbox reads "notify this user" (checked = will get it, matching
  // this page's other grids' "checked = has it" convention) — internally
  // that's the ABSENCE of an opt-out row, so a checked->unchecked toggle
  // here is what actually creates one.
  const handleOptOutToggle = async (user: ProfileRow, triggerKey: string, notifyChecked: boolean) => {
    if (!user.firebase_uid) return;
    const optedOut = !notifyChecked;
    const prevSet = notificationOptOuts[triggerKey] ?? new Set<string>();
    const nextSet = new Set(prevSet);
    if (optedOut) nextSet.add(user.firebase_uid);
    else nextSet.delete(user.firebase_uid);

    setNotificationOptOuts((p) => ({ ...p, [triggerKey]: nextSet }));
    const cellKey = `${user.id}:${triggerKey}`;
    setSavingOptOutCell(cellKey);
    try {
      await setUserNotificationOptOut(user.firebase_uid, triggerKey, optedOut);
    } catch (err) {
      setNotificationOptOuts((p) => ({ ...p, [triggerKey]: prevSet }));
      alert(`Failed to update notification opt-out: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingOptOutCell(null);
    }
  };

  const renderOptOutUserRow = (user: ProfileRow) => {
    const primary = normalizeRole(user.role);
    return (
      <tr key={user.id} className="border-b border-white/5 hover:bg-white/5">
        <td
          className="px-3 py-2 truncate font-medium text-white sticky left-0 z-10 bg-slate-950"
          title={user.display_name || user.email || undefined}
        >
          {user.display_name || user.email}
        </td>
        <td className="px-3 py-2 truncate text-slate-300" title={ROLE_LABELS[primary] || user.role || undefined}>
          {ROLE_LABELS[primary] || user.role || "—"}
        </td>
        {NOTIFICATION_TRIGGERS.map((trigger) => {
          const optedOut = notificationOptOuts[trigger.key]?.has(user.firebase_uid) ?? false;
          const cellKey = `${user.id}:${trigger.key}`;
          const cellSaving = savingOptOutCell === cellKey;
          return (
            <td key={trigger.key} className="px-2 py-2 text-center">
              {cellSaving ? (
                <Loader2 className="h-3.5 w-3.5 mx-auto animate-spin text-slate-400" />
              ) : (
                <input
                  type="checkbox"
                  checked={!optedOut}
                  title={`${optedOut ? "Opted out of" : "Gets"} ${trigger.label}`}
                  onChange={(e) => void handleOptOutToggle(user, trigger.key, e.target.checked)}
                  className="h-4 w-4 accent-blue-500"
                />
              )}
            </td>
          );
        })}
      </tr>
    );
  };

  // Every submodule across every module — grouped by module for the grid
  // below. A row with no override (and, for Dashboard, no hardcoded
  // DASHBOARD_ROLE_GATES entry either) is open to every role today.
  const gateRows = useMemo<GateRow[]>(
    () => MODULES.flatMap((m) => m.submodules.map((s) => ({ moduleSlug: m.slug, moduleLabel: m.label, slug: s.slug, title: s.title }))),
    []
  );

  const loadUsers = async () => {
    setLoading(true);
    try {
      // Deactivated accounts (including cleanup artifacts like a deactivated
      // duplicate profile) are hidden by default here, same as Login Security —
      // they don't need a secondary-role assignment.
      const rows = (await getCompanyUsers()).filter((u) => u.is_active !== false);
      rows.sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));
      setUsers(rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.display_name || "").toLowerCase().includes(q) ||
        (u.username || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q)
    );
  }, [users, search]);

  // Users grouped by Primary Role for the collapsible view (search bypasses
  // this entirely — see expandedRoleGroups). Built from the real data, not
  // ROLE_OPTIONS, since a primary role like SUPERADMIN is deliberately
  // excluded from ROLE_OPTIONS but still needs its own group here.
  const roleGroups = useMemo(() => {
    const map = new Map<string, ProfileRow[]>();
    for (const u of users) {
      const code = normalizeRole(u.role);
      const list = map.get(code);
      if (list) list.push(u);
      else map.set(code, [u]);
    }
    return Array.from(map.entries())
      .map(([code, list]) => ({ code, label: ROLE_LABELS[code] || code || "—", users: list }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [users]);

  const handleToggle = async (user: ProfileRow, roleCode: string, checked: boolean) => {
    const primary = normalizeRole(user.role);
    if (roleCode === primary) return; // primary role isn't editable from this grid

    const prevExtra = user.extra_roles ?? [];
    const nextExtra = checked
      ? Array.from(new Set([...prevExtra, roleCode]))
      : prevExtra.filter((r) => normalizeRole(r) !== roleCode);

    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, extra_roles: nextExtra as any } : u)));
    const cellKey = `${user.id}:${roleCode}`;
    setSavingCell(cellKey);
    try {
      await updateCompanyUser(user.id, { extraRoles: nextExtra as any });
    } catch (err) {
      // Roll back this one cell — every other row/cell is unaffected.
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, extra_roles: prevExtra } : u)));
      alert(`Failed to update role: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingCell(null);
    }
  };

  const renderUserRow = (user: ProfileRow) => {
    const primary = normalizeRole(user.role);
    const extraSet = new Set((user.extra_roles ?? []).map(normalizeRole));
    return (
      <tr key={user.id} className="border-b border-white/5 hover:bg-white/5">
        <td
          className="px-3 py-2 truncate font-medium text-white sticky left-0 z-10 bg-slate-950"
          title={user.display_name || user.email || undefined}
        >
          {user.display_name || user.email}
        </td>
        <td className="px-3 py-2 truncate text-slate-300" title={ROLE_LABELS[primary] || user.role || undefined}>
          {ROLE_LABELS[primary] || user.role || "—"}
        </td>
        {ROLE_OPTIONS.map((r) => {
          const isPrimary = r.value === primary;
          const checked = isPrimary || extraSet.has(r.value);
          const cellKey = `${user.id}:${r.value}`;
          const cellSaving = savingCell === cellKey;
          return (
            <td key={r.value} className="px-2 py-2 text-center">
              {cellSaving ? (
                <Loader2 className="h-3.5 w-3.5 mx-auto animate-spin text-slate-400" />
              ) : (
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isPrimary}
                  title={isPrimary ? "Primary role — change it from this user's profile page" : undefined}
                  onChange={(e) => void handleToggle(user, r.value, e.target.checked)}
                  className="h-4 w-4 accent-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
                />
              )}
            </td>
          );
        })}
      </tr>
    );
  };

  const toggleRoleGroup = (code: string) => {
    setExpandedRoleGroups((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const loadDashboardGates = async () => {
    setGatesLoading(true);
    try {
      const overrides = await getModuleRoleGateOverrides();
      rawOverridesRef.current = overrides;
      const effective: Record<string, string[]> = {};
      for (const row of gateRows) {
        const key = `${row.moduleSlug}:${row.slug}`;
        const hardcodedDefault = row.moduleSlug === "dashboard" ? DASHBOARD_ROLE_GATES[row.slug] : undefined;
        effective[key] = overrides[key] ?? hardcodedDefault ?? ALL_ROLE_VALUES;
      }
      setDashboardGates(effective);
      // Every client (including this tab's own nav gating) reads overrides
      // straight from moduleAccess.ts's hydrated cache — keep it in sync
      // with what we just loaded rather than waiting for the next login.
      hydrateModuleRoleGates(overrides);
    } finally {
      setGatesLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboardGates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGateToggle = async (moduleSlug: string, submoduleSlug: string, roleCode: string, checked: boolean) => {
    const key = `${moduleSlug}:${submoduleSlug}`;
    const prev = dashboardGates[key] ?? [];
    const next = checked ? Array.from(new Set([...prev, roleCode])) : prev.filter((r) => r !== roleCode);

    setDashboardGates((p) => ({ ...p, [key]: next }));
    const cellKey = `${key}:${roleCode}`;
    setSavingGateCell(cellKey);
    try {
      await setModuleRoleGateOverride(moduleSlug, submoduleSlug, next);
      // Reflect the change in this tab's own nav gating immediately too,
      // instead of only taking effect on the next login/reload — only the
      // ONE real override changes here, everything else stays exactly what
      // it actually is in the database (never the "all roles" display
      // fallback dashboardGates uses for an untouched row).
      rawOverridesRef.current = { ...rawOverridesRef.current, [key]: next };
      hydrateModuleRoleGates(rawOverridesRef.current);
    } catch (err) {
      // Roll back this one cell — every other row/cell is unaffected.
      setDashboardGates((p) => ({ ...p, [key]: prev }));
      alert(`Failed to update module access: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingGateCell(null);
    }
  };

  return (
    <main className="flex-1 bg-slate-950 py-6">
      <div className="max-w-[1600px] mx-auto px-6">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-white">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn">
            <ChevronLeft className="h-4 w-4" />
            {mod.label}
          </Link>
          <div>
            <h1 className="text-2xl font-semibold leading-tight">{sub.title}</h1>
            <p className="text-sm text-muted-foreground">{sub.description}</p>
          </div>
          <button
            onClick={() => void loadUsers()}
            disabled={loading}
            className="ml-auto inline-flex items-center gap-2 btn hover:bg-white/15 disabled:opacity-60"
            title="Re-read users from Supabase"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        <div className="panel mb-4">
          <p className="text-sm text-slate-300">
            Users are grouped by Primary Role, collapsed by default — click a group to expand it. Search for a name,
            login, or email to bypass grouping and show a flat matching list instead. Check a box to grant that role
            as an <span className="font-semibold text-white">additional</span> (secondary) role — it stacks on top
            of, and never replaces, the primary role shown in its own column. A user's primary role can only be
            changed on their own profile page.
          </p>
        </div>

        <div className="mb-4 max-w-md">
          <label className="block text-xs font-semibold uppercase tracking-[0.04em] text-slate-400">Search</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, login, or email..."
            className="glass-input mt-2 w-full"
            disabled={loading}
          />
        </div>

        <div className="text-sm text-slate-400 mb-2">
          {loading ? "Fetching from database..." : `${filtered.length} of ${users.length} users`}
        </div>

        <FloatingHorizontalScrollbar targetRef={tableScrollRef} />
        {/*
          Two separate <table>s (header-only, body-only) instead of one —
          a single table can't have a header that's sticky against the PAGE
          while also living inside an overflow-x-auto wrapper: CSS forces
          overflow-y to `auto` the moment overflow-x isn't `visible` (an
          axis can't stay `visible` while the other isn't), which silently
          traps `position: sticky` inside that wrapper instead of letting
          it stick to the viewport, forcing a second inner scrollbar.
          Splitting it in two keeps the header wrapper free of any
          overflow-x-auto ancestor (so `sticky top-16` — same offset as the
          ticket detail page's header — sticks to the real page), while the
          body wrapper below it owns the one real (native) horizontal
          scrollbar; a scroll listener mirrors the body's scrollLeft onto
          the header so they move together. table-layout: fixed with an
          identical <colgroup> in both keeps their columns pixel-aligned.
        */}
        <div
          ref={headerScrollRef}
          className="overflow-x-hidden rounded-t-lg border border-b-0 border-[var(--color-panel-border)] bg-[var(--color-panel)] backdrop-blur-md sticky top-16 z-20"
        >
          <table className="text-sm" style={{ tableLayout: "fixed", width: TABLE_WIDTH }}>
            <ColGroup />
            <thead>
              <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 truncate sticky left-0 z-10 bg-slate-950">Name</th>
                <th className="px-3 py-2 whitespace-nowrap truncate">Primary Role</th>
                {ROLE_OPTIONS.map((r) => (
                  <th key={r.value} className="px-2 py-2 text-center font-normal leading-tight">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
        <div
          ref={tableScrollRef}
          onScroll={(e) => {
            if (headerScrollRef.current) headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
          }}
          className="overflow-x-auto rounded-b-lg border border-[var(--color-panel-border)] bg-[var(--color-panel)] backdrop-blur-md"
        >
          <table className="text-sm" style={{ tableLayout: "fixed", width: TABLE_WIDTH }}>
            <ColGroup />
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={2 + ROLE_OPTIONS.length} className="px-3 py-6 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : search.trim() ? (
                // Searching always shows a flat matching list — a collapsed
                // group could otherwise hide the very result you searched for.
                filtered.length === 0 ? (
                  <tr>
                    <td colSpan={2 + ROLE_OPTIONS.length} className="px-3 py-6 text-center text-slate-400">
                      No users found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((user) => renderUserRow(user))
                )
              ) : (
                roleGroups.flatMap((group) => {
                  const isExpanded = expandedRoleGroups.has(group.code);
                  const headerRow = (
                    <tr key={`role-${group.code}`} className="border-b border-white/10 bg-white/5">
                      <td colSpan={2 + ROLE_OPTIONS.length} className="p-0 sticky left-0 bg-slate-900">
                        <button
                          type="button"
                          data-testid="user-role-group-row"
                          data-role-code={group.code}
                          onClick={() => toggleRoleGroup(group.code)}
                          aria-expanded={isExpanded}
                          className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-300 hover:bg-white/5 transition-colors"
                        >
                          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                          {group.label} ({group.users.length})
                        </button>
                      </td>
                    </tr>
                  );
                  if (!isExpanded) return [headerRow];
                  return [headerRow, ...group.users.map((user) => renderUserRow(user))];
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-10 mb-4">
          <h2 className="text-xl font-semibold text-white">Module Access by Role</h2>
          <p className="text-sm text-slate-400 mt-1">
            Click a module name to expand or collapse its submodules — every module starts collapsed. Check a box to
            let that role open the submodule (from its tile grid, and directly by URL). A row you haven't edited yet
            shows the built-in default — every role for most submodules, or the Dashboard's own built-in list for the
            few that have one. Changing any box here replaces that submodule's whole list, company-wide, immediately.
            Super Admin can always open every submodule regardless of this grid.
          </p>
        </div>

        <FloatingHorizontalScrollbar targetRef={gateTableScrollRef} />
        <div
          ref={gateHeaderScrollRef}
          className="overflow-x-hidden rounded-t-lg border border-b-0 border-[var(--color-panel-border)] bg-[var(--color-panel)] backdrop-blur-md sticky top-16 z-20"
        >
          <table className="text-sm" style={{ tableLayout: "fixed", width: GATE_TABLE_WIDTH }}>
            <GateColGroup />
            <thead>
              <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 truncate sticky left-0 z-10 bg-slate-950">Module / Submodule</th>
                {ROLE_OPTIONS.map((r) => (
                  <th key={r.value} className="px-2 py-2 text-center font-normal leading-tight">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
        <div
          ref={gateTableScrollRef}
          onScroll={(e) => {
            if (gateHeaderScrollRef.current) gateHeaderScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
          }}
          className="overflow-x-auto rounded-b-lg border border-[var(--color-panel-border)] bg-[var(--color-panel)] backdrop-blur-md"
        >
          <table className="text-sm" style={{ tableLayout: "fixed", width: GATE_TABLE_WIDTH }}>
            <GateColGroup />
            <tbody>
              {gatesLoading ? (
                <tr>
                  <td colSpan={1 + ROLE_OPTIONS.length} className="px-3 py-6 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : (
                MODULES.flatMap((m) => {
                  const isModuleExpanded = expandedGateModules.has(m.slug);
                  const headerRow = (
                    <tr key={`mod-${m.slug}`} className="border-b border-white/10 bg-white/5">
                      <td colSpan={1 + ROLE_OPTIONS.length} className="p-0 sticky left-0 bg-slate-900">
                        <button
                          type="button"
                          data-testid="gate-module-row"
                          data-module-slug={m.slug}
                          onClick={() =>
                            setExpandedGateModules((prev) => {
                              const next = new Set(prev);
                              if (next.has(m.slug)) next.delete(m.slug);
                              else next.add(m.slug);
                              return next;
                            })
                          }
                          aria-expanded={isModuleExpanded}
                          className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-300 hover:bg-white/5 transition-colors"
                        >
                          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${isModuleExpanded ? "rotate-180" : ""}`} />
                          {m.label}
                        </button>
                      </td>
                    </tr>
                  );
                  if (!isModuleExpanded) return [headerRow];
                  return [
                    headerRow,
                    ...m.submodules.map((s) => {
                      const key = `${m.slug}:${s.slug}`;
                      const allowed = new Set(dashboardGates[key] ?? []);
                      return (
                        <tr key={key} data-testid="gate-submodule-row" className="border-b border-white/5 hover:bg-white/5">
                          <td
                            className="px-3 py-2 truncate font-medium text-white sticky left-0 z-10 bg-slate-950"
                            title={s.title}
                          >
                            {s.title}
                          </td>
                          {ROLE_OPTIONS.map((r) => {
                            const checked = allowed.has(r.value);
                            const cellKey = `${key}:${r.value}`;
                            const cellSaving = savingGateCell === cellKey;
                            return (
                              <td key={r.value} className="px-2 py-2 text-center">
                                {cellSaving ? (
                                  <Loader2 className="h-3.5 w-3.5 mx-auto animate-spin text-slate-400" />
                                ) : (
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => void handleGateToggle(m.slug, s.slug, r.value, e.target.checked)}
                                    className="h-4 w-4 accent-blue-500"
                                  />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    }),
                  ];
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-10 mb-4">
          <h2 className="text-xl font-semibold text-white">Notification Access by Role</h2>
          <p className="text-sm text-slate-400 mt-1">
            Check a box to have that role notified when the trigger on the left fires. A row you haven't edited yet
            shows its built-in default (usually Parts Manager). This only covers notifications that are genuinely
            "which role should hear about this" — a few notifications elsewhere in the app go to named individuals
            or back to whoever originally requested something, and aren't configurable here.
          </p>
        </div>

        <FloatingHorizontalScrollbar targetRef={notificationTableScrollRef} />
        <div
          ref={notificationHeaderScrollRef}
          className="overflow-x-hidden rounded-t-lg border border-b-0 border-[var(--color-panel-border)] bg-[var(--color-panel)] backdrop-blur-md sticky top-16 z-20"
        >
          <table className="text-sm" style={{ tableLayout: "fixed", width: GATE_TABLE_WIDTH }}>
            <GateColGroup />
            <thead>
              <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 truncate sticky left-0 z-10 bg-slate-950">Notification</th>
                {ROLE_OPTIONS.map((r) => (
                  <th key={r.value} className="px-2 py-2 text-center font-normal leading-tight">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
        <div
          ref={notificationTableScrollRef}
          onScroll={(e) => {
            if (notificationHeaderScrollRef.current) notificationHeaderScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
          }}
          className="overflow-x-auto rounded-b-lg border border-[var(--color-panel-border)] bg-[var(--color-panel)] backdrop-blur-md"
        >
          <table className="text-sm" style={{ tableLayout: "fixed", width: GATE_TABLE_WIDTH }}>
            <GateColGroup />
            <tbody>
              {notificationGatesLoading ? (
                <tr>
                  <td colSpan={1 + ROLE_OPTIONS.length} className="px-3 py-6 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : (
                NOTIFICATION_TRIGGERS.map((trigger) => {
                  const allowed = new Set(notificationGates[trigger.key] ?? []);
                  return (
                    <tr key={trigger.key} className="border-b border-white/5 hover:bg-white/5">
                      <td
                        className="px-3 py-2 sticky left-0 z-10 bg-slate-950"
                        title={trigger.description}
                      >
                        <div className="font-medium text-white truncate">{trigger.label}</div>
                        <div className="text-xs text-slate-500 truncate">{trigger.description}</div>
                      </td>
                      {ROLE_OPTIONS.map((r) => {
                        const checked = allowed.has(r.value);
                        const cellKey = `${trigger.key}:${r.value}`;
                        const cellSaving = savingNotificationCell === cellKey;
                        return (
                          <td key={r.value} className="px-2 py-2 text-center">
                            {cellSaving ? (
                              <Loader2 className="h-3.5 w-3.5 mx-auto animate-spin text-slate-400" />
                            ) : (
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => void handleNotificationGateToggle(trigger.key, r.value, e.target.checked)}
                                className="h-4 w-4 accent-blue-500"
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-10 mb-4">
          <h2 className="text-xl font-semibold text-white">Notification Opt-Outs by User</h2>
          <p className="text-sm text-slate-400 mt-1">
            Layered on top of Notification Access by Role above — a role check makes someone a candidate, but you can
            uncheck a specific person here to exclude them from that one trigger anyway. Checked means they'll get
            it (the default); unchecked means they've been opted out. Same grouping/search as the first grid.
          </p>
        </div>

        <FloatingHorizontalScrollbar targetRef={optOutTableScrollRef} />
        <div
          ref={optOutHeaderScrollRef}
          className="overflow-x-hidden rounded-t-lg border border-b-0 border-[var(--color-panel-border)] bg-[var(--color-panel)] backdrop-blur-md sticky top-16 z-20"
        >
          <table className="text-sm" style={{ tableLayout: "fixed", width: OPTOUT_TABLE_WIDTH }}>
            <OptOutColGroup />
            <thead>
              <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 truncate sticky left-0 z-10 bg-slate-950">Name</th>
                <th className="px-3 py-2 whitespace-nowrap truncate">Primary Role</th>
                {NOTIFICATION_TRIGGERS.map((trigger) => (
                  <th key={trigger.key} className="px-2 py-2 text-center font-normal leading-tight" title={trigger.description}>
                    {trigger.label}
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
        <div
          ref={optOutTableScrollRef}
          onScroll={(e) => {
            if (optOutHeaderScrollRef.current) optOutHeaderScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
          }}
          className="overflow-x-auto rounded-b-lg border border-[var(--color-panel-border)] bg-[var(--color-panel)] backdrop-blur-md"
        >
          <table className="text-sm" style={{ tableLayout: "fixed", width: OPTOUT_TABLE_WIDTH }}>
            <OptOutColGroup />
            <tbody>
              {loading || optOutsLoading ? (
                <tr>
                  <td colSpan={2 + NOTIFICATION_TRIGGERS.length} className="px-3 py-6 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : search.trim() ? (
                filtered.length === 0 ? (
                  <tr>
                    <td colSpan={2 + NOTIFICATION_TRIGGERS.length} className="px-3 py-6 text-center text-slate-400">
                      No users found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((user) => renderOptOutUserRow(user))
                )
              ) : (
                roleGroups.flatMap((group) => {
                  const isExpanded = expandedRoleGroups.has(group.code);
                  const headerRow = (
                    <tr key={`optout-role-${group.code}`} className="border-b border-white/10 bg-white/5">
                      <td colSpan={2 + NOTIFICATION_TRIGGERS.length} className="p-0 sticky left-0 bg-slate-900">
                        <button
                          type="button"
                          onClick={() => toggleRoleGroup(group.code)}
                          aria-expanded={isExpanded}
                          className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-300 hover:bg-white/5 transition-colors"
                        >
                          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                          {group.label} ({group.users.length})
                        </button>
                      </td>
                    </tr>
                  );
                  if (!isExpanded) return [headerRow];
                  return [headerRow, ...group.users.map((user) => renderOptOutUserRow(user))];
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
