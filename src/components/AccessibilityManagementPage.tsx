import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Loader2, ArrowRight, Inbox, CheckCircle2, Plus, X, Settings, Pencil, Trash2, Check } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { MODULES } from "@/lib/modules";
import { ROLE_LABELS, ROLE_OPTIONS } from "@/lib/roleLabels";
import { useAllRoleOptions, useCustomRoles, createCustomRole, setRoleLabel, deleteCustomRole } from "@/lib/customRoles";
import { DASHBOARD_ROLE_GATES } from "@/lib/dashboardAccess";
import { hydrateModuleRoleGates } from "@/lib/moduleAccess";
import { getModuleRoleGateOverrides, setModuleRoleGateOverride } from "@/lib/supabase/moduleRoleGates";

interface Props {
  mod: ModuleDef;
  sub: SubModuleDef;
}

// Admin-tier codes excluded from Manage Roles' "Built-in Roles" rename
// list — never editable from the UI, even just the display label, since
// they're the roles that grant the ability to reach this page at all.
// SUPERADMIN/SUPERSUPERADMIN are already excluded from ROLE_OPTIONS
// itself; ADMIN is listed defensively too since it IS in ROLE_OPTIONS.
const NON_RENAMABLE_BUILTIN_CODES = new Set(["ADMIN", "SUPERADMIN", "SUPERSUPERADMIN"]);

// Click-to-move alternate view for "Module Access by Role" — one role at a
// time, two containers, each page living in exactly one of them so nothing
// repeats the way it would showing every role as its own column. Reuses the
// same GateRow shape, dashboardGates state, and handleGateToggle save path
// the Grid view already had. Deliberately NOT drag-and-drop: an earlier
// @dnd-kit-based version of this kept silently losing edits (a drop's
// trailing synthetic click re-toggling whatever card ended up under the
// pointer, or the whole gesture just not registering depending on where a
// drag ended relative to the container boundary) — a plain move button with
// no pointer-capture/collision-detection machinery underneath it has none
// of those failure modes, so it's the more reliable choice here even though
// it's a smaller motion than a real drag.
// One accent color per top-level module (Dashboard/Tickets/Parts/Claims/
// Report/Admin) — reusing MODULES' own ModuleDef.accent (already the app's
// canonical per-module color, shown as each module's tile dot on the home
// screen) rather than inventing a second palette, so a page's card color
// here means the same thing it does everywhere else in the app.
const moduleAccentBySlug = new Map(MODULES.map((m) => [m.slug, m.accent]));

export function ModuleAccessCard({ title, moduleLabel, moduleSlug, onMove, direction }: { title: string; moduleLabel: string; moduleSlug: string; onMove: () => void; direction: "grant" | "revoke" }) {
  const accent = moduleAccentBySlug.get(moduleSlug) ?? "#94a3b8";
  return (
    <button
      type="button"
      onClick={onMove}
      title={direction === "grant" ? "Grant access" : "Revoke access"}
      style={{ borderLeftColor: accent, borderLeftWidth: "3px" }}
      className="group flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-left hover:bg-white/[0.08] transition-colors"
    >
      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: accent }} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate" title={title}>{title}</div>
        <div className="text-xs truncate" style={{ color: accent }}>{moduleLabel}</div>
      </div>
      <span
        className={`shrink-0 rounded-md p-1.5 transition-colors ${
          direction === "grant"
            ? "text-muted-foreground group-hover:text-foreground group-hover:bg-white/10"
            : "text-red-400/80 group-hover:text-red-300 group-hover:bg-red-500/10"
        }`}
      >
        {direction === "grant" ? <ArrowRight className="h-4 w-4" /> : <X className="h-4 w-4" />}
      </span>
    </button>
  );
}

export function AccessListContainer({ label, count, icon, tint, children }: { label: string; count: number; icon: React.ReactNode; tint: "neutral" | "granted"; children: React.ReactNode }) {
  const idleBorder = tint === "granted" ? "border-emerald-500/30" : "border-white/10";
  const idleBg = tint === "granted" ? "bg-emerald-500/[0.04]" : "bg-white/5";
  return (
    <div className={`flex-1 min-w-0 rounded-xl border-2 p-4 space-y-2 min-h-[24rem] max-h-[42rem] overflow-y-auto ${idleBorder} ${idleBg}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-3 flex items-center gap-2 sticky top-0 -mx-4 -mt-4 px-4 pt-4 pb-2 bg-slate-950/95 backdrop-blur-sm z-10">
        {icon} {label} · {count}
      </div>
      {children}
    </div>
  );
}

export function ModuleAccessEditor({
  gateRows,
  dashboardGates,
  selectedRole,
  onSelectedRoleChange,
  filter,
  onFilterChange,
  onToggle,
  pendingCount,
  saving,
  saveError,
  onSaveAll,
  onDiscardAll,
}: {
  gateRows: GateRow[];
  dashboardGates: Record<string, string[]>;
  selectedRole: string;
  onSelectedRoleChange: (role: string) => void;
  filter: string;
  onFilterChange: (v: string) => void;
  onToggle: (moduleSlug: string, submoduleSlug: string, roleCode: string, checked: boolean) => void;
  pendingCount: number;
  saving: boolean;
  saveError: string | null;
  onSaveAll: () => void;
  onDiscardAll: () => void;
}) {
  const roleOptions = useAllRoleOptions();
  const customRoles = useCustomRoles();
  const allRoleValues = useMemo(() => roleOptions.map((r) => r.value), [roleOptions]);
  const [addRoleOpen, setAddRoleOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [addRoleError, setAddRoleError] = useState<string | null>(null);
  const [creatingRole, setCreatingRole] = useState(false);

  // Manage Roles modal — rename/delete for company-created custom roles
  // only. Built-in roles (ROLE_LABELS, src/lib/roleLabels.ts) aren't listed
  // here — they're referenced by dozens of hardcoded permission checks
  // throughout the app, so renaming/deleting one is a code change, not a
  // UI action.
  const [manageRolesOpen, setManageRolesOpen] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [confirmDeleteCode, setConfirmDeleteCode] = useState<string | null>(null);
  const [roleActionBusy, setRoleActionBusy] = useState<string | null>(null);
  const [roleActionError, setRoleActionError] = useState<string | null>(null);

  const q = filter.trim().toLowerCase();
  const filtered = q ? gateRows.filter((r) => r.title.toLowerCase().includes(q) || r.moduleLabel.toLowerCase().includes(q)) : gateRows;
  const isGranted = (row: GateRow) => (dashboardGates[`${row.moduleSlug}:${row.slug}`] ?? allRoleValues).includes(selectedRole);
  const granted = filtered.filter(isGranted);
  const available = filtered.filter((r) => !isGranted(r));

  const move = (row: GateRow, toGranted: boolean) => onToggle(row.moduleSlug, row.slug, selectedRole, toGranted);

  const handleCreateRole = async () => {
    setCreatingRole(true);
    setAddRoleError(null);
    try {
      const role = await createCustomRole(newRoleName);
      onSelectedRoleChange(role.code);
      setAddRoleOpen(false);
      setNewRoleName("");
    } catch (err) {
      setAddRoleError(err instanceof Error ? err.message : "Failed to create role.");
    } finally {
      setCreatingRole(false);
    }
  };

  const startEditingRole = (code: string, label: string) => {
    setRoleActionError(null);
    setConfirmDeleteCode(null);
    setEditingCode(code);
    setEditingLabel(label);
  };

  const handleRenameRole = async (code: string) => {
    setRoleActionBusy(code);
    setRoleActionError(null);
    try {
      await setRoleLabel(code, editingLabel);
      setEditingCode(null);
    } catch (err) {
      setRoleActionError(err instanceof Error ? err.message : "Failed to rename role.");
    } finally {
      setRoleActionBusy(null);
    }
  };

  const handleDeleteRole = async (code: string) => {
    setRoleActionBusy(code);
    setRoleActionError(null);
    try {
      await deleteCustomRole(code);
      setConfirmDeleteCode(null);
      // The deleted role can't stay selected — fall back to the first
      // remaining option so the picker/select never points at a role that
      // no longer exists.
      if (selectedRole === code) onSelectedRoleChange(roleOptions.find((r) => r.value !== code)?.value ?? "");
    } catch (err) {
      setRoleActionError(err instanceof Error ? err.message : "Failed to delete role.");
    } finally {
      setRoleActionBusy(null);
    }
  };

  // One row in the Manage Roles modal — shared between the Custom Roles
  // section (canDelete=true) and the Built-in Roles section (canDelete=
  // false, rename only, since a built-in's code can't actually be removed —
  // it's a literal entry in roleLabels.ts, not a database row).
  const renderManageRoleRow = (code: string, label: string, canDelete: boolean) => {
    const busy = roleActionBusy === code;
    const isEditing = editingCode === code;
    const isConfirmingDelete = confirmDeleteCode === code;
    return (
      <div key={code} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              autoFocus
              value={editingLabel}
              onChange={(e) => setEditingLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && editingLabel.trim() && !busy) void handleRenameRole(code); }}
              className="glass-input flex-1 text-sm py-1.5 px-2"
            />
            <button
              type="button"
              onClick={() => void handleRenameRole(code)}
              disabled={busy || !editingLabel.trim()}
              title="Save"
              className="shrink-0 rounded-md p-1.5 text-emerald-400 hover:bg-white/10 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </button>
            <button type="button" onClick={() => setEditingCode(null)} disabled={busy} title="Cancel" className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-white/10">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : isConfirmingDelete ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm text-slate-200 truncate">Delete "{label}"?</span>
            <button
              type="button"
              onClick={() => void handleDeleteRole(code)}
              disabled={busy}
              className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold bg-red-500/20 text-red-300 hover:bg-red-500/30 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : "Delete"}
            </button>
            <button type="button" onClick={() => setConfirmDeleteCode(null)} disabled={busy} className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-white/10">
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm text-slate-200 truncate">{label}</span>
            <button type="button" onClick={() => startEditingRole(code, label)} title="Rename" className="shrink-0 rounded-md p-1.5 text-slate-400 hover:text-white hover:bg-white/10">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {canDelete && (
              <button type="button" onClick={() => { setRoleActionError(null); setEditingCode(null); setConfirmDeleteCode(code); }} title="Delete" className="shrink-0 rounded-md p-1.5 text-slate-400 hover:text-red-400 hover:bg-white/10">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="panel p-6 mb-8">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Role</label>
        <select
          value={selectedRole}
          onChange={(e) => onSelectedRoleChange(e.target.value)}
          className="glass-input text-base py-2 px-3 rounded-md"
        >
          {roleOptions.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => { setAddRoleOpen(true); setAddRoleError(null); }}
          className="btn text-sm py-2 px-3 inline-flex items-center gap-1.5"
          title="Create a new role"
        >
          <Plus className="h-4 w-4" /> Add Role
        </button>
        <button
          type="button"
          onClick={() => { setManageRolesOpen(true); setRoleActionError(null); setEditingCode(null); setConfirmDeleteCode(null); }}
          className="btn text-sm py-2 px-3 inline-flex items-center gap-1.5"
          title="Rename or delete custom roles"
        >
          <Settings className="h-4 w-4" /> Manage Roles
        </button>
        <input
          type="text"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter pages…"
          className="glass-input text-base py-2 px-3 rounded-md ml-auto w-64"
        />
      </div>

      {/* Explicit Save bar — clicking a card only stages a local change now
          (see the parent's handleGateToggle), it does NOT write to the
          database by itself. Nothing here persists until "Save Changes" is
          clicked, which is the point: a save that only fires on a single,
          deliberate click is much easier to reason about (and to trust) than
          one silently firing on every card click, especially after this
          exact page's auto-save kept appearing to lose edits. */}
      {(pendingCount > 0 || saveError) && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <span className="text-sm font-medium text-amber-200">
            {saveError ? saveError : `${pendingCount} unsaved change${pendingCount === 1 ? "" : "s"}`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onDiscardAll}
              disabled={saving}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/10 disabled:opacity-40"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={onSaveAll}
              disabled={saving || pendingCount === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      )}

      {addRoleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-white/15 bg-slate-950/95 shadow-2xl shadow-black/60 p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-semibold text-white">Add Role</h3>
              <button type="button" onClick={() => setAddRoleOpen(false)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-[0.04em] text-slate-400 mb-1.5">Role name</label>
            <input
              type="text"
              autoFocus
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newRoleName.trim() && !creatingRole) void handleCreateRole(); }}
              placeholder="e.g. Warehouse Lead"
              className="glass-input w-full"
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Immediately usable as a primary or extra role in User Management, and grantable/gate-able here like any other role.
            </p>
            {addRoleError && <p className="mt-2 text-xs text-red-400">{addRoleError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setAddRoleOpen(false)} disabled={creatingRole} className="btn hover:bg-slate-800">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreateRole()}
                disabled={creatingRole || !newRoleName.trim()}
                className="btn btn-primary disabled:opacity-50"
              >
                {creatingRole && <Loader2 className="h-4 w-4 animate-spin mr-1 inline" />}
                {creatingRole ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {manageRolesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-xl border border-white/15 bg-slate-950/95 shadow-2xl shadow-black/60 p-5">
            <div className="flex items-center justify-between gap-3 mb-1">
              <h3 className="text-lg font-semibold text-white">Manage Roles</h3>
              <button type="button" onClick={() => setManageRolesOpen(false)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mb-4">
              Custom roles can be renamed or deleted. Built-in roles can only have their display label renamed — their
              code (what permissions actually check) never changes. Admin, Super Admin, and Super Super Admin aren't
              editable at all.
            </p>
            {roleActionError && <p className="mb-3 text-xs text-red-400">{roleActionError}</p>}

            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-1.5">Custom Roles</div>
            {customRoles.length === 0 ? (
              <p className="text-sm text-muted-foreground italic py-3 text-center mb-4">No custom roles yet — use Add Role to create one.</p>
            ) : (
              <div className="space-y-1.5 mb-4">
                {customRoles.map((r) => renderManageRoleRow(r.code, r.label, true))}
              </div>
            )}

            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-1.5">Built-in Roles</div>
            <div className="space-y-1.5">
              {ROLE_OPTIONS.filter((r) => !NON_RENAMABLE_BUILTIN_CODES.has(r.value)).map((r) =>
                renderManageRoleRow(r.value, roleOptions.find((o) => o.value === r.value)?.label ?? r.label, false)
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-4 flex-col md:flex-row">
        <AccessListContainer label="Available" count={available.length} icon={<Inbox className="h-4 w-4" />} tint="neutral">
          {available.map((row) => (
            <ModuleAccessCard
              key={`${row.moduleSlug}:${row.slug}`}
              title={row.title}
              moduleLabel={row.moduleLabel}
              moduleSlug={row.moduleSlug}
              direction="grant"
              onMove={() => move(row, true)}
            />
          ))}
          {available.length === 0 && <div className="text-sm text-muted-foreground italic px-1 py-4 text-center">Nothing here.</div>}
        </AccessListContainer>
        <AccessListContainer label={`Granted to ${ROLE_LABELS[selectedRole] ?? selectedRole}`} count={granted.length} icon={<CheckCircle2 className="h-4 w-4" />} tint="granted">
          {granted.map((row) => (
            <ModuleAccessCard
              key={`${row.moduleSlug}:${row.slug}`}
              title={row.title}
              moduleLabel={row.moduleLabel}
              moduleSlug={row.moduleSlug}
              direction="revoke"
              onMove={() => move(row, false)}
            />
          ))}
          {granted.length === 0 && <div className="text-sm text-muted-foreground italic px-1 py-4 text-center">Nothing here.</div>}
        </AccessListContainer>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Click a page's arrow to grant {ROLE_LABELS[selectedRole] ?? selectedRole} access, or the X on a granted page to
        revoke it. Each card's dot/label color matches its parent module. Nothing is saved until you click "Save Changes" above.
      </p>
    </div>
  );
}

interface GateRow {
  moduleSlug: string;
  moduleLabel: string;
  slug: string;
  title: string;
}

/**
 * Bulk secondary-role ("Accessibility") assignment grid — one row per
 * company user, one checkbox column per assignable role (roleOptions below —
 * built-in roles plus any custom ones, the same list the individual user
 * edit page's "User Type" multi-select uses).
 * A checked box means that role is held in extra_roles; the primary role
 * (shown as its own read-only column) is NOT editable here — changing
 * someone's primary role stays a deliberate, one-at-a-time action on their
 * own profile page, since it drives RLS and is a bigger deal than granting
 * an additional permission. This page only ever touches extra_roles.
 */
export function AccessibilityManagementPage({ mod, sub }: Props) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));

  // Built-in roles plus any company-created custom roles (see
  // src/lib/customRoles.ts) — the live source for every role picker/column
  // on this page. Every role code, for the display-only fallback of a
  // (module, submodule) that has neither an override nor (for Dashboard) a
  // hardcoded default — shown as "every role checked" so an unrestricted
  // row visually reads as "everyone currently has access," not "nobody
  // does" (including a role created after that row's fallback was baked in
  // — see the loadDashboardGates effect's dependency on roleOptions.length
  // below, which re-bakes it when a new role appears).
  const roleOptions = useAllRoleOptions();
  const allRoleValues = useMemo(() => roleOptions.map((r) => r.value), [roleOptions]);

  const [dashboardGates, setDashboardGates] = useState<Record<string, string[]>>({});
  const [gatesLoading, setGatesLoading] = useState(true);
  // The TRUE override map (no "open to everyone" rows filled in) — kept
  // separate from dashboardGates (which fills in allRoleValues for
  // display on untouched rows) so hydrateModuleRoleGates never mistakes a
  // merely-displayed default for a real override.
  const rawOverridesRef = useRef<Record<string, string[]>>({});

  // Staged-but-unsaved edits — a card click no longer writes to the
  // database by itself, it just records what WOULD be written here.
  // pendingSaves is what "Save Changes" actually sends; originalValues is
  // what "Discard" reverts dashboardGates back to. Both keyed by
  // `${moduleSlug}:${submoduleSlug}`, and only ever gains an entry the
  // FIRST time a given row is touched in this batch — a second edit to the
  // same row updates pendingSaves but must never overwrite originalValues,
  // or Discard would "revert" to an already-edited value.
  const [pendingSaves, setPendingSaves] = useState<Record<string, { moduleSlug: string; submoduleSlug: string; roles: string[] }>>({});
  const [originalValues, setOriginalValues] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // A module tile's gear icon (home.tsx's quick-edit modal footer link)
  // deep-links here as ?focusModule=<slug> — land already filtered to just
  // that module's pages instead of the full list across every module.
  const focusModuleSlug = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("focusModule") : null;
  const focusModuleLabel = focusModuleSlug ? MODULES.find((m) => m.slug === focusModuleSlug)?.label ?? "" : "";

  // Every submodule across every module — the source list for the
  // Available/Granted editor below. A row with no override (and, for
  // Dashboard, no hardcoded DASHBOARD_ROLE_GATES entry either) is open to
  // every role today.
  const gateRows = useMemo<GateRow[]>(
    () => MODULES.flatMap((m) => m.submodules.map((s) => ({ moduleSlug: m.slug, moduleLabel: m.label, slug: s.slug, title: s.title }))),
    []
  );

  const [dndSelectedRole, setDndSelectedRole] = useState(roleOptions[0]?.value ?? "");
  const [dndFilter, setDndFilter] = useState(focusModuleLabel);

  const loadDashboardGates = async () => {
    setGatesLoading(true);
    try {
      const overrides = await getModuleRoleGateOverrides();
      rawOverridesRef.current = overrides;
      const effective: Record<string, string[]> = {};
      for (const row of gateRows) {
        const key = `${row.moduleSlug}:${row.slug}`;
        const hardcodedDefault = (row.moduleSlug === "dashboard" || row.moduleSlug === "hr" || row.moduleSlug === "accounting" || row.moduleSlug === "csr") ? DASHBOARD_ROLE_GATES[row.slug] : undefined;
        effective[key] = overrides[key] ?? hardcodedDefault ?? allRoleValues;
      }
      // Re-apply any not-yet-saved edits on top of the fresh load — this
      // effect can in principle re-run mid-edit (its dep is roleOptions
      // .length, which changes if a custom role is added while a save is
      // still pending), and a reload must never silently wipe an edit the
      // Save bar is still showing as unsaved.
      for (const [key, entry] of Object.entries(pendingSaves)) effective[key] = entry.roles;
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
    // Re-runs when a custom role is added (roleOptions.length grows) so any
    // row's "open to everyone" fallback gets re-baked to include the new
    // role, not just whichever roles existed at the last load.
    void loadDashboardGates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleOptions.length]);

  // Local-only — records the intended change and updates the display, but
  // does NOT write to the database. See handleSaveAll for the actual write.
  const handleGateToggle = (moduleSlug: string, submoduleSlug: string, roleCode: string, checked: boolean) => {
    const key = `${moduleSlug}:${submoduleSlug}`;
    const prev = dashboardGates[key] ?? [];
    const next = checked ? Array.from(new Set([...prev, roleCode])) : prev.filter((r) => r !== roleCode);

    setDashboardGates((p) => ({ ...p, [key]: next }));
    setPendingSaves((p) => ({ ...p, [key]: { moduleSlug, submoduleSlug, roles: next } }));
    setOriginalValues((p) => (key in p ? p : { ...p, [key]: prev }));
    setSaveError(null);
  };

  const handleSaveAll = async () => {
    const entries = Object.entries(pendingSaves);
    if (entries.length === 0) return;
    setSaving(true);
    setSaveError(null);
    const succeededKeys: string[] = [];
    try {
      for (const [key, entry] of entries) {
        await setModuleRoleGateOverride(entry.moduleSlug, entry.submoduleSlug, entry.roles);
        // Reflect each write in this tab's own nav gating immediately too,
        // instead of only taking effect on the next login/reload.
        rawOverridesRef.current = { ...rawOverridesRef.current, [key]: entry.roles };
        succeededKeys.push(key);
      }
      hydrateModuleRoleGates(rawOverridesRef.current);
      setPendingSaves({});
      setOriginalValues({});
    } catch (err) {
      // Whatever succeeded before the failure stays applied (both here and
      // in the database) — drop just those from the pending queue so a
      // retry only resends what actually still needs saving.
      setPendingSaves((p) => {
        const next = { ...p };
        for (const key of succeededKeys) delete next[key];
        return next;
      });
      setOriginalValues((p) => {
        const next = { ...p };
        for (const key of succeededKeys) delete next[key];
        return next;
      });
      setSaveError(err instanceof Error ? err.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  const handleDiscardAll = () => {
    setDashboardGates((p) => ({ ...p, ...originalValues }));
    setPendingSaves({});
    setOriginalValues({});
    setSaveError(null);
  };

  return (
    <main className="flex-1 bg-slate-950 py-6">
      <div className="max-w-[1600px] mx-auto px-6">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-white">
          <button
            type="button"
            onClick={() => {
              if (Object.keys(pendingSaves).length > 0 && !confirm("You have unsaved changes. Leave without saving?")) return;
              goBack();
            }}
            className="btn"
          >
            <ChevronLeft className="h-4 w-4" />
            {mod.label}
          </button>
          <div>
            <h1 className="text-2xl font-semibold leading-tight">{sub.title}</h1>
            <p className="text-sm text-muted-foreground">{sub.description}</p>
          </div>
        </div>

        <div className="mb-4">
          <h2 className="text-xl font-semibold text-white">Module Access by Role</h2>
          <p className="text-sm text-slate-400 mt-1">
            Pick a role, then move a page between the two lists to grant or revoke its access. A row you haven't edited
            yet is open to every role — moving it out of "Granted" replaces its whole allowed-role list, company-wide,
            immediately. Super Admin can always open every page regardless of this.
          </p>
        </div>

        <ModuleAccessEditor
          gateRows={gateRows}
          dashboardGates={dashboardGates}
          selectedRole={dndSelectedRole}
          onSelectedRoleChange={setDndSelectedRole}
          filter={dndFilter}
          onFilterChange={setDndFilter}
          onToggle={handleGateToggle}
          pendingCount={Object.keys(pendingSaves).length}
          saving={saving}
          saveError={saveError}
          onSaveAll={() => void handleSaveAll()}
          onDiscardAll={handleDiscardAll}
        />
        {gatesLoading && <p className="mt-3 text-sm text-slate-400">Loading…</p>}
      </div>
    </main>
  );
}
