/**
 * Password checks (migration 0441): which pages and buttons ask for the
 * person's own login password first (PasswordGateModal), and how often.
 * Managed by a Super Admin on Admin → Password and Email Management →
 * Password Checks. Loaded once after sign-in (auth.tsx → startPasswordChecks)
 * and kept current through realtime, so a change reaches open pages.
 *
 * Kept small and free of heavy imports: the page wrapper and the gated
 * buttons read it synchronously.
 */
import { useSyncExternalStore } from "react";

export type PasswordCheckFrequency = "every_time" | "once_per_session";
/** own = the person's own login password; set = a password a Super Admin set for this check. */
export type PasswordCheckType = "own" | "set";

export interface PasswordCheckSetting {
  id: string;
  key: string;
  label: string;
  enabled: boolean;
  frequency: PasswordCheckFrequency;
  passwordType: PasswordCheckType;
  /** When the set password was last set (null = never). */
  passwordSetAt: string | null;
  passwordSetByName: string | null;
  updatedByName: string | null;
  updatedAt: string | null;
}

export interface BuiltInPasswordCheck {
  key: string;
  label: string;
  where: string;
  defaultFrequency: PasswordCheckFrequency;
}

/** Checks the app has on its own buttons. On by default. */
export const BUILT_IN_PASSWORD_CHECKS: BuiltInPasswordCheck[] = [
  { key: "truck-stock-import", label: "Truck Stock → Import", where: "The Import button on Logistics → Part Inventory → Truck Stock.", defaultFrequency: "every_time" },
  {
    key: "employee-monitoring-attendance-status",
    label: "Employee Monitoring → Attendance Status",
    where: "The Attendance Status view on Employee Monitoring (HR and Accounting).",
    defaultFrequency: "once_per_session",
  },
];

export const pageCheckKey = (moduleSlug: string, submoduleSlug: string) => `page:${moduleSlug}/${submoduleSlug}`;
export const isPageCheckKey = (key: string) => key.startsWith("page:");

export const FREQUENCY_LABEL: Record<PasswordCheckFrequency, string> = {
  every_time: "Every time",
  once_per_session: "Once per session",
};

// ---------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------

type Status = "idle" | "loading" | "ready";
let status: Status = "idle" as Status;
let rows = new Map<string, PasswordCheckSetting>();
let snapshot: { status: Status; rows: Map<string, PasswordCheckSetting> } = { status, rows };
const listeners = new Set<() => void>();
const notify = () => {
  snapshot = { status, rows };
  for (const l of listeners) l();
};

export function hydratePasswordChecks(list: PasswordCheckSetting[]): void {
  rows = new Map(list.map((r) => [r.key, r]));
  status = "ready";
  notify();
}

export function getPasswordChecksSnapshot() {
  return snapshot;
}

/** Re-renders the caller whenever the settings change. */
export function usePasswordChecks() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getPasswordChecksSnapshot,
    getPasswordChecksSnapshot,
  );
}

/**
 * The setting in force: the saved row, else the built-in default (on), else
 * off (a page nobody added).
 */
export interface ResolvedPasswordCheck {
  enabled: boolean;
  frequency: PasswordCheckFrequency;
  /** Which password it takes. "set" only once a password has actually been set — until then it's the person's own. */
  passwordType: PasswordCheckType;
}

export function resolvePasswordCheck(key: string, saved: ReadonlyMap<string, PasswordCheckSetting> = rows): ResolvedPasswordCheck {
  const row = saved.get(key);
  if (row) return { enabled: row.enabled, frequency: row.frequency, passwordType: row.passwordType === "set" && row.passwordSetAt ? "set" : "own" };
  const builtIn = BUILT_IN_PASSWORD_CHECKS.find((b) => b.key === key);
  return builtIn ? { enabled: true, frequency: builtIn.defaultFrequency, passwordType: "own" } : { enabled: false, frequency: "every_time", passwordType: "own" };
}

/** Same storage PasswordGateModal writes when a password checks out. */
export function gateUnlockedThisSession(key: string): boolean {
  try {
    return sessionStorage.getItem(`gate:${key}`) === "1";
  } catch {
    return false;
  }
}

/** Should opening `key` ask for the password right now? */
export function needsPassword(key: string, saved: ReadonlyMap<string, PasswordCheckSetting> = rows): boolean {
  const c = resolvePasswordCheck(key, saved);
  if (!c.enabled) return false;
  return !(c.frequency === "once_per_session" && gateUnlockedThisSession(key));
}

// ---------------------------------------------------------------------
// Loading (after sign-in) and live updates
// ---------------------------------------------------------------------

let stopWatch: (() => void) | null = null;
let loadToken = 0;

async function reload(token: number) {
  try {
    const { getPasswordChecks } = await import("./supabase/passwordChecks");
    const list = await getPasswordChecks();
    if (token === loadToken) hydratePasswordChecks(list);
  } catch (e) {
    // Not set up yet (0441 not run) or offline: built-in defaults apply.
    console.warn("Password checks not loaded:", e);
    if (token === loadToken) hydratePasswordChecks([]);
  }
}

export function startPasswordChecks(companyId: string): void {
  stopPasswordChecks();
  const token = ++loadToken;
  status = "loading";
  notify();
  void reload(token);
  void import("./supabase/realtime").then(({ subscribeTableChanges }) => {
    if (token !== loadToken) return;
    stopWatch = subscribeTableChanges("password_checks", () => void reload(token), `company_id=eq.${companyId}`);
  });
}

export function stopPasswordChecks(): void {
  loadToken++;
  if (stopWatch) stopWatch();
  stopWatch = null;
  rows = new Map();
  status = "idle";
  notify();
}

/** Reload now (after this person saved a change). */
export function refreshPasswordChecks(): void {
  void reload(loadToken);
}
