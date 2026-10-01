/**
 * "Why are you rejecting this?" — one shared popup for every Reject action
 * (Time Corrections, PTO / Sick / Unpaid Leave, Ticket Time Disputes,
 * Payroll Inquiries…). The save functions themselves call askRejectReason()
 * when no reason was passed in, so every Reject button anywhere in the app
 * gets the popup without each screen wiring its own. The reason is saved on
 * the request and shown to the employee in Employee Self-Service → My
 * Requests and in their rejection notification.
 *
 * RejectReasonHost (mounted once in __root.tsx) registers the real popup;
 * without it (tests, server) this falls back to window.prompt.
 */

type Asker = (title: string) => Promise<string | null>;

let asker: Asker | null = null;

export function registerRejectReasonAsker(fn: Asker | null): void {
  asker = fn;
}

/** Resolves to the trimmed reason, or null if the reviewer cancelled. */
export async function askRejectReason(title = "Reason for rejecting"): Promise<string | null> {
  if (asker) return asker(title);
  if (typeof window === "undefined") return null;
  const v = window.prompt(`${title} (required):`);
  return v && v.trim() ? v.trim() : null;
}

export const REJECT_CANCELLED_MESSAGE = "Rejection cancelled — nothing was changed.";

/** Thrown when the reviewer cancels the popup — callers treat it as "nothing happened". */
export class RejectCancelledError extends Error {
  constructor() {
    super(REJECT_CANCELLED_MESSAGE);
    this.name = "RejectCancelledError";
  }
}

export function isRejectCancelled(err: unknown): boolean {
  return err instanceof RejectCancelledError;
}

/** Gets a reason (asking if none given) or throws RejectCancelledError. */
export async function requireRejectReason(given: string | null | undefined, title?: string): Promise<string> {
  const v = (given ?? "").trim();
  if (v) return v;
  const asked = await askRejectReason(title);
  if (!asked) throw new RejectCancelledError();
  return asked;
}
