/**
 * Tracks which ticket numbers this browser has opened from a claims list
 * (Need Claim List / Claim List), so those rows can show a small "already
 * opened" checkmark. Deliberately just a plain localStorage set, not
 * per-company/per-user or synced to Supabase — this is a personal
 * "have I looked at this one yet" scratch mark for whoever's sitting at
 * this browser, not a shared team record.
 */
const STORAGE_KEY = "ahs:opened-tickets";

export function loadOpenedTickets(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

/** Returns a new Set with ticketNo added, persisting it — or the same Set back if it was already marked (no-op, no re-render needed). */
export function markTicketOpened(ticketNo: string, current: Set<string>): Set<string> {
  if (current.has(ticketNo)) return current;
  const next = new Set(current);
  next.add(ticketNo);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)));
  } catch {
    // Storage full/disabled — the checkmark just won't persist, not worth surfacing.
  }
  return next;
}
