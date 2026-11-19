/**
 * Admin → Payroll Locks: each pay period's payroll cutoff, declared per
 * period in Central Time (no fixed "N days after" rule — holidays move it).
 * Once a period's cutoff passes, nothing in it can change anywhere —
 * hours, attendance, custom lines, taxes, Done marks, mileage, PTO, rates
 * dated in it (enforced by the database, migration 0469). Internal Notes
 * stay open.
 *
 * Admin / SuperAdmin set, move and remove cutoffs, and can reopen a locked
 * period until a set time with a reason (it locks again by itself). Every
 * change is kept in the History below.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Clock, Loader2, Lock, LockOpen, RotateCcw, Trash2 } from "lucide-react";
import { useSmartBack } from "@/hooks/useSmartBack";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { getMyProfileAndCompanyIds } from "@/lib/supabase/users";
import { addDaysISO } from "@/lib/localDate";
import { listPayPeriods, payPeriodContaining, type PayPeriod } from "@/lib/payPeriods";
import {
  centralLocalToISO,
  deletePayrollPeriodLock,
  formatCentral,
  getPayrollPeriodLockHistory,
  getPayrollPeriodLocks,
  isoToCentralLocal,
  lockStateOf,
  relockPayrollPeriod,
  reopenPayrollPeriod,
  setPayrollPeriodLock,
  timeLeft,
  type PayrollPeriodLock,
  type PayrollPeriodLockHistory,
} from "@/lib/supabase/payrollPeriodLocks";

const fmtDay = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const ACTION_LABEL: Record<PayrollPeriodLockHistory["action"], string> = {
  set: "Cutoff set",
  moved: "Cutoff moved",
  reopened: "Reopened",
  relocked: "Locked again",
  removed: "Cutoff removed",
};

export function PayrollLocksPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { uid, role, extraRoles } = useAuth();
  const canManage = [role, ...extraRoles].some((r) => r === "ADMIN" || r === "SUPERADMIN" || r === "SUPERSUPERADMIN" || r === "IT");
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [locks, setLocks] = useState<PayrollPeriodLock[]>([]);
  const [history, setHistory] = useState<PayrollPeriodLockHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (uid) void getMyProfileAndCompanyIds(uid).then((ids) => setCompanyId(ids?.companyId ?? null));
  }, [uid]);

  const load = async () => {
    try {
      const [l, h] = await Promise.all([getPayrollPeriodLocks(), getPayrollPeriodLockHistory()]);
      setLocks(l);
      setHistory(h);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load payroll locks.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  // The next period (so its cutoff can be declared ahead), every period
  // so far, and any locked period older than the picker's list.
  const periods = useMemo(() => {
    const list = listPayPeriods();
    const next = list[0] ? payPeriodContaining(addDaysISO(list[0].end, 1)) : null;
    const all: PayPeriod[] = next ? [next, ...list] : list;
    for (const l of locks) {
      if (!all.some((p) => p.start === l.periodStart && p.end === l.periodEnd)) all.push({ start: l.periodStart, end: l.periodEnd });
    }
    return all.sort((a, b) => b.start.localeCompare(a.start));
  }, [locks]);
  const lockFor = (p: PayPeriod) => locks.find((l) => l.periodStart === p.start && l.periodEnd === p.end) ?? null;

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1200px] mx-auto w-full px-4 sm:px-6 py-8">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <button type="button" onClick={goBack} className="btn hover:bg-white/15" aria-label="Back"><ChevronLeft className="h-4 w-4" /></button>
          <div className="flex-1 min-w-[14rem]">
            <h1 className="text-2xl font-bold">{sub.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Declare each pay period's payroll cutoff (Central Time). After it passes, nothing in that period can be changed: hours, attendance, includables,
              reimbursements, custom and tax lines, Done marks, mileage, PTO or rates dated in it. Internal Notes stay open.
              {!canManage && " Only Admin and SuperAdmin can change cutoffs."}
            </p>
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">{error}</p>}

        {loading ? (
          <div className="mt-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="panel mt-4 overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5">Pay period</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Cutoff (Central Time)</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <PeriodRow
                    key={p.start}
                    period={p}
                    lock={lockFor(p)}
                    now={now}
                    canManage={canManage && !!companyId}
                    onSet={(iso) => run(() => setPayrollPeriodLock(companyId!, p.start, p.end, iso))}
                    onReopen={(id, until, reason) => run(() => reopenPayrollPeriod(id, until, reason))}
                    onRelock={(id) => run(() => relockPayrollPeriod(id))}
                    onRemove={(id) => run(() => deletePayrollPeriodLock(id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="panel mt-6">
          <h2 className="text-sm font-semibold mb-2">History</h2>
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground">No cutoff changes yet.</p>
          ) : (
            <ul className="divide-y divide-white/5 text-xs">
              {history.map((h) => (
                <li key={h.id} className="py-2 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="font-semibold text-slate-200">{ACTION_LABEL[h.action]}</span>
                  <span className="text-muted-foreground">{fmtDay(h.periodStart)} – {fmtDay(h.periodEnd)}</span>
                  {h.action === "reopened" && h.reopenedUntil ? (
                    <span>until {formatCentral(h.reopenedUntil)}{h.reason ? ` · “${h.reason}”` : ""}</span>
                  ) : h.lockAt && h.action !== "removed" && h.action !== "relocked" ? (
                    <span>cutoff {formatCentral(h.lockAt)}</span>
                  ) : null}
                  <span className="ml-auto text-muted-foreground">
                    {h.byName || "Unknown"} · {new Date(h.at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}

function PeriodRow({ period, lock, now, canManage, onSet, onReopen, onRelock, onRemove }: {
  period: PayPeriod;
  lock: PayrollPeriodLock | null;
  now: Date;
  canManage: boolean;
  onSet: (iso: string) => Promise<void>;
  onReopen: (id: string, until: string, reason: string) => Promise<void>;
  onRelock: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const state = lockStateOf(lock, now);
  const [cutoff, setCutoff] = useState(lock ? isoToCentralLocal(lock.lockAt) : "");
  const [reopening, setReopening] = useState(false);
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setCutoff(lock ? isoToCentralLocal(lock.lockAt) : ""); }, [lock?.lockAt]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };
  const cutoffChanged = !!cutoff && (!lock || isoToCentralLocal(lock.lockAt) !== cutoff);
  const lockingNow = cutoffChanged && Date.parse(centralLocalToISO(cutoff)) <= now.getTime();

  const badge =
    state.kind === "locked" ? <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-300"><Lock className="h-3 w-3" /> Locked</span>
    : state.kind === "reopened" ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300" title={state.reason ?? undefined}><LockOpen className="h-3 w-3" /> Reopened · {timeLeft(state.until, now)} left</span>
    : state.kind === "scheduled" ? <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-300"><Clock className="h-3 w-3" /> Locks in {timeLeft(state.lockAt, now)}</span>
    : <span className="text-[11px] text-muted-foreground">No cutoff declared</span>;

  return (
    <>
      <tr className="border-b border-white/5 align-middle">
        <td className="px-4 py-2.5 whitespace-nowrap font-medium">{fmtDay(period.start)} – {fmtDay(period.end)}</td>
        <td className="px-4 py-2.5 whitespace-nowrap">
          {badge}
          {state.kind === "reopened" && <p className="mt-0.5 text-[10px] text-muted-foreground">until {formatCentral(state.until)}{state.reason ? ` · ${state.reason}` : ""}</p>}
        </td>
        <td className="px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="datetime-local"
              value={cutoff}
              disabled={!canManage || busy}
              onChange={(e) => setCutoff(e.target.value)}
              className="glass-input text-sm py-1 px-2 rounded-md"
            />
            <span className="text-[11px] text-muted-foreground">CT</span>
            {canManage && cutoffChanged && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (lockingNow && !confirm(`That time has already passed, so ${fmtDay(period.start)} – ${fmtDay(period.end)} locks right away. Continue?`)) return;
                  void act(() => onSet(centralLocalToISO(cutoff)));
                }}
                className="btn text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : lock ? "Save new cutoff" : "Set cutoff"}
              </button>
            )}
          </div>
          {lock && <p className="mt-0.5 text-[10px] text-muted-foreground">{formatCentral(lock.lockAt)}{lock.updatedByName ? ` · set by ${lock.updatedByName}` : ""}</p>}
        </td>
        <td className="px-4 py-2.5 text-right whitespace-nowrap">
          {canManage && lock && (
            <div className="inline-flex items-center gap-1.5">
              {state.kind === "locked" && (
                <button type="button" disabled={busy} onClick={() => setReopening((v) => !v)} className="btn text-xs px-2.5 py-1 flex items-center gap-1 disabled:opacity-50">
                  <LockOpen className="h-3.5 w-3.5" /> Reopen
                </button>
              )}
              {state.kind === "reopened" && (
                <button type="button" disabled={busy} onClick={() => void act(() => onRelock(lock.id))} className="btn text-xs px-2.5 py-1 flex items-center gap-1 disabled:opacity-50">
                  <RotateCcw className="h-3.5 w-3.5" /> Lock now
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                title="Remove this period's cutoff"
                onClick={() => { if (confirm(`Remove the cutoff for ${fmtDay(period.start)} – ${fmtDay(period.end)}? The period becomes editable again.`)) void act(() => onRemove(lock.id)); }}
                className="text-muted-foreground hover:text-red-300 p-1 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )}
        </td>
      </tr>
      {reopening && lock && state.kind === "locked" && (
        <tr className="border-b border-white/5 bg-white/[0.02]">
          <td colSpan={4} className="px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                Reopen until (CT)
                <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} className="glass-input text-sm py-1 px-2 rounded-md" />
              </label>
              <label className="flex flex-1 min-w-[16rem] flex-col gap-1 text-[11px] text-muted-foreground">
                Reason (required)
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. late timecard correction for J. Smith" className="glass-input text-sm py-1 px-2 rounded-md" />
              </label>
              <button
                type="button"
                disabled={busy || !until || !reason.trim() || Date.parse(centralLocalToISO(until || "1970-01-01T00:00")) <= now.getTime()}
                onClick={() => void act(async () => { await onReopen(lock.id, centralLocalToISO(until), reason); setReopening(false); setUntil(""); setReason(""); })}
                className="btn text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
              >
                Reopen
              </button>
              <button type="button" onClick={() => setReopening(false)} className="btn text-xs px-3 py-1.5">Cancel</button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
