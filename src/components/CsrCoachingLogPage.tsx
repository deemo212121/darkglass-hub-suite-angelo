/**
 * CSR → Coaching Log — the paper "CSR Coaching Log" as a shared, signable
 * record (migration 0356).
 *
 *   Header + I. Summary / III. Coaching Discussion / V. TL's Action Plan
 *     → the coach side (CSR Team Leader, CSR Manager, Admin, Super Admin)
 *   II. CSR's Explanation / IV. CSR's Action Plan
 *     → only the person being coached
 *   VI. Acknowledgement → the person coached signs first (every section
 *     filled), then whoever created the log. Both signed = locked.
 *
 * CSR Manager / Admin / Super Admin see and manage everything (and are the
 * only ones who can coach a TL); HR and Senior Managers read everything; a
 * TL sees and manages only their own team's agents' logs (migration 0357);
 * the person coached sees only their own logs. Delete is a soft delete (restorable) and every create /
 * edit / sign / delete / restore shows on the History tab. All of these
 * rules are enforced by the table's triggers and RLS too — this page only
 * mirrors them so people aren't offered buttons that would be refused.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronLeft, ClipboardCheck, History, Lock, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { useSmartBack } from "@/hooks/useSmartBack";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";
import { AppModal } from "@/components/ui-kit/AppModal";
import { EmptyState } from "@/components/ui-kit/EmptyState";
import { TableSkeleton } from "@/components/ui-kit/TableSkeleton";
import usihsLogo from "@/assets/us-in-home-services-logo.png";
import { hasDashboardAccess } from "@/lib/dashboardAccess";
import { getMyProfileId, getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getCsrTeamComposition, type CsrTeamComposition } from "@/lib/supabase/csrTeams";
import {
  getCoachingLogs,
  getCoachingLogEvents,
  createCoachingLog,
  saveCoachFields,
  saveCsrFields,
  signAsCsr,
  signAsCreator,
  deleteCoachingLog,
  restoreCoachingLog,
  type CoachingLog,
  type CoachingLogEvent,
} from "@/lib/supabase/csrCoachingLogs";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const WRITE_ROLES = ["ADMIN", "SUPERADMIN", "CSR_MANAGER", "CSR_TEAM_LEADER"];
const READ_ALL_ROLES = [...WRITE_ROLES, "HR", "SENIOR_MANAGER"];
// Can coach anyone (agents and TLs) and sees every log. A TL only coaches the
// agents on their own CSR team and only sees those logs (migration 0357).
const MANAGER_ROLES = ["ADMIN", "SUPERADMIN", "CSR_MANAGER"];
// Who can be coached — picked by role, primary or extra.
const COACHABLE_ROLES = new Set(["CSR", "CSR_AGENT", "CSR_TEAM_LEADER"]);
const TL_ROLE = new Set(["CSR_TEAM_LEADER"]);

function holds(p: ProfileRow, set: Set<string>): boolean {
  if (set.has(String(p.role || "").toUpperCase())) return true;
  return (p.extra_roles ?? []).some((r) => set.has(String(r).toUpperCase()));
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${m}/${d}/${y}`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
}

type Status = "coach" | "csr" | "csr_sign" | "creator_sign" | "locked";

function statusOf(l: CoachingLog): Status {
  if (l.csrSignedAt && l.creatorSignedAt) return "locked";
  if (l.csrSignedAt) return "creator_sign";
  if (!l.summary.trim() || !l.coachingDiscussion.trim() || !l.tlActionPlan.trim()) return "coach";
  if (!l.csrExplanation.trim() || !l.csrActionPlan.trim()) return "csr";
  return "csr_sign";
}

const STATUS_LABEL: Record<Status, string> = {
  coach: "Coach to fill in",
  csr: "CSR to fill in",
  csr_sign: "Waiting for CSR signature",
  creator_sign: "Waiting for coach signature",
  locked: "Signed & locked",
};

const STATUS_CLASS: Record<Status, string> = {
  coach: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  csr: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  csr_sign: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  creator_sign: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  locked: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

const EVENT_LABEL: Record<CoachingLogEvent["action"], string> = {
  created: "Created",
  edited: "Edited",
  csr_signed: "CSR signed",
  creator_signed: "Coach signed",
  deleted: "Deleted",
  restored: "Restored",
};

export function CsrCoachingLogPage({ mod, sub }: Props) {
  const { uid, role, extraRoles, displayName } = useAuth();
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const canWrite = hasDashboardAccess(WRITE_ROLES, role, extraRoles);
  const canReadAll = hasDashboardAccess(READ_ALL_ROLES, role, extraRoles);
  const isManager = hasDashboardAccess(MANAGER_ROLES, role, extraRoles);

  const [myId, setMyId] = useState<string | null>(null);
  const [logs, setLogs] = useState<CoachingLog[]>([]);
  const [events, setEvents] = useState<CoachingLogEvent[]>([]);
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [teams, setTeams] = useState<CsrTeamComposition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<"active" | "deleted" | "history">("active");
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | Status>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<{ log: CoachingLog; action: "delete" | "restore" } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    setError(null);
    try {
      const [pid, rows, ev, userRows, comp] = await Promise.all([
        getMyProfileId(uid),
        getCoachingLogs(),
        canReadAll ? getCoachingLogEvents().catch(() => []) : Promise.resolve([] as CoachingLogEvent[]),
        canWrite ? getCompanyUsers() : Promise.resolve([] as ProfileRow[]),
        canWrite ? getCsrTeamComposition().catch(() => null) : Promise.resolve(null),
      ]);
      setMyId(pid);
      setLogs(rows);
      setEvents(ev);
      setUsers(userRows);
      setTeams(comp);
    } catch (e: any) {
      setError(e?.message || "Couldn't load coaching logs.");
    } finally {
      setLoading(false);
    }
  }, [uid, canReadAll, canWrite]);

  useEffect(() => { void load(); }, [load]);

  const replaceLog = (l: CoachingLog) => setLogs((prev) => prev.map((x) => (x.id === l.id ? l : x)));
  const refreshEvents = () => {
    if (canReadAll) getCoachingLogEvents().then(setEvents).catch(() => {});
  };

  const teamNames = useMemo(() => Array.from(new Set(logs.map((l) => l.team).filter(Boolean))).sort(), [logs]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (tab === "active" ? l.deletedAt : !l.deletedAt) return false;
      if (q && ![l.csrName, l.teamLeaderName ?? "", l.ticketNumber, l.createdByName ?? ""].some((s) => s.toLowerCase().includes(q))) return false;
      if (teamFilter && l.team !== teamFilter) return false;
      if (statusFilter && statusOf(l) !== statusFilter) return false;
      if (from && l.coachingDate < from) return false;
      if (to && l.coachingDate > to) return false;
      return true;
    });
  }, [logs, tab, search, teamFilter, statusFilter, from, to]);

  const waitingOnMe = useMemo(
    () =>
      logs.filter((l) => {
        if (l.deletedAt || !myId) return false;
        const s = statusOf(l);
        if (l.csrProfileId === myId) return s === "csr" || s === "csr_sign";
        if (l.createdBy === myId) return s === "creator_sign";
        return false;
      }),
    [logs, myId]
  );

  const logById = useMemo(() => new Map(logs.map((l) => [l.id, l])), [logs]);
  const openLog = openId ? logById.get(openId) ?? null : null;

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const updated = confirm.action === "delete" ? await deleteCoachingLog(confirm.log.id) : await restoreCoachingLog(confirm.log.id);
      replaceLog(updated);
      refreshEvents();
      toast.success(confirm.action === "delete" ? "Coaching log deleted — you can restore it from the Deleted tab." : "Coaching log restored.");
      setConfirm(null);
    } catch (e: any) {
      toast.error(e?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-6">
          <button type="button" onClick={goBack} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" /> {mod.label}
          </button>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-display font-bold tracking-tight mb-2">{sub.title}</h1>
            <p className="text-lg text-muted-foreground">
              {canReadAll
                ? `${isManager || !canWrite ? "Coaching sessions for the CSR department." : "Coaching sessions for your team."} The person coached fills in II and IV and signs first, then whoever created the log signs — after that it's locked.`
                : "Your coaching sessions. Fill in II (your explanation) and IV (your action plan), then sign."}
            </p>
          </div>
          {canWrite && (
            <button type="button" onClick={() => setCreating(true)} className="btn btn-primary">
              <Plus className="h-4 w-4" /> New Coaching Log
            </button>
          )}
        </div>
      </div>

      {error && <div className="panel mb-4 border-red-500/30 bg-red-500/5 text-sm text-red-300 px-4 py-3">{error}</div>}

      {waitingOnMe.length > 0 && (
        <div className="panel mb-4 border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          <span className="font-semibold text-amber-300">{waitingOnMe.length} coaching log{waitingOnMe.length === 1 ? "" : "s"} waiting for you: </span>
          {waitingOnMe.map((l, i) => (
            <span key={l.id}>
              {i > 0 && ", "}
              <button type="button" className="underline hover:text-foreground" onClick={() => setOpenId(l.id)}>
                {l.csrProfileId === myId ? `${fmtDate(l.coachingDate)} with ${l.teamLeaderName || l.createdByName || "your coach"}` : `${l.csrName} (${fmtDate(l.coachingDate)})`}
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 mb-3">
        {(["active", ...(canReadAll ? (["deleted", "history"] as const) : [])] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`text-sm px-3 py-1.5 rounded-md border transition ${tab === t ? "bg-blue-600 text-white border-blue-600" : "border-[var(--color-panel-border)] text-muted-foreground hover:text-foreground"}`}
          >
            {t === "active" ? "Coaching Logs" : t === "deleted" ? `Deleted (${logs.filter((l) => l.deletedAt).length})` : "History"}
          </button>
        ))}
      </div>

      {tab !== "history" && (
        <div className="panel p-3 mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <input className="glass-input text-sm" placeholder="Search CSR, team leader, ticket #…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="glass-input text-sm" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
            <option value="">All teams</option>
            {teamNames.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="glass-input text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="">All statuses</option>
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <input type="date" className="glass-input text-sm" value={from} onChange={(e) => setFrom(e.target.value)} title="Coaching date from" />
          <input type="date" className="glass-input text-sm" value={to} onChange={(e) => setTo(e.target.value)} title="Coaching date to" />
        </div>
      )}

      <div className="panel p-0 overflow-x-auto">
        {loading ? (
          <TableSkeleton rows={5} cols={7} />
        ) : tab === "history" ? (
          events.length === 0 ? (
            <EmptyState icon={<History />} title="No activity yet" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground border-b border-[var(--color-panel-border)]">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">By</th>
                  <th className="px-3 py-2">Coaching log</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => {
                  const l = logById.get(ev.logId);
                  return (
                    <tr key={ev.id} className="border-b border-[var(--color-panel-border)]/60">
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(ev.createdAt)}</td>
                      <td className={`px-3 py-2 font-medium ${ev.action === "deleted" ? "text-red-300" : ev.action === "restored" ? "text-emerald-300" : ""}`}>{EVENT_LABEL[ev.action] ?? ev.action}</td>
                      <td className="px-3 py-2">{ev.actorName || "—"}</td>
                      <td className="px-3 py-2">
                        {l ? (
                          <button type="button" className="underline hover:text-foreground text-left" onClick={() => setOpenId(l.id)}>
                            {l.csrName} — {fmtDate(l.coachingDate)}{l.ticketNumber ? ` — #${l.ticketNumber}` : ""}
                          </button>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck />}
            title={tab === "deleted" ? "No deleted coaching logs" : "No coaching logs"}
            hint={tab === "active" && canWrite ? "Create one with “New Coaching Log”." : undefined}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground border-b border-[var(--color-panel-border)]">
                <th className="px-3 py-2">Coaching date</th>
                <th className="px-3 py-2">CSR</th>
                <th className="px-3 py-2">Coach</th>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">Ticket #</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">{tab === "deleted" ? "Deleted by" : "Created by"}</th>
                {canWrite && <th className="px-3 py-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => {
                const s = statusOf(l);
                return (
                  <tr key={l.id} className="border-b border-[var(--color-panel-border)]/60 hover:bg-white/[0.03] cursor-pointer" onClick={() => setOpenId(l.id)}>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(l.coachingDate)}</td>
                    <td className="px-3 py-2 font-medium">{l.csrName}</td>
                    <td className="px-3 py-2">{l.teamLeaderName || l.createdByName || "—"}</td>
                    <td className="px-3 py-2">{l.team || "—"}</td>
                    <td className="px-3 py-2">{l.ticketNumber || "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${STATUS_CLASS[s]}`}>
                        {s === "locked" && <Lock className="h-3 w-3" />}{STATUS_LABEL[s]}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {tab === "deleted" ? `${l.deletedByName || "—"} · ${fmtDateTime(l.deletedAt)}` : l.createdByName || "—"}
                    </td>
                    {canWrite && (
                      <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                        {l.csrProfileId === myId ? null : tab === "deleted" ? (
                          <button type="button" className="btn text-xs" onClick={() => setConfirm({ log: l, action: "restore" })}>
                            <RotateCcw className="h-3.5 w-3.5" /> Restore
                          </button>
                        ) : (
                          <button type="button" className="btn btn-danger text-xs" onClick={() => setConfirm({ log: l, action: "delete" })}>
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <NewCoachingLogModal
          users={users}
          teams={teams}
          myId={myId}
          isManager={isManager}
          onClose={() => setCreating(false)}
          onCreated={(l) => {
            setLogs((prev) => [l, ...prev]);
            refreshEvents();
            setCreating(false);
            setOpenId(l.id);
            toast.success(`Coaching log created for ${l.csrName}.`);
          }}
        />
      )}

      {openLog && (
        <CoachingLogModal
          log={openLog}
          myId={myId}
          myName={displayName || ""}
          canWrite={canWrite}
          onClose={() => setOpenId(null)}
          onSaved={(l) => { replaceLog(l); refreshEvents(); }}
        />
      )}

      {confirm && (
        <AppModal
          title={confirm.action === "delete" ? "Delete this coaching log?" : "Restore this coaching log?"}
          description={`${confirm.log.csrName} — ${fmtDate(confirm.log.coachingDate)}`}
          tone={confirm.action === "delete" ? "warning" : "default"}
          size="sm"
          busy={busy}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
              <button type="button" className={`btn ${confirm.action === "delete" ? "btn-danger" : "btn-primary"}`} onClick={runConfirm} disabled={busy}>
                {busy ? "Working…" : confirm.action === "delete" ? "Delete" : "Restore"}
              </button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">
            {confirm.action === "delete"
              ? "It moves to the Deleted tab and can be restored any time. Who deleted it is recorded on the History tab."
              : "It goes back to the Coaching Logs list exactly as it was."}
          </p>
        </AppModal>
      )}
    </main>
  );
}

function NewCoachingLogModal({
  users,
  teams,
  myId,
  isManager,
  onClose,
  onCreated,
}: {
  users: ProfileRow[];
  teams: CsrTeamComposition | null;
  myId: string | null;
  isManager: boolean;
  onClose: () => void;
  onCreated: (l: CoachingLog) => void;
}) {
  const active = useMemo(() => users.filter((u) => u.is_active).sort((a, b) => (a.display_name || "").localeCompare(b.display_name || "")), [users]);
  // Managers: every CSR agent and TL. A TL: only the agents (not other TLs)
  // on their own CSR team(s) — same rule the database enforces.
  const coachable = useMemo(() => {
    const base = active.filter((u) => u.id !== myId && holds(u, COACHABLE_ROLES));
    if (isManager) return base;
    const myTeams = new Set((teams?.members ?? []).filter((m) => m.profileId === myId).map((m) => m.teamId));
    const teammates = new Set((teams?.members ?? []).filter((m) => myTeams.has(m.teamId)).map((m) => m.profileId));
    return base.filter((u) => teammates.has(u.id) && !holds(u, TL_ROLE));
  }, [active, myId, isManager, teams]);
  // Whoever creates the log is the coach.
  const me = active.find((u) => u.id === myId) ?? null;
  const myName = me ? me.display_name || me.username || "" : "";

  const [csrId, setCsrId] = useState("");
  const [team, setTeam] = useState("");
  const [ticket, setTicket] = useState("");
  const [date, setDate] = useState(todayIso());
  const [summary, setSummary] = useState("");
  const [discussion, setDiscussion] = useState("");
  const [tlPlan, setTlPlan] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Picking the person pre-fills their CSR team.
  const pickCsr = (id: string) => {
    setCsrId(id);
    const member = teams?.members.find((m) => m.profileId === id);
    const t = member ? teams?.teams.find((x) => x.id === member.teamId) : undefined;
    setTeam(t ? t.name : "");
  };

  const submit = async () => {
    const csr = active.find((u) => u.id === csrId);
    if (!csr) { setErr("Choose who this coaching log is for."); return; }
    if (!date) { setErr("Coaching date is required."); return; }
    setSaving(true);
    setErr(null);
    try {
      const created = await createCoachingLog({
        csrProfileId: csr.id,
        csrName: csr.display_name || csr.username || "",
        teamLeaderProfileId: myId,
        teamLeaderName: myName || null,
        ticketNumber: ticket.trim(),
        team: team.trim(),
        coachingDate: date,
        summary: summary.trim(),
        coachingDiscussion: discussion.trim(),
        tlActionPlan: tlPlan.trim(),
      });
      onCreated(created);
    } catch (e: any) {
      setErr(e?.message || "Couldn't create the coaching log.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal
      title="New Coaching Log"
      description="Fill in the header and your sections now or later. The CSR fills in II and IV."
      size="lg"
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? "Creating…" : "Create"}</button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Coaching for">
          <select className="glass-input w-full text-sm" value={csrId} onChange={(e) => pickCsr(e.target.value)}>
            <option value="">Select person…</option>
            {coachable.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name || u.username}{holds(u, TL_ROLE) ? " — Team Leader" : ""}
              </option>
            ))}
          </select>
          {!isManager && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {coachable.length === 0
                ? "No agents found on your CSR team — ask a CSR Manager to add you to a team in Team Composition."
                : "Agents on your own CSR team. A CSR Manager creates logs for Team Leaders."}
            </p>
          )}
        </Field>
        <Field label="Coach">
          <div className="glass-input w-full text-sm opacity-80 cursor-default">{myName || "You"} <span className="text-muted-foreground">(you)</span></div>
        </Field>
        <Field label="Ticket Number">
          <input className="glass-input w-full text-sm" value={ticket} onChange={(e) => setTicket(e.target.value)} />
        </Field>
        <Field label="Team">
          <input className="glass-input w-full text-sm" value={team} onChange={(e) => setTeam(e.target.value)} list="coaching-team-names" />
          <datalist id="coaching-team-names">{teams?.teams.map((t) => <option key={t.id} value={t.name} />)}</datalist>
        </Field>
        <Field label="Coaching Date">
          <input type="date" className="glass-input w-full text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 space-y-3">
        <Section n="I" title="Summary of the Scenario" value={summary} onChange={setSummary} editable />
        <Section n="III" title="Coaching Discussion" value={discussion} onChange={setDiscussion} editable />
        <Section n="V" title="Coach's Action Plan" value={tlPlan} onChange={setTlPlan} editable />
      </div>
      {err && <p className="mt-3 text-sm text-red-300">{err}</p>}
    </AppModal>
  );
}

function CoachingLogModal({
  log,
  myId,
  myName,
  canWrite,
  onClose,
  onSaved,
}: {
  log: CoachingLog;
  myId: string | null;
  myName: string;
  canWrite: boolean;
  onClose: () => void;
  onSaved: (l: CoachingLog) => void;
}) {
  const isTarget = !!myId && log.csrProfileId === myId;
  const isCreator = !!myId && log.createdBy === myId;
  const deleted = !!log.deletedAt;
  const locked = !!(log.csrSignedAt && log.creatorSignedAt);
  const coachEditable = canWrite && !isTarget && !log.csrSignedAt && !deleted;
  const csrEditable = isTarget && !log.csrSignedAt && !deleted;

  const [f, setF] = useState(() => ({
    ticketNumber: log.ticketNumber,
    team: log.team,
    coachingDate: log.coachingDate,
    summary: log.summary,
    coachingDiscussion: log.coachingDiscussion,
    tlActionPlan: log.tlActionPlan,
    csrExplanation: log.csrExplanation,
    csrActionPlan: log.csrActionPlan,
  }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [signing, setSigning] = useState<"csr" | "creator" | null>(null);

  const coachDirty =
    f.ticketNumber !== log.ticketNumber ||
    f.team !== log.team ||
    f.coachingDate !== log.coachingDate ||
    f.summary !== log.summary ||
    f.coachingDiscussion !== log.coachingDiscussion ||
    f.tlActionPlan !== log.tlActionPlan;
  const csrDirty = f.csrExplanation !== log.csrExplanation || f.csrActionPlan !== log.csrActionPlan;
  const dirty = (coachEditable && coachDirty) || (csrEditable && csrDirty);

  const allFilled = [f.summary, f.csrExplanation, f.coachingDiscussion, f.csrActionPlan, f.tlActionPlan].every((s) => s.trim());
  const coachName = log.teamLeaderName || log.createdByName || "Coach";
  const canSignCsr = isTarget && !log.csrSignedAt && !deleted;
  const canSignCreator = isCreator && !!log.csrSignedAt && !log.creatorSignedAt && !deleted;

  const save = async (): Promise<CoachingLog | null> => {
    setSaving(true);
    setErr(null);
    try {
      let updated = log;
      if (coachEditable && coachDirty) {
        updated = await saveCoachFields(log.id, {
          ticketNumber: f.ticketNumber.trim(),
          team: f.team.trim(),
          coachingDate: f.coachingDate,
          summary: f.summary.trim(),
          coachingDiscussion: f.coachingDiscussion.trim(),
          tlActionPlan: f.tlActionPlan.trim(),
        });
      }
      if (csrEditable && csrDirty) {
        updated = await saveCsrFields(log.id, f.csrExplanation.trim(), f.csrActionPlan.trim());
      }
      onSaved(updated);
      return updated;
    } catch (e: any) {
      setErr(e?.message || "Couldn't save.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <AppModal
      title={
        <span className="flex items-center gap-2">
          CSR Coaching Log {locked && <Lock className="h-4 w-4 text-emerald-400" />}
        </span>
      }
      description={
        deleted
          ? `Deleted by ${log.deletedByName || "—"} on ${fmtDateTime(log.deletedAt)} — view only. Restore it from the Deleted tab to continue.`
          : locked
            ? "Signed by both — locked, view only."
            : `Created by ${log.createdByName || "—"} on ${fmtDateTime(log.createdAt)}`
      }
      size="xl"
      busy={saving || !!signing}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Close</button>
          {(coachEditable || csrEditable) && (
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </>
      }
    >
      <div className="coaching-paper mx-auto w-full max-w-[816px] rounded-sm bg-white px-5 py-8 text-[#111] shadow-lg sm:px-14 sm:py-12" style={{ fontFamily: "Arial, Helvetica, sans-serif", colorScheme: "light" }}>
        <div className="flex items-center gap-4 sm:gap-8">
          <img src={usihsLogo} alt="US In Home Services" className="h-20 w-20 shrink-0 sm:h-28 sm:w-28" />
          <div className="flex-1 text-center">
            <div className="text-base font-bold tracking-wide sm:text-[22px]">CUSTOMER SERVICE REPRESENTATIVE</div>
            <div className="mt-1 text-sm sm:text-[19px]">COACHING LOG ( CSR DEPARTMENT )</div>
          </div>
        </div>

        <div className="mt-8 space-y-1.5 text-sm sm:mt-12 sm:pl-6">
          <PaperField label="CSR's Name">{log.csrName}</PaperField>
          <PaperField label="Coach">{log.teamLeaderName || log.createdByName || ""}</PaperField>
          <PaperField label="Ticket Number">
            {coachEditable ? <input className={PAPER_INPUT} value={f.ticketNumber} onChange={(e) => set("ticketNumber")(e.target.value)} /> : f.ticketNumber}
          </PaperField>
          <PaperField label="Team">
            {coachEditable ? <input className={PAPER_INPUT} value={f.team} onChange={(e) => set("team")(e.target.value)} /> : f.team}
          </PaperField>
          <PaperField label="Coaching Date">
            {coachEditable ? <input type="date" className={PAPER_INPUT} value={f.coachingDate} onChange={(e) => set("coachingDate")(e.target.value)} /> : fmtDate(f.coachingDate)}
          </PaperField>
        </div>

        <div className="mt-8 space-y-7 sm:pl-6">
          <PaperSection n="I." title="SUMMARY OF THE SCENARIO:" who={coachName} value={f.summary} onChange={set("summary")} editable={coachEditable} />
          <PaperSection n="II." title="CSR's EXPLANATION" who={log.csrName} value={f.csrExplanation} onChange={set("csrExplanation")} editable={csrEditable} />
          <PaperSection n="III." title="COACHING DISCUSSION" who={coachName} value={f.coachingDiscussion} onChange={set("coachingDiscussion")} editable={coachEditable} />
          <PaperSection n="IV." title="CSR's ACTION PLAN" who={log.csrName} value={f.csrActionPlan} onChange={set("csrActionPlan")} editable={csrEditable} />
          <PaperSection n="V." title="COACH'S ACTION PLAN" who={coachName} value={f.tlActionPlan} onChange={set("tlActionPlan")} editable={coachEditable} />

          <div>
            <h3 className="flex text-sm font-bold">
              <span className="w-10 shrink-0">VI.</span>
              <span>ACKNOWLEDGEMENT</span>
            </h3>
            <p className="mt-2 pl-10 text-sm">I acknowledge that this coaching session was discussed and understood.</p>
            <div className="mt-6 space-y-5 pl-10">
              <PaperSignature
                label="CSR's Signature"
                person={log.csrName}
                signature={log.csrSignature}
                signedName={log.csrSignedName}
                signedAt={log.csrSignedAt}
                note={log.csrSignedAt ? "" : "Signs first, once every section is filled in."}
                action={
                  canSignCsr ? (
                    <button
                      type="button"
                      className="btn btn-primary text-xs"
                      disabled={!allFilled || saving}
                      title={allFilled ? undefined : "Every section (I–V) must be filled in first."}
                      onClick={async () => {
                        if (dirty && !(await save())) return;
                        setSigning("csr");
                      }}
                    >
                      Sign
                    </button>
                  ) : null
                }
              />
              <PaperSignature
                label="Coach's Signature"
                person={coachName}
                signature={log.creatorSignature}
                signedName={log.creatorSignedName}
                signedAt={log.creatorSignedAt}
                note={log.creatorSignedAt ? "" : log.csrSignedAt ? "Signs second (whoever created this log)." : "Signs after the CSR."}
                action={canSignCreator ? <button type="button" className="btn btn-primary text-xs" onClick={() => setSigning("creator")}>Sign</button> : null}
              />
            </div>
            {isTarget && !log.csrSignedAt && !allFilled && !deleted && (
              <p className="mt-3 pl-10 text-xs text-amber-700">Fill in II and IV (and wait for the coach to finish I, III and V) before signing. After you sign, the log can't be edited.</p>
            )}
          </div>
        </div>
      </div>

      {err && <p className="mt-3 text-sm text-red-300">{err}</p>}

      {signing && (
        <SignModal
          defaultName={signing === "csr" ? log.csrName : myName || log.createdByName || ""}
          onClose={() => setSigning(null)}
          onSign={async (dataUrl, name) => {
            const updated = signing === "csr" ? await signAsCsr(log.id, dataUrl, name) : await signAsCreator(log.id, dataUrl, name);
            onSaved(updated);
            setSigning(null);
            toast.success(updated.creatorSignedAt ? "Signed — the coaching log is now locked." : "Signed.");
          }}
        />
      )}
    </AppModal>
  );
}

function SignModal({ defaultName, onClose, onSign }: { defaultName: string; onClose: () => void; onSign: (dataUrl: string, name: string) => Promise<void> }) {
  const pad = useSignaturePad({ width: 400, height: 110, defaultName });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!pad.hasContent()) { setErr("Please add your signature and check the box first."); return; }
    const dataUrl = pad.toDataURL();
    if (!dataUrl) { setErr("Please add your signature first."); return; }
    setBusy(true);
    setErr(null);
    try {
      await onSign(dataUrl, pad.typedName.trim() || defaultName);
    } catch (e: any) {
      setErr(e?.message || "Couldn't sign.");
      setBusy(false);
    }
  };
  return (
    <AppModal
      title="Sign coaching log"
      description="Once signed, your part can't be changed."
      size="md"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Signing…" : "Sign"}</button>
        </>
      }
    >
      <canvas {...pad.canvasProps} className={`bg-white rounded-md border border-white/15 block mx-auto w-full max-w-sm ${pad.canvasProps.className}`} />
      <div className="mt-2"><SignaturePadControls pad={pad} /></div>
      {err && <p className="mt-2 text-sm text-red-300 text-center">{err}</p>}
    </AppModal>
  );
}

// Paper look (white page, black text) — inputs are styled explicitly so they
// stay light in dark mode.
const PAPER_INPUT =
  "w-full max-w-xs rounded-none border-0 border-b border-gray-400 bg-transparent px-1 py-0.5 text-sm text-[#111] outline-none focus:border-blue-600";
const PAPER_TEXTAREA =
  "mt-2 w-full min-h-[96px] rounded border border-gray-300 bg-white p-2 text-sm text-[#111] outline-none focus:border-blue-600";

function PaperField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[28px] items-center gap-2">
      <span className="w-32 shrink-0 font-bold">{label}:</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function PaperSection({
  n,
  title,
  who,
  value,
  onChange,
  editable,
}: {
  n: string;
  title: string;
  who: string;
  value: string;
  onChange: (v: string) => void;
  editable: boolean;
}) {
  return (
    <div>
      <h3 className="flex flex-wrap items-baseline text-sm font-bold">
        <span className="w-10 shrink-0">{n}</span>
        <span>{title}</span>
        <span className="ml-2 text-[11px] font-normal text-gray-500">— {who}</span>
      </h3>
      <div className="pl-10">
        {editable ? (
          <textarea className={PAPER_TEXTAREA} value={value} onChange={(e) => onChange(e.target.value)} />
        ) : value ? (
          <p className="mt-2 whitespace-pre-wrap text-sm">{value}</p>
        ) : (
          <p className="mt-2 text-sm italic text-gray-400">Not filled in yet.</p>
        )}
      </div>
    </div>
  );
}

function PaperSignature({
  label,
  person,
  signature,
  signedName,
  signedAt,
  note,
  action,
}: {
  label: string;
  person: string;
  signature: string | null;
  signedName: string | null;
  signedAt: string | null;
  note: string;
  action: React.ReactNode;
}) {
  const signed = !!(signedAt && signature);
  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-2 gap-y-2 text-sm">
        <span className="font-bold">{label}:</span>
        <span className="flex h-14 w-56 items-end justify-center border-b border-[#111] sm:w-64">
          {signed && <img src={signature!} alt={`${label} — ${signedName || person}`} title={signedName || person} className="max-h-[52px] w-auto max-w-full" />}
        </span>
        <span className="font-bold">Date:</span>
        <span className="w-28 border-b border-[#111] pb-0.5 text-center">{signed ? fmtDate(signedAt) : " "}</span>
        {!signed && action}
      </div>
      <div className="mt-1 text-[11px] text-gray-500">{signed ? `${signedName || person} · ${fmtDateTime(signedAt)}` : `${person}${note ? " — " + note : ""}`}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-xs font-semibold uppercase text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Section({
  n,
  title,
  who,
  value,
  onChange,
  editable,
}: {
  n: string;
  title: string;
  who?: string;
  value: string;
  onChange: (v: string) => void;
  editable: boolean;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold flex flex-wrap items-baseline gap-x-2">
        <span><span className="inline-block w-8">{n}.</span>{title}</span>
        {who && <span className="text-[11px] font-normal text-muted-foreground">— {who}</span>}
      </h3>
      {editable ? (
        <textarea className="glass-input mt-1 w-full text-sm min-h-[84px] sm:ml-8 sm:w-[calc(100%-2rem)]" value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <p className="mt-1 text-sm whitespace-pre-wrap sm:ml-8 min-h-[1.25rem]">{value || <span className="text-muted-foreground italic">Not filled in yet.</span>}</p>
      )}
    </div>
  );
}
