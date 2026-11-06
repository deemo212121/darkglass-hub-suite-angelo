/**
 * Accounting → Coaching Log — the CSR Coaching Log's copy for the Accounting
 * department, a shared, signable record in its own tables (migration 0433).
 *
 *   Header + I. Summary / III. Coaching Discussion / V. Coach's Action Plan
 *     → the coach side (Admin, Super Admin)
 *   II. Accounting Staff's Explanation / IV. Accounting Staff's Action Plan
 *     → only the person being coached
 *   VI. Acknowledgement → the person coached signs first (every section
 *     filled), then whoever created the log. Both signed = locked.
 *
 * Accounting has no team leaders, so there's no team
 * scoping like CSR has: Admin and up see and manage everything, HR and Senior
 * Managers read everything, and the person coached sees only their own logs.
 * Delete is a soft delete (restorable) and every create / edit / send / sign /
 * delete / restore shows on the History tab. All of these rules are enforced
 * by the table's triggers and RLS too — this page only mirrors them so people
 * aren't offered buttons that would be refused.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronLeft, ClipboardCheck, Eye, History, Lock, Plus, RotateCcw, Send, Trash2 } from "lucide-react";
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
import {
  getAccountingCoachingLogs,
  getAccountingCoachingLogEvents,
  createAccountingCoachingLog,
  saveAccountingCoachFields,
  saveAccountingStaffFields,
  signAsAccountingStaff,
  signAsAccountingCoach,
  deleteAccountingCoachingLog,
  restoreAccountingCoachingLog,
  markAccountingCoachingLogSent,
  sendAccountingCoachingLogMessage,
  accountingCoachingStatus,
  isAccountingCoachingWaitingOn,
  type AccountingCoachingStatus,
  type AccountingCoachingLog,
  type AccountingCoachingLogEvent,
} from "@/lib/supabase/accountingCoachingLogs";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const WRITE_ROLES = ["ADMIN", "SUPERADMIN", "SUPERSUPERADMIN"];
const READ_ALL_ROLES = [...WRITE_ROLES, "HR", "SENIOR_MANAGER"];
// Who can be coached — picked by role, primary or extra.
const COACHABLE_ROLES = new Set(["FINANCE", "ACCOUNTING_MANAGER"]);

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

type Status = AccountingCoachingStatus;
const statusOf = accountingCoachingStatus;

const STATUS_LABEL: Record<Status, string> = {
  coach: "Coach to fill in",
  staff: "Accounting Staff to fill in",
  staff_sign: "Waiting for Accounting Staff signature",
  creator_sign: "Waiting for coach signature",
  locked: "Signed & locked",
};

const STATUS_CLASS: Record<Status, string> = {
  coach: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  staff: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  staff_sign: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  creator_sign: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  locked: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

const EVENT_LABEL: Record<AccountingCoachingLogEvent["action"], string> = {
  created: "Created",
  edited: "Edited",
  sent: "Sent to Accounting Staff",
  employee_signed: "Accounting Staff signed",
  creator_signed: "Coach signed",
  deleted: "Deleted",
  restored: "Restored",
};

export function AccountingCoachingLogPage({ mod, sub }: Props) {
  const { uid, role, extraRoles, displayName } = useAuth();
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const canWrite = hasDashboardAccess(WRITE_ROLES, role, extraRoles);
  const canReadAll = hasDashboardAccess(READ_ALL_ROLES, role, extraRoles);

  const [myId, setMyId] = useState<string | null>(null);
  const [logs, setLogs] = useState<AccountingCoachingLog[]>([]);
  const [events, setEvents] = useState<AccountingCoachingLogEvent[]>([]);
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<"active" | "deleted" | "history">("active");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | Status>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<{ log: AccountingCoachingLog; action: "delete" | "restore" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  // Same rule as the Send button inside a log: coach side, until the person coached has signed.
  const canSendRow = (l: AccountingCoachingLog) => !!myId && canWrite && l.employeeProfileId !== myId && !l.deletedAt && !l.employeeSignedAt;
  const sendFromList = async (l: AccountingCoachingLog) => {
    if (!myId) return;
    setSendingId(l.id);
    try {
      replaceLog(await sendLogToStaff(l, myId, displayName || ""));
      refreshEvents();
      toast.success(`${l.sentAt ? "Resent" : "Sent"} to ${l.employeeName}.`);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't send.");
    } finally {
      setSendingId(null);
    }
  };

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    setError(null);
    try {
      const [pid, rows, ev, userRows] = await Promise.all([
        getMyProfileId(uid),
        getAccountingCoachingLogs(),
        canReadAll ? getAccountingCoachingLogEvents().catch(() => []) : Promise.resolve([] as AccountingCoachingLogEvent[]),
        canWrite ? getCompanyUsers() : Promise.resolve([] as ProfileRow[]),
      ]);
      setMyId(pid);
      setLogs(rows);
      setEvents(ev);
      setUsers(userRows);
    } catch (e: any) {
      setError(e?.message || "Couldn't load coaching logs.");
    } finally {
      setLoading(false);
    }
  }, [uid, canReadAll, canWrite]);

  useEffect(() => { void load(); }, [load]);

  // Opened from a Team Messenger / bell link (…/coaching-log?log=<id>) —
  // each link opens its log once, even when already on this page.
  const linkedLogId = String((useLocation().search as Record<string, unknown>)?.log ?? "");
  const handledLink = useRef("");
  useEffect(() => {
    if (!linkedLogId || loading || handledLink.current === linkedLogId) return;
    handledLink.current = linkedLogId;
    if (logs.some((l) => l.id === linkedLogId)) setOpenId(linkedLogId);
  }, [linkedLogId, loading, logs]);

  const replaceLog = (l: AccountingCoachingLog) => setLogs((prev) => prev.map((x) => (x.id === l.id ? l : x)));
  const refreshEvents = () => {
    if (canReadAll) getAccountingCoachingLogEvents().then(setEvents).catch(() => {});
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (tab === "active" ? l.deletedAt : !l.deletedAt) return false;
      if (q && ![l.employeeName, l.coachName ?? "", l.issue, l.createdByName ?? ""].some((s) => s.toLowerCase().includes(q))) return false;
      if (statusFilter && statusOf(l) !== statusFilter) return false;
      if (from && l.coachingDate < from) return false;
      if (to && l.coachingDate > to) return false;
      return true;
    });
  }, [logs, tab, search, statusFilter, from, to]);

  const waitingOnMe = useMemo(
    () =>
      logs.filter((l) => isAccountingCoachingWaitingOn(l, myId)),
    [logs, myId]
  );

  const logById = useMemo(() => new Map(logs.map((l) => [l.id, l])), [logs]);
  const openLog = openId ? logById.get(openId) ?? null : null;

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const updated = confirm.action === "delete" ? await deleteAccountingCoachingLog(confirm.log.id) : await restoreAccountingCoachingLog(confirm.log.id);
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
                ? `Coaching sessions for the Accounting department. The person coached fills in II and IV and signs first, then whoever created the log signs — after that it's locked.`
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
                {l.employeeProfileId === myId ? `${fmtDate(l.coachingDate)} with ${l.coachName || l.createdByName || "your coach"}` : `${l.employeeName} (${fmtDate(l.coachingDate)})`}
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
        <div className="panel p-3 mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input className="glass-input text-sm" placeholder="Search accounting staff, coach, issue…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
                            {l.employeeName} — {fmtDate(l.coachingDate)}{l.issue ? ` — ${l.issue}` : ""}
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
                <th className="px-3 py-2">Accounting Staff</th>
                <th className="px-3 py-2">Coach</th>
                <th className="px-3 py-2">Issue</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">{tab === "deleted" ? "Deleted by" : "Created by"}</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => {
                const s = statusOf(l);
                return (
                  <tr key={l.id} className="border-b border-[var(--color-panel-border)]/60 hover:bg-white/[0.03] cursor-pointer" onClick={() => setOpenId(l.id)}>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(l.coachingDate)}</td>
                    <td className="px-3 py-2 font-medium">{l.employeeName}</td>
                    <td className="px-3 py-2">{l.coachName || l.createdByName || "—"}</td>
                    <td className="px-3 py-2 max-w-[16rem] truncate" title={l.issue || undefined}>{l.issue || "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${STATUS_CLASS[s]}`}>
                        {s === "locked" && <Lock className="h-3 w-3" />}{STATUS_LABEL[s]}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {tab === "deleted" ? `${l.deletedByName || "—"} · ${fmtDateTime(l.deletedAt)}` : l.createdByName || "—"}
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <button type="button" className="btn text-xs" onClick={() => setOpenId(l.id)}>
                          <Eye className="h-3.5 w-3.5" /> View
                        </button>
                        {tab === "active" && canSendRow(l) && (
                          <button
                            type="button"
                            className={`btn text-xs ${l.sentAt ? "" : "btn-primary"}`}
                            disabled={sendingId === l.id}
                            title={l.sentAt ? `Sent ${fmtDateTime(l.sentAt)}${l.sentByName ? " by " + l.sentByName : ""} — send it again` : `Send it to ${l.employeeName} in Team Messenger`}
                            onClick={() => void sendFromList(l)}
                          >
                            <Send className="h-3.5 w-3.5" /> {sendingId === l.id ? "Sending…" : l.sentAt ? "Resend" : "Send"}
                          </button>
                        )}
                        {canWrite && l.employeeProfileId !== myId && (tab === "deleted" ? (
                          <button type="button" className="btn text-xs" onClick={() => setConfirm({ log: l, action: "restore" })}>
                            <RotateCcw className="h-3.5 w-3.5" /> Restore
                          </button>
                        ) : (
                          <button type="button" className="btn btn-danger text-xs" onClick={() => setConfirm({ log: l, action: "delete" })}>
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </button>
                        ))}
                      </div>
                    </td>
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
          myId={myId}
          onClose={() => setCreating(false)}
          onCreated={(l) => {
            setLogs((prev) => [l, ...prev]);
            refreshEvents();
            setCreating(false);
            setOpenId(l.id);
            toast.success(`Coaching log created for ${l.employeeName}.`);
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
          description={`${confirm.log.employeeName} — ${fmtDate(confirm.log.coachingDate)}`}
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

/**
 * "Send to Accounting Staff": a Team Messenger message from the coach with a link to the
 * log plus a bell notification, then stamps it sent (History tab). Returns
 * the updated log, or the same one if only the stamp failed.
 */
async function sendLogToStaff(log: AccountingCoachingLog, myId: string, myName: string): Promise<AccountingCoachingLog> {
  await sendAccountingCoachingLogMessage({
    fromId: myId,
    fromName: myName || "Coach",
    toId: log.employeeProfileId,
    logId: log.id,
    body: `📋 Coaching Log (${fmtDate(log.coachingDate)}) from ${myName || "your coach"} is ready for you. Please fill in II. Accounting Staff's Explanation and IV. Accounting Staff's Action Plan, then sign.`,
  });
  try {
    return await markAccountingCoachingLogSent(log.id);
  } catch (e: any) {
    toast.warning(e?.message || "Sent, but couldn't record it as sent.");
    return log;
  }
}

function NewCoachingLogModal({
  users,
  myId,
  onClose,
  onCreated,
}: {
  users: ProfileRow[];
  myId: string | null;
  onClose: () => void;
  onCreated: (l: AccountingCoachingLog) => void;
}) {
  const active = useMemo(() => users.filter((u) => u.is_active).sort((a, b) => (a.display_name || "").localeCompare(b.display_name || "")), [users]);
  // Everyone in Accounting except yourself.
  const coachable = useMemo(() => active.filter((u) => u.id !== myId && holds(u, COACHABLE_ROLES)), [active, myId]);
  // Whoever creates the log is the coach.
  const me = active.find((u) => u.id === myId) ?? null;
  const myName = me ? me.display_name || me.username || "" : "";

  const [employeeId, setEmployeeId] = useState("");
  const [issue, setIssue] = useState("");
  const [date, setDate] = useState(todayIso());
  const [summary, setSummary] = useState("");
  const [discussion, setDiscussion] = useState("");
  const [coachPlan, setCoachPlan] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (andSend: boolean) => {
    const employee = active.find((u) => u.id === employeeId);
    if (!employee) { setErr("Choose who this coaching log is for."); return; }
    if (!date) { setErr("Coaching date is required."); return; }
    setSaving(true);
    setErr(null);
    try {
      const created = await createAccountingCoachingLog({
        employeeProfileId: employee.id,
        employeeName: employee.display_name || employee.username || "",
        issue: issue.trim(),
        coachingDate: date,
        summary: summary.trim(),
        coachingDiscussion: discussion.trim(),
        coachActionPlan: coachPlan.trim(),
      });
      if (andSend && myId) {
        try {
          const sent = await sendLogToStaff(created, myId, myName);
          toast.success(`Sent to ${created.employeeName}.`);
          onCreated(sent);
        } catch (e: any) {
          toast.error(`Created, but sending failed: ${e?.message || "unknown error"} — use Send on the log to try again.`);
          onCreated(created);
        }
        return;
      }
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
      description="Fill in the header and your sections now or later. Accounting Staff fills in II and IV."
      size="lg"
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn" onClick={() => submit(false)} disabled={saving}>{saving ? "Creating…" : "Create"}</button>
          <button type="button" className="btn btn-primary" onClick={() => submit(true)} disabled={saving} title="Create it and send it to the person in Team Messenger">
            {saving ? "Working…" : "Create & Send"}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Coaching for">
          <select className="glass-input w-full text-sm" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Select person…</option>
            {coachable.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name || u.username}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Coach">
          <div className="glass-input w-full text-sm opacity-80 cursor-default">{myName || "You"} <span className="text-muted-foreground">(you)</span></div>
        </Field>
        <Field label="Issue">
          <input className="glass-input w-full text-sm" value={issue} onChange={(e) => setIssue(e.target.value)} />
        </Field>
        <Field label="Coaching Date">
          <input type="date" className="glass-input w-full text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 space-y-3">
        <Section n="I" title="Summary of the Scenario" value={summary} onChange={setSummary} editable />
        <Section n="III" title="Coaching Discussion" value={discussion} onChange={setDiscussion} editable />
        <Section n="V" title="Coach's Action Plan" value={coachPlan} onChange={setCoachPlan} editable />
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
  log: AccountingCoachingLog;
  myId: string | null;
  myName: string;
  canWrite: boolean;
  onClose: () => void;
  onSaved: (l: AccountingCoachingLog) => void;
}) {
  const isTarget = !!myId && log.employeeProfileId === myId;
  const isCreator = !!myId && log.createdBy === myId;
  const deleted = !!log.deletedAt;
  const locked = !!(log.employeeSignedAt && log.creatorSignedAt);
  const coachEditable = canWrite && !isTarget && !log.employeeSignedAt && !deleted;
  const staffEditable = isTarget && !log.employeeSignedAt && !deleted;
  // The coach side can send it to the person coached until they've signed.
  const canSend = !!myId && canWrite && !isTarget && !deleted && !log.employeeSignedAt;
  const [sending, setSending] = useState(false);

  const [f, setF] = useState(() => ({
    issue: log.issue,
    coachingDate: log.coachingDate,
    summary: log.summary,
    coachingDiscussion: log.coachingDiscussion,
    coachActionPlan: log.coachActionPlan,
    employeeExplanation: log.employeeExplanation,
    employeeActionPlan: log.employeeActionPlan,
  }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [signing, setSigning] = useState<"staff" | "creator" | null>(null);

  const coachDirty =
    f.issue !== log.issue ||
    f.coachingDate !== log.coachingDate ||
    f.summary !== log.summary ||
    f.coachingDiscussion !== log.coachingDiscussion ||
    f.coachActionPlan !== log.coachActionPlan;
  const staffDirty = f.employeeExplanation !== log.employeeExplanation || f.employeeActionPlan !== log.employeeActionPlan;
  const dirty = (coachEditable && coachDirty) || (staffEditable && staffDirty);

  const allFilled = [f.summary, f.employeeExplanation, f.coachingDiscussion, f.employeeActionPlan, f.coachActionPlan].every((s) => s.trim());
  const coachName = log.coachName || log.createdByName || "Coach";
  const canSignStaff = isTarget && !log.employeeSignedAt && !deleted;
  const canSignCreator = isCreator && !!log.employeeSignedAt && !log.creatorSignedAt && !deleted;

  const save = async (): Promise<AccountingCoachingLog | null> => {
    if (coachEditable && !f.coachingDate) { setErr("Coaching date is required."); return null; }
    setSaving(true);
    setErr(null);
    try {
      let updated = log;
      if (coachEditable && coachDirty) {
        updated = await saveAccountingCoachFields(log.id, {
          issue: f.issue.trim(),
          coachingDate: f.coachingDate,
          summary: f.summary.trim(),
          coachingDiscussion: f.coachingDiscussion.trim(),
          coachActionPlan: f.coachActionPlan.trim(),
        });
      }
      if (staffEditable && staffDirty) {
        updated = await saveAccountingStaffFields(log.id, f.employeeExplanation.trim(), f.employeeActionPlan.trim());
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
          Accounting Coaching Log {locked && <Lock className="h-4 w-4 text-emerald-400" />}
        </span>
      }
      description={
        deleted
          ? `Deleted by ${log.deletedByName || "—"} on ${fmtDateTime(log.deletedAt)} — view only. Restore it from the Deleted tab to continue.`
          : locked
            ? "Signed by both — locked, view only."
            : `Created by ${log.createdByName || "—"} on ${fmtDateTime(log.createdAt)}${
                log.sentAt ? ` · Sent to ${log.employeeName} on ${fmtDateTime(log.sentAt)}` : canSend ? " · Not sent yet" : ""
              }`
      }
      size="xl"
      busy={saving || !!signing}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving || sending}>Close</button>
          {canSend && (
            <button
              type="button"
              className="btn"
              disabled={saving || sending}
              title={`Send it to ${log.employeeName} in Team Messenger, with a link to this log`}
              onClick={async () => {
                if (dirty && !(await save())) return;
                setSending(true);
                try {
                  onSaved(await sendLogToStaff(log, myId!, myName));
                  toast.success(`Sent to ${log.employeeName}.`);
                } catch (e: any) {
                  toast.error(e?.message || "Couldn't send.");
                } finally {
                  setSending(false);
                }
              }}
            >
              {sending ? "Sending…" : log.sentAt ? `Resend to ${log.employeeName.split(" ")[0]}` : `Send to ${log.employeeName.split(" ")[0]}`}
            </button>
          )}
          {(coachEditable || staffEditable) && (
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
            <div className="text-base font-bold tracking-wide sm:text-[22px]">ACCOUNTING STAFF</div>
            <div className="mt-1 text-sm sm:text-[19px]">COACHING LOG ( ACCOUNTING DEPARTMENT )</div>
          </div>
        </div>

        <div className="mt-8 space-y-1.5 text-sm sm:mt-12 sm:pl-6">
          <PaperField label="Accounting Staff's Name">{log.employeeName}</PaperField>
          <PaperField label="Coach">{log.coachName || log.createdByName || ""}</PaperField>
          <PaperField label="Issue">
            {coachEditable ? <input className={PAPER_INPUT} value={f.issue} onChange={(e) => set("issue")(e.target.value)} /> : f.issue}
          </PaperField>
          <PaperField label="Coaching Date">
            {coachEditable ? <input type="date" className={`${PAPER_INPUT} max-w-xs`} value={f.coachingDate} onChange={(e) => set("coachingDate")(e.target.value)} /> : fmtDate(f.coachingDate)}
          </PaperField>
        </div>

        <div className="mt-8 space-y-7 sm:pl-6">
          <PaperSection n="I." title="SUMMARY OF THE SCENARIO:" who={coachName} value={f.summary} onChange={set("summary")} editable={coachEditable} />
          <PaperSection n="II." title="ACCOUNTING STAFF'S EXPLANATION" who={log.employeeName} value={f.employeeExplanation} onChange={set("employeeExplanation")} editable={staffEditable} />
          <PaperSection n="III." title="COACHING DISCUSSION" who={coachName} value={f.coachingDiscussion} onChange={set("coachingDiscussion")} editable={coachEditable} />
          <PaperSection n="IV." title="ACCOUNTING STAFF'S ACTION PLAN" who={log.employeeName} value={f.employeeActionPlan} onChange={set("employeeActionPlan")} editable={staffEditable} />
          <PaperSection n="V." title="COACH'S ACTION PLAN" who={coachName} value={f.coachActionPlan} onChange={set("coachActionPlan")} editable={coachEditable} />

          <div>
            <h3 className="flex text-sm font-bold">
              <span className="w-10 shrink-0">VI.</span>
              <span>ACKNOWLEDGEMENT</span>
            </h3>
            <p className="mt-2 pl-10 text-sm">I acknowledge that this coaching session was discussed and understood.</p>
            <div className="mt-6 space-y-5 pl-10">
              <PaperSignature
                label="Accounting Staff's Signature"
                person={log.employeeName}
                signature={log.employeeSignature}
                signedName={log.employeeSignedName}
                signedAt={log.employeeSignedAt}
                note={log.employeeSignedAt ? "" : "Signs first, once every section is filled in."}
                action={
                  canSignStaff ? (
                    <button
                      type="button"
                      className="btn btn-primary text-xs"
                      disabled={!allFilled || saving}
                      title={allFilled ? undefined : "Every section (I–V) must be filled in first."}
                      onClick={async () => {
                        if (dirty && !(await save())) return;
                        setSigning("staff");
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
                note={log.creatorSignedAt ? "" : log.employeeSignedAt ? "Signs second (whoever created this log)." : "Signs after the Accounting Staff."}
                action={canSignCreator ? <button type="button" className="btn btn-primary text-xs" onClick={() => setSigning("creator")}>Sign</button> : null}
              />
            </div>
            {isTarget && !log.employeeSignedAt && !allFilled && !deleted && (
              <p className="mt-3 pl-10 text-xs text-amber-700">Fill in II and IV (and wait for the coach to finish I, III and V) before signing. After you sign, the log can't be edited.</p>
            )}
          </div>
        </div>
      </div>

      {err && <p className="mt-3 text-sm text-red-300">{err}</p>}

      {signing && (
        <SignModal
          defaultName={signing === "staff" ? log.employeeName : myName || log.createdByName || ""}
          onClose={() => setSigning(null)}
          onSign={async (dataUrl, name) => {
            const updated = signing === "staff" ? await signAsAccountingStaff(log.id, dataUrl, name) : await signAsAccountingCoach(log.id, dataUrl, name);
            onSaved(updated);
            setSigning(null);
            toast.success(updated.creatorSignedAt ? "Signed — the coaching log is now locked." : "Signed.");
            // Let the other side know, the same way the log was sent.
            const coachName = updated.coachName || updated.createdByName || "the coach";
            const to = signing === "staff" ? updated.createdBy : updated.employeeProfileId;
            if (myId && to && to !== myId) {
              sendAccountingCoachingLogMessage({
                fromId: myId,
                fromName: myName || (signing === "staff" ? updated.employeeName : coachName),
                toId: to,
                logId: updated.id,
                body:
                  signing === "staff"
                    ? `✍️ ${updated.employeeName} signed the Coaching Log (${fmtDate(updated.coachingDate)}). Your signature is next.`
                    : `✅ Your Coaching Log (${fmtDate(updated.coachingDate)}) is signed by you and ${coachName} and is now locked.`,
              }).catch(() => toast.warning("Signed, but the message to the other person couldn't be sent."));
            }
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
  "w-full rounded-none border-0 border-b border-gray-400 bg-transparent px-1 py-0.5 text-sm text-[#111] outline-none focus:border-blue-600";
const PAPER_TEXTAREA =
  "mt-2 w-full min-h-[96px] rounded border border-gray-300 bg-white p-2 text-sm text-[#111] outline-none focus:border-blue-600";

function PaperField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[28px] items-center gap-2">
      <span className="w-32 shrink-0 font-bold sm:w-44">{label}:</span>
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
