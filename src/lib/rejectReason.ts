/**
 * "Why are you rejecting this?" — one shared popup for every Reject action
 * (Time Corrections, PTO / Sick / Unpaid Leave, Ticket Time Disputes,
 * Payroll Inquiries…). The save functions themselves call askRejectReason()
 * when no reason was passed in, so every Reject button anywhere in the app
 * gets the popup without each screen wiring its own. The reason is saved on
 * the request and shown to the employee in Employee Self-Service → My
 * Requests and in their rejection notification.
 *
 * The same popup asks for the required approval note (requireApproveNote,
 * migration 0376) when an Approve has none — Manager / HR / Accounting notes
 * shown under each status.
 *
 * RejectReasonHost (mounted once in __root.tsx) registers the real popup;
 * without it (tests, server) this falls back to window.prompt.
 */

export type NoteKind = "reject" | "approve";
type Asker = (title: string, kind: NoteKind) => Promise<string | null>;

let asker: Asker | null = null;

export function registerRejectReasonAsker(fn: Asker | null): void {
  asker = fn;
}

/** Resolves to the trimmed reason, or null if the reviewer cancelled. */
export async function askRejectReason(title = "Reason for rejecting", kind: NoteKind = "reject"): Promise<string | null> {
  if (asker) return asker(title, kind);
  if (typeof window === "undefined") return null;
  const v = window.prompt(`${title} (required):`);
  return v && v.trim() ? v.trim() : null;
}

export const REJECT_CANCELLED_MESSAGE = "Rejection cancelled — nothing was changed.";
export const APPROVE_CANCELLED_MESSAGE = "Approval cancelled — nothing was changed.";

/** Thrown when the reviewer cancels the popup — callers treat it as "nothing happened". */
export class RejectCancelledError extends Error {
  constructor(message = REJECT_CANCELLED_MESSAGE) {
    super(message);
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
  const asked = await askRejectReason(title, "reject");
  if (!asked) throw new RejectCancelledError();
  return asked;
}

/** Gets the approval note (asking if none given) or throws RejectCancelledError (approval cancelled). */
export async function requireApproveNote(given: string | null | undefined, title = "Approval notes"): Promise<string> {
  const v = (given ?? "").trim();
  if (v) return v;
  const asked = await askRejectReason(title, "approve");
  if (!asked) throw new RejectCancelledError(APPROVE_CANCELLED_MESSAGE);
  return asked;
}
