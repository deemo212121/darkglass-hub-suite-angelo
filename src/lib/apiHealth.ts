/**
 * API health watcher.
 *
 * Wraps any async call (ServicePower, Marcone, Supabase, etc.) and tracks
 * per-endpoint failure streaks. When the same endpoint fails repeatedly
 * within a short window, it notifies the company's admins + parts /
 * claims managers via the existing Firebase notification channel so they
 * can investigate before users start reporting the outage.
 *
 * Usage:
 *   import { runWithApiHealth } from "@/lib/apiHealth";
 *   const result = await runWithApiHealth("marcone.orderStatus", () =>
 *     marconeOrderStatus(...));
 *
 * The wrapper preserves the original return value / throw on every call
 * (including the failing one) — it only adds bookkeeping + the
 * fire-and-forget admin notification. Successful calls clear the streak
 * so transient blips don't pile up.
 */

import type { NotifKind } from "./firebase/notifications";

interface StreakState {
  /** Number of consecutive failures since the last success. */
  count: number;
  /** Last error message we saw — used in the notification body. */
  lastError: string;
  /** ms timestamp of the first failure in the current streak. */
  firstFailureAt: number;
  /** ms timestamp of the most recent admin notification for this streak. */
  lastNotifiedAt: number;
}

const STREAKS = new Map<string, StreakState>();

/** How many consecutive failures before we fire the first alert. */
const FAILURE_THRESHOLD = 3;
/** Don't re-notify more than once every 10 minutes for the same endpoint. */
const NOTIFY_THROTTLE_MS = 10 * 60 * 1000;

/**
 * Roles that should hear about API outages. Tuned to the existing
 * roleLabels list — admins + the people who actually use the API
 * (parts / claims) so they can swap modes / pause the syncs.
 */
const ALERT_ROLES = ["Admin", "Manager", "Claims Manager", "Parts Manager"];

/** Optional named users to always alert in addition to roles. */
const ALERT_USERS = ["Naveen", "Ian", "Tina"];

interface RunOptions {
  /**
   * Override the auto-detected "is this call a failure?" predicate. By
   * default we treat thrown errors as failures; pass a custom predicate
   * when the API returns a structured `{ success: false }` envelope so
   * we can spot logical failures too.
   */
  isFailure?: (value: unknown) => boolean;
  /** Override the failure description shown in the admin notification. */
  describeFailure?: (value: unknown) => string;
  /** companyId to scope the admin lookup to — pulled from auth elsewhere. */
  companyId?: string | null;
}

function shortMessage(err: unknown): string {
  if (!err) return "Unknown failure";
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err).slice(0, 240);
  } catch {
    return String(err);
  }
}

/**
 * Notify the admin team. Fire-and-forget: we never await on the network
 * side of the caller, and we never throw out of this helper.
 */
async function notifyAdmins(
  endpoint: string,
  state: StreakState,
  companyId: string,
): Promise<void> {
  if (!companyId) return;
  try {
    const { sendNotificationToRole, sendNotificationToUsers } = await import(
      "./firebase/notifications"
    );
    const payload = {
      kind: "system" as NotifKind,
      title: `API failing: ${endpoint}`,
      body:
        `${endpoint} has failed ${state.count} times in a row. ` +
        `Latest error: ${state.lastError || "(no message)"}. ` +
        `First failure ${Math.round((Date.now() - state.firstFailureAt) / 1000)}s ago.`,
    };
    await Promise.all([
      ...ALERT_ROLES.map((role) =>
        sendNotificationToRole(role, companyId, payload).catch((e) =>
          console.warn(`[apiHealth] notify role ${role} failed:`, e),
        ),
      ),
      sendNotificationToUsers(ALERT_USERS, companyId, payload).catch((e) =>
        console.warn("[apiHealth] notify users failed:", e),
      ),
    ]);
  } catch (err) {
    console.warn("[apiHealth] admin notification failed:", err);
  }
}

/** Reset bookkeeping for an endpoint after a clean call. */
function clearStreak(endpoint: string): void {
  const prev = STREAKS.get(endpoint);
  if (!prev) return;
  // Only log a "recovery" once.
  if (prev.count >= FAILURE_THRESHOLD) {
    console.info(`[apiHealth] ${endpoint} recovered after ${prev.count} failures.`);
  }
  STREAKS.delete(endpoint);
}

/** Mark an endpoint as having just failed; emit admin notification when due. */
function recordFailure(
  endpoint: string,
  errMessage: string,
  companyId: string | null | undefined,
): void {
  const now = Date.now();
  const prev = STREAKS.get(endpoint);
  const next: StreakState = prev
    ? {
        count: prev.count + 1,
        lastError: errMessage,
        firstFailureAt: prev.firstFailureAt,
        lastNotifiedAt: prev.lastNotifiedAt,
      }
    : {
        count: 1,
        lastError: errMessage,
        firstFailureAt: now,
        lastNotifiedAt: 0,
      };
  STREAKS.set(endpoint, next);
  console.warn(
    `[apiHealth] ${endpoint} failed (#${next.count}): ${errMessage.slice(0, 200)}`,
  );

  if (
    next.count >= FAILURE_THRESHOLD &&
    now - next.lastNotifiedAt >= NOTIFY_THROTTLE_MS &&
    companyId
  ) {
    next.lastNotifiedAt = now;
    STREAKS.set(endpoint, next);
    void notifyAdmins(endpoint, next, companyId);
  }
}

/**
 * Wrap any async call so persistent failures fire an admin
 * notification. The wrapped function's return value (or thrown error)
 * is passed through unchanged.
 */
export async function runWithApiHealth<T>(
  endpoint: string,
  fn: () => Promise<T>,
  options: RunOptions = {},
): Promise<T> {
  try {
    const result = await fn();
    // Logical-failure detection: some APIs resolve with { success: false }
    // payloads rather than throwing. The caller can pass a predicate to
    // catch those cases.
    if (options.isFailure && options.isFailure(result)) {
      const msg = options.describeFailure
        ? options.describeFailure(result)
        : "Logical failure (success=false in response)";
      recordFailure(endpoint, msg, options.companyId ?? readGlobalCompanyId());
      // We don't throw — caller still gets the structured response.
      return result;
    }
    clearStreak(endpoint);
    return result;
  } catch (err) {
    recordFailure(endpoint, shortMessage(err), options.companyId ?? readGlobalCompanyId());
    throw err;
  }
}

/**
 * One-shot helper that doesn't run a function — call this when a caller
 * already has the result and just wants to feed it into the health
 * tracker (e.g. after manually parsing a SOAP response).
 */
export function reportApiHealth(
  endpoint: string,
  outcome: "ok" | { error: string },
  companyId?: string | null,
): void {
  if (outcome === "ok") {
    clearStreak(endpoint);
    return;
  }
  recordFailure(endpoint, outcome.error, companyId ?? readGlobalCompanyId());
}

/** Read the current company id off the global Supabase auth, if any. */
function readGlobalCompanyId(): string | null {
  try {
    const cached = (globalThis as any).__AHS_AUTH_COMPANY_ID__;
    return typeof cached === "string" ? cached : null;
  } catch {
    return null;
  }
}

/** Set the global company id so background fetches outside React can notify. */
export function setApiHealthCompanyId(companyId: string | null): void {
  (globalThis as any).__AHS_AUTH_COMPANY_ID__ = companyId;
}

/** Inspect current streaks — handy for an Admin → Diagnostics page. */
export function getApiHealthState(): Array<{
  endpoint: string;
  failureCount: number;
  lastError: string;
  firstFailureAt: string;
  lastNotifiedAt: string | null;
}> {
  return Array.from(STREAKS.entries()).map(([endpoint, s]) => ({
    endpoint,
    failureCount: s.count,
    lastError: s.lastError,
    firstFailureAt: new Date(s.firstFailureAt).toISOString(),
    lastNotifiedAt: s.lastNotifiedAt ? new Date(s.lastNotifiedAt).toISOString() : null,
  }));
}
