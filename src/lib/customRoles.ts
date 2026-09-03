/**
 * Custom roles — created from the UI (Accessibility Management's "Add
 * Role"), see migration 0208_custom_roles.sql. Unlike moduleAccess.ts's
 * hydrate-once-at-login cache, a role created mid-session must show up
 * immediately in every open role picker in that same session, so this
 * mirrors isOnline.ts's singleton-listener pattern (module-level cache +
 * useSyncExternalStore) instead.
 */
import { useSyncExternalStore } from "react";
import { supabase } from "./supabase/client";
import { ROLE_LABELS, ROLE_OPTIONS, normalizeRole } from "./roleLabels";

export interface CustomRole {
  code: string;
  label: string;
}

let customRoles: CustomRole[] = [];
let loaded = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function load(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const { data, error } = await supabase.from("custom_roles").select("code, label").order("label");
    if (error) {
      console.error("Failed to load custom roles:", error.message);
      return;
    }
    customRoles = data ?? [];
    loaded = true;
    notify();
  })();
  return loadPromise;
}

function subscribe(listener: () => void): () => void {
  if (!loaded) void load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): CustomRole[] {
  return customRoles;
}

/** Every company-created custom role — reactive, lazy-loads on first use. */
export function useCustomRoles(): CustomRole[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => []);
}

/**
 * Built-in ROLE_OPTIONS plus every custom role, sorted by label — the
 * single source every role PICKER (not permission-check helper) should
 * read instead of the static ROLE_OPTIONS import, so a newly created
 * custom role is immediately selectable everywhere a role is picked.
 *
 * A custom_roles row whose `code` matches an EXISTING built-in role (see
 * setRoleLabel below) overrides that role's display label instead of
 * appearing as a second entry — this is how "rename a built-in role's
 * label" works: same table, no separate schema, distinguished purely by
 * whether the code was already a built-in at read time.
 */
export function useAllRoleOptions(): { value: string; label: string }[] {
  const custom = useCustomRoles();
  const labelByCode = new Map(ROLE_OPTIONS.map((r) => [r.value, r.label]));
  for (const r of custom) labelByCode.set(r.code, r.label);
  return Array.from(labelByCode, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Creates a new custom role and updates the shared cache immediately.
 * Admin/SuperAdmin only — enforced by RLS (custom_roles_insert policy).
 */
export async function createCustomRole(label: string): Promise<CustomRole> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Enter a role name.");
  const code = normalizeRole(trimmed);
  if (ROLE_LABELS[code] || customRoles.some((r) => r.code === code)) {
    throw new Error(`A role named "${trimmed}" already exists.`);
  }
  const { data, error } = await supabase.from("custom_roles").insert({ code, label: trimmed }).select("code, label").single();
  if (error) throw new Error(error.message);
  customRoles = [...customRoles, data].sort((a, b) => a.label.localeCompare(b.label));
  loaded = true;
  notify();
  return data;
}

/**
 * Sets the display label for a role code — works for an existing custom
 * role (renames it) AND for a built-in role (creates/updates an override
 * row for it, so its code and every permission check against that code
 * stay exactly as they are; only what's shown in pickers changes). Upsert,
 * so either case is a single call. Admin/SuperAdmin only — enforced by RLS.
 */
export async function setRoleLabel(code: string, newLabel: string): Promise<void> {
  const trimmed = newLabel.trim();
  if (!trimmed) throw new Error("Enter a role name.");
  const { data, error } = await supabase
    .from("custom_roles")
    .upsert({ code, label: trimmed }, { onConflict: "company_id,code" })
    .select("code, label")
    .single();
  if (error) throw new Error(error.message);
  customRoles = [...customRoles.filter((r) => r.code !== code), data].sort((a, b) => a.label.localeCompare(b.label));
  loaded = true;
  notify();
}

/**
 * How many company profiles currently hold this role (primary or extra) —
 * checked before deleting so a delete can never silently orphan someone's
 * assigned role. Same `role.eq/extra_roles.cs` OR pattern used throughout
 * src/lib/supabase/users.ts for "does this person hold role X."
 */
export async function countProfilesWithRole(code: string): Promise<number> {
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .or(`role.eq.${code},extra_roles.cs.{${code}}`);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * Deletes a custom role. Refuses (throws) if any profile still holds it, so
 * an admin has to reassign those people first rather than silently leaving
 * them with an orphaned role code — call countProfilesWithRole first to
 * show that count instead of hitting this error path blind.
 * Admin/SuperAdmin only — enforced by RLS.
 */
export async function deleteCustomRole(code: string): Promise<void> {
  const inUse = await countProfilesWithRole(code);
  if (inUse > 0) {
    throw new Error(`${inUse} ${inUse === 1 ? "person" : "people"} still hold this role — reassign them first.`);
  }
  const { error } = await supabase.from("custom_roles").delete().eq("code", code);
  if (error) throw new Error(error.message);
  customRoles = customRoles.filter((r) => r.code !== code);
  notify();
}
