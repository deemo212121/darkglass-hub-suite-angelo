/**
 * Admin → Approval Chain → Philippines. PH staff are organized by
 * department, not branch/area (migration 0334):
 *
 *   PH staff ──► their department's manager(s) ──► top level
 *
 * Team Leaders don't approve; a department manager's own request goes to the
 * top level (same list as the US side). No clock-in rules for PH.
 * Department managers default to whoever holds the department's manager role
 * (primary, or extra within the same department); an Admin can set an
 * explicit list per department here — e.g. both CSR managers.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, ChevronRight, Pencil } from "lucide-react";
import type { ProfileRow } from "@/lib/supabase/users";
import { setPhDepartmentManagers } from "@/lib/supabase/approvalAreas";
import { ROLE_LABELS, normalizeRole } from "@/lib/roleLabels";
import { isPhGoverned, isPhDepartmentManager, phDepartmentOf, type ChainData } from "@/lib/approvalDirectory";

const nameOf = (p: ProfileRow) => p.display_name || p.email || "Unknown";
const roleLabel = (p: ProfileRow) => ROLE_LABELS[normalizeRole(p.role)] ?? p.role;
const isTeamLeader = (p: ProfileRow) => /_TEAM_LEADER$/.test(String(p.role || "").toUpperCase());

export function PhApprovalChainPanel({
  data,
  profiles,
  topTier,
  busy,
  run,
  migrationMissing,
}: {
  data: ChainData;
  profiles: ProfileRow[];
  topTier: ProfileRow[];
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  migrationMissing: boolean;
}) {
  const phStaff = useMemo(() => profiles.filter((p) => p.is_active && isPhGoverned(p)), [profiles]);
  const departments = useMemo(() => {
    const byDept = new Map<string, ProfileRow[]>();
    for (const p of phStaff) {
      const d = phDepartmentOf(p);
      byDept.set(d, [...(byDept.get(d) ?? []), p]);
    }
    return [...byDept.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [phStaff]);

  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const phPool = useMemo(
    () => profiles.filter((p) => p.is_active).sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
    [profiles]
  );

  const startEdit = (dept: string, current: ProfileRow[]) => {
    setDraft(new Set(current.map((p) => p.id)));
    setSearch("");
    setEditing(dept);
  };

  return (
    <div className="space-y-4">
      <div className="panel p-4 text-xs text-slate-300 leading-relaxed">
        <div className="font-semibold text-white mb-1">How requests are routed (Philippines staff)</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded bg-white/10">PH staff</span>
          <ArrowRight className="h-3 w-3" />
          <span className="px-1.5 py-0.5 rounded bg-white/10">Department manager(s)</span>
          <ArrowRight className="h-3 w-3" />
          <span className="px-1.5 py-0.5 rounded bg-white/10">Top level</span>
        </div>
        <div className="mt-1.5 text-slate-400">
          Team Leaders don't approve. A department manager's own request goes to the top level. Any one approver is enough for the Manager step;
          HR and Accounting keep their own steps. No clock-in rules for PH. Enforced by the database.
        </div>
      </div>

      {migrationMissing && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Run migration <code>0334_approval_chain_ph.sql</code> in Supabase to turn on the Philippines chain and editable department managers.
        </div>
      )}

      <div className="panel p-4">
        <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Top level — same list as the US side (edit it on Hierarchy &amp; Areas)</div>
        <div className="flex flex-wrap gap-2">
          {topTier.map((p) => (
            <span key={p.id} className="text-sm text-slate-100 rounded border border-white/10 bg-white/5 px-2 py-1">
              {nameOf(p)} <span className="text-slate-500 text-xs">· {roleLabel(p)}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {departments.map(([dept, members]) => {
          const explicit = (data.phDeptManagers ?? []).some((m) => m.department === dept);
          const managers = phPool.filter((p) => isPhDepartmentManager(data, p, dept));
          const staff = members.filter((p) => !managers.some((m) => m.id === p.id));
          const leaders = staff.filter(isTeamLeader);
          const isOpen = open === dept;
          return (
            <div key={dept} className="panel p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="text-base font-semibold text-white">{dept}</div>
                <span className="text-xs text-slate-400">{members.length} staff</span>
              </div>

              <div className="flex items-center gap-2">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Department manager{managers.length === 1 ? "" : "s"}</div>
                <span className="text-[10px] text-slate-500">{explicit ? "· custom list" : "· from roles"}</span>
                {editing !== dept && (
                  <button
                    type="button"
                    onClick={() => startEdit(dept, managers)}
                    disabled={busy || migrationMissing}
                    title={migrationMissing ? "Run migration 0334 first" : "Edit managers"}
                    className="ml-auto p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-40"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {editing === dept ? (
                <div className="mt-1.5 space-y-2">
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people…" className="glass-input text-sm py-1 px-2 rounded-md w-full" />
                  <div className="max-h-56 overflow-y-auto rounded border border-white/10 p-2">
                    {phPool
                      .filter((p) => !search.trim() || nameOf(p).toLowerCase().includes(search.trim().toLowerCase()))
                      .sort((a, b) => Number(draft.has(b.id)) - Number(draft.has(a.id)) || Number(phDepartmentOf(b) === dept) - Number(phDepartmentOf(a) === dept))
                      .map((p) => (
                        <label key={p.id} className="flex items-center gap-2 py-0.5 text-sm text-slate-200 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={draft.has(p.id)}
                            onChange={() =>
                              setDraft((prev) => {
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
                    <button
                      type="button"
                      disabled={busy || draft.size === 0}
                      onClick={() => run(async () => { await setPhDepartmentManagers(dept, [...draft]); setEditing(null); })}
                      className="btn text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                    >
                      Save ({draft.size})
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="btn text-sm px-3 py-1.5">Cancel</button>
                    {explicit && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(async () => { await setPhDepartmentManagers(dept, []); setEditing(null); })}
                        className="btn text-sm px-3 py-1.5 text-amber-300"
                        title="Clear the custom list — managers come from roles again"
                      >
                        Reset to roles
                      </button>
                    )}
                  </div>
                </div>
              ) : managers.length === 0 ? (
                <div className="mt-1 flex items-start gap-1 text-xs text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /> No department manager — only the top level approves {dept} requests.
                </div>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {managers.map((m) => (
                    <span key={m.id} className="text-xs text-slate-100 rounded border border-green-500/30 bg-green-500/10 px-2 py-0.5">
                      {nameOf(m)} <span className="text-slate-400">· {roleLabel(m)}</span>
                    </span>
                  ))}
                </div>
              )}

              <button type="button" onClick={() => setOpen(isOpen ? null : dept)} className="mt-3 flex items-center gap-1 text-xs font-semibold text-slate-300 hover:text-white">
                <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                Staff ({staff.length}){leaders.length ? ` · ${leaders.length} team leader${leaders.length === 1 ? "" : "s"} (don't approve)` : ""}
              </button>
              {isOpen && (
                <div className="mt-1.5 pl-5 space-y-0.5 text-xs text-slate-300 max-h-72 overflow-y-auto">
                  {staff.length === 0 ? (
                    <div className="text-slate-500">No other staff.</div>
                  ) : (
                    staff
                      .sort((a, b) => Number(isTeamLeader(b)) - Number(isTeamLeader(a)) || nameOf(a).localeCompare(nameOf(b)))
                      .map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5">
                          {nameOf(p)} <span className="text-slate-500">· {roleLabel(p)}</span>
                          {p.employment_type === "trainee" && (
                            <span className="px-1.5 rounded text-[9px] font-bold uppercase tracking-wide border border-amber-500/50 bg-amber-500/15 text-amber-300">Trainee</span>
                          )}
                        </div>
                      ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
