/**
 * Cross-page "done" queue backing the Parts hub's single "I'm Done"
 * button (m.$module.tsx, Parts module only). Part Receive, Part Daily
 * Collection, and Part Daily Pickup each push an entry here when a row
 * gets marked done, and pull it back out if reverted before it's been
 * reported — localStorage-backed since plain React state can't survive
 * navigating between these separate route components. Only the hub page
 * actually sends the notification and clears this queue; the per-page
 * components never send anything themselves anymore.
 */

const STORAGE_KEY = "ahs:parts:pending-done-items";
export const PARTS_DONE_QUEUE_EVENT = "ahs:parts-done-queue-changed";

export interface PendingDoneItem {
  /** `${source}:${rowId}` — unique per row per source page. */
  key: string;
  source: string;
  /** Human-readable summary, e.g. "140004669044 (PO 1007960358-10-SV)". */
  label: string;
  /** Branch/location the row belongs to — drives the per-branch progress digest and the branch->Parts Manager routing. */
  branch: string;
  markedAt: string;
}

function readAll(): PendingDoneItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(items: PendingDoneItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* ignore — worst case the queue just doesn't persist this change */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PARTS_DONE_QUEUE_EVENT));
}

export function addPendingDoneItem(source: string, rowId: string, label: string, branch: string): void {
  const key = `${source}:${rowId}`;
  const items = readAll().filter((i) => i.key !== key);
  items.push({ key, source, label, branch, markedAt: new Date().toISOString() });
  writeAll(items);
}

export function removePendingDoneItem(source: string, rowId: string): void {
  const key = `${source}:${rowId}`;
  const items = readAll();
  if (!items.some((i) => i.key === key)) return;
  writeAll(items.filter((i) => i.key !== key));
}

export function getPendingDoneItems(): PendingDoneItem[] {
  return readAll();
}

export function clearPendingDoneItems(): void {
  writeAll([]);
}
