import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, ChevronDown, Loader2, ArrowRight, ArrowLeft, LayoutGrid, Move, GripVertical, Inbox, CheckCircle2, Plus, X, Settings, Pencil, Trash2, Check } from "lucide-react";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { MODULES } from "@/lib/modules";
import { ROLE_LABELS, ROLE_OPTIONS } from "@/lib/roleLabels";
import { useAllRoleOptions, useCustomRoles, createCustomRole, setRoleLabel, deleteCustomRole } from "@/lib/customRoles";
import { DASHBOARD_ROLE_GATES } from "@/lib/dashboardAccess";
import { hydrateModuleRoleGates } from "@/lib/moduleAccess";
import { getModuleRoleGateOverrides, setModuleRoleGateOverride } from "@/lib/supabase/moduleRoleGates";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";

interface Props {
  mod: ModuleDef;
  sub: SubModuleDef;
}

// Fixed per-column pixel widths for the Module Access by Role grid below
// (see the split-table comment further down for why there are two <table>
// elements). table-layout: fixed + identical <colgroup> widths is what
// keeps their columns pixel-aligned as the body scrolls sideways. Role
// count is dynamic (built-in roles plus any company-created custom roles —
// see src/lib/customRoles.ts), so widths are computed from the live count
// instead of a module-level constant.
const CHECKBOX_COL_W = 92;
const GATE_NAME_COL_W = 260;

function gateColWidths(roleCount: number): number[] {
  return [GATE_NAME_COL_W, ...Array.from({ length: roleCount }, () => CHECKBOX_COL_W)];
}

function gateTableWidth(roleCount: number): number {
  return gateColWidths(roleCount).reduce((sum, w) => sum + w, 0);
}

function GateColGroup({ roleCount }: { roleCount: number }) {
  return (
    <colgroup>
      {gateColWidths(roleCount).map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    </colgroup>
  );
}

// Admin-tier codes excluded from Manage Roles' "Built-in Roles" rename
// list — never editable from the UI, even just the display label, since
// they're the roles that grant the ability to reach this page at all.
// SUPERADMIN/SUPERSUPERADMIN are already excluded from ROLE_OPTIONS
// itself; ADMIN is listed defensively too since it IS in ROLE_OPTIONS.
const NON_RENAMABLE_BUILTIN_CODES = new Set(["ADMIN", "SUPERADMIN", "SUPERSUPERADMIN"]);

// Drag & Drop alternate view for "Module Access by Role" (see the toggle
// next to that heading) — one role at a time, two containers, each module
// card living in exactly one of them so nothing repeats the way it would
// showing every role as its own column. Reuses the same GateRow shape,
// dashboardGates state, and handleGateToggle save path the Grid view
// already has; this is purely a different way to trigger the same change.
// Same card/container visual language as CsrTeamComposition.tsx's existing
// drag-and-drop board (Team Composition, under CSR) — grip handle, same
// rounded-lg/border-white/10/bg-white/5 idle style, same opacity-on-drag
// feedback, same isOver container highlight — so this reads as the same
// interaction pattern elsewhere in the app, just wired to @dnd-kit instead
// of that page's native HTML5 drag events.
// One accent color per top-level module (Dashboard/Tickets/Parts/Claims/
// Report/Admin) — reusing MODULES' own ModuleDef.accent (already the app's
// canonical per-module color, shown as each module's tile dot on the home
// screen) rather than inventing a second palette, so a page's card color
// here means the same thing it does everywhere else in the app.
const moduleAccentBySlug = new Map(MODULES.map((m) => [m.slug, m.accent]));

function DraggableModuleCard({ id, title, moduleLabel, moduleSlug, onMove, direction }: { id: string; title: string; moduleLabel: string; moduleSlug: string; onMove: () => void; direction: "grant" | "revoke" }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  const accent = moduleAccentBySlug.get(moduleSlug) ?? "#94a3b8";
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        borderLeftColor: accent,
        borderLeftWidth: "3px",
      }}
      className={`group flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 cursor-grab active:cursor-grabbing touch-none ${isDragging ? "opacity-50" : ""}`}
    >
      <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: accent }} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate" title={title}>{title}</div>
        <div className="text-xs truncate" style={{ color: accent }}>{moduleLabel}</div>
      </div>
      <button
        type="button"
        title={direction === "grant" ? "Grant access" : "Revoke access"}
        onClick={(e) => { e.stopPropagation(); onMove(); }}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-white/10 transition-colors"
      >
        {direction === "grant" ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
      </button>
    </div>
  );
}

function DroppableContainer({ id, label, count, icon, tint, children }: { id: string; label: string; count: number; icon: React.ReactNode; tint: "neutral" | "granted"; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const idleBorder = tint === "granted" ? "border-emerald-500/30" : "border-white/10";
  const idleBg = tint === "granted" ? "bg-emerald-500/[0.04]" : "bg-white/5";
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-w-0 rounded-xl border-2 p-4 space-y-2 min-h-[24rem] max-h-[42rem] overflow-y-auto transition-colors ${
        isOver ? "border-blue-500 bg-white/10" : `${idleBorder} ${idleBg}`
      }`}
    >
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-3 flex items-center gap-2 sticky top-0">
        {icon} {label} · {count}
      </div>
      {children}
    </div>
  );
}

function ModuleAccessDragDrop({
  gateRows,
  dashboardGates,
  selectedRole,
  onSelectedRoleChange,
  filter,
  onFilterChange,
  savingGateCell,
  onToggle,
}: {
  gateRows: GateRow[];
  dashboardGates: Record<string, string[]>;
  selectedRole: string;
  onSelectedRoleChange: (role: string) => void;
  filter: string;
  onFilterChange: (v: string) => void;
  savingGateCell: string | null;
  onToggle: (moduleSlug: string, submoduleSlug: string, roleCode: string, checked: boolean) => void;
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
  const cellBusy = savingGateCell?.endsWith(`:${selectedRole}`);

  const move = (row: GateRow, toGranted: boolean) => onToggle(row.moduleSlug, row.slug, selectedRole, toGranted);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const row = gateRows.find((r) => `${r.moduleSlug}:${r.slug}` === active.id);
    if (!row) return;
    if (over.id === "granted" && !isGranted(row)) move(row, true);
    else if (over.id === "available" && isGranted(row)) move(row, false);
  };

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
        {cellBusy && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      </div>

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

      <DndContext onDragEnd={handleDragEnd}>
        <div className="flex gap-4 flex-col md:flex-row">
          <DroppableContainer id="available" label="Available" count={available.length} icon={<Inbox className="h-4 w-4" />} tint="neutral">
            {available.map((row) => (
              <DraggableModuleCard
                key={`${row.moduleSlug}:${row.slug}`}
                id={`${row.moduleSlug}:${row.slug}`}
                title={row.title}
                moduleLabel={row.moduleLabel}
                moduleSlug={row.moduleSlug}
                direction="grant"
                onMove={() => move(row, true)}
              />
            ))}
            {available.length === 0 && <div className="text-sm text-muted-foreground italic px-1 py-4 text-center">Nothing here.</div>}
          </DroppableContainer>
          <DroppableContainer id="granted" label={`Granted to ${ROLE_LABELS[selectedRole] ?? selectedRole}`} count={granted.length} icon={<CheckCircle2 className="h-4 w-4" />} tint="granted">
            {granted.map((row) => (
              <DraggableModuleCard
                key={`${row.moduleSlug}:${row.slug}`}
                id={`${row.moduleSlug}:${row.slug}`}
                title={row.title}
                moduleLabel={row.moduleLabel}
                moduleSlug={row.moduleSlug}
                direction="revoke"
                onMove={() => move(row, false)}
              />
            ))}
            {granted.length === 0 && <div className="text-sm text-muted-foreground italic px-1 py-4 text-center">Nothing here.</div>}
          </DroppableContainer>
        </div>
      </DndContext>
      <p className="mt-4 text-xs text-muted-foreground">
        Drag a page into "Granted" to give {ROLE_LABELS[selectedRole] ?? selectedRole} access, or back to "Available" to
        revoke it — or use the arrow button on a card. Each card's dot/label color matches its parent module. Changes save
        automatically and are shared company-wide.
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

  // Dashboard-submodule role-gate grid.
  const [dashboardGates, setDashboardGates] = useState<Record<string, string[]>>({});
  const [gatesLoading, setGatesLoading] = useState(true);
  const [savingGateCell, setSavingGateCell] = useState<string | null>(null);
  const gateTableScrollRef = useRef<HTMLDivElement>(null);
  const gateHeaderScrollRef = useRef<HTMLDivElement>(null);
  // The TRUE override map (no "open to everyone" rows filled in) — kept
  // separate from dashboardGates (which fills in allRoleValues for
  // display on untouched rows) so hydrateModuleRoleGates never mistakes a
  // merely-displayed default for a real override.
  const rawOverridesRef = useRef<Record<string, string[]>>({});
  // Which modules' submodule rows are expanded — every module starts
  // collapsed (just its one header row) so the ~74-row grid across all 6
  // modules doesn't force a long scroll before you reach the one module
  // you actually came to edit.
  const [expandedGateModules, setExpandedGateModules] = useState<Set<string>>(new Set());

  // Every submodule across every module — grouped by module for the grid
  // below. A row with no override (and, for Dashboard, no hardcoded
  // DASHBOARD_ROLE_GATES entry either) is open to every role today.
  const gateRows = useMemo<GateRow[]>(
    () => MODULES.flatMap((m) => m.submodules.map((s) => ({ moduleSlug: m.slug, moduleLabel: m.label, slug: s.slug, title: s.title }))),
    []
  );

  // Drag & Drop alternate view for "Module Access by Role" — same data and
  // save path as the checkbox grid (handleGateToggle below), just a
  // one-role-at-a-time, two-container editor instead of a ~86×28 matrix.
  const [moduleAccessView, setModuleAccessView] = useState<"grid" | "dragdrop">("dragdrop");
  const [dndSelectedRole, setDndSelectedRole] = useState(roleOptions[0]?.value ?? "");
  const [dndFilter, setDndFilter] = useState("");

  const loadDashboardGates = async () => {
    setGatesLoading(true);
    try {
      const overrides = await getModuleRoleGateOverrides();
      rawOverridesRef.current = overrides;
      const effective: Record<string, string[]> = {};
      for (const row of gateRows) {
        const key = `${row.moduleSlug}:${row.slug}`;
        const hardcodedDefault = row.moduleSlug === "dashboard" ? DASHBOARD_ROLE_GATES[row.slug] : undefined;
        effective[key] = overrides[key] ?? hardcodedDefault ?? allRoleValues;
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
    // Re-runs when a custom role is added (roleOptions.length grows) so any
    // row's "open to everyone" fallback gets re-baked to include the new
    // role, not just whichever roles existed at the last load.
    void loadDashboardGates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleOptions.length]);

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
          <button type="button" onClick={goBack} className="btn">
            <ChevronLeft className="h-4 w-4" />
            {mod.label}
          </button>
          <div>
            <h1 className="text-2xl font-semibold leading-tight">{sub.title}</h1>
            <p className="text-sm text-muted-foreground">{sub.description}</p>
          </div>
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-xl font-semibold text-white">Module Access by Role</h2>
            <div className="flex rounded-lg border border-[var(--color-panel-border)] overflow-hidden text-xs font-medium">
              <button
                type="button"
                onClick={() => setModuleAccessView("grid")}
                className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${moduleAccessView === "grid" ? "bg-blue-600 text-white" : "bg-transparent text-slate-400 hover:text-slate-200"}`}
              >
                <LayoutGrid className="h-3.5 w-3.5" /> Grid
              </button>
              <button
                type="button"
                onClick={() => setModuleAccessView("dragdrop")}
                className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${moduleAccessView === "dragdrop" ? "bg-blue-600 text-white" : "bg-transparent text-slate-400 hover:text-slate-200"}`}
              >
                <Move className="h-3.5 w-3.5" /> Drag &amp; Drop
              </button>
            </div>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            {moduleAccessView === "grid" ? (
              <>
                Click a module name to expand or collapse its submodules — every module starts collapsed. Check a box to
                let that role open the submodule (from its tile grid, and directly by URL). A row you haven't edited yet
                shows the built-in default — every role for most submodules, or the Dashboard's own built-in list for the
                few that have one. Changing any box here replaces that submodule's whole list, company-wide, immediately.
                Super Admin can always open every submodule regardless of this grid.
              </>
            ) : (
              <>
                Pick a role, then drag a page between the two lists (or use the arrow buttons) to grant or revoke its
                access — same effect as checking a box in the Grid view, just one role at a time. Super Admin can always
                open every submodule regardless of this.
              </>
            )}
          </p>
        </div>

        {moduleAccessView === "dragdrop" && (
          <ModuleAccessDragDrop
            gateRows={gateRows}
            dashboardGates={dashboardGates}
            selectedRole={dndSelectedRole}
            onSelectedRoleChange={setDndSelectedRole}
            filter={dndFilter}
            onFilterChange={setDndFilter}
            savingGateCell={savingGateCell}
            onToggle={handleGateToggle}
          />
        )}

        {moduleAccessView === "grid" && (
        <>
        <FloatingHorizontalScrollbar targetRef={gateTableScrollRef} />
        <div
          ref={gateHeaderScrollRef}
          className="overflow-x-hidden rounded-t-lg border border-b-0 border-[var(--color-panel-border)] bg-[var(--color-panel)] backdrop-blur-md sticky top-16 z-20"
        >
          <table className="text-sm" style={{ tableLayout: "fixed", width: gateTableWidth(roleOptions.length) }}>
            <GateColGroup roleCount={roleOptions.length} />
            <thead>
              <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 truncate sticky left-0 z-10 bg-slate-950">Module / Submodule</th>
                {roleOptions.map((r) => (
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
          <table className="text-sm" style={{ tableLayout: "fixed", width: gateTableWidth(roleOptions.length) }}>
            <GateColGroup roleCount={roleOptions.length} />
            <tbody>
              {gatesLoading ? (
                <tr>
                  <td colSpan={1 + roleOptions.length} className="px-3 py-6 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : (
                MODULES.flatMap((m) => {
                  const isModuleExpanded = expandedGateModules.has(m.slug);
                  const headerRow = (
                    <tr key={`mod-${m.slug}`} className="border-b border-white/10 bg-white/5">
                      <td colSpan={1 + roleOptions.length} className="p-0 sticky left-0 bg-slate-900">
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
                          {roleOptions.map((r) => {
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
        </>
        )}

      </div>
    </main>
  );
}
