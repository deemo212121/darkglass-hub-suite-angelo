/**
 * Deactivated accounts are flagged across the app — their name shows as
 * "Jane Doe (Deactivated)" — everywhere except Payroll, the Accounting
 * Dashboard and Expenses, HR Paperworks and the signing pages (the papers
 * they signed), plus User Management, which show the name as is (most of
 * them have their own Deactivated badge). Nothing stored is changed: this is
 * display-only (see components/InactiveNameMask.tsx), so reactivating an
 * account drops the flag everywhere.
 *
 * Only full names (two words or more) are masked, and never a name an active
 * person also has — a single word like "Mark" would hit "Mark as read".
 */
import type { ProfileRow } from "@/lib/supabase/users";

/** Added after a deactivated person's name on screen. */
export const INACTIVE_NAME_FLAG = " (Deactivated)";

/** Pages where deactivated people keep their names. */
const KEEP_NAMES_PATHS: RegExp[] = [
  /^\/m\/[^/]+\/(payroll-calculation|payroll-report|tech-payroll-setup|hr-paperworks|user-management)(\/|$)/,
  // Accounting's own pages — payroll runs, payslips, disputes and expenses for people who've since left.
  /^\/m\/[^/]+\/accounting-dashboard(\/|$)/,
  /^\/m\/accounting\/expenses(\/|$)/,
  // Attendance Monitoring Report — its people tables flag them "Deactivated · date".
  /^\/m\/[^/]+\/report-attendance-monitoring(\/|$)/,
  /^\/payroll-demo(\/|$)/,
  /^\/(fill|sign)-/,
  /^\/sign-(document|bundle|external)/,
  /^\/admin\/users(\/|$)/,
  /^\/superadmin(\/|$)/,
];

export function keepsInactiveNames(pathname: string): boolean {
  return KEEP_NAMES_PATHS.some((re) => re.test(pathname));
}

const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

let pattern: RegExp | null = null;
let names = new Set<string>();
const listeners = new Set<() => void>();

/** Rebuilds the list from a full roster (active and deactivated rows). */
export function setInactiveNamesFromRoster(rows: Pick<ProfileRow, "display_name" | "is_active">[]): void {
  const active = new Set<string>();
  for (const r of rows) if (r.is_active && r.display_name) active.add(normalize(r.display_name));
  const next = new Set<string>();
  for (const r of rows) {
    if (r.is_active || !r.display_name) continue;
    const n = normalize(r.display_name);
    if (n.split(" ").length < 2 || n.length < 5 || active.has(n)) continue;
    next.add(n);
  }
  if (next.size === names.size && [...next].every((n) => names.has(n))) return;
  names = next;
  pattern = next.size
    ? new RegExp(
        `(?<![\\p{L}\\p{N}])(?:${[...next]
          .sort((a, b) => b.length - a.length)
          .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+"))
          .join("|")})(?![\\p{L}\\p{N}])(?!\\s*\\(Deactivated\\))`,
        "giu",
      )
    : null;
  listeners.forEach((l) => l());
}

export function onInactiveNamesChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True when this whole name belongs to a deactivated person. */
export function isInactiveName(name: string | null | undefined): boolean {
  return !!name && names.has(normalize(name));
}

/**
 * The text with every deactivated person's name flagged — "Jane Doe" →
 * "Jane Doe (Deactivated)"; null when nothing changed. A name already
 * followed by the flag is left alone (the pattern's lookahead), so running
 * it again on its own output changes nothing.
 */
export function maskInactiveNames(text: string): string | null {
  if (!pattern || text.length < 5) return null;
  pattern.lastIndex = 0;
  if (!pattern.test(text)) return null;
  pattern.lastIndex = 0;
  return text.replace(pattern, (name) => `${name}${INACTIVE_NAME_FLAG}`);
}
