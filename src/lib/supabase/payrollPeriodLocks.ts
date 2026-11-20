/**
 * Payroll period locks (migration 0469): each pay period's declared cutoff —
 * the Central Time date and time after which nothing in that period can
 * change. Admin sets / moves / reopens them (Admin → Payroll Locks);
 * Accounting sees the countdown and goes view-only once a period locks.
 * The database enforces it (enforce_payroll_lock), so this file only reads
 * and manages the locks themselves.
 */
import { supabase } from "@/lib/supabase/client";

export const PAYROLL_LOCK_TZ = "America/Chicago";

export interface PayrollPeriodLock {
  id: string;
  periodStart: string;
  periodEnd: string;
  /** ISO timestamp (UTC). */
  lockAt: string;
  reopenedUntil: string | null;
  reopenReason: string | null;
  updatedByName: string | null;
  updatedAt: string;
}

export interface PayrollPeriodLockHistory {
  id: string;
  periodStart: string;
  periodEnd: string;
  action: "set" | "moved" | "reopened" | "relocked" | "removed";
  lockAt: string | null;
  reopenedUntil: string | null;
  reason: string | null;
  byName: string | null;
  at: string;
}

type LockRow = {
  id: string;
  period_start: string;
  period_end: string;
  lock_at: string;
  reopened_until: string | null;
  reopen_reason: string | null;
  updated_by_name: string | null;
  updated_at: string;
};

const fromRow = (r: LockRow): PayrollPeriodLock => ({
  id: r.id,
  periodStart: r.period_start,
  periodEnd: r.period_end,
  lockAt: r.lock_at,
  reopenedUntil: r.reopened_until,
  reopenReason: r.reopen_reason,
  updatedByName: r.updated_by_name,
  updatedAt: r.updated_at,
});

const COLUMNS = "id, period_start, period_end, lock_at, reopened_until, reopen_reason, updated_by_name, updated_at";

/** Missing table (0469 not run yet) — callers treat it as "no locks". */
const isMissingTable = (message: string) => /payroll_period_lock|relation .* does not exist|schema cache/i.test(message);

export async function getPayrollPeriodLocks(): Promise<PayrollPeriodLock[]> {
  const { data, error } = await supabase.from("payroll_period_locks").select(COLUMNS).order("period_start", { ascending: false });
  if (error) {
    if (isMissingTable(error.message)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as LockRow[]).map(fromRow);
}

export async function getPayrollPeriodLock(periodStart: string, periodEnd: string): Promise<PayrollPeriodLock | null> {
  const { data, error } = await supabase
    .from("payroll_period_locks")
    .select(COLUMNS)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error.message)) return null;
    throw new Error(error.message);
  }
  return data ? fromRow(data as LockRow) : null;
}

/** Sets (or moves) a period's cutoff. `lockAt` is an ISO timestamp. */
export async function setPayrollPeriodLock(companyId: string, periodStart: string, periodEnd: string, lockAt: string): Promise<void> {
  const { error } = await supabase
    .from("payroll_period_locks")
    .upsert(
      { company_id: companyId, period_start: periodStart, period_end: periodEnd, lock_at: lockAt, reopened_until: null, reopen_reason: null },
      { onConflict: "company_id,period_start,period_end" },
    );
  if (error) throw new Error(error.message);
}

/** Reopens a locked period until `until` (ISO); it locks again by itself then. */
export async function reopenPayrollPeriod(id: string, until: string, reason: string): Promise<void> {
  const { error } = await supabase.from("payroll_period_locks").update({ reopened_until: until, reopen_reason: reason.trim() }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Ends a reopening early. */
export async function relockPayrollPeriod(id: string): Promise<void> {
  const { error } = await supabase.from("payroll_period_locks").update({ reopened_until: null, reopen_reason: null }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deletePayrollPeriodLock(id: string): Promise<void> {
  const { error } = await supabase.from("payroll_period_locks").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function getPayrollPeriodLockHistory(limit = 100): Promise<PayrollPeriodLockHistory[]> {
  const { data, error } = await supabase
    .from("payroll_period_lock_history")
    .select("id, period_start, period_end, action, lock_at, reopened_until, reason, by_name, at")
    .order("at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingTable(error.message)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as { id: string; period_start: string; period_end: string; action: PayrollPeriodLockHistory["action"]; lock_at: string | null; reopened_until: string | null; reason: string | null; by_name: string | null; at: string }[]).map((r) => ({
    id: r.id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    action: r.action,
    lockAt: r.lock_at,
    reopenedUntil: r.reopened_until,
    reason: r.reason,
    byName: r.by_name,
    at: r.at,
  }));
}

// ── State ────────────────────────────────────────────────────────────────

export type LockState =
  | { kind: "none" }
  | { kind: "scheduled"; lockAt: string }
  | { kind: "locked"; lockAt: string }
  | { kind: "reopened"; lockAt: string; until: string; reason: string | null };

export function lockStateOf(lock: PayrollPeriodLock | null | undefined, now: Date = new Date()): LockState {
  if (!lock) return { kind: "none" };
  const t = now.getTime();
  if (Date.parse(lock.lockAt) > t) return { kind: "scheduled", lockAt: lock.lockAt };
  if (lock.reopenedUntil && Date.parse(lock.reopenedUntil) > t) return { kind: "reopened", lockAt: lock.lockAt, until: lock.reopenedUntil, reason: lock.reopenReason };
  return { kind: "locked", lockAt: lock.lockAt };
}

export const isLockedNow = (lock: PayrollPeriodLock | null | undefined, now?: Date) => lockStateOf(lock, now).kind === "locked";

/** The database's lock message (enforce_payroll_lock) — show it as is. */
export const isPayrollLockedError = (message: string | null | undefined) => /is locked \(cutoff passed/i.test(message ?? "");

// ── Central Time ─────────────────────────────────────────────────────────

/** Minutes Central Time is ahead of UTC at that instant (−300 CDT, −360 CST). */
function chicagoOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PAYROLL_LOCK_TZ,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** "YYYY-MM-DDTHH:mm" read as Central Time → ISO (UTC). */
export function centralLocalToISO(local: string): string {
  const [d, t = "00:00"] = local.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = t.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, day, hh, mm);
  // Two passes settle the offset across a daylight-saving change.
  let utc = guess - chicagoOffsetMinutes(new Date(guess)) * 60_000;
  utc = guess - chicagoOffsetMinutes(new Date(utc)) * 60_000;
  return new Date(utc).toISOString();
}

/** ISO → "YYYY-MM-DDTHH:mm" in Central Time (for a datetime-local input). */
export function isoToCentralLocal(iso: string): string {
  const at = new Date(iso);
  const shifted = new Date(at.getTime() + chicagoOffsetMinutes(at) * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** "Tue, Nov 24, 2026, 5:00 PM CST" */
export function formatCentral(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: PAYROLL_LOCK_TZ,
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
}

/** "2d 4h", "3h 12m", "8m" until `iso`. */
export function timeLeft(iso: string, now: Date = new Date()): string {
  const ms = Math.max(Date.parse(iso) - now.getTime(), 0);
  const mins = Math.floor(ms / 60_000);
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}
