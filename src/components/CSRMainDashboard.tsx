/**
 * CSR Main Dashboard — the CSR module's main landing page, replacing the
 * separate "To Do List" and "Team Composition" tiles with one 3-tab page:
 *
 *   1. To Do List — visible to everyone (Manager, Team Leader, Agent).
 *      Same content as CSRToDoListContent (CSRToDoList.tsx).
 *   2. Team List — Manager and Team Leader only (Team Leaders don't
 *      supervise anyone but their own team, so Agents don't get this tab
 *      at all). Manager sees every team; a Team Leader sees only the team
 *      they lead. Each agent's row has a Task dropdown that writes
 *      straight to today's csr_daily_report_entries row for that person —
 *      the SAME column Daily Report's own Task dropdown edits (see
 *      CSR_DAILY_REPORT_TASKS, exported from CSRTeamDailyReport.tsx so the
 *      two option lists can never drift apart) — so setting it here is
 *      exactly the same edit as setting it on today's Daily Report row.
 *      A "Send Mistake" button opens a small form (agent, date, reason,
 *      action taken) that writes to the same csr_mistake_log_entries table
 *      Daily Report's own Mistake Log reads, then navigates there so the
 *      new entry is immediately visible.
 *   3. Team Composition — Manager only. Exactly what used to be its own
 *      page (CsrTeamComposition + WorkHoursPanel).
 *
 * Daily Report stays a fully separate page/tile — this dashboard only
 * folds in the two tools that used to be their own tiles.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Loader2, Send } from "lucide-react";
import { BrandedLoader } from "@/components/BrandedLoader";
import { CsrTeamComposition } from "@/components/CsrTeamComposition";
import { WorkHoursPanel } from "@/components/WorkHoursPanel";
import { CSRToDoListContent } from "@/components/CSRToDoList";
import { CSR_DAILY_REPORT_TASKS, todayIso } from "@/components/CSRTeamDailyReport";
import { useAuth } from "@/lib/auth";
import { normalizeRole } from "@/lib/roleLabels";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyUsers, getMyProfileId, type ProfileRow } from "@/lib/supabase/users";
import { getCsrTeamComposition, type CsrTeamRow, type CsrTeamMemberRow } from "@/lib/supabase/csrTeams";
import { getCsrDailyReportEntries, upsertCsrDailyReportEntry, type CsrDailyReportEntry } from "@/lib/supabase/csrDailyReportEntries";
import { createCsrMistakeLogEntry } from "@/lib/supabase/csrMistakeLog";

const MANAGER_TIER_ROLES = new Set(["ADMIN", "SUPERADMIN", "CSR_MANAGER", "BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER"]);

type Tab = "todo" | "team-list" | "team-composition";

interface TeamRow {
  profile: ProfileRow;
  isLeader: boolean;
}

export function CSRMainDashboard({ mod }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { role, uid, ready } = useAuth();
  const normalizedRole = normalizeRole(role);
  const isManagerTier = MANAGER_TIER_ROLES.has(normalizedRole);
  const isTeamLeader = normalizedRole === "CSR_TEAM_LEADER";

  const [tab, setTab] = useState<Tab>("todo");
  const [myProfileId, setMyProfileId] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !uid) return;
    void getMyProfileId(uid).then(setMyProfileId);
  }, [ready, uid]);

  // Team List/Team Composition tabs never render for a plain Agent — bounce
  // back to To Do List if they're somehow on one (e.g. stale tab state from
  // before a role change).
  useEffect(() => {
    if (tab === "team-composition" && !isManagerTier) setTab("todo");
    if (tab === "team-list" && !isManagerTier && !isTeamLeader) setTab("todo");
  }, [tab, isManagerTier, isTeamLeader]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <BrandedLoader />
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "todo", label: "To Do List" },
    ...(isManagerTier || isTeamLeader ? [{ key: "team-list" as Tab, label: "Team List" }] : []),
    ...(isManagerTier ? [{ key: "team-composition" as Tab, label: "Team Composition" }] : []),
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-5">
        <div className="flex items-center gap-3 mb-4">
          <button type="button" onClick={goBack} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold">CSR Main Dashboard</h1>
          </div>
        </div>

        <div className="flex gap-1.5 border-b border-white/10 mb-4">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "todo" && <CSRToDoListContent />}
        {tab === "team-list" && (isManagerTier || isTeamLeader) && (
          <TeamListTab isManagerTier={isManagerTier} myProfileId={myProfileId} navigate={navigate} />
        )}
        {tab === "team-composition" && isManagerTier && (
          <div className="space-y-6">
            <CsrTeamComposition />
            <WorkHoursPanel filterProfile={isCsrProfileFilter} emptyMessage="No active CSR Associates or Team Leaders found." />
          </div>
        )}
      </main>
    </div>
  );
}

const isCsrProfileFilter = (p: ProfileRow) => {
  const extras = p.extra_roles || [];
  return p.role === "CSR_AGENT" || p.role === "CSR_TEAM_LEADER" || extras.includes("CSR_AGENT") || extras.includes("CSR_TEAM_LEADER");
};

function TeamListTab({ isManagerTier, myProfileId, navigate }: { isManagerTier: boolean; myProfileId: string | null; navigate: ReturnType<typeof useNavigate> }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teams, setTeams] = useState<CsrTeamRow[]>([]);
  const [members, setMembers] = useState<CsrTeamMemberRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [entries, setEntries] = useState<Map<string, CsrDailyReportEntry>>(new Map());
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [showMistakeForm, setShowMistakeForm] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [composition, allProfiles, entryRows] = await Promise.all([
        getCsrTeamComposition(),
        getCompanyUsers(),
        getCsrDailyReportEntries(todayIso()),
      ]);
      setTeams(composition.teams);
      setMembers(composition.members);
      setProfiles(allProfiles);
      setEntries(new Map(entryRows.map((e) => [e.profileId, e])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Team List.");
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const myTeamId = useMemo(() => {
    if (isManagerTier || !myProfileId) return null;
    return members.find((m) => m.profileId === myProfileId && m.isLeader)?.teamId ?? null;
  }, [isManagerTier, myProfileId, members]);

  const visibleTeams = useMemo(() => {
    if (isManagerTier) return teams;
    return teams.filter((t) => t.id === myTeamId);
  }, [teams, isManagerTier, myTeamId]);

  const rowsByTeam = useMemo(() => {
    const map = new Map<string, TeamRow[]>();
    for (const m of members) {
      const profile = profileById.get(m.profileId);
      if (!profile) continue;
      const arr = map.get(m.teamId) ?? [];
      arr.push({ profile, isLeader: m.isLeader });
      map.set(m.teamId, arr);
    }
    for (const rows of map.values()) {
      rows.sort((a, b) => (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0) || (a.profile.display_name || a.profile.email).localeCompare(b.profile.display_name || b.profile.email));
    }
    return map;
  }, [members, profileById]);

  const handleTaskSave = async (profileId: string, task: string) => {
    const prev = entries.get(profileId);
    setEntries((p) => {
      const next = new Map(p);
      next.set(profileId, { ...(prev ?? { id: "", profileId, reportDate: todayIso(), rate: null, task: null, gh: null, total: null, schedule: null, attempt: null, updateCount: null, mistake: null, warning: null, absEm: null, hr: null }), task: task || null });
      return next;
    });
    setSavingProfileId(profileId);
    try {
      await upsertCsrDailyReportEntry(profileId, todayIso(), { task: task || null });
    } catch (err) {
      setEntries((p) => {
        const next = new Map(p);
        if (prev) next.set(profileId, prev);
        else next.delete(profileId);
        return next;
      });
      setError(err instanceof Error ? err.message : "Failed to save task.");
    } finally {
      setSavingProfileId(null);
    }
  };

  if (error) {
    return <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>;
  }

  if (loading) {
    return (
      <div className="panel p-8">
        <BrandedLoader label="Loading Team List…" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-end mb-3">
        <button type="button" onClick={() => setShowMistakeForm(true)} className="btn btn-primary inline-flex items-center gap-1.5">
          <Send className="h-4 w-4" /> Send Mistake
        </button>
      </div>

      {visibleTeams.length === 0 ? (
        <div className="panel p-8 text-center text-sm text-muted-foreground">
          {isManagerTier ? "No CSR teams set up yet — add them from the Team Composition tab." : "You're not currently set as a team leader on any team."}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleTeams.map((team) => {
            const rows = rowsByTeam.get(team.id) ?? [];
            return (
              <div key={team.id} className="panel p-0 overflow-hidden">
                <div className="px-3 py-2 flex items-center gap-2" style={{ backgroundColor: `${team.color}22`, borderBottom: `1px solid ${team.color}55` }}>
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: team.color }} />
                  <h3 className="font-semibold text-sm" style={{ color: team.color }}>{team.name}</h3>
                  <span className="ml-auto text-[10px] text-muted-foreground">{rows.length} member{rows.length === 1 ? "" : "s"}</span>
                </div>
                <div className="divide-y divide-white/5">
                  {rows.length === 0 ? (
                    <p className="px-3 py-4 text-xs text-muted-foreground text-center">No one on this team yet.</p>
                  ) : (
                    rows.map(({ profile, isLeader }) => {
                      const entry = entries.get(profile.id);
                      return (
                        <div key={profile.id} className="px-3 py-2 flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm truncate">{profile.display_name || profile.username || profile.email}</p>
                            {isLeader && <span className="text-[9px] font-semibold uppercase tracking-wide text-amber-300">Leader</span>}
                          </div>
                          <select
                            value={entry?.task ?? ""}
                            onChange={(e) => void handleTaskSave(profile.id, e.target.value)}
                            className="glass-input text-[11px] py-1 px-1.5 rounded-md w-28 shrink-0"
                          >
                            <option value="">— Task —</option>
                            {entry?.task && !CSR_DAILY_REPORT_TASKS.includes(entry.task) && (
                              <option value={entry.task}>{entry.task}</option>
                            )}
                            {CSR_DAILY_REPORT_TASKS.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                          {savingProfileId === profile.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showMistakeForm && (
        <SendMistakeModal
          profiles={profiles.filter(isCsrProfileFilter)}
          onClose={() => setShowMistakeForm(false)}
          onSent={() => {
            setShowMistakeForm(false);
            void navigate({ to: "/m/$module/$submodule", params: { module: "csr", submodule: "daily-report" } });
          }}
        />
      )}
    </div>
  );
}

function SendMistakeModal({ profiles, onClose, onSent }: { profiles: ProfileRow[]; onClose: () => void; onSent: () => void }) {
  const [profileId, setProfileId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    if (!profileId) return;
    setSending(true);
    setError(null);
    try {
      await createCsrMistakeLogEntry(profileId, date || null, reason, actionTaken);
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send.");
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !sending && onClose()}>
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-3">Send Mistake</h3>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Agent</label>
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)} className="glass-input mt-1 w-full">
              <option value="">Select…</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name || p.username || p.email}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="glass-input mt-1 w-full" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Reason</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="glass-input mt-1 w-full resize-y" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Action Taken</label>
            <textarea value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} rows={2} className="glass-input mt-1 w-full resize-y" />
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={sending} className="btn disabled:opacity-50">Cancel</button>
          <button type="button" onClick={() => void handleSend()} disabled={sending || !profileId} className="btn btn-primary inline-flex items-center gap-1.5 disabled:opacity-50">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send — goes to Daily Report's Mistake Log
          </button>
        </div>
      </div>
    </div>
  );
}
