/**
 * Admin → Approval Chain. Manages and previews the role + area/branch
 * approval routing for NON-Philippines field staff (migration 0329):
 *
 *   Technician ──► Branch Manager / Parts / Parts Manager (same branch)
 *              ──► Senior Branch Manager (owns the branch's area)
 *              ──► Admin / Technical Director / Asst. Director
 *   Branch Manager / Parts staff ──► their area's SBM ──► Admin / TD / ATD
 *   Senior Branch Manager  ──► Admin / TD / ATD
 *
 * Hierarchy tab: create/rename/delete Areas, set each area's Senior Branch
 * Manager (reassigning moves every branch they own), add/move branches. An
 * area's branches are its SBM's rows in senior_branch_manager_branches — the
 * same table Branch Daily Report uses.
 * People tab: every governed employee, who approves them, who can clock them
 * in, their branch (editable), and problems; plus a route preview.
 *
 * The rules shown here come from approvalDirectory.ts, which mirrors the
 * database functions that actually enforce them (chain_can_approve /
 * chain_can_clock_in), so the preview matches what the server allows.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Check, Pencil, ChevronLeft, ChevronRight, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useSmartBack } from "@/hooks/useSmartBack";
import { getCompanyUsers, invalidateCompanyUsersCache, updateCompanyUser, type ProfileRow } from "@/lib/supabase/users";
import { getSeniorBranchManagerAssignments, assignBranchToSeniorManager, unassignBranch, type SbmBranchAssignment } from "@/lib/supabase/seniorBranchManagerAssignments";
import { getApprovalAreas, createApprovalArea, updateApprovalArea, deleteApprovalArea, getTopApproverIds, setTopApproverIds, getPhDepartmentManagers, type ApprovalArea, type PhDepartmentManagerRow } from "@/lib/supabase/approvalAreas";
import { PhApprovalChainPanel } from "@/components/PhApprovalChainPanel";
import { supabase } from "@/lib/supabase/client";
import { ROLE_LABELS, normalizeRole } from "@/lib/roleLabels";
import {
  chainLevelOf,
  isTopApprover,
  chainApproverGroups,
  chainCanClockInWith,
  chainCanApproveWith,
  normBranch,
  CHAIN_LEVEL_LABEL,
  type ChainData,
} from "@/lib/approvalDirectory";

interface Props {
  mod: ModuleDef;
  sub: SubModuleDef;
}

/** Masterlist Employment Status = Trainee. */
function TraineeFlag() {
  return <span className="px-1.5 rounded text-[9px] font-bold uppercase tracking-wide border border-amber-500/50 bg-amber-500/15 text-amber-300" title="Trainee — their attendance is approved through this chain too">Trainee</span>;
}

const nameOf = (p: ProfileRow | null | undefined) => (p ? p.display_name || p.email || "Unknown" : "—");
const roleLabel = (p: ProfileRow) => ROLE_LABELS[normalizeRole(p.role)] ?? p.role;
const holds = (p: ProfileRow, role: string) => [p.role, ...(p.extra_roles ?? [])].some((r) => String(r || "").toUpperCase() === role);
const FULL_CLOCK_IN = ["SUPERADMIN", "SUPERSUPERADMIN", "ADMIN", "HR", "FINANCE", "TECHNICAL_DIRECTOR", "TECHNICAL_ASSISTANT_DIRECTOR"];

export function ApprovalChainPage({ mod, sub }: Props) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));

  const [tab, setTab] = useState<"hierarchy" | "people" | "ph">("hierarchy");
  const [phDeptManagers, setPhDeptManagersState] = useState<PhDepartmentManagerRow[]>([]);
  const [phMigrationMissing, setPhMigrationMissing] = useState(false);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [sbmRows, setSbmRows] = useState<SbmBranchAssignment[]>([]);
  const [areas, setAreas] = useState<ApprovalArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [areasMissing, setAreasMissing] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      invalidateCompanyUsersCache();
      const [rows, sbm] = await Promise.all([getCompanyUsers(), getSeniorBranchManagerAssignments()]);
      setProfiles(rows);
      setSbmRows(sbm);
      try {
        setAreas(await getApprovalAreas());
        setTopIds(await getTopApproverIds());
        // PH department managers (0334) — a failed read just means the migration isn't run yet.
        const phProbe = await supabase.from("ph_department_managers").select("department, profile_id");
        setPhMigrationMissing(!!phProbe.error);
        setPhDeptManagersState(await getPhDepartmentManagers());
        setAreasMissing(false);
      } catch {
        setAreasMissing(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const [topIds, setTopIds] = useState<string[]>([]);
  const data: ChainData = useMemo(
    () => ({ byId: new Map(profiles.map((p) => [p.id, p])), sbmBranches: sbmRows, topApproverIds: topIds, phDeptManagers }),
    [profiles, sbmRows, topIds, phDeptManagers]
  );
  const active = useMemo(() => profiles.filter((p) => p.is_active), [profiles]);
  const nonPh = useMemo(() => active.filter((p) => normBranch(p.assigned_branch) !== "philippines"), [active]);
  const governed = useMemo(() => nonPh.filter((p) => chainLevelOf(p)), [nonPh]);
  const sbms = useMemo(() => nonPh.filter((p) => holds(p, "SENIOR_BRANCH_MANAGER")).sort((a, b) => nameOf(a).localeCompare(nameOf(b))), [nonPh]);
  const topTier = useMemo(
    // SuperAdmins always belong to the top level (they can approve anything); the list adds everyone else.
    () =>
      active
        .filter((p) => holds(p, "SUPERADMIN") || isTopApprover(data, p))
        .sort((a, b) => Number(holds(b, "SUPERADMIN")) - Number(holds(a, "SUPERADMIN")) || nameOf(a).localeCompare(nameOf(b))),
    [active, data]
  );

  // ---- Top level editing (migration 0333) ----
  const [editingTop, setEditingTop] = useState(false);
  const [topDraft, setTopDraft] = useState<Set<string>>(new Set());
  const [topSearch, setTopSearch] = useState("");
  const startEditTop = () => {
    setTopDraft(new Set(topTier.filter((p) => !holds(p, "SUPERADMIN")).map((p) => p.id)));
    setTopSearch("");
    setEditingTop(true);
  };
  const saveTop = (ids: string[]) =>
    run(async () => {
      await setTopApproverIds(ids);
      setEditingTop(false);
    });

  // ---- Per-person edits in a branch ----
  const BRANCH_ROLE_OPTIONS = ["TECHNICIAN", "TECHNICIAN_MANAGER", "BRANCH_MANAGER", "PARTS", "PARTS_TEAM_LEADER", "PARTS_MANAGER"];
  const changePersonRole = (person: ProfileRow, newRole: string) =>
    run(async () => {
      if (!window.confirm(`Change ${nameOf(person)}'s role from ${roleLabel(person)} to ${ROLE_LABELS[newRole] ?? newRole}? This changes their access across the app.`)) return;
      await updateCompanyUser(person.id, { role: newRole as ProfileRow["role"] });
    });
  const movePerson = (person: ProfileRow, branch: string) =>
    run(async () => {
      if (!window.confirm(branch ? `Move ${nameOf(person)} to ${branch}?` : `Remove ${nameOf(person)} from ${person.assigned_branch}? They'll have no branch.`)) return;
      await updateCompanyUser(person.id, { assignedBranch: branch });
    });

  // Canonical branch list: SBM-owned branches first (their spelling), then any other spelling found on profiles.
  const allBranches = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of sbmRows) if (!seen.has(normBranch(s.branch))) seen.set(normBranch(s.branch), s.branch);
    for (const p of nonPh) if (p.assigned_branch && !seen.has(normBranch(p.assigned_branch))) seen.set(normBranch(p.assigned_branch), p.assigned_branch);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [sbmRows, nonPh]);

  const branchesOf = (sbmId: string | null) => (sbmId ? sbmRows.filter((s) => s.profileId === sbmId).map((s) => s.branch).sort((a, b) => a.localeCompare(b)) : []);
  const ownerOf = (branch: string) => sbmRows.find((s) => normBranch(s.branch) === normBranch(branch))?.profileId ?? null;
  const areaOfSbm = (sbmId: string | null) => (sbmId ? areas.find((a) => a.seniorBranchManagerId === sbmId) ?? null : null);
  const areaOfBranch = (branch: string | null | undefined) => (branch ? areaOfSbm(ownerOf(branch)) : null);
  const peopleAt = (branch: string) => governed.filter((p) => normBranch(p.assigned_branch) === normBranch(branch));
  const branchStaffAt = (branch: string) =>
    nonPh.filter((p) => normBranch(p.assigned_branch) === normBranch(branch) && (chainLevelOf(p) || holds(p, "PARTS")));
  const assignable = useMemo(
    () => nonPh.filter((p) => (chainLevelOf(p) && chainLevelOf(p) !== "sbm" && chainLevelOf(p) !== "td" && chainLevelOf(p) !== "atd") || holds(p, "PARTS")).sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
    [nonPh]
  );
  /** Branch level first (Branch Manager and Parts side by side), then technicians. */
  /** -1 Senior Branch Manager, 0 branch level (BM / Parts), 2 technicians. */
  const rankAtBranch = (p: ProfileRow) => {
    const l = chainLevelOf(p);
    return l === "sbm" ? -1 : l === "branch" ? 0 : 2;
  };
  const [addPersonFor, setAddPersonFor] = useState<string | null>(null);
  const ADD_ROLE_OPTIONS = ["TECHNICIAN", "BRANCH_MANAGER", "PARTS"];
  const [addDraft, setAddDraft] = useState<{ personId: string; role: string }>({ personId: "", role: "TECHNICIAN" });
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [personDraft, setPersonDraft] = useState<{ role: string; branch: string }>({ role: "", branch: "" });
  /** Pencil → Save: role and/or branch in one update. */
  // Role is managed in Users — this page only moves people between branches.
  const savePersonEdit = (person: ProfileRow) =>
    run(async () => {
      const fields: { assignedBranch?: string } = {};
      if (personDraft.branch && normBranch(personDraft.branch) !== normBranch(person.assigned_branch)) fields.assignedBranch = personDraft.branch;
      if (Object.keys(fields).length === 0) { setEditingPersonId(null); return; }
      if (!window.confirm(`Move ${nameOf(person)} from ${person.assigned_branch || "no branch"} to ${fields.assignedBranch}?`)) return;
      await updateCompanyUser(person.id, fields);
      setEditingPersonId(null);
    });
  /** Add person: put them in this branch with the chosen role. */
  const addPersonToBranch = (person: ProfileRow, branch: string) =>
    run(async () => {
      if (!window.confirm(`Add ${nameOf(person)} (${roleLabel(person)}) to ${branch}?${person.assigned_branch ? ` This moves them from ${person.assigned_branch}.` : ""}`)) return;
      await updateCompanyUser(person.id, { assignedBranch: branch });
      setAddPersonFor(null);
    });
  const movePersonToBranch = (person: ProfileRow, branch: string) =>
    run(async () => {
      if (person.assigned_branch && normBranch(person.assigned_branch) !== normBranch(branch) && !window.confirm(`Move ${nameOf(person)} from ${person.assigned_branch} to ${branch}?`)) return;
      await updateCompanyUser(person.id, { assignedBranch: branch });
      setAddPersonFor(null);
    });

  // ---- Hierarchy actions ----
  const [newArea, setNewArea] = useState({ name: "", sbmId: "" });
  const [expandedBranch, setExpandedBranch] = useState<string | null>(null);

  const reassignAreaSbm = (area: ApprovalArea, newSbmId: string) =>
    run(async () => {
      const oldSbm = area.seniorBranchManagerId;
      const moving = branchesOf(oldSbm);
      if (oldSbm && moving.length > 0 && newSbmId && !window.confirm(`Move ${moving.length} branch(es) from ${nameOf(data.byId.get(oldSbm))} to ${nameOf(data.byId.get(newSbmId))}?`)) return;
      await updateApprovalArea(area.id, { seniorBranchManagerId: newSbmId || null });
      if (newSbmId) for (const b of moving) await assignBranchToSeniorManager(newSbmId, b);
    });

  const addBranchToArea = (area: ApprovalArea, branch: string) =>
    run(async () => {
      if (!area.seniorBranchManagerId) throw new Error("Set this area's Senior Branch Manager first.");
      const owner = ownerOf(branch);
      if (owner && owner !== area.seniorBranchManagerId && !window.confirm(`${branch} currently belongs to ${nameOf(data.byId.get(owner))}. Move it to ${area.name}?`)) return;
      await assignBranchToSeniorManager(area.seniorBranchManagerId, branch);
    });

  const seedAreasFromSbms = () =>
    run(async () => {
      let i = 0;
      for (const s of sbms) {
        if (areaOfSbm(s.id) || branchesOf(s.id).length === 0) continue;
        await createApprovalArea(`Area ${++i} — ${nameOf(s)}`, s.id, i);
      }
    });

  const unassignedBranches = allBranches.filter((b) => !areaOfBranch(b));

  // ---- People ----
  const [areaFilter, setAreaFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [search, setSearch] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const peopleRows = useMemo(
    () =>
      governed.map((p) => {
        const level = chainLevelOf(p)!;
        const groups = chainApproverGroups(data, p.id) ?? [];
        const clockIn = level === "tech" || level === "branch"
          ? active.filter((v) => v.id !== p.id && !FULL_CLOCK_IN.some((r) => holds(v, r)) && chainCanClockInWith(data, v.id, p.id) === true)
          : [];
        const area = areaOfBranch(p.assigned_branch);
        const issues: string[] = [];
        if (!p.assigned_branch) issues.push("No branch assigned");
        else {
          if ((level === "tech" || level === "branch") && !ownerOf(p.assigned_branch)) issues.push(`${p.assigned_branch} has no Senior Branch Manager`);
          else if ((level === "tech" || level === "branch") && !area) issues.push(`${p.assigned_branch} isn't in any area`);
          const canonical = allBranches.find((b) => normBranch(b) === normBranch(p.assigned_branch));
          if (canonical && canonical !== p.assigned_branch) issues.push(`Branch spelled "${p.assigned_branch}" — use "${canonical}"`);
        }
        if (level === "tech" && p.assigned_branch && !groups.some((g) => g.label === "Branch")) issues.push("No Branch Manager or Parts staff at this branch");
        if (level === "sbm" && branchesOf(p.id).length === 0) issues.push("Owns no branches");
        const teamApproves = governed.filter((t) => t.id !== p.id && chainCanApproveWith(data, p.id, t.id) === true);
        const teamClocksIn = governed.filter((t) => t.id !== p.id && chainCanClockInWith(data, p.id, t.id) === true);
        return { p, level, groups, clockIn, area, issues, teamApproves, teamClocksIn };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [governed, data, areas, allBranches]
  );

  const filteredPeople = peopleRows
    .filter((r) => !areaFilter || (areaFilter === "__none" ? !r.area : r.area?.id === areaFilter))
    .filter((r) => !levelFilter || r.level === levelFilter)
    .filter((r) => !branchFilter || normBranch(r.p.assigned_branch) === normBranch(branchFilter))
    .filter((r) => !problemsOnly || r.issues.length > 0)
    .filter((r) => !search.trim() || nameOf(r.p).toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => (a.area?.name ?? "~").localeCompare(b.area?.name ?? "~") || (a.p.assigned_branch ?? "").localeCompare(b.p.assigned_branch ?? "") || nameOf(a.p).localeCompare(nameOf(b.p)));

  const problemCount = peopleRows.filter((r) => r.issues.length > 0).length;

  const changeBranch = (p: ProfileRow, branch: string) =>
    run(async () => {
      await updateCompanyUser(p.id, { assignedBranch: branch });
    });

  /**
   * One line per route: Branch → SBM → Admin / Directors. The first tiers list
   * names; the top tier (often 8+ people, incl. HR/Accounting who also hold
   * Admin) collapses to a count with the names on hover. `full` (the preview)
   * lists every name.
   */
  const routeChips = (groups: { label: string; people: ProfileRow[] }[], full = false) =>
    groups.length === 0 ? (
      <span className="text-xs text-rose-300">Only SuperAdmin</span>
    ) : (
      <div className="flex flex-wrap items-center gap-1">
        {groups.map((g, i) => {
          const isTop = g.label.startsWith("Admin");
          const short = isTop ? "Admin / Directors" : g.label === "Senior Branch Manager" ? "SBM" : g.label;
          return (
            <Fragment key={g.label}>
              {i > 0 && <ArrowRight className="h-3 w-3 text-slate-500 shrink-0" />}
              {isTop && !full ? (
                <span
                  className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300 whitespace-nowrap cursor-help"
                  title={g.people.map((x) => `${nameOf(x)} · ${roleLabel(x)}`).join("\n")}
                >
                  {short} <span className="text-slate-500 tabular-nums">· {g.people.length}</span>
                </span>
              ) : (
                <span className={`inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] max-w-full ${full ? "" : "whitespace-nowrap"}`}>
                  <span className="text-[9px] uppercase tracking-wide text-slate-500">{short}</span>
                  <span className={`text-slate-100 ${full ? "" : "truncate"}`}>{g.people.map(nameOf).join(", ")}</span>
                </span>
              )}
            </Fragment>
          );
        })}
      </div>
    );

  const previewRow = previewId ? peopleRows.find((r) => r.p.id === previewId) ?? null : null;

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
          <button type="button" onClick={() => void load()} disabled={loading} className="btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ml-auto disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        <div className="panel p-4 mb-4 text-xs text-slate-300 leading-relaxed">
          <div className="font-semibold text-white mb-1">How requests are routed (non-Philippines staff)</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded bg-white/10">Technician</span><ArrowRight className="h-3 w-3" />
            <span className="px-1.5 py-0.5 rounded bg-white/10">Branch Manager / Parts / Parts Team Leader / Parts Manager (same branch)</span><ArrowRight className="h-3 w-3" />
            <span className="px-1.5 py-0.5 rounded bg-white/10">Senior Branch Manager (area)</span><ArrowRight className="h-3 w-3" />
            <span className="px-1.5 py-0.5 rounded bg-white/10">Admin / Technical Director / Asst. Director</span>
          </div>
          <div className="mt-1.5 text-slate-400">
            Any one person at any of these levels can approve the Manager step; nobody approves their own request; SuperAdmin always can. HR and Accounting keep their own steps (any 2 of 3).
            Enforced by the database — direct links or API calls can't skip it. Philippines staff follow their own department chain — see the Philippines tab. Other US departments keep their current rules.
          </div>
        </div>

        {areasMissing && (
          <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Run migration <code>0329_approval_chain.sql</code> in Supabase to turn on Areas and the database enforcement.
          </div>
        )}
        {error && <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

        <div className="flex gap-1.5 mb-4">
          {(["hierarchy", "people", "ph"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`btn text-sm px-3 py-1.5 ${tab === t ? "bg-primary/20 text-primary" : ""}`}>
              {t === "hierarchy" ? "Hierarchy & Areas" : t === "ph" ? "Philippines" : `People${problemCount ? ` · ${problemCount} problems` : ""}`}
            </button>
          ))}
          {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-400 self-center ml-2" />}
        </div>

        {loading ? (
          <div className="panel p-10 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
        ) : tab === "ph" ? (
          <PhApprovalChainPanel data={data} profiles={profiles} topTier={topTier} busy={busy} run={run} migrationMissing={phMigrationMissing} />
        ) : tab === "hierarchy" ? (
          <div className="space-y-4">
            <div className="panel p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="text-xs uppercase tracking-wide text-slate-400">Top level — approves Senior Branch Managers and everyone below</div>
                <span className="text-[10px] text-slate-500">{topIds.length > 0 ? "· custom list" : "· from roles (Admin / Technical Director / Asst. Director)"}</span>
                {!editingTop && (
                  <button type="button" onClick={startEditTop} disabled={busy || areasMissing} className="ml-auto text-xs font-semibold text-blue-300 hover:text-blue-200 disabled:opacity-40" title={areasMissing ? "Run migration 0333 first" : undefined}>
                    Edit
                  </button>
                )}
              </div>
              {!editingTop ? (
                <div className="flex flex-wrap gap-2">
                  {topTier.map((p) => (
                    <span key={p.id} className="text-sm text-slate-100 rounded border border-white/10 bg-white/5 px-2 py-1">
                      {nameOf(p)} <span className="text-slate-500 text-xs">· {holds(p, "SUPERADMIN") ? "Super Admin · always" : roleLabel(p)}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  <input value={topSearch} onChange={(e) => setTopSearch(e.target.value)} placeholder="Search people…" className="glass-input text-sm py-1.5 px-2 rounded-md w-full max-w-sm" />
                  <div className="max-h-64 overflow-y-auto rounded border border-white/10 p-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4">
                    {active
                      .filter((p) => !holds(p, "SUPERSUPERADMIN") || holds(p, "SUPERADMIN"))
                      .filter((p) => !topSearch.trim() || nameOf(p).toLowerCase().includes(topSearch.trim().toLowerCase()))
                      .sort((a, b) => Number(holds(b, "SUPERADMIN")) - Number(holds(a, "SUPERADMIN")) || Number(topDraft.has(b.id)) - Number(topDraft.has(a.id)) || nameOf(a).localeCompare(nameOf(b)))
                      .map((p) => (
                        <label key={p.id} className="flex items-center gap-2 py-0.5 text-sm text-slate-200 cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={holds(p, "SUPERADMIN")}
                            title={holds(p, "SUPERADMIN") ? "Super Admins are always top level" : undefined}
                            checked={holds(p, "SUPERADMIN") || topDraft.has(p.id)}
                            onChange={() =>
                              setTopDraft((prev) => {
                                const next = new Set(prev);
                                if (next.has(p.id)) next.delete(p.id);
                                else next.add(p.id);
                                return next;
                              })
                            }
                          />
                          {nameOf(p)} <span className="text-slate-500 text-xs">· {roleLabel(p)}</span>
                        </label>
                      ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={busy || topDraft.size === 0} onClick={() => saveTop([...topDraft])} className="btn text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                      Save ({topDraft.size})
                    </button>
                    <button type="button" onClick={() => setEditingTop(false)} className="btn text-sm px-3 py-1.5">Cancel</button>
                    {topIds.length > 0 && (
                      <button type="button" disabled={busy} onClick={() => saveTop([])} className="btn text-sm px-3 py-1.5 text-amber-300" title="Clear the custom list — top level comes from roles again">
                        Reset to roles
                      </button>
                    )}
                    <span className="text-[11px] text-slate-500">Super Admins are always top level; the people ticked here join them.</span>
                  </div>
                </div>
              )}
            </div>

            {!areasMissing && areas.length === 0 && sbms.length > 0 && (
              <div className="panel p-4 flex flex-wrap items-center gap-3">
                <span className="text-sm text-slate-300">No areas yet. {sbms.length} Senior Branch Managers already own branches.</span>
                <button type="button" onClick={seedAreasFromSbms} disabled={busy} className="btn text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                  Create one area per Senior Branch Manager
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {areas.map((area) => {
                const branches = branchesOf(area.seniorBranchManagerId);
                const addable = allBranches.filter((b) => !branches.some((x) => normBranch(x) === normBranch(b)));
                return (
                  <div key={area.id} className="panel p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <input
                        defaultValue={area.name}
                        onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== area.name && run(() => updateApprovalArea(area.id, { name: e.target.value }))}
                        className="glass-input text-base font-semibold py-1 px-2 rounded-md flex-1 min-w-0"
                        aria-label="Area name"
                      />
                      <button type="button" onClick={() => window.confirm(`Delete ${area.name}? Its branches stay with their Senior Branch Manager.`) && run(() => deleteApprovalArea(area.id))} title="Delete area" className="p-1.5 rounded hover:bg-red-500/20 text-red-300">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <label className="text-[10px] uppercase tracking-wide text-slate-400">Senior Branch Manager</label>
                    <select
                      value={area.seniorBranchManagerId ?? ""}
                      onChange={(e) => reassignAreaSbm(area, e.target.value)}
                      disabled={busy}
                      className="glass-input text-sm py-1.5 px-2 rounded-md w-full mb-3"
                    >
                      <option value="">— None —</option>
                      {sbms.map((s) => (
                        <option key={s.id} value={s.id} disabled={!!areaOfSbm(s.id) && areaOfSbm(s.id)!.id !== area.id}>
                          {nameOf(s)}{areaOfSbm(s.id) && areaOfSbm(s.id)!.id !== area.id ? ` (${areaOfSbm(s.id)!.name})` : ""}
                        </option>
                      ))}
                    </select>

                    <div className="space-y-1">
                      {branches.length === 0 && <div className="text-xs text-slate-500">No branches yet.</div>}
                      {branches.map((b) => {
                        const ppl = peopleAt(b);
                        const bms = ppl.filter((p) => holds(p, "BRANCH_MANAGER"));
                        const pms = ppl.filter((p) => holds(p, "PARTS_MANAGER"));
                        // Other parts staff (Parts / Parts Team Leader) — they approve and clock in this branch's techs too.
                        const partsStaff = ppl.filter((p) => !holds(p, "PARTS_MANAGER") && (holds(p, "PARTS") || holds(p, "PARTS_TEAM_LEADER")));
                        const techs = ppl.filter((p) => chainLevelOf(p) === "tech");
                        const open = expandedBranch === b;
                        return (
                          <div key={b} className="rounded border border-white/10">
                            <div className="flex items-center gap-2 px-2 py-1.5">
                              <button type="button" onClick={() => setExpandedBranch(open ? null : b)} className="flex items-center gap-1 text-sm text-slate-100 font-medium">
                                <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} /> {b}
                              </button>
                              <span className="text-[11px] text-slate-400">
                                BM: {bms.map(nameOf).join(", ") || <span className="text-amber-300">none</span>} · Parts Mgr: {pms.map(nameOf).join(", ") || <span className="text-amber-300">none</span>} · Parts: {partsStaff.map(nameOf).join(", ") || <span className="text-amber-300">none</span>} · {techs.length} tech{techs.length === 1 ? "" : "s"}
                              </span>
                              <button type="button" onClick={() => window.confirm(`Remove ${b} from ${area.name}? It will have no Senior Branch Manager.`) && run(() => unassignBranch(b))} title="Remove branch" className="ml-auto p-1 rounded hover:bg-white/10 text-slate-400">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            {open && (() => {
                              const staff = [...branchStaffAt(b)].sort((x, y) => rankAtBranch(x) - rankAtBranch(y) || nameOf(x).localeCompare(nameOf(y)));
                              const groups = [
                                { label: "Senior Branch Manager", people: staff.filter((x) => rankAtBranch(x) === -1) },
                                { label: "Branch level — Branch Manager / Parts", people: staff.filter((x) => rankAtBranch(x) === 0) },
                                { label: "Technicians", people: staff.filter((x) => rankAtBranch(x) === 2) },
                              ];
                              // Add person: only people with no branch yet (e.g. a new hire) — everyone at
                              // this branch is already listed above, and moving someone in from another
                              // branch is done with the pencil on their own row.
                              const candidates = nonPh.filter((x) => !x.assigned_branch).sort((a2, b2) => nameOf(a2).localeCompare(nameOf(b2)));
                              const iconBtn = "p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-40";
                              return (
                                <div className="px-7 pb-2 text-xs text-slate-300 space-y-2">
                                  {staff.length === 0 && <div className="text-slate-500">Nobody assigned to this branch.</div>}
                                  {groups.filter((g) => g.people.length > 0).map((g) => (
                                    <div key={g.label}>
                                      <div className="text-[10px] uppercase tracking-wide text-slate-500">{g.label}</div>
                                      {g.people.map((x) =>
                                        editingPersonId === x.id ? (
                                          <div key={x.id} className="flex flex-wrap items-center gap-1.5 py-1">
                                            <span className="text-slate-100">{nameOf(x)}</span>
                                            <span className="text-slate-500">· {roleLabel(x)} — move to</span>
                                            <select
                                              value={personDraft.branch}
                                              onChange={(e) => setPersonDraft((d) => ({ ...d, branch: e.target.value }))}
                                              style={{ width: "11rem", flex: "0 0 11rem" }}
                                              className="glass-input text-[11px] py-0.5 px-1 rounded"
                                              title="Branch"
                                            >
                                              {allBranches.map((br) => <option key={br} value={br}>{br}</option>)}
                                            </select>
                                            <button type="button" onClick={() => savePersonEdit(x)} disabled={busy} title="Save" className="p-1 rounded bg-green-600 hover:bg-green-700 text-white disabled:opacity-50">
                                              <Check className="h-3 w-3" />
                                            </button>
                                            <button type="button" onClick={() => setEditingPersonId(null)} title="Cancel" className={iconBtn}>
                                              <X className="h-3 w-3" />
                                            </button>
                                          </div>
                                        ) : (
                                          <div key={x.id} className="group flex flex-wrap items-center gap-1 py-0.5">
                                            {nameOf(x)}
                                            {x.employment_type === "trainee" && <TraineeFlag />}
                                            <span className="text-slate-500">
                                              · {roleLabel(x)}
                                              {(x.extra_roles ?? []).length ? ` (+ ${(x.extra_roles ?? []).map((r) => ROLE_LABELS[normalizeRole(r)] ?? r).join(", ")})` : ""}
                                            </span>
                                            {rankAtBranch(x) === 0 && (() => {
                                              const techsHere = staff.filter((t) => rankAtBranch(t) === 2);
                                              const approves = techsHere.some((t) => chainCanApproveWith(data, x.id, t.id) === true);
                                              const clocks = techsHere.some((t) => chainCanClockInWith(data, x.id, t.id) === true);
                                              return (
                                                <>
                                                  <span className={`px-1 rounded text-[9px] font-semibold border ${approves ? "border-green-500/40 text-green-300" : "border-white/10 text-slate-500 line-through"}`} title="Approves this branch's technicians' requests">Approves</span>
                                                  <span className={`px-1 rounded text-[9px] font-semibold border ${clocks ? "border-sky-500/40 text-sky-300" : "border-white/10 text-slate-500 line-through"}`} title="Can clock in this branch's technicians">Clocks in</span>
                                                </>
                                              );
                                            })()}
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setEditingPersonId(x.id);
                                                setPersonDraft({ role: normalizeRole(x.role), branch: allBranches.find((br) => normBranch(br) === normBranch(b)) ?? b });
                                              }}
                                              disabled={busy}
                                              title="Change branch"
                                              className={iconBtn}
                                            >
                                              <Pencil className="h-3 w-3" />
                                            </button>
                                            <button type="button" onClick={() => movePerson(x, "")} disabled={busy} title={`Remove from ${b}`} className="p-1 rounded text-slate-400 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-40">
                                              <Trash2 className="h-3 w-3" />
                                            </button>
                                          </div>
                                        )
                                      )}
                                    </div>
                                  ))}
                                  {addPersonFor === b ? (
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <select
                                        autoFocus
                                        value={addDraft.personId}
                                        onChange={(e) => {
                                          const person = candidates.find((x) => x.id === e.target.value);
                                          const r = person ? normalizeRole(person.role) : "TECHNICIAN";
                                          setAddDraft({ personId: e.target.value, role: ADD_ROLE_OPTIONS.includes(r) ? r : "TECHNICIAN" });
                                        }}
                                        disabled={busy}
                                        style={{ width: "22rem", maxWidth: "100%" }}
                                        className="glass-input text-xs py-1 px-1.5 rounded"
                                      >
                                        <option value="">{candidates.length ? "Choose someone with no branch yet…" : "Everyone already has a branch"}</option>
                                        {candidates.map((x) => (
                                          <option key={x.id} value={x.id}>
                                            {nameOf(x)} — {roleLabel(x)}
                                          </option>
                                        ))}
                                      </select>
                                      <button
                                        type="button"
                                        disabled={busy || !addDraft.personId}
                                        onClick={() => {
                                          const person = candidates.find((x) => x.id === addDraft.personId);
                                          if (person) addPersonToBranch(person, b);
                                        }}
                                        className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-50"
                                      >
                                        Add
                                      </button>
                                      <button type="button" onClick={() => setAddPersonFor(null)} className={iconBtn} title="Cancel">
                                        <X className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    <button type="button" onClick={() => { setAddDraft({ personId: "", role: "TECHNICIAN" }); setAddPersonFor(b); }} disabled={busy} className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-300 hover:text-blue-200 disabled:opacity-50">
                                      <Plus className="h-3 w-3" /> Add person to {b}
                                    </button>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>

                    {area.seniorBranchManagerId && (
                      <select value="" onChange={(e) => e.target.value && addBranchToArea(area, e.target.value)} disabled={busy} className="glass-input text-sm py-1.5 px-2 rounded-md w-full mt-2">
                        <option value="">+ Add / move a branch into this area…</option>
                        {addable.map((b) => (
                          <option key={b} value={b}>{b}{ownerOf(b) ? ` (now: ${nameOf(data.byId.get(ownerOf(b)!))})` : ""}</option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>

            {!areasMissing && (
              <div className="panel p-4 flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-wide text-slate-400">New area</label>
                  <input value={newArea.name} onChange={(e) => setNewArea((a) => ({ ...a, name: e.target.value }))} placeholder="e.g. Area 5" className="glass-input text-sm py-1.5 px-2 rounded-md w-48" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-wide text-slate-400">Senior Branch Manager</label>
                  <select value={newArea.sbmId} onChange={(e) => setNewArea((a) => ({ ...a, sbmId: e.target.value }))} className="glass-input text-sm py-1.5 px-2 rounded-md w-56">
                    <option value="">— Choose later —</option>
                    {sbms.filter((s) => !areaOfSbm(s.id)).map((s) => <option key={s.id} value={s.id}>{nameOf(s)}</option>)}
                  </select>
                </div>
                <button
                  type="button"
                  disabled={busy || !newArea.name.trim()}
                  onClick={() => run(async () => { await createApprovalArea(newArea.name, newArea.sbmId || null, areas.length + 1); setNewArea({ name: "", sbmId: "" }); })}
                  className="btn text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 inline-flex items-center gap-1"
                >
                  <Plus className="h-4 w-4" /> Add area
                </button>
              </div>
            )}

            {unassignedBranches.length > 0 && (
              <div className="panel p-4">
                <div className="text-sm font-semibold text-amber-300 mb-1 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> Branches not in any area</div>
                <div className="text-xs text-slate-400 mb-2">Their technicians and managers can only be approved by Admin / Directors (and the branch's Branch Manager / Parts staff for technicians) until the branch is added to an area.</div>
                <div className="flex flex-wrap gap-1.5">
                  {unassignedBranches.map((b) => (
                    <span key={b} className="text-xs rounded border border-amber-500/30 bg-amber-500/10 text-amber-200 px-2 py-0.5">
                      {b}{ownerOf(b) ? ` · ${nameOf(data.byId.get(ownerOf(b)!))}` : " · no SBM"}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="panel p-4">
              <div className="text-sm font-semibold text-white mb-2">Preview — who approves this person's request?</div>
              <select value={previewId ?? ""} onChange={(e) => setPreviewId(e.target.value || null)} className="glass-input text-sm py-1.5 px-2 rounded-md w-full max-w-md mb-3">
                <option value="">Choose an employee…</option>
                {[...governed].sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map((p) => (
                  <option key={p.id} value={p.id}>{nameOf(p)} — {roleLabel(p)}{p.assigned_branch ? ` · ${p.assigned_branch}` : ""}</option>
                ))}
              </select>
              {previewRow && (
                <div className="flex flex-wrap items-start gap-2">
                  <div className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-1">
                    <div className="text-[9px] uppercase tracking-wide text-sky-300">Requester</div>
                    <div className="text-xs text-white">{nameOf(previewRow.p)} · {roleLabel(previewRow.p)}</div>
                    <div className="text-[10px] text-slate-400">{previewRow.p.assigned_branch || "no branch"}{previewRow.area ? ` · ${previewRow.area.name}` : ""}</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-500 mt-2" />
                  {routeChips(previewRow.groups, true)}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Area</label>
                <select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} className="glass-input text-sm py-1.5 px-2.5 rounded-md min-w-[160px]">
                  <option value="">All areas</option>
                  {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  <option value="__none">Not in an area</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Level</label>
                <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} className="glass-input text-sm py-1.5 px-2.5 rounded-md min-w-[180px]">
                  <option value="">All levels</option>
                  {(Object.keys(CHAIN_LEVEL_LABEL) as (keyof typeof CHAIN_LEVEL_LABEL)[]).map((l) => <option key={l} value={l}>{CHAIN_LEVEL_LABEL[l]}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Branch</label>
                <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="glass-input text-sm py-1.5 px-2.5 rounded-md min-w-[150px]">
                  <option value="">All branches</option>
                  {allBranches.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Search</label>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Employee name…" className="glass-input text-sm py-1.5 px-2.5 rounded-md w-52" />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer pb-1.5">
                <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
                Only show problems
              </label>
            </div>

            <div className="panel p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs uppercase text-slate-400">
                    <th className="px-3 py-2">Employee</th>
                    <th className="px-3 py-2">Branch / Area</th>
                    <th className="px-3 py-2">Approves their requests (Manager step)</th>
                    <th className="px-3 py-2">Can clock them in</th>
                    <th className="px-3 py-2">Their team</th>
                    <th className="px-3 py-2">Problems</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPeople.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400">No employees match these filters.</td></tr>
                  ) : filteredPeople.map((r) => (
                    <tr key={r.p.id} className="border-b border-white/5 align-top hover:bg-white/5">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-white flex items-center gap-1.5">{nameOf(r.p)}{r.p.employment_type === "trainee" && <TraineeFlag />}</div>
                        <div className="text-[11px] text-slate-400">{roleLabel(r.p)}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <select
                          value={allBranches.find((b) => normBranch(b) === normBranch(r.p.assigned_branch)) ?? r.p.assigned_branch ?? ""}
                          onChange={(e) => e.target.value && changeBranch(r.p, e.target.value)}
                          disabled={busy}
                          className="glass-input text-xs py-1 px-1.5 rounded w-40"
                          aria-label="Branch"
                        >
                          {!r.p.assigned_branch && <option value="">— No branch —</option>}
                          {allBranches.map((b) => <option key={b} value={b}>{b}</option>)}
                        </select>
                        <div className="text-[11px] text-slate-400 mt-0.5">{r.area?.name ?? (r.level === "sbm" ? `${branchesOf(r.p.id).length} branches` : "No area")}</div>
                      </td>
                      <td className="px-3 py-2.5">{routeChips(r.groups)}</td>
                      <td className="px-3 py-2.5">
                        {r.level === "tech" || r.level === "branch" ? (
                          <div className="text-xs leading-5">
                            {r.clockIn.length > 0 ? (
                              <span className="text-slate-200">{r.clockIn.map((c) => nameOf(c)).join(", ")}</span>
                            ) : (
                              <span className="text-amber-300">Nobody at the branch</span>
                            )}
                            <div className="text-[10px] text-slate-500">+ HR · Finance · Admin · Directors</div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500">HR · Finance · Admin · Directors</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {r.teamApproves.length === 0 && r.teamClocksIn.length === 0 ? (
                          <span className="text-[11px] text-slate-500">—</span>
                        ) : (
                          <details className="text-xs">
                            <summary className="cursor-pointer select-none text-slate-200">
                              <span className="text-green-300">Approves {r.teamApproves.length}</span> · <span className="text-sky-300">Clocks in {r.teamClocksIn.length}</span>
                            </summary>
                            <div className="mt-1 space-y-0.5 max-h-56 overflow-y-auto pr-1">
                              {[...new Set([...r.teamApproves, ...r.teamClocksIn])].sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map((t) => (
                                <div key={t.id} className="text-slate-300 whitespace-nowrap">
                                  {nameOf(t)} <span className="text-slate-500">· {roleLabel(t)}{t.assigned_branch ? ` · ${t.assigned_branch}` : ""}</span>
                                  {r.teamApproves.includes(t) && <span className="ml-1 text-[9px] text-green-300">A</span>}
                                  {r.teamClocksIn.includes(t) && <span className="ml-1 text-[9px] text-sky-300">C</span>}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {r.issues.length === 0 ? (
                          <span className="text-[11px] text-green-400">OK</span>
                        ) : (
                          <div className="space-y-1">
                            {r.issues.map((i) => (
                              <div key={i} className="flex items-start gap-1 text-xs text-amber-300">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                                <span>
                                  {i}
                                  {i.startsWith("Branch spelled") && (() => {
                                    // Save the standard spelling (the dropdown already shows it, so re-picking it does nothing).
                                    const canonical = allBranches.find((b) => normBranch(b) === normBranch(r.p.assigned_branch));
                                    return canonical ? (
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => run(async () => { await updateCompanyUser(r.p.id, { assignedBranch: canonical }); })}
                                        className="ml-1.5 px-1.5 py-px rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[10px] font-semibold disabled:opacity-50"
                                      >
                                        Fix
                                      </button>
                                    ) : null;
                                  })()}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
