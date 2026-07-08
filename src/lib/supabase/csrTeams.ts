/**
 * CSR Team Composition — Supabase-backed persistence.
 *
 * Replaces the old in-memory (per-browser-session) team builder. Teams and
 * their member assignments are stored company-wide so they survive a reload
 * and are shared across everyone who opens the CSR Dashboard.
 */

import { supabase } from "./client";

export interface CsrTeamRow {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}

export interface CsrTeamMemberRow {
  profileId: string;
  teamId: string;
  isLeader: boolean;
}

export interface CsrTeamComposition {
  teams: CsrTeamRow[];
  members: CsrTeamMemberRow[];
}

export async function getCsrTeamComposition(): Promise<CsrTeamComposition> {
  const [teamsRes, membersRes] = await Promise.all([
    supabase.from("csr_teams").select("id, name, color, sort_order").order("sort_order", { ascending: true }),
    supabase.from("csr_team_members").select("profile_id, team_id, is_leader"),
  ]);
  if (teamsRes.error) throw new Error(teamsRes.error.message);
  if (membersRes.error) throw new Error(membersRes.error.message);
  return {
    teams: (teamsRes.data ?? []).map((r: any) => ({ id: r.id, name: r.name, color: r.color, sortOrder: r.sort_order })),
    members: (membersRes.data ?? []).map((r: any) => ({ profileId: r.profile_id, teamId: r.team_id, isLeader: r.is_leader })),
  };
}

export async function createCsrTeam(name: string, color: string, sortOrder: number): Promise<string> {
  const { data, error } = await supabase
    .from("csr_teams")
    .insert({ name, color, sort_order: sortOrder })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function renameCsrTeam(teamId: string, name: string): Promise<void> {
  const { error } = await supabase.from("csr_teams").update({ name, updated_at: new Date().toISOString() }).eq("id", teamId);
  if (error) throw new Error(error.message);
}

export async function deleteCsrTeam(teamId: string): Promise<void> {
  const { error } = await supabase.from("csr_teams").delete().eq("id", teamId);
  if (error) throw new Error(error.message);
}

/** Place a staff member on a team, or unassign them back to the roster (teamId = null). */
export async function assignCsrMember(profileId: string, teamId: string | null): Promise<void> {
  if (!teamId) {
    const { error } = await supabase.from("csr_team_members").delete().eq("profile_id", profileId);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase
    .from("csr_team_members")
    .upsert({ profile_id: profileId, team_id: teamId, is_leader: false }, { onConflict: "profile_id" });
  if (error) throw new Error(error.message);
}

/** Set (or clear) a team's leader. Only one leader per team. */
export async function setCsrTeamLeader(teamId: string, profileId: string | null): Promise<void> {
  const clear = await supabase.from("csr_team_members").update({ is_leader: false }).eq("team_id", teamId);
  if (clear.error) throw new Error(clear.error.message);
  if (!profileId) return;
  const { error } = await supabase.from("csr_team_members").update({ is_leader: true }).eq("team_id", teamId).eq("profile_id", profileId);
  if (error) throw new Error(error.message);
}
