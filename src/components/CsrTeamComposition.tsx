/**
 * CSR Team Composition — roster on the left, team placeholders on the right.
 *
 * - Left: the live CSR roster — every profile with role (or extra_roles)
 *   CSR_TEAM_LEADER / CSR_AGENT, pulled from User Management. Anyone not
 *   yet placed on a team starts here.
 * - Right: team placeholders. Drag a Team Leader onto a team and they
 *   become its leader automatically; drag Agents in as members. You can also
 *   click the crown to (re)assign a leader, rename teams, add/remove teams.
 * - Drag anyone back to the roster to unassign.
 *
 * Teams and assignments are persisted in Supabase (csr_teams /
 * csr_team_members, company-scoped) so the board survives a reload and is
 * shared company-wide instead of resetting per browser session.
 */

import { useEffect, useMemo, useState } from "react";
import { RotateCcw, GripVertical, Users, Plus, X, Crown, UserCog, Pencil, Loader2 } from "lucide-react";
import { getCompanyUsers } from "@/lib/supabase/users";
import {
  assignCsrMember,
  createCsrTeam,
  deleteCsrTeam,
  getCsrTeamComposition,
  renameCsrTeam,
  setCsrTeamLeader,
  type CsrTeamComposition as CsrTeamCompositionData,
} from "@/lib/supabase/csrTeams";

const ROSTER = "__roster__";
const TEAM_COLORS = ["#3b82f6", "#34d399", "#a78bfa", "#fb923c", "#f43f5e", "#14b8a6", "#eab308", "#06b6d4", "#ec4899", "#22c55e"];

interface Team { key: string; name: string; color: string; }
interface Person { id: string; name: string; isLeaderRole: boolean; }

const firstName = (full: string) => (full || "").trim().split(/\s+/)[0] || "";
const teamNameFor = (leaderName: string) => `Team ${firstName(leaderName)}`;

export function CsrTeamComposition() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [staff, setStaff] = useState<Person[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [assign, setAssign] = useState<Record<string, string>>({}); // profileId -> teamKey | ROSTER
  const [leaders, setLeaders] = useState<Record<string, string>>({}); // teamKey -> profileId
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [profiles, composition] = await Promise.all([getCompanyUsers(), getCsrTeamComposition()]);
      const roster: Person[] = profiles
        .filter((p) => p.is_active !== false)
        .filter((p) => {
          const extras = p.extra_roles || [];
          return p.role === "CSR_AGENT" || p.role === "CSR_TEAM_LEADER" || extras.includes("CSR_AGENT") || extras.includes("CSR_TEAM_LEADER");
        })
        .map((p) => ({
          id: p.id,
          name: p.display_name || p.username || p.email,
          isLeaderRole: p.role === "CSR_TEAM_LEADER" || (p.extra_roles || []).includes("CSR_TEAM_LEADER"),
        }));
      setStaff(roster);
      await applyComposition(roster, composition);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load team composition.");
    } finally {
      setLoading(false);
    }
  };

  // Seed two default teams the first time a company opens this tool with an
  // empty board, so the layout matches what people are used to.
  const applyComposition = async (roster: Person[], composition: CsrTeamCompositionData) => {
    let { teams: teamRows } = composition;
    if (teamRows.length === 0) {
      const id1 = await createCsrTeam("Team 1", TEAM_COLORS[0], 0);
      const id2 = await createCsrTeam("Team 2", TEAM_COLORS[1], 1);
      teamRows = [
        { id: id1, name: "Team 1", color: TEAM_COLORS[0], sortOrder: 0 },
        { id: id2, name: "Team 2", color: TEAM_COLORS[1], sortOrder: 1 },
      ];
    }
    const nextAssign: Record<string, string> = {};
    for (const p of roster) nextAssign[p.id] = ROSTER;
    const nextLeaders: Record<string, string> = {};
    for (const m of composition.members) {
      if (nextAssign[m.profileId] !== undefined) nextAssign[m.profileId] = m.teamId;
      if (m.isLeader) nextLeaders[m.teamId] = m.profileId;
    }

    // Repair any team whose stored name doesn't match its current leader
    // (e.g. teams created before this rule existed, or a leader change that
    // never got persisted) so the name always tracks the leader.
    const rosterById = new Map(roster.map((p) => [p.id, p.name]));
    const repaired = teamRows.map((t) => {
      const leaderId = nextLeaders[t.id];
      const leaderName = leaderId ? rosterById.get(leaderId) : undefined;
      if (!leaderName) return t;
      const expected = teamNameFor(leaderName);
      if (t.name === expected) return t;
      renameCsrTeam(t.id, expected).catch((err) => console.error("Failed to repair team name:", err));
      return { ...t, name: expected };
    });

    setTeams(repaired.map((t) => ({ key: t.id, name: t.name, color: t.color })));
    setAssign(nextAssign);
    setLeaders(nextLeaders);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roleOf = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const p of staff) m[p.id] = p.isLeaderRole;
    return m;
  }, [staff]);

  const membersOf = (key: string) => staff.filter((p) => assign[p.id] === key);
  const rosterLeaders = membersOf(ROSTER).filter((p) => p.isLeaderRole);
  const rosterAgents = membersOf(ROSTER).filter((p) => !p.isLeaderRole);

  const moveTo = (profileId: string, target: string) => {
    setAssign((prev) => (prev[profileId] === target ? prev : { ...prev, [profileId]: target }));
    const isLeaderRole = roleOf[profileId];
    let newTeamName: string | null = null;
    if (target !== ROSTER && isLeaderRole) {
      setLeaders((prev) => {
        const next = { ...prev };
        for (const tk of Object.keys(next)) if (next[tk] === profileId && tk !== target) delete next[tk];
        next[target] = profileId;
        return next;
      });
      const name = staff.find((p) => p.id === profileId)?.name || "";
      newTeamName = teamNameFor(name);
      setTeams((prev) => prev.map((t) => t.key === target ? { ...t, name: newTeamName! } : t));
    } else {
      setLeaders((prev) => {
        const next = { ...prev };
        for (const tk of Object.keys(next)) if (next[tk] === profileId && tk !== target) delete next[tk];
        return next;
      });
    }
    (async () => {
      try {
        await assignCsrMember(profileId, target === ROSTER ? null : target);
        if (target !== ROSTER && isLeaderRole) {
          await setCsrTeamLeader(target, profileId);
          if (newTeamName) await renameCsrTeam(target, newTeamName);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save assignment.");
      }
    })();
  };

  const setLeader = (teamKey: string, profileId: string) => {
    const willUnset = leaders[teamKey] === profileId;
    setLeaders((prev) => ({ ...prev, [teamKey]: willUnset ? "" : profileId }));
    let newTeamName: string | null = null;
    if (!willUnset) {
      const name = staff.find((p) => p.id === profileId)?.name || "";
      newTeamName = teamNameFor(name);
      setTeams((prev) => prev.map((t) => (t.key === teamKey ? { ...t, name: newTeamName! } : t)));
    }
    (async () => {
      try {
        await setCsrTeamLeader(teamKey, willUnset ? null : profileId);
        if (newTeamName) await renameCsrTeam(teamKey, newTeamName);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save team leader.");
      }
    })();
  };

  const renameTeam = (key: string, name: string) =>
    setTeams((prev) => prev.map((t) => (t.key === key ? { ...t, name } : t)));

  const commitRename = (key: string, name: string) => {
    renameCsrTeam(key, name).catch((err) => setError(err instanceof Error ? err.message : "Failed to rename team."));
  };

  const addTeam = async () => {
    const name = `Team ${teams.length + 1}`;
    const color = TEAM_COLORS[teams.length % TEAM_COLORS.length];
    try {
      const id = await createCsrTeam(name, color, teams.length);
      setTeams((prev) => [...prev, { key: id, name, color }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add team.");
    }
  };

  const removeTeam = async (key: string) => {
    try {
      await deleteCsrTeam(key);
      setAssign((prev) => { const n = { ...prev }; for (const k of Object.keys(n)) if (n[k] === key) n[k] = ROSTER; return n; });
      setLeaders((prev) => { const n = { ...prev }; delete n[key]; return n; });
      setTeams((prev) => prev.filter((t) => t.key !== key));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove team.");
    }
  };

  const resetAll = async () => {
    if (!confirm("Reset the whole board? This removes every team and puts everyone back in the roster.")) return;
    try {
      await Promise.all(teams.map((t) => deleteCsrTeam(t.key)));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset teams.");
    }
  };

  const dirty = membersOf(ROSTER).length !== staff.length;

  const Card = ({ p, teamKey }: { p: Person; teamKey: string }) => {
    const isLeader = teamKey !== ROSTER && leaders[teamKey] === p.id;
    return (
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", p.id);
          requestAnimationFrame(() => setDragging(p.id));
        }}
        onDragEnd={() => { setDragging(null); setOver(null); }}
        className={`group flex items-center gap-1.5 rounded-lg border px-2 py-1.5 cursor-grab active:cursor-grabbing ${
          isLeader ? "bg-white/10" : "border-white/10 bg-white/5"
        } ${dragging === p.id ? "opacity-50" : ""}`}
        style={isLeader ? { borderColor: "#f59e0b" } : undefined}
      >
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate flex items-center gap-1">
            {isLeader && <Crown className="h-3 w-3 shrink-0 text-amber-500" />}
            {p.name}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {isLeader ? "Team Leader (lead)" : p.isLeaderRole ? "Team Leader" : "CSR Agent"}
          </div>
        </div>
        {teamKey !== ROSTER && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setLeader(teamKey, p.id); }}
            title={isLeader ? "Unset leader" : "Set as team leader"}
            className={`shrink-0 rounded-md p-1 transition-colors ${isLeader ? "text-amber-500" : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-amber-500"}`}>
            <Crown className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="panel p-8 mb-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading team composition…
      </div>
    );
  }

  return (
    <div className="panel p-4 mb-6">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold">Team Composition</h3>
          <span className="text-xs text-muted-foreground">{teams.length} teams · {staff.length} staff</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={addTeam}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/25">
            <Plus className="h-3.5 w-3.5" /> Add Team
          </button>
          <button type="button" onClick={resetAll} disabled={!dirty}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed">
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      {staff.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No CSR Agents or CSR Team Leaders found. Add them in User Management with role "CSR Agent" or "CSR Team Leader" first.
        </p>
      ) : (
      <div className="grid gap-4 lg:grid-cols-[320px_1fr] items-start">
        {/* LEFT — roster */}
        <div
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== ROSTER) setOver(ROSTER); }}
          onDragLeave={() => setOver((o) => (o === ROSTER ? null : o))}
          onDrop={(e) => { const n = e.dataTransfer.getData("text/plain") || dragging; if (n) moveTo(n, ROSTER); setDragging(null); setOver(null); }}
          className={`rounded-xl border p-3 transition-colors overflow-y-auto max-h-[calc(100vh-220px)] lg:sticky lg:top-4 ${over === ROSTER ? "border-primary bg-white/10" : "border-white/10 bg-white/5"}`}
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2 flex items-center gap-1.5">
            <UserCog className="h-3.5 w-3.5" /> Team Leaders · {rosterLeaders.length}
          </div>
          <div className="flex flex-col gap-1.5 mb-4">
            {rosterLeaders.length === 0 && <div className="text-[11px] text-muted-foreground italic px-1">All leaders placed.</div>}
            {rosterLeaders.map((p) => <Card key={p.id} p={p} teamKey={ROSTER} />)}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2 flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> CSR Agents · {rosterAgents.length}
          </div>
          <div className="flex flex-col gap-1.5">
            {rosterAgents.length === 0 && <div className="text-[11px] text-muted-foreground italic px-1">All agents placed.</div>}
            {rosterAgents.map((p) => <Card key={p.id} p={p} teamKey={ROSTER} />)}
          </div>
        </div>

        {/* RIGHT — team placeholders */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 content-start">
          {teams.map((team) => {
            const members = membersOf(team.key);
            const leaderId = leaders[team.key];
            const leaderName = staff.find((p) => p.id === leaderId)?.name;
            const isOver = over === team.key;
            return (
              <div
                key={team.key}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== team.key) setOver(team.key); }}
                onDragLeave={() => setOver((o) => (o === team.key ? null : o))}
                onDrop={(e) => { const n = e.dataTransfer.getData("text/plain") || dragging; if (n) moveTo(n, team.key); setDragging(null); setOver(null); }}
                className={`rounded-xl border p-2.5 transition-colors ${isOver ? "bg-white/10" : "border-white/10 bg-white/5"}`}
                style={isOver ? { borderColor: team.color } : undefined}
              >
                <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/10">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
                  <div className="min-w-0 flex-1">
                    {editingKey === team.key ? (
                      <input autoFocus value={team.name} onChange={(e) => renameTeam(team.key, e.target.value)}
                        onBlur={() => { setEditingKey(null); commitRename(team.key, team.name); }}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { setEditingKey(null); commitRename(team.key, team.name); } }}
                        className="glass-input !py-0.5 !px-1.5 text-[13px] font-semibold w-full" style={{ color: team.color }} placeholder="Team name" />
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="text-[13px] font-semibold truncate" style={{ color: team.color }}>
                          {team.name || "Untitled team"}
                        </span>
                        <button type="button" onClick={() => setEditingKey(team.key)} title="Edit team name"
                          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-70 hover:opacity-100 hover:text-foreground">
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {leaderName ? `Lead: ${leaderName}` : "Drag a Team Leader here"} · {members.length} member{members.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <button type="button" onClick={() => removeTeam(team.key)} title="Remove team"
                    className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-red-500 hover:bg-white/10">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex flex-col gap-1.5 min-h-[64px]">
                  {members.length === 0 && <div className="text-[11px] text-muted-foreground italic px-1 py-3 text-center">Drop leader &amp; agents here…</div>}
                  {members.map((p) => <Card key={p.id} p={p} teamKey={team.key} />)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        Drag a Team Leader onto a team to set its lead, then drag Agents in. Drag anyone back to the roster to unassign, or use the crown to change a leader. Team names are editable; use "Add Team" for more. Changes save automatically and are shared company-wide.
      </p>
    </div>
  );
}
