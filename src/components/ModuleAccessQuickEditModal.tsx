/**
 * "Who can access this module?" pop-out — opens right where you clicked
 * the gear on a home-page tile (home.tsx), instead of navigating away to
 * the full Accessibility Management page. Same click-to-move editor as that
 * page's "Module Access by Role" section (ModuleAccessCard/AccessListContainer,
 * reused from there), just scoped to one module's own submodules and shown
 * as a dialog instead of a full page section — this is a shortcut into the
 * SAME underlying data (module_role_gate_overrides), not a parallel
 * access-control system. The full page still exists for the complete
 * all-modules view; this is the "quick edit" version.
 *
 * Same explicit Save/Discard bar as the full page — a card click only
 * stages a local change, nothing writes to the database until "Save
 * Changes" is clicked. See AccessibilityManagementPage.tsx's own
 * pendingSaves/originalValues for the reasoning.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X, Inbox, CheckCircle2, Loader2 } from "lucide-react";
import type { ModuleDef } from "@/lib/modules";
import { ROLE_LABELS } from "@/lib/roleLabels";
import { useAllRoleOptions } from "@/lib/customRoles";
import { DASHBOARD_ROLE_GATES } from "@/lib/dashboardAccess";
import { hydrateModuleRoleGates } from "@/lib/moduleAccess";
import { getModuleRoleGateOverrides, setModuleRoleGateOverride } from "@/lib/supabase/moduleRoleGates";
import { ModuleAccessCard, AccessListContainer } from "@/components/AccessibilityManagementPage";

interface GateRow {
  moduleSlug: string;
  moduleLabel: string;
  slug: string;
  title: string;
}

// Same 4 modules dashboardAccess.ts's DASHBOARD_ROLE_GATES has hardcoded
// defaults for — mirrors AccessibilityManagementPage's own loadDashboardGates.
const HARDCODED_DEFAULT_MODULES = new Set(["dashboard", "hr", "accounting", "csr"]);

export function ModuleAccessQuickEditModal({ mod, onClose }: { mod: ModuleDef; onClose: () => void }) {
  const roleOptions = useAllRoleOptions();
  const allRoleValues = useMemo(() => roleOptions.map((r) => r.value), [roleOptions]);
  const gateRows = useMemo<GateRow[]>(
    () => mod.submodules.map((s) => ({ moduleSlug: mod.slug, moduleLabel: mod.label, slug: s.slug, title: s.title })),
    [mod]
  );

  const [gates, setGates] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState(roleOptions[0]?.value ?? "");
  const rawOverridesRef = useRef<Record<string, string[]>>({});

  // Staged-but-unsaved edits — see the file-level comment above.
  const [pendingSaves, setPendingSaves] = useState<Record<string, { moduleSlug: string; submoduleSlug: string; roles: string[] }>>({});
  const [originalValues, setOriginalValues] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pendingCount = Object.keys(pendingSaves).length;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const overrides = await getModuleRoleGateOverrides();
        if (cancelled) return;
        rawOverridesRef.current = overrides;
        const effective: Record<string, string[]> = {};
        for (const row of gateRows) {
          const key = `${row.moduleSlug}:${row.slug}`;
          const hardcodedDefault = HARDCODED_DEFAULT_MODULES.has(row.moduleSlug) ? DASHBOARD_ROLE_GATES[row.slug] : undefined;
          effective[key] = overrides[key] ?? hardcodedDefault ?? allRoleValues;
        }
        // Re-apply any not-yet-saved edits on top of the fresh load — see
        // AccessibilityManagementPage.tsx's loadDashboardGates for why.
        for (const [key, entry] of Object.entries(pendingSaves)) effective[key] = entry.roles;
        setGates(effective);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mod.slug, roleOptions.length]);

  const isGranted = (row: GateRow) => (gates[`${row.moduleSlug}:${row.slug}`] ?? allRoleValues).includes(selectedRole);
  const granted = gateRows.filter(isGranted);
  const available = gateRows.filter((r) => !isGranted(r));

  // Local-only — records the intended change and updates the display, but
  // does NOT write to the database. See handleSaveAll for the actual write.
  const move = (row: GateRow, toGranted: boolean) => {
    const key = `${row.moduleSlug}:${row.slug}`;
    const prev = gates[key] ?? [];
    const next = toGranted ? Array.from(new Set([...prev, selectedRole])) : prev.filter((r) => r !== selectedRole);
    setGates((p) => ({ ...p, [key]: next }));
    setPendingSaves((p) => ({ ...p, [key]: { moduleSlug: row.moduleSlug, submoduleSlug: row.slug, roles: next } }));
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
        rawOverridesRef.current = { ...rawOverridesRef.current, [key]: entry.roles };
        succeededKeys.push(key);
      }
      hydrateModuleRoleGates(rawOverridesRef.current);
      setPendingSaves({});
      setOriginalValues({});
    } catch (err) {
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
    setGates((p) => ({ ...p, ...originalValues }));
    setPendingSaves({});
    setOriginalValues({});
    setSaveError(null);
  };

  const handleClose = () => {
    if (pendingCount > 0 && !confirm("You have unsaved changes. Close without saving?")) return;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm" onClick={handleClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-white/15 bg-slate-950/95 shadow-2xl shadow-black/60 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: mod.accent }} />
            <h3 className="text-lg font-semibold text-white">Who can access {mod.label}?</h3>
          </div>
          <button type="button" onClick={handleClose} className="text-slate-400 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mb-4">
          Pick a role, then click a page's arrow/X to grant or revoke its access to {mod.label}. Nothing is saved until
          you click "Save Changes" below. Super Admin can always open every page regardless of this.
        </p>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Role</label>
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            className="glass-input text-base py-2 px-3 rounded-md"
          >
            {roleOptions.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        </div>

        {(pendingCount > 0 || saveError) && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <span className="text-sm font-medium text-amber-200">
              {saveError ? saveError : `${pendingCount} unsaved change${pendingCount === 1 ? "" : "s"}`}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={handleDiscardAll}
                disabled={saving}
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/10 disabled:opacity-40"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => void handleSaveAll()}
                disabled={saving || pendingCount === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {saving ? "Saving…" : "Save Changes"}
              </button>
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
            {!loading && available.length === 0 && <div className="text-sm text-muted-foreground italic px-1 py-4 text-center">Nothing here.</div>}
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
            {!loading && granted.length === 0 && <div className="text-sm text-muted-foreground italic px-1 py-4 text-center">Nothing here.</div>}
          </AccessListContainer>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          For every module at once, or to manage roles themselves,{" "}
          <Link
            to="/m/$module/$submodule"
            params={{ module: "admin", submodule: "accessibility-management" }}
            search={{ focusModule: mod.slug } as any}
            className="text-blue-400 hover:text-blue-300 hover:underline"
          >
            open the full Accessibility Management page
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
