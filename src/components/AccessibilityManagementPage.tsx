import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, RefreshCw, Loader2 } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyUsers, updateCompanyUser, type ProfileRow } from "@/lib/supabase/users";
import { ROLE_OPTIONS, ROLE_LABELS, normalizeRole } from "@/lib/roleLabels";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";

interface Props {
  mod: ModuleDef;
  sub: SubModuleDef;
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
  // `${profileId}:${roleCode}` of the one checkbox currently saving, so only
  // that cell shows a spinner/disables instead of freezing the whole grid.
  const [savingCell, setSavingCell] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const rows = await getCompanyUsers();
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
            Check a box to grant that role as an <span className="font-semibold text-white">additional</span>{" "}
            (secondary) role — it stacks on top of, and never replaces, the primary role shown in its own column.
            A user's primary role can only be changed on their own profile page.
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
        <div ref={tableScrollRef} className="panel overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 whitespace-nowrap sticky left-0 bg-slate-950">Name</th>
                <th className="px-3 py-2 whitespace-nowrap">Primary Role</th>
                {ROLE_OPTIONS.map((r) => (
                  <th key={r.value} className="px-2 py-2 text-center whitespace-nowrap font-normal">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={2 + ROLE_OPTIONS.length} className="px-3 py-6 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={2 + ROLE_OPTIONS.length} className="px-3 py-6 text-center text-slate-400">
                    No users found.
                  </td>
                </tr>
              ) : (
                filtered.map((user) => {
                  const primary = normalizeRole(user.role);
                  const extraSet = new Set((user.extra_roles ?? []).map(normalizeRole));
                  return (
                    <tr key={user.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-3 py-2 whitespace-nowrap font-medium text-white sticky left-0 bg-slate-950">
                        {user.display_name || user.email}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-300">
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
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
