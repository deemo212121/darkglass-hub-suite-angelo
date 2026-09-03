import { useMemo, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { BrandedLoader } from "@/components/BrandedLoader";
import { ChevronDown, ChevronLeft, Check, Filter, Search, Loader2, KeyRound, RotateCcw, Ban, CheckCircle2 } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { type UserManagementRecord } from "@/lib/user-management";
import { useAuth } from "@/lib/auth";
import { createCompanyUser, getCompanyUsers, updateCompanyUser, setMustChangePassword, type ProfileRow } from "@/lib/supabase/users";
import { usePersistedTab } from "@/lib/usePersistedTab";
import { ROLE_LABELS, normalizeRole } from "@/lib/roleLabels";
import { useAllRoleOptions } from "@/lib/customRoles";
import { auth as firebaseAuth } from "@/lib/firebase/config";
import { ActivityLogPanel } from "@/components/ActivityLogPanel";
import { logModuleActivity } from "@/lib/supabase/moduleActivityLog";
import { ManageWorkingHoursModal } from "@/components/ManageWorkingHoursModal";
import { getBranchRoleSchedules, type BranchRoleScheduleRow } from "@/lib/supabase/branchSchedules";

/** Readable role text for display — e.g. "BIZOPS_MANAGER" -> "BizOps Manager". Falls back to the raw value for anything not in ROLE_LABELS (legacy free-text roles like "CSR Manager" already read fine as-is). */
function roleDisplay(role: string | null | undefined): string {
  if (!role) return "";
  return ROLE_LABELS[normalizeRole(role)] || role;
}

/**
 * Branch Access can list dozens of branches (pipe/comma-separated in
 * branch_access), which used to blow up row height in the User Management
 * table. Collapse it to "FirstBranch +N" so every row stays one line tall —
 * the full list is still available via the `full` string as a hover title.
 */
function formatBranchAccess(raw: string | null | undefined): { short: string; full: string } {
  if (!raw || !raw.trim()) return { short: "—", full: "" };
  if (raw.trim() === "*") return { short: "All Branches", full: "All Branches" };
  const parts = raw.split(/[|,;]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { short: "—", full: "" };
  const full = parts.join(", ");
  return parts.length === 1 ? { short: parts[0], full } : { short: `${parts[0]} +${parts.length - 1}`, full };
}

/** 0 = Super Admin, 1 = Admin, 2 = everyone else — for sorting the Hierarchy tree's root row so Super Admin always leads, then Admin, per the requested chart order. */
function topTierRank(record: UserManagementRecord): number {
  const role = normalizeRole(record.type);
  if (role === "SUPERADMIN") return 0;
  if (role === "ADMIN") return 1;
  return 2;
}

/**
 * Same three-bucket color coding as the Leaders tab's own tier system
 * (senior/manager/standard) — derived from the real role code here
 * instead of a hand-picked field, since Hierarchy is built from actual
 * accounts, not a curated roster.
 */
type HierarchyTier = "senior" | "manager" | "standard";
function hierarchyRoleTier(roleCode: string | null | undefined): HierarchyTier {
  const r = normalizeRole(roleCode);
  if (["SUPERADMIN", "SUPERSUPERADMIN", "ADMIN", "TECHNICAL_DIRECTOR", "SENIOR_DIRECTOR"].includes(r) || r.includes("SENIOR")) return "senior";
  if (r.includes("MANAGER") || r.includes("TEAM_LEADER") || r.includes("DIRECTOR") || r === "DISPATCHER") return "manager";
  return "standard";
}

type ViewMode = "list" | "hierarchy";

interface NewUserFormData {
  loginName: string;
  userName: string;
  email: string;
  /** Primary role code (first ticked in the checkbox grid). Drives RLS / legacy checks. */
  userType: string;
  /** All ticked role codes including the primary one. */
  userTypes: string[];
  manager: string;
  technicianId: string;
  assignedBranch: string;
  branchAccess: string;
  poInitials: string;
  requiredCheckIn: string;
  requiredCheckOut: string;
  workingHours: string;
  mealMinutes: string;
  selectedOffDays: number[];
}

// Display order only (a work week reads naturally Monday-first). The actual
// stored/compared value for each day is NOT its position in this array —
// off_days is interpreted everywhere else in the app (AttendanceMonitoringPage,
// AccountingDashboard, ReportHRDaily, ReportAttendanceMonitoring, payslips,
// timecards.ts) via JS's native Date.getDay(): 0=Sunday..6=Saturday. See
// DAYS_OF_WEEK_INDEX below, which maps each display position to that real
// index — storing raw 0..6 by display position here would silently shift
// everyone's off days by one relative to every other reader (e.g. "Saturday
// and Sunday" would get saved as {5,6} and then misread elsewhere as
// "Friday and Saturday").
const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAYS_OF_WEEK_INDEX = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAME_BY_INDEX = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Branch/office locations (used by Assigned Branch + Branch Access dropdowns)
const LOCATIONS = [
  "Asheville", "Atlanta", "Birmingham", "Cape Girardeau", "Chattanooga",
  "Columbus", "Destin", "Dallas", "Huntsville", "Jackson, MS", "Jackson, TN",
  "Jacksonville", "Jonesboro", "Knoxville", "Lake Charles", "Little Rock",
  "Memphis", "Mobile", "Montgomery", "Nashville", "New Orleans", "Norfolk",
  "Richmond", "Raleigh", "San Antonio", "St. Louis", "Savannah",
  "Tallahassee", "Wilmington", "Philippines",
];

// Sentinel for the "All Locations" entry in Branch Access. Picking this clears
// every individual selection — the user can see every branch. Stored as-is so
// downstream code can detect it explicitly.
const ALL_LOCATIONS_TOKEN = "*";

// Columns that get a funnel filter on the user management table header.
// Mirrors the Ticket List column-filter pattern.
const UM_FILTERABLE_FIELDS = [
  "id",
  "loginName",
  "userName",
  "type",
  "email",
  "manager",
  "technicianId",
  "office",
  "status",
] as const;

type UMFilterableField = (typeof UM_FILTERABLE_FIELDS)[number];

/**
 * Plain-text representation of a user record column. Mirrors what the
 * cell renders, so the funnel dropdown shows the same values the user
 * sees in the table.
 */
function colValue(record: { id: string; loginName: string; userName: string; type: string; email?: string; manager?: string; technicianId?: string; office?: string; isActive?: boolean }, field: string): string {
  switch (field as UMFilterableField) {
    case "id":            return String(record.id ?? "");
    // The cell now displays the full name (userName), same as the User
    // Name column — see the "Login Name" <td> comment above.
    case "loginName":     return String(record.userName ?? "");
    case "userName":      return String(record.userName ?? "");
    // Readable label, not the raw role code/legacy free-text value - two
    // rows stored differently (e.g. "PARTS_MANAGER" vs legacy "Parts
    // Manager") must collapse into one funnel entry and filter together,
    // not show up as two visually-identical checkboxes.
    case "type":          return roleDisplay(record.type);
    case "email":         return String(record.email ?? "");
    case "manager":       return String(record.manager ?? "");
    case "technicianId":  return String(record.technicianId ?? "");
    case "office":        return String(record.office ?? "");
    case "status":        return record.isActive === false ? "Deactivated" : "Active";
    default:              return String((record as any)[field] ?? "");
  }
}

/**
 * Single-select branch dropdown (Assigned Branch).
 * A checkbox sits on the LEFT of each location; picking one selects it.
 */
function BranchSingleSelect({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="glass-input w-full text-[11px] px-2 py-1 flex items-center justify-between text-left">
        <span className={value ? "text-slate-100" : "text-slate-500"}>{value || placeholder}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-slate-900 shadow-xl">
          {LOCATIONS.map(loc => {
            const checked = value === loc;
            return (
              <button key={loc} type="button"
                onClick={() => { onChange(loc); setOpen(false); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-left hover:bg-white/10">
                <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${checked ? "bg-blue-500 border-blue-500" : "border-white/30"}`}>
                  {checked && <Check className="h-2.5 w-2.5 text-white" />}
                </span>
                <span className="text-slate-200">{loc}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Multi-select branch dropdown (Branch Access).
 * Each location has a LEFT checkbox; multiple may be selected. Stored as a
 * pipe-delimited string ("Jackson, MS|Jackson, TN") so location names that
 * already contain a comma (Jackson, MS / Jackson, TN) don't get split into
 * two phantom entries when re-parsed. Legacy comma-separated values are still
 * recognized via a fallback parser below.
 */
const BRANCH_DELIMITER = "|";

function parseSelectedBranches(value: string): string[] {
  const raw = String(value || "").trim();
  if (!raw) return [];
  // New pipe-delimited format.
  if (raw.includes(BRANCH_DELIMITER)) {
    return raw.split(BRANCH_DELIMITER).map((s) => s.trim()).filter(Boolean);
  }
  // Legacy comma-delimited format: greedy-match against the known location
  // list so multi-word names like "Jackson, MS" stay intact even when stored
  // with a comma separator.
  const remaining = raw;
  const found: string[] = [];
  // Sort longest-first so "Jackson, MS" matches before "Jackson".
  const sorted = [...LOCATIONS].sort((a, b) => b.length - a.length);
  let working = remaining;
  while (working.length > 0) {
    working = working.replace(/^[\s,]+/, "");
    if (!working) break;
    const hit = sorted.find((loc) => working.startsWith(loc));
    if (!hit) {
      // Unknown token — drop everything up to the next comma so we don't loop.
      const next = working.indexOf(",");
      working = next === -1 ? "" : working.slice(next + 1);
      continue;
    }
    found.push(hit);
    working = working.slice(hit.length);
  }
  // De-duplicate.
  return Array.from(new Set(found));
}

function BranchMultiSelect({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isAll = value === ALL_LOCATIONS_TOKEN;
  const selected = useMemo(() => (isAll ? [] : parseSelectedBranches(value)), [value, isAll]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const toggle = (loc: string) => {
    // "All" shows every box checked (see `checked` below); unchecking one
    // materializes it into an explicit list of every location except that
    // one, since it's no longer literally "all".
    if (isAll) { onChange(LOCATIONS.filter((l) => l !== loc).join(BRANCH_DELIMITER)); return; }
    const next = selected.includes(loc) ? selected.filter(s => s !== loc) : [...selected, loc];
    onChange(next.join(BRANCH_DELIMITER));
  };
  const toggleAll = () => onChange(isAll ? "" : ALL_LOCATIONS_TOKEN);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="glass-input w-full text-[11px] px-2 py-1 flex items-center justify-between text-left">
        <span className={(isAll || selected.length) ? "text-slate-100 truncate" : "text-slate-500"}>
          {isAll
            ? "All Locations"
            : selected.length
              ? `${selected.length} selected: ${selected.join(", ")}`
              : placeholder}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-slate-900 shadow-xl">
          {/* All Locations — stored as the compact "*" sentinel (auth.tsx
              grants full access on branch_access === "*"), but every
              individual box below renders checked so it's visually clear
              that everything is included. */}
          <button
            type="button"
            onClick={toggleAll}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-left hover:bg-white/10 border-b border-white/5"
          >
            <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${isAll ? "bg-blue-500 border-blue-500" : "border-white/30"}`}>
              {isAll && <Check className="h-2.5 w-2.5 text-white" />}
            </span>
            <span className="font-semibold text-blue-300">All Locations</span>
          </button>
          {LOCATIONS.map(loc => {
            const checked = isAll || selected.includes(loc);
            return (
              <button key={loc} type="button" onClick={() => toggle(loc)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-left hover:bg-white/10">
                <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${checked ? "bg-blue-500 border-blue-500" : "border-white/30"}`}>
                  {checked && <Check className="h-2.5 w-2.5 text-white" />}
                </span>
                <span className="text-slate-200">{loc}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Multi-select dropdown for User Type. Stored on the form as a string[] of
 * role codes. The first entry is treated as the primary role (drives RLS /
 * legacy access checks); the rest land in `extra_roles` on the profile row.
 *
 * Lays out exactly like BranchMultiSelect / BranchSingleSelect so the form
 * grid stays uniform — closed state is a single-line dropdown button.
 */
function RoleMultiSelect({
  values,
  options,
  onChange,
  placeholder,
}: {
  values: string[];
  options: { value: string; label: string }[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const labelByValue = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of options) m[normalizeRole(o.value)] = o.label;
    return m;
  }, [options]);
  // Compare normalized forms, not exact strings — a profile carrying a
  // legacy free-text role (e.g. "CSR Manager" instead of "CSR_MANAGER")
  // would otherwise match none of this list's option values, so its
  // checkbox would never show checked and could never be toggled off,
  // leaving the primary role stuck on that legacy value forever.
  const toggle = (val: string) => {
    const norm = normalizeRole(val);
    onChange(
      values.some((v) => normalizeRole(v) === norm)
        ? values.filter((v) => normalizeRole(v) !== norm)
        : [...values, val]
    );
  };
  const summary = values.length
    ? `${values.length} selected: ${values.map((v) => labelByValue[normalizeRole(v)] || v).join(", ")}`
    : placeholder;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="glass-input w-full text-[11px] px-2 py-1 flex items-center justify-between text-left"
      >
        <span className={values.length ? "text-slate-100 truncate" : "text-slate-500"}>{summary}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-slate-900 shadow-xl">
          {options.map((opt) => {
            const checked = values.some((v) => normalizeRole(v) === normalizeRole(opt.value));
            const isPrimary = values.length > 0 && normalizeRole(values[0]) === normalizeRole(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-left hover:bg-white/10"
              >
                <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${checked ? "bg-blue-500 border-blue-500" : "border-white/30"}`}>
                  {checked && <Check className="h-2.5 w-2.5 text-white" />}
                </span>
                <span className="text-slate-200 flex-1 truncate">{opt.label}</span>
                {isPrimary && (
                  <span className="text-[9px] font-semibold uppercase text-blue-300">primary</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Map a Supabase profile row to the table's UserManagementRecord shape.
// Row shape for the table: UserManagementRecord plus the Supabase profile id
// (needed for the delete action and for forcing a password change) and the
// Firebase Auth uid (needed to target a specific account for the "reset to
// default password" bridge — see handleConfirmResetToDefault below).
// `type` (primary role) is for display/title/hierarchy sort only — never
// the sole basis for an eligibility check. `extraRoles` (held roles, same
// as canReviewPtoStage's convention) must be checked alongside it anywhere
// this file asks "does this person hold role X" — see managerCandidates.
type UserRow = UserManagementRecord & { profileId: string; firebaseUid: string; extraRoles: string[] };

function mapProfilesToRecords(profiles: ProfileRow[]): UserRow[] {
  return profiles.map((p, index) => ({
    profileId: p.id,
    firebaseUid: p.firebase_uid,
    id: String(index + 1), // sequential display id: 1, 2, 3...
    loginName: p.username || p.email.split("@")[0],
    userName: p.display_name || p.email,
    type: p.role,
    extraRoles: p.extra_roles ?? [],
    email: p.email,
    manager: p.manager_name || "",
    technicianId: p.technician_id || "",
    office: p.assigned_branch || "",
    locations: p.branch_access || "",
    isActive: p.is_active,
  }));
}

function UserLink({ moduleSlug, submoduleSlug, userId, children }: { moduleSlug: string; submoduleSlug: string; userId: string; children: React.ReactNode }) {
  return (
    <Link
      to="/m/$module/$submodule/$userId"
      params={{ module: moduleSlug, submodule: submoduleSlug, userId }}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-blue-300 hover:text-blue-200 hover:underline"
    >
      {children}
    </Link>
  );
}

const EMPTY_ANCESTORS: ReadonlySet<string> = new Set();

/**
 * One row of the Hierarchy tree, recursing into its own direct reports.
 * A manager gets a chevron + its children indented under a connecting
 * line; a leaf (no reports) just gets a short tick mark — same visual
 * language as a standard file/org-chart tree. `ancestors` guards against a
 * bad manager chain (e.g. two people accidentally set as each other's
 * manager) recursing forever — free-text manager names have no DB
 * constraint stopping that.
 *
 * Root-level nodes (isRoot) start COLLAPSED — with up to ~200 people in
 * one tree, a single huge branch (e.g. everyone under one Super Admin)
 * would otherwise push every OTHER root far down the page before it even
 * renders, making them impossible to find without first scrolling past
 * the whole thing. Non-root nodes still default open, matching this
 * tree's previous always-expanded behavior once you've opened a root.
 *
 * Draggable — native HTML5 DnD, same technique as CsrTeamComposition.tsx
 * / the Leaders tab's own reporting tree: drag one person's row onto
 * another to set the dragged person's manager_name to that row's name
 * (see moveUserManagerTo on the parent). No inline-editable inputs live
 * inside this row, so unlike Leaders' dedicated grip handle, the whole
 * row itself is the drag source — nothing for it to conflict with.
 */
function HierarchyTreeNode({
  record, childrenByManagerName, moduleSlug, submoduleSlug, ancestors, isRoot, subtreeSize,
  draggingId, overName, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
}: {
  record: UserRow;
  childrenByManagerName: Map<string, UserRow[]>;
  moduleSlug: string;
  submoduleSlug: string;
  ancestors: ReadonlySet<string>;
  isRoot?: boolean;
  subtreeSize: (userName: string) => number;
  draggingId: string | null;
  overName: string | null;
  onDragStart: (profileId: string) => (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (userName: string) => (e: React.DragEvent) => void;
  onDragLeave: (userName: string) => () => void;
  onDrop: (userName: string) => (e: React.DragEvent) => void;
}) {
  const children = ancestors.has(record.userName) ? [] : (childrenByManagerName.get(record.userName) ?? []);
  const hasChildren = children.length > 0;
  const childAncestors = useMemo(() => new Set(ancestors).add(record.userName), [ancestors, record.userName]);
  const [expanded, setExpanded] = useState(!isRoot);
  const isDragging = draggingId === record.profileId;
  const isOver = overName === record.userName;
  const tier = hierarchyRoleTier(record.type);
  const tierBoxClass =
    tier === "senior"
      ? "border-cyan-400/30 bg-cyan-500/10 hover:border-cyan-400/50"
      : tier === "manager"
      ? "border-rose-400/30 bg-rose-500/10 hover:border-rose-400/50"
      : "border-white/10 bg-white/5 hover:border-white/20";
  const tierTextClass = tier === "senior" ? "text-cyan-300" : tier === "manager" ? "text-rose-300" : "text-slate-400";

  return (
    <div className="mb-1.5 last:mb-0">
      <div
        draggable
        onDragStart={onDragStart(record.profileId)}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver(record.userName)}
        onDragLeave={onDragLeave(record.userName)}
        onDrop={onDrop(record.userName)}
        title="Drag onto another person to make them this person's manager"
        className={`flex items-center gap-2.5 py-1.5 px-2.5 rounded-lg border cursor-grab active:cursor-grabbing transition-colors ${
          isOver ? "border-primary bg-white/10" : tierBoxClass
        } ${isDragging ? "opacity-50" : ""}`}
      >
        <button
          type="button"
          onClick={() => hasChildren && setExpanded((e) => !e)}
          disabled={!hasChildren}
          aria-label={hasChildren ? (expanded ? "Collapse" : "Expand") : undefined}
          className="flex h-4 w-4 shrink-0 items-center justify-center disabled:cursor-default"
        >
          {hasChildren ? (
            <ChevronDown className={`h-3 w-3 text-blue-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
          ) : (
            <span className="h-px w-2.5 bg-white/25" />
          )}
        </button>
        <div className="flex items-baseline gap-1.5 min-w-0">
          <UserLink moduleSlug={moduleSlug} submoduleSlug={submoduleSlug} userId={record.loginName}>
            {record.userName}
          </UserLink>
          <span className={`text-xs whitespace-nowrap ${tierTextClass}`}>({roleDisplay(record.type)})</span>
          {hasChildren && !expanded && (
            <span className="text-xs text-slate-500 whitespace-nowrap">
              — {subtreeSize(record.userName)} {subtreeSize(record.userName) === 1 ? "report" : "reports"} total
            </span>
          )}
        </div>
      </div>
      {hasChildren && expanded && (
        <div className="ml-[7px] mt-1.5 border-l border-white/15 pl-[17px]">
          {children.map((child) => (
            <HierarchyTreeNode
              key={child.loginName}
              record={child}
              childrenByManagerName={childrenByManagerName}
              moduleSlug={moduleSlug}
              submoduleSlug={submoduleSlug}
              ancestors={childAncestors}
              subtreeSize={subtreeSize}
              draggingId={draggingId}
              overName={overName}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Per-column funnel filter ──
// Mirrors the Ticket List / CSR Status Summary pattern: each column header
// gets a small funnel icon that opens a checkbox list of the distinct values
// present in the current dataset, with search-in-list and (Select All).
// The funnel turns blue when the filter is narrowing the view so it's easy
// to see at a glance which columns are filtered.
function ColumnFilter({
  field,
  label,
  options,
  selected,
  onChange,
}: {
  field: string;
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // Portaled to <body> with `fixed` positioning computed from the trigger's
  // getBoundingClientRect() — the table wraps in a div with `overflow-x-auto`,
  // which per the CSS spec forces `overflow-y: auto` too (a non-"visible" X
  // value can't pair with a "visible" Y value), so an `absolute`-positioned
  // menu here would get clipped by that same overflow box instead of
  // floating above the table. That clipping was ALSO why clicks on it did
  // nothing — the clipped-away portion isn't just invisible, it's outside
  // the scrollable region and never receives the click at all.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(
    () => options.filter((o) => !search || o.toLowerCase().includes(search.toLowerCase())),
    [options, search],
  );
  // selected.size === 0 means "no filter applied" (all rows shown).
  // selected.has("__none__") means "explicitly empty" (no rows match).
  const allChecked = selected.size === 0 || selected.size === options.length;
  const active = (selected.size > 0 && selected.size < options.length) || selected.has("__none__");

  const toggle = (opt: string) => {
    // Coming from "__none__" (Select All was just unchecked), start a fresh
    // selection with just this option rather than carrying the sentinel
    // forward — leaving it in would make every subsequent pick still match
    // `sel.has("__none__")` in the filter below and hide every row forever,
    // no matter what got checked afterward.
    const base = selected.has("__none__")
      ? new Set<string>()
      : selected.size === 0
        ? new Set(options)
        : new Set(selected);
    if (base.has(opt)) base.delete(opt);
    else base.add(opt);
    onChange(base.size === options.length ? new Set<string>() : base);
  };
  const toggleAll = () => {
    if (allChecked) onChange(new Set(["__none__"]));
    else onChange(new Set<string>());
  };

  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    // `capture: true` so scrolling the page (which this fixed-position menu
    // doesn't track) closes it — but that also catches scroll events from
    // the menu's own internal checkbox list, so ignore those specifically
    // (same fix as the Daily Activity Report's chart line filter).
    const closeOnScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", closeOnScroll, { capture: true, passive: true });
    const closeOnOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => {
      window.removeEventListener("scroll", closeOnScroll, { capture: true });
      document.removeEventListener("mousedown", closeOnOutsideClick);
    };
  }, [open]);

  return (
    <span className="relative inline-flex items-center">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          open ? setOpen(false) : openMenu();
        }}
        className={`ml-1 inline-grid h-4 w-4 place-items-center rounded ${active ? "text-blue-100" : "text-blue-300/60"} hover:text-white`}
        title={`Filter by ${label}`}
      >
        <Filter className="h-3 w-3" fill={active ? "currentColor" : "none"} />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 w-60 rounded-lg border border-white/15 bg-slate-900 shadow-2xl p-2 text-left normal-case"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Filter by {label}
          </div>
          <div className="relative mb-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full rounded border border-white/15 bg-slate-800 pl-7 pr-2 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            <label className="flex items-center gap-2 px-1 py-1 text-xs text-white cursor-pointer hover:bg-white/5 rounded">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                className="accent-blue-500 h-3.5 w-3.5"
              />
              <span className="font-semibold">(Select All)</span>
            </label>
            {visible.map((opt) => {
              const checked = selected.size === 0 || selected.size === options.length || selected.has(opt);
              return (
                <label
                  key={opt}
                  className="flex items-center gap-2 px-1 py-1 text-xs text-slate-200 cursor-pointer hover:bg-white/5 rounded"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt)}
                    className="accent-blue-500 h-3.5 w-3.5"
                  />
                  <span className="truncate">{opt || "(blank)"}</span>
                </label>
              );
            })}
            {visible.length === 0 && (
              <div className="px-1 py-2 text-xs text-slate-500">No matches</div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}

export function AdminUserManagementPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const auth = useAuth();
  // User types shown in the "Add New User" dropdown. Built-in roles plus
  // any company-created custom roles (Accessibility Management's "Add
  // Role" — see src/lib/customRoles.ts) so a role added there is
  // immediately usable as a new user's primary role here too. Users can
  // tick multiple — the first ticked value becomes the primary `role`
  // (used by RLS / legacy access checks); the rest go into `extra_roles`.
  const userTypes = useAllRoleOptions();
  const [viewMode, setViewMode] = usePersistedTab<ViewMode>("ahs:admin-user-management-view-mode", ["list", "hierarchy"], "list");
  const [search, setSearch] = useState("");
  // Per-column funnel filters: { fieldName: Set<allowed values> }
  // Empty set or missing key = no filter on that column.
  // "__none__" sentinel = user toggled (Select All) off → hide everything.
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const setColFilter = (field: string, next: Set<string>) =>
    setColFilters((prev) => ({ ...prev, [field]: next }));
  // Column filters AND together silently — narrowing one column and then a
  // different one without clearing the first can leave zero rows matching
  // both at once, which looks like the whole filter system broke when it's
  // really just an old filter still active on another column. Surface how
  // many columns are currently narrowed, plus a one-click way to clear them.
  const activeFilterCount = Object.values(colFilters).filter((sel) => sel && sel.size > 0).length;
  const clearAllFilters = () => setColFilters({});
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showWorkingHoursModal, setShowWorkingHoursModal] = useState(false);
  // Loaded once so the Add User form can prefill Required Schedule from a
  // matching branch+role template — see the effect below and handleAddUserFormChange.
  const [branchSchedules, setBranchSchedules] = useState<BranchRoleScheduleRow[]>([]);
  useEffect(() => {
    getBranchRoleSchedules().then(setBranchSchedules).catch(() => {});
  }, []);
  const [creatingUser, setCreatingUser] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<UserRow | null>(null);
  const [togglingActive, setTogglingActive] = useState(false);
  const [resetModal, setResetModal] = useState<{ mode: "single"; row: UserRow } | { mode: "all" } | null>(null);
  const [resettingPassword, setResettingPassword] = useState(false);
  // "Locked out" recovery — distinct from resetModal above (which only
  // forces a change on next login using the user's CURRENT password): this
  // one actually resets the Firebase Auth password right now, for someone
  // who can't log in at all. See handleConfirmResetToDefault.
  const [resetToDefaultTarget, setResetToDefaultTarget] = useState<UserRow | null>(null);
  const [resettingToDefault, setResettingToDefault] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUserForm, setNewUserForm] = useState<NewUserFormData>({
    loginName: "",
    userName: "",
    email: "",
    userType: "",
    userTypes: [],
    manager: "",
    technicianId: "",
    assignedBranch: "",
    branchAccess: "",
    poInitials: "",
    requiredCheckIn: "08:00",
    requiredCheckOut: "17:00",
    workingHours: "",
    mealMinutes: "",
    selectedOffDays: [0, 6], // Sunday and Saturday by default
  });

  // Load users from Supabase on mount (RLS scopes to the caller's company).
  // Supabase is now the source of truth — we read only from it.
  useEffect(() => {
    const loadUsers = async () => {
      if (!auth.companyId) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const profiles = await getCompanyUsers();
        setUsers(mapProfilesToRecords(profiles));
      } catch (error) {
        console.error("❌ Error loading users:", error);
        alert(`Error loading users: ${error instanceof Error ? error.message : "Unknown error"}`);
      } finally {
        setLoading(false);
      }
    };
    loadUsers();
  }, [auth.companyId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = users.filter((record) => {
      // Free-text search across the visible fields.
      if (query) {
        const blob = [record.id, record.loginName, record.userName, record.type, record.email, record.manager, record.technicianId, record.office, record.locations]
          .join(" ")
          .toLowerCase();
        if (!blob.includes(query)) return false;
      }
      // Per-column funnel filters (mirrors Ticket List behaviour).
      for (const [field, sel] of Object.entries(colFilters)) {
        if (!sel || sel.size === 0) continue; // no filter on this column
        if (sel.has("__none__")) return false; // explicitly hide everything
        const value = colValue(record, field);
        if (!sel.has(value)) return false;
      }
      return true;
    });
    if (!query) return matches;
    // The blob search above matches ANY field, including "Manager" - so
    // searching a manager's own name previously surfaced every one of
    // their direct reports (whose row also contains that name) ahead of
    // the manager themselves, in whatever order the data happened to load.
    // Sort (stably) so a match on the person's own login/username always
    // outranks a match that only came from some other field.
    const isDirectMatch = (r: UserRow) =>
      r.loginName.toLowerCase().includes(query) || r.userName.toLowerCase().includes(query);
    return [...matches].sort((a, b) => Number(isDirectMatch(b)) - Number(isDirectMatch(a)));
  }, [search, users, colFilters]);

  // Manager cells store a free-text display name (profiles.manager_name),
  // not a real foreign key - so linking to "the manager" needs this lookup
  // to find the actual profile (and its real loginName) behind that name.
  const loginNameByDisplayName = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users) if (u.userName) map.set(u.userName, u.loginName);
    return map;
  }, [users]);

  // Distinct values per column for the funnel dropdowns. Built from the
  // free-text-filtered set so column dropdowns shrink with the search.
  const columnOptions = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const field of UM_FILTERABLE_FIELDS) {
      map[field] = Array.from(
        new Set(users.map((r) => colValue(r, field)).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b));
    }
    return map;
  }, [users]);

  // manager is free text (matched against real profiles by display name —
  // see resolveTeamLeadOrManager in notifyRouting.ts), so building the tree
  // is just: group everyone by their manager's name, then start from
  // whoever's own manager name doesn't resolve to a real person in view
  // (blank, "Unassigned", or a typo/former manager) — those are the roots.
  // Deactivated accounts (e.g. an inactive placeholder like "Dummy.csr")
  // don't belong in the org chart at all — excluded from every hierarchy
  // structure below. Anyone whose real manager turns out to be one of these
  // simply surfaces as their own root instead (same as an unassigned/typo'd
  // manager already does), rather than nesting under a deactivated account.
  const activeForHierarchy = useMemo(() => filtered.filter((r) => r.isActive !== false), [filtered]);

  const usersByName = useMemo(() => {
    const map = new Map<string, UserRow>();
    activeForHierarchy.forEach((r) => { if (r.userName) map.set(r.userName, r); });
    return map;
  }, [activeForHierarchy]);

  // Built straight from manager_name — no synthetic edges. A root here
  // only ever gets the reports it actually, really has. A Super Admin/Admin
  // with a real manager (any role — a Super Admin can genuinely report to
  // a Manager) nests there exactly like anyone else; role only decides
  // where the ROOTS themselves sort (see hierarchyRoots), never whether
  // someone with a real manager gets nested.
  const childrenByManagerName = useMemo(() => {
    const map = new Map<string, UserRow[]>();
    activeForHierarchy.forEach((record) => {
      if (!record.manager) return;
      map.set(record.manager, [...(map.get(record.manager) ?? []), record]);
    });
    for (const list of map.values()) list.sort((a, b) => a.userName.localeCompare(b.userName));
    return map;
  }, [activeForHierarchy]);

  // Drag-and-drop manager reassignment (native HTML5 DnD — same
  // technique as CsrTeamComposition.tsx / the Leaders tab's own
  // reporting-tree drag). manager_name is free text with no DB
  // constraint against cycles, so dropping someone onto their own
  // descendant is blocked client-side.
  const [hierarchyDraggingId, setHierarchyDraggingId] = useState<string | null>(null);
  const [hierarchyOverName, setHierarchyOverName] = useState<string | null>(null);
  const ROOT_DROP_KEY = "__root__";

  const getHierarchyDescendantNames = (userName: string): Set<string> => {
    const result = new Set<string>();
    const stack = (childrenByManagerName.get(userName) ?? []).map((r) => r.userName);
    while (stack.length > 0) {
      const name = stack.pop()!;
      if (result.has(name)) continue;
      result.add(name);
      stack.push(...(childrenByManagerName.get(name) ?? []).map((r) => r.userName));
    }
    return result;
  };

  /** newManagerName "" clears it (makes them a root). */
  const moveUserManagerTo = (profileId: string, newManagerName: string) => {
    const moving = users.find((u) => u.profileId === profileId);
    if (!moving || moving.userName === newManagerName) return;
    if (newManagerName && getHierarchyDescendantNames(moving.userName).has(newManagerName)) return;

    const prevManager = moving.manager;
    setUsers((prev) => prev.map((u) => (u.profileId === profileId ? { ...u, manager: newManagerName } : u)));
    updateCompanyUser(profileId, { managerName: newManagerName }).catch((err) => {
      console.error("Failed to update manager via drag:", err);
      setUsers((prev) => prev.map((u) => (u.profileId === profileId ? { ...u, manager: prevManager } : u)));
      alert(`Failed to update manager: ${err instanceof Error ? err.message : "Unknown error"}`);
    });
  };

  const handleHierarchyDragStart = (profileId: string) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", profileId);
    requestAnimationFrame(() => setHierarchyDraggingId(profileId));
  };
  const handleHierarchyDragEnd = () => {
    setHierarchyDraggingId(null);
    setHierarchyOverName(null);
  };
  const handleHierarchyDragOver = (userName: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (hierarchyOverName !== userName) setHierarchyOverName(userName);
  };
  const handleHierarchyDragLeave = (userName: string) => () => {
    setHierarchyOverName((o) => (o === userName ? null : o));
  };
  const handleHierarchyDrop = (userName: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = e.dataTransfer.getData("text/plain") || hierarchyDraggingId;
    if (draggedId) moveUserManagerTo(draggedId, userName);
    setHierarchyDraggingId(null);
    setHierarchyOverName(null);
  };
  // Fallback drop target — dropping into empty panel space (not onto any
  // specific person) clears the manager, making them a root.
  const handleHierarchyRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (hierarchyOverName !== ROOT_DROP_KEY) setHierarchyOverName(ROOT_DROP_KEY);
  };
  const handleHierarchyRootDragLeave = () => {
    setHierarchyOverName((o) => (o === ROOT_DROP_KEY ? null : o));
  };
  const handleHierarchyRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData("text/plain") || hierarchyDraggingId;
    if (draggedId) moveUserManagerTo(draggedId, "");
    setHierarchyDraggingId(null);
    setHierarchyOverName(null);
  };

  const subtreeSize = useMemo(() => {
    const cache = new Map<string, number>();
    const countBelow = (userName: string, seen: Set<string>): number => {
      if (seen.has(userName)) return 0; // guard a bad manager cycle
      if (cache.has(userName)) return cache.get(userName)!;
      const nextSeen = new Set(seen).add(userName);
      const kids = childrenByManagerName.get(userName) ?? [];
      const total = kids.reduce((sum, kid) => sum + 1 + countBelow(kid.userName, nextSeen), 0);
      cache.set(userName, total);
      return total;
    };
    return (userName: string) => countBelow(userName, new Set());
  }, [childrenByManagerName]);

  // Roots (no manager set, or manager isn't a real active user in view) are
  // NEVER nested under each other — that would show a false reporting line
  // for people who don't actually report to that person; anyone with a
  // real manager nests there regardless of their own role (see
  // childrenByManagerName). Sorted Super Admin first, then Admin, per the
  // requested chart order; within the same tier (and for everyone else)
  // whoever has the biggest real reporting chain underneath them leads,
  // then name.
  const hierarchyRoots = useMemo(
    () =>
      activeForHierarchy
        .filter((record) => !record.manager || !usersByName.has(record.manager))
        .sort((a, b) => {
          const tierDiff = topTierRank(a) - topTierRank(b);
          if (tierDiff !== 0) return tierDiff;
          const diff = subtreeSize(b.userName) - subtreeSize(a.userName);
          if (diff !== 0) return diff;
          return a.userName.localeCompare(b.userName);
        }),
    [activeForHierarchy, usersByName, subtreeSize],
  );

  // Manager dropdown candidates: real users with a manager-ish or admin
  // role, not the old hardcoded name list. Stored as free-text (manager_name
  // matched against real profiles by display name — see resolveTeamLeadOrManager
  // in src/lib/notifyRouting.ts), so the option value is the display name.
  const managerCandidates = useMemo(() => {
    // Deactivated accounts shouldn't be selectable as anyone's manager going
    // forward. Held roles pile up (primary + extraRoles) — someone whose
    // primary role/title is e.g. Senior Director but who also holds Claims
    // Manager/Manager as a secondary role is just as eligible as if that
    // were their primary role; `type` alone is display/hierarchy only.
    const eligible = users.filter((u) => {
      if (u.isActive === false) return false;
      const heldRoles = [u.type, ...(u.extraRoles ?? [])].map((r) => (r || "").toUpperCase());
      return heldRoles.some((r) => ["ADMIN", "SUPERADMIN"].includes(r) || r.includes("MANAGER"));
    });
    return Array.from(new Set(eligible.map((u) => u.userName).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [users]);

  const handleAddUserFormChange = (field: keyof NewUserFormData, value: any) => {
    setNewUserForm((prev) => ({ ...prev, [field]: value }));
  };

  // Prefill Required Schedule from a saved branch/role template (Manage
  // Working Hours) whenever both a branch and a primary role are picked —
  // still fully editable/overridable before submit, this just replaces the
  // hardcoded 08:00/17:00 default with whatever that branch+role is set to.
  useEffect(() => {
    if (!newUserForm.assignedBranch || !newUserForm.userType) return;
    const match = branchSchedules.find(
      (s) => s.branch === newUserForm.assignedBranch && s.role === normalizeRole(newUserForm.userType)
    );
    if (match) {
      setNewUserForm((prev) => ({
        ...prev,
        requiredCheckIn: match.requiredCheckIn,
        requiredCheckOut: match.requiredCheckOut,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newUserForm.assignedBranch, newUserForm.userType, branchSchedules]);

  const toggleOffDay = (dayNum: number) => {
    setNewUserForm((prev) => ({
      ...prev,
      selectedOffDays: prev.selectedOffDays.includes(dayNum)
        ? prev.selectedOffDays.filter((d) => d !== dayNum)
        : [...prev.selectedOffDays, dayNum],
    }));
  };

  const handleToggleUserActive = async (row: UserRow) => {
    const reactivating = row.isActive === false;
    setTogglingActive(true);
    try {
      await updateCompanyUser(row.profileId, { isActive: reactivating });
      const profiles = await getCompanyUsers();
      setUsers(mapProfilesToRecords(profiles));
      void logModuleActivity({
        module: "user-management",
        actorName: auth.displayName || auth.email || "Admin",
        action: reactivating ? "user_activated" : "user_deactivated",
        targetType: "profile",
        targetId: row.profileId,
        targetLabel: row.userName,
      });
    } catch (error) {
      console.error("Toggle active error:", error);
      alert(`Error ${reactivating ? "reactivating" : "deactivating"} user: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setTogglingActive(false);
      setDeactivateTarget(null);
    }
  };

  const handleConfirmResetPassword = async () => {
    if (!resetModal) return;
    const targets = resetModal.mode === "single" ? [resetModal.row] : users;
    if (
      resetModal.mode === "all" &&
      !confirm(`Force ALL ${targets.length} users in this company to change their password on next login? This cannot be undone.`)
    ) {
      return;
    }
    setResettingPassword(true);
    try {
      await setMustChangePassword(targets.map((u) => u.profileId), true);
      void logModuleActivity({
        module: "user-management",
        actorName: auth.displayName || auth.email || "Admin",
        action: "user_password_reset",
        targetLabel: resetModal.mode === "single" ? resetModal.row.userName : `All users (${targets.length})`,
        details: { mode: resetModal.mode, count: targets.length },
      });
      alert(
        resetModal.mode === "single"
          ? `${resetModal.row.userName} will be asked to change their password next time they log in.`
          : `All ${targets.length} users will be asked to change their password next time they log in.`
      );
      setResetModal(null);
    } catch (error) {
      alert(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setResettingPassword(false);
    }
  };

  /**
   * "Locked out" recovery — actually resets the target's Firebase Auth
   * password to the same default used at account creation (see
   * handleCreateUser below), no old password needed, via
   * src/lib/server/adminPasswordBridge.ts. Immediately followed by
   * setMustChangePassword so the known default is only ever valid for
   * exactly one login before the user is forced to set a real password.
   */
  const handleConfirmResetToDefault = async () => {
    if (!resetToDefaultTarget) return;
    setResettingToDefault(true);
    try {
      const idToken = await firebaseAuth?.currentUser?.getIdToken(false);
      if (!idToken) throw new Error("Not authenticated.");
      const res = await fetch("/api/admin-reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, targetProfileId: resetToDefaultTarget.profileId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Password reset failed.");

      await setMustChangePassword([resetToDefaultTarget.profileId], true);
      void logModuleActivity({
        module: "user-management",
        actorName: auth.displayName || auth.email || "Admin",
        action: "user_password_reset_to_default",
        targetLabel: resetToDefaultTarget.userName,
      });
      alert(
        `${resetToDefaultTarget.userName}'s password has been reset to "Welcome2024!". They can log in with that now, but will be required to set a new password immediately.`
      );
      setResetToDefaultTarget(null);
    } catch (error) {
      alert(`Error resetting password: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setResettingToDefault(false);
    }
  };

  const handleCreateUser = async () => {
    // Admins don't report to a manager in this system, so the Manager field
    // isn't required when Admin is one of the selected user types.
    const managerNotRequired = newUserForm.userTypes.includes("ADMIN");
    // Validate required fields
    if (!newUserForm.loginName || !newUserForm.userName || !newUserForm.email || newUserForm.userTypes.length === 0 || (!managerNotRequired && !newUserForm.manager) || !newUserForm.assignedBranch || !newUserForm.branchAccess) {
      alert("Please fill in all required fields.");
      return;
    }

    if (!auth.companyId || !auth.uid) {
      alert("Error: User not authenticated properly.");
      return;
    }

    setCreatingUser(true);
    try {
      // Pick the first ticked role as the primary; remaining go into extra_roles.
      const primaryRole = newUserForm.userTypes[0];
      const extraRoles = newUserForm.userTypes.slice(1);

      // Create user: Firebase Auth credential + Supabase profile (company-scoped)
      const newUid = await createCompanyUser({
        email: newUserForm.email,
        password: "Welcome2024!", // Default password
        displayName: newUserForm.userName,
        role: primaryRole as any,
        extraRoles: extraRoles as any,
        phoneNumber: "",
        department: "",
        managerName: newUserForm.manager,
        assignedBranch: newUserForm.assignedBranch,
        branchAccess: newUserForm.branchAccess,
        technicianId: newUserForm.technicianId,
        poInitials: newUserForm.poInitials,
        requiredCheckIn: newUserForm.requiredCheckIn,
        requiredCheckOut: newUserForm.requiredCheckOut,
        workingHours: newUserForm.workingHours.trim() ? Number(newUserForm.workingHours) : undefined,
        mealMinutes: newUserForm.mealMinutes.trim() ? Number(newUserForm.mealMinutes) : undefined,
      });

      // Save schedule / off-days / PO initials to localStorage (until employees domain is wired)
      localStorage.setItem(`requiredSchedule_${newUid}`, JSON.stringify({
        requiredCheckIn: newUserForm.requiredCheckIn,
        requiredCheckOut: newUserForm.requiredCheckOut,
      }));
      localStorage.setItem(`offDays_${newUid}`, JSON.stringify(newUserForm.selectedOffDays));
      if (newUserForm.poInitials) {
        localStorage.setItem(`poInitials_${newUid}`, newUserForm.poInitials);
      }

      alert(`User ${newUserForm.userName} created successfully!\nDefault password: Welcome2024!`);

      void logModuleActivity({
        module: "user-management",
        actorName: auth.displayName || auth.email || "Admin",
        action: "user_created",
        targetType: "profile",
        targetId: newUid,
        targetLabel: newUserForm.userName,
        details: { role: primaryRole, extraRoles },
      });

      // Reload users from Supabase
      const profiles = await getCompanyUsers();
      setUsers(mapProfilesToRecords(profiles));

      // Reset form
      setNewUserForm({
        loginName: "",
        userName: "",
        email: "",
        userType: "",
        userTypes: [],
        manager: "",
        technicianId: "",
        assignedBranch: "",
        branchAccess: "",
        poInitials: "",
        requiredCheckIn: "08:00",
        requiredCheckOut: "17:00",
        workingHours: "",
        mealMinutes: "",
        selectedOffDays: [0, 6],
      });
      setShowAddUserModal(false);
    } catch (error: any) {
      console.error("Error creating user:", error);
      alert(`Error creating user: ${error.message || "Unknown error"}`);
    } finally {
      setCreatingUser(false);
    }
  };

  return (
    <main className="flex-1 bg-slate-950 py-6">
      <div className="max-w-[1500px] mx-auto px-6">
        <div className="rounded-xl border border-white/15 bg-white/8 p-5 text-white backdrop-blur-md">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button type="button" onClick={goBack} className="btn">
                <ChevronLeft className="h-4 w-4" />
                {mod.label}
              </button>
              <div className="min-w-0">
                <h1 className="text-3xl font-bold tracking-tight">{sub.title}</h1>
                <p className="mt-1 text-sm text-slate-300">{sub.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-full border border-white/15 bg-slate-900/80 p-1">
                {(["list", "hierarchy"] as ViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewMode(mode)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${viewMode === mode ? "bg-blue-500/30 text-white" : "text-slate-300 hover:text-white"}`}
                  >
                    {mode === "list" ? "List" : "Hierarchy"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setResetModal({ mode: "all" })}
                disabled={users.length === 0}
                className="btn whitespace-nowrap border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 disabled:opacity-40"
              >
                Force All Password Changes
              </button>
              <button
                type="button"
                onClick={() => setShowWorkingHoursModal(true)}
                className="btn whitespace-nowrap border border-blue-400/40 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20"
              >
                Manage Working Hours
              </button>
              <button
                type="button"
                onClick={() => setShowAddUserModal(true)}
                className="btn btn-primary whitespace-nowrap"
              >
                + Add User
              </button>
            </div>
          </div>

          <div className="mt-4">
            <ActivityLogPanel module="user-management" title="User Management Activity Log" />
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-4">
            <div>
              <div className="text-2xl font-bold text-white">
                {loading ? "Loading..." : `${users.length} records found`}
              </div>
              <div className="text-sm text-slate-400">
                {loading ? "Fetching from database..." : "search in result"}
                {!loading && !auth.companyId && (
                  <span className="text-red-400 ml-2">⚠️ No company ID found</span>
                )}
              </div>
            </div>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="flex items-center gap-1.5 rounded-md border border-blue-400/40 bg-blue-500/15 px-3 py-1.5 text-xs font-semibold text-blue-200 hover:bg-blue-500/25"
                title="Column filters narrow the table by ANDing every active column together — clear them all here."
              >
                {activeFilterCount} column filter{activeFilterCount === 1 ? "" : "s"} active — Clear all
              </button>
            )}
            <div className="ml-auto flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.04em] text-slate-400">Status</label>
                <select
                  value={
                    colFilters["status"]?.has("Active")
                      ? "Active"
                      : colFilters["status"]?.has("Deactivated")
                        ? "Deactivated"
                        : "all"
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    setColFilter("status", v === "all" ? new Set() : new Set([v]));
                  }}
                  className="glass-input mt-2"
                  disabled={loading}
                >
                  <option value="all">All</option>
                  <option value="Active">Active only</option>
                  <option value="Deactivated">Deactivated only</option>
                </select>
              </div>
              <div className="min-w-[220px] max-w-md flex-1">
                <label className="block text-xs font-semibold uppercase tracking-[0.04em] text-slate-400">Search</label>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by login name, user name, manager, email, office..."
                  className="glass-input mt-2 w-full"
                  disabled={loading}
                />
              </div>
            </div>
          </div>
        </div>

        {viewMode === "list" ? (
          <div className="mt-5 overflow-x-auto rounded-xl border border-white/15 bg-white/8 backdrop-blur-md">
            <table className="w-full table-fixed text-xs leading-tight">
              <colgroup>
                <col style={{ width: "3%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "24%" }} />
              </colgroup>
              <thead>
                <tr className="bg-slate-900/90 text-blue-200">
                  <th className="px-2.5 py-2 text-left">
                    <span className="inline-flex items-center">ID
                      <ColumnFilter field="id" label="ID" options={columnOptions["id"] || []}
                        selected={colFilters["id"] || new Set()} onChange={(n) => setColFilter("id", n)} />
                    </span>
                  </th>
                  <th className="px-2.5 py-2 text-left">
                    <span className="inline-flex items-center">Login Name
                      <ColumnFilter field="loginName" label="Login Name" options={columnOptions["loginName"] || []}
                        selected={colFilters["loginName"] || new Set()} onChange={(n) => setColFilter("loginName", n)} />
                    </span>
                  </th>
                  <th className="px-2.5 py-2 text-left">
                    <span className="inline-flex items-center">Full Name
                      <ColumnFilter field="userName" label="Full Name" options={columnOptions["userName"] || []}
                        selected={colFilters["userName"] || new Set()} onChange={(n) => setColFilter("userName", n)} />
                    </span>
                  </th>
                  <th className="px-2.5 py-2 text-left">
                    <span className="inline-flex items-center">Type
                      <ColumnFilter field="type" label="Type" options={columnOptions["type"] || []}
                        selected={colFilters["type"] || new Set()} onChange={(n) => setColFilter("type", n)} />
                    </span>
                  </th>
                  <th className="px-2.5 py-2 text-left">
                    <span className="inline-flex items-center">Email
                      <ColumnFilter field="email" label="Email" options={columnOptions["email"] || []}
                        selected={colFilters["email"] || new Set()} onChange={(n) => setColFilter("email", n)} />
                    </span>
                  </th>
                  <th className="px-2.5 py-2 text-left">
                    <span className="inline-flex items-center">Manager
                      <ColumnFilter field="manager" label="Manager" options={columnOptions["manager"] || []}
                        selected={colFilters["manager"] || new Set()} onChange={(n) => setColFilter("manager", n)} />
                    </span>
                  </th>
                  <th className="px-2.5 py-2 text-left">
                    <span className="inline-flex items-center">Tech ID
                      <ColumnFilter field="technicianId" label="Technician ID" options={columnOptions["technicianId"] || []}
                        selected={colFilters["technicianId"] || new Set()} onChange={(n) => setColFilter("technicianId", n)} />
                    </span>
                  </th>
                  <th className="px-2.5 py-2 text-left">
                    <span className="inline-flex items-center">Branch
                      <ColumnFilter field="office" label="Assigned Branch" options={columnOptions["office"] || []}
                        selected={colFilters["office"] || new Set()} onChange={(n) => setColFilter("office", n)} />
                    </span>
                  </th>
                  <th className="px-2.5 py-2 text-left">Branch Access</th>
                  <th className="px-2.5 py-2 text-left">
                    <span className="inline-flex items-center">Status
                      <ColumnFilter field="status" label="Status" options={columnOptions["status"] || []}
                        selected={colFilters["status"] || new Set()} onChange={(n) => setColFilter("status", n)} />
                    </span>
                  </th>
                  <th className="px-2.5 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 bg-slate-950/60 text-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-2">
                      <BrandedLoader label="Loading users…" />
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-10 text-center text-slate-400">
                      {users.length === 0 ? "No users found. Create your first user above." : "No records match that search."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((record) => {
                    const branchAccess = formatBranchAccess(record.locations);
                    const rowKey = `${record.id}-${record.loginName}`;
                    const branchAccessExpandable = branchAccess.full && branchAccess.full !== branchAccess.short;
                    return (
                    <tr key={rowKey} className="hover:bg-white/5">
                      <td className="px-2.5 py-2 align-top">{record.id}</td>
                      {/* Displays the full name, same as User Name — but userId stays record.loginName (the real username) since that's what the detail page's getProfileByUsername lookup resolves by; only the visible text changes here. */}
                      <td className="px-2.5 py-2 align-top break-words"><UserLink moduleSlug={mod.slug} submoduleSlug={sub.slug} userId={record.loginName}>{record.userName}</UserLink></td>
                      <td className="px-2.5 py-2 align-top break-words"><UserLink moduleSlug={mod.slug} submoduleSlug={sub.slug} userId={record.loginName}>{record.userName}</UserLink></td>
                      <td className="px-2.5 py-2 align-top break-words">{roleDisplay(record.type)}</td>
                      <td className="px-2.5 py-2 align-top break-words text-slate-300">{record.email || "—"}</td>
                      <td className="px-2.5 py-2 align-top break-words"><UserLink moduleSlug={mod.slug} submoduleSlug={sub.slug} userId={loginNameByDisplayName.get(record.manager) || record.manager || record.loginName}>{record.manager || "—"}</UserLink></td>
                      <td className="px-2.5 py-2 align-top break-words text-slate-300">{record.technicianId || "—"}</td>
                      <td className="px-2.5 py-2 align-top break-words text-slate-300">{record.office}</td>
                      <td className="px-2.5 py-2 align-top text-slate-300">
                        {branchAccessExpandable ? (
                          <HoverCard openDelay={150} closeDelay={100}>
                            <HoverCardTrigger asChild>
                              <span className="block truncate cursor-default hover:text-white">{branchAccess.short}</span>
                            </HoverCardTrigger>
                            <HoverCardContent className="w-auto max-w-xs text-xs">
                              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Branch Access</div>
                              {branchAccess.full}
                            </HoverCardContent>
                          </HoverCard>
                        ) : (
                          <span className="block truncate">{branchAccess.short}</span>
                        )}
                      </td>
                      <td className="px-2.5 py-2 align-top">
                        <span
                          className={
                            record.isActive === false
                              ? "inline-block rounded-full border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-300"
                              : "inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-300"
                          }
                        >
                          {record.isActive === false ? "Deactivated" : "Active"}
                        </span>
                      </td>
                      <td className="px-2.5 py-2 align-top">
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setResetModal({ mode: "single", row: record })}
                            title="Force Password Change"
                            aria-label="Force Password Change"
                            className="inline-flex items-center gap-1 rounded border border-blue-500/40 bg-blue-500/10 px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-blue-300 hover:bg-blue-500/20"
                          >
                            <KeyRound className="h-3 w-3" /> Reset PW
                          </button>
                          <button
                            type="button"
                            onClick={() => setResetToDefaultTarget(record)}
                            title="Reset to Default — for a user who's locked out and can't log in at all"
                            aria-label="Reset to Default"
                            className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-amber-300 hover:bg-amber-500/20"
                          >
                            <RotateCcw className="h-3 w-3" /> Default
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeactivateTarget(record)}
                            title={record.isActive === false ? "Reactivate" : "Deactivate"}
                            aria-label={record.isActive === false ? "Reactivate" : "Deactivate"}
                            className={
                              record.isActive === false
                                ? "inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-emerald-300 hover:bg-emerald-500/20"
                                : "inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-red-300 hover:bg-red-500/20"
                            }
                          >
                            {record.isActive === false ? <CheckCircle2 className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
                            {record.isActive === false ? "Reactivate" : "Deactivate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div
            onDragOver={handleHierarchyRootDragOver}
            onDragLeave={handleHierarchyRootDragLeave}
            onDrop={handleHierarchyRootDrop}
            title="Drop here to clear a manager (make them top-level)"
            className={`mt-5 rounded-xl border p-5 text-white backdrop-blur-md transition-colors ${
              hierarchyOverName === ROOT_DROP_KEY ? "border-primary bg-white/12" : "border-white/15 bg-white/8"
            }`}
          >
            <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-slate-400">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-cyan-400" /> Senior / Director / Admin</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-400" /> Manager / Team Leader</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-500" /> Everyone else</span>
            </div>
            {hierarchyRoots.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">No hierarchy to show yet.</p>
            ) : (
              hierarchyRoots.map((root) => (
                <HierarchyTreeNode
                  key={root.loginName}
                  record={root}
                  childrenByManagerName={childrenByManagerName}
                  moduleSlug={mod.slug}
                  submoduleSlug={sub.slug}
                  ancestors={EMPTY_ANCESTORS}
                  subtreeSize={subtreeSize}
                  isRoot
                  draggingId={hierarchyDraggingId}
                  overName={hierarchyOverName}
                  onDragStart={handleHierarchyDragStart}
                  onDragEnd={handleHierarchyDragEnd}
                  onDragOver={handleHierarchyDragOver}
                  onDragLeave={handleHierarchyDragLeave}
                  onDrop={handleHierarchyDrop}
                />
              ))
            )}
          </div>
        )}
      </div>

      {showAddUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-white/15 bg-slate-950/95 shadow-2xl shadow-black/60">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-white/10 bg-slate-950/95 px-5 py-4 backdrop-blur-md">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Add New User</h2>
                <p className="mt-1 text-sm text-slate-300">Create a new user account (Default password: Welcome2024!)</p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button type="button" onClick={() => setShowAddUserModal(false)} disabled={creatingUser} className="btn hover:bg-slate-800">Cancel</button>
                <button type="button" onClick={handleCreateUser} disabled={creatingUser} className="btn btn-primary disabled:opacity-50">
                  {creatingUser && <Loader2 className="h-4 w-4 animate-spin mr-1 inline" />}
                  {creatingUser ? "Creating…" : "Create User"}
                </button>
              </div>
            </div>
            <div className="p-5 space-y-6">
              {/* Basic Information */}
              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-4">Basic Information</h3>
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Login Name *</span>
                    <input
                      placeholder="Enter login name"
                      className="glass-input w-full text-[11px] px-2 py-1"
                      value={newUserForm.loginName}
                      onChange={(e) => handleAddUserFormChange("loginName", e.target.value)}
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Full Name *</span>
                    <input
                      placeholder="Enter user name"
                      className="glass-input w-full text-[11px] px-2 py-1"
                      value={newUserForm.userName}
                      onChange={(e) => handleAddUserFormChange("userName", e.target.value)}
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Email *</span>
                    <input 
                      type="email" 
                      placeholder="Enter email address" 
                      className="glass-input w-full text-[11px] px-2 py-1"
                      value={newUserForm.email}
                      onChange={(e) => handleAddUserFormChange("email", e.target.value)}
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">User Type *</span>
                    <RoleMultiSelect
                      values={newUserForm.userTypes}
                      options={userTypes}
                      placeholder="Select user type(s)"
                      onChange={(next) => setNewUserForm((prev) => ({
                        ...prev,
                        userTypes: next,
                        // Primary role stays in sync with the first ticked.
                        userType: next[0] || "",
                      }))}
                    />
                  </label>
                </div>
              </div>

              {/* Assignment Details */}
              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-4">Assignment Details</h3>
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">
                      Manager {newUserForm.userTypes.includes("ADMIN") ? "(not required for Admins)" : "*"}
                    </span>
                    <select
                      className="glass-input w-full text-[11px] px-2 py-1"
                      value={newUserForm.manager}
                      onChange={(e) => handleAddUserFormChange("manager", e.target.value)}
                    >
                      <option value="">Assign manager</option>
                      {managerCandidates.map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Technician ID</span>
                    <input 
                      placeholder="Enter technician ID (optional)" 
                      className="glass-input w-full text-[11px] px-2 py-1"
                      value={newUserForm.technicianId}
                      onChange={(e) => handleAddUserFormChange("technicianId", e.target.value)}
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Assigned Branch *</span>
                    <BranchSingleSelect
                      placeholder="Select branch office"
                      value={newUserForm.assignedBranch}
                      onChange={(v) => handleAddUserFormChange("assignedBranch", v)}
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Branch Access *</span>
                    <BranchMultiSelect
                      placeholder="Select branch access"
                      value={newUserForm.branchAccess}
                      onChange={(v) => handleAddUserFormChange("branchAccess", v)}
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">PO # Initial</span>
                    <input 
                      placeholder="Enter initials for purchase orders" 
                      className="glass-input w-full text-[11px] px-2 py-1"
                      value={newUserForm.poInitials}
                      onChange={(e) => handleAddUserFormChange("poInitials", e.target.value.toUpperCase())}
                      maxLength={5}
                    />
                  </label>
                </div>
              </div>

              {/* Required Schedule */}
              <div className="pt-4 border-t border-white/10">
                <h3 className="text-sm font-semibold text-slate-300 mb-4">Required Schedule</h3>
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="flex flex-col gap-2">
                    <span className="text-xs text-slate-400">Check-In Time</span>
                    <input
                      type="time"
                      value={newUserForm.requiredCheckIn}
                      onChange={(e) => handleAddUserFormChange("requiredCheckIn", e.target.value)}
                      className="px-3 py-2 bg-slate-700 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs text-slate-400">Check-Out Time</span>
                    <input
                      type="time"
                      value={newUserForm.requiredCheckOut}
                      onChange={(e) => handleAddUserFormChange("requiredCheckOut", e.target.value)}
                      className="px-3 py-2 bg-slate-700 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs text-slate-400">Working Hours <span className="normal-case text-[10px] text-slate-500">(overrides Check-In/Out for meal eligibility)</span></span>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      placeholder="e.g. 8"
                      value={newUserForm.workingHours}
                      onChange={(e) => handleAddUserFormChange("workingHours", e.target.value)}
                      className="px-3 py-2 bg-slate-700 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs text-slate-400">Meal Time (minutes)</span>
                    <input
                      type="number"
                      min={0}
                      step={5}
                      placeholder="e.g. 30"
                      value={newUserForm.mealMinutes}
                      onChange={(e) => handleAddUserFormChange("mealMinutes", e.target.value)}
                      className="px-3 py-2 bg-slate-700 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                    />
                  </label>
                </div>
              </div>

              {/* Days Off */}
              <div className="pt-4 border-t border-white/10">
                <h3 className="text-sm font-semibold text-slate-300 mb-4">Days Off</h3>
                <div className="grid grid-cols-7 gap-2 mb-4">
                  {DAYS_OF_WEEK.map((dayName, i) => {
                    const dayNum = DAYS_OF_WEEK_INDEX[i];
                    return (
                    <button
                      key={dayNum}
                      type="button"
                      onClick={() => toggleOffDay(dayNum)}
                      className={`p-2 rounded border transition text-xs font-semibold flex flex-col items-center justify-center h-16 ${
                        newUserForm.selectedOffDays.includes(dayNum)
                          ? "bg-red-500/20 border-red-500/50 text-red-300"
                          : "bg-slate-700 border-white/10 text-slate-300 hover:border-white/30"
                      }`}
                    >
                      <span className="text-xs truncate">{dayName.slice(0, 3)}</span>
                      <span className="text-xs mt-1 opacity-75">{newUserForm.selectedOffDays.includes(dayNum) ? "OFF" : "WORK"}</span>
                    </button>
                    );
                  })}
                </div>
                {newUserForm.selectedOffDays.length > 0 && (
                  <p className="text-xs text-blue-300">Selected: {newUserForm.selectedOffDays.map((d) => DAY_NAME_BY_INDEX[d]).join(", ")}</p>
                )}
              </div>

              <div className="text-xs text-slate-400 pt-4 border-t border-white/10">
                <p className="mb-2"><span className="font-semibold">Note:</span> Fields marked with * are required.</p>
                <p className="mb-2">• User will be created with company ID: <span className="text-blue-300 font-mono">{auth.companyLoginAlias || auth.companyId || "N/A"}</span></p>
                <p className="mb-2">• Default password: <span className="text-blue-300 font-mono">Welcome2024!</span> (user should change on first login)</p>
                <p>• Username (for username-based login) will match the User Name entered above</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {resetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-xl border border-white/15 bg-slate-950/95 shadow-2xl shadow-black/60">
            <div className="border-b border-white/10 px-5 py-4">
              <h2 className="text-xl font-bold tracking-tight">
                {resetModal.mode === "single" ? `Force Password Change — ${resetModal.row.userName}` : `Force ALL Password Changes (${users.length} users)`}
              </h2>
              <p className="mt-1 text-sm text-slate-300">
                {resetModal.mode === "single"
                  ? `${resetModal.row.userName} keeps logging in with their current password — but the next time they sign in, they'll be sent straight to My Profile and required to set a new password before they can reach any dashboard.`
                  : `Every one of the ${users.length} users currently loaded keeps logging in with their current password — but the next time each signs in, they'll be sent straight to My Profile and required to set a new password before reaching any dashboard.`}
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-white/10 px-5 py-4">
              <button type="button" onClick={() => setResetModal(null)} className="btn hover:bg-slate-800" disabled={resettingPassword}>
                Cancel
              </button>
              <button type="button" onClick={handleConfirmResetPassword} className="btn btn-primary" disabled={resettingPassword}>
                {resettingPassword ? "Applying…" : "Force Password Change"}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetToDefaultTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-xl border border-white/15 bg-slate-950/95 shadow-2xl shadow-black/60">
            <div className="border-b border-white/10 px-5 py-4">
              <h2 className="text-xl font-bold tracking-tight">Reset to Default — {resetToDefaultTarget.userName}</h2>
              <p className="mt-1 text-sm text-slate-300">
                Use this when {resetToDefaultTarget.userName} is locked out and can't log in at all (forgot their password). This
                immediately sets their password to <span className="font-mono text-amber-300">Welcome2024!</span> — no old password
                needed — so they can log back in right now. They'll then be required to set a new password of their own before
                reaching any dashboard.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-white/10 px-5 py-4">
              <button type="button" onClick={() => setResetToDefaultTarget(null)} className="btn hover:bg-slate-800" disabled={resettingToDefault}>
                Cancel
              </button>
              <button type="button" onClick={handleConfirmResetToDefault} className="btn btn-primary" disabled={resettingToDefault}>
                {resettingToDefault ? "Resetting…" : "Reset Password"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deactivateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
          <div className="relative w-full max-w-sm rounded-xl border border-white/15 bg-slate-950/95 p-5 shadow-2xl shadow-black/60">
            <h2 className="text-lg font-bold text-white">
              {deactivateTarget.isActive === false ? "Reactivate user?" : "Deactivate user?"}
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              {deactivateTarget.isActive === false
                ? `Reactivate ${deactivateTarget.userName} (${deactivateTarget.email})? They'll be able to log in again.`
                : `Deactivate ${deactivateTarget.userName} (${deactivateTarget.email})? They won't be able to log in, but their records stay intact.`}
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setDeactivateTarget(null)} disabled={togglingActive} className="btn hover:bg-slate-800">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleToggleUserActive(deactivateTarget)}
                disabled={togglingActive}
                className={deactivateTarget.isActive === false ? "btn btn-primary" : "btn btn-danger"}
              >
                {togglingActive
                  ? (deactivateTarget.isActive === false ? "Reactivating…" : "Deactivating…")
                  : (deactivateTarget.isActive === false ? "Reactivate" : "Deactivate")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showWorkingHoursModal && (
        <ManageWorkingHoursModal
          branches={LOCATIONS}
          onClose={() => setShowWorkingHoursModal(false)}
          changedByName={auth.displayName || auth.email || "Admin"}
          onApplied={async () => {
            const [profiles, schedules] = await Promise.all([getCompanyUsers(), getBranchRoleSchedules()]);
            setUsers(mapProfilesToRecords(profiles));
            setBranchSchedules(schedules);
          }}
        />
      )}
    </main>
  );
}
