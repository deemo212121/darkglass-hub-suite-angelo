/**
 * CSR Team Composition — localStorage-backed persistence.
 *
 * Matches the interface of the upstream Supabase-backed version so
 * CSRDashboard / CsrTeamComposition work without any new DB tables.
 * Data is stored per-browser in localStorage and shared across tabs
 * via storage events. Upgrade to real Supabase tables later by swapping
 * this file — the callers don't need to change.
 */

const TEAMS_KEY = "ahs:csr_teams";
const MEMBERS_KEY = "ahs:csr_team_members";

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

function readTeams(): CsrTeamRow[] {
  try { return JSON.parse(localStorage.getItem(TEAMS_KEY) ?? "[]"); } catch { return []; }
}

function saveTeams(teams: CsrTeamRow[]): void {
  localStorage.setItem(TEAMS_KEY, JSON.stringify(teams));
}

function readMembers(): CsrTeamMemberRow[] {
  try { return JSON.parse(localStorage.getItem(MEMBERS_KEY) ?? "[]"); } catch { return []; }
}

function saveMembers(members: CsrTeamMemberRow[]): void {
  localStorage.setItem(MEMBERS_KEY, JSON.stringify(members));
}

function uuid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export async function getCsrTeamComposition(): Promise<CsrTeamComposition> {
  return { teams: readTeams(), members: readMembers() };
}

export async function createCsrTeam(name: string, color: string, sortOrder: number): Promise<string> {
  const id = uuid();
  const teams = readTeams();
  teams.push({ id, name, color, sortOrder });
  saveTeams(teams);
  return id;
}

export async function renameCsrTeam(teamId: string, name: string): Promise<void> {
  const teams = readTeams().map(t => t.id === teamId ? { ...t, name } : t);
  saveTeams(teams);
}

export async function deleteCsrTeam(teamId: string): Promise<void> {
  saveTeams(readTeams().filter(t => t.id !== teamId));
  saveMembers(readMembers().filter(m => m.teamId !== teamId));
}

export async function assignCsrMember(profileId: string, teamId: string | null): Promise<void> {
  const members = readMembers().filter(m => m.profileId !== profileId);
  if (teamId) members.push({ profileId, teamId, isLeader: false });
  saveMembers(members);
}

export async function setCsrTeamLeader(teamId: string, profileId: string | null): Promise<void> {
  const members = readMembers().map(m =>
    m.teamId === teamId
      ? { ...m, isLeader: profileId ? m.profileId === profileId : false }
      : m
  );
  saveMembers(members);
}
