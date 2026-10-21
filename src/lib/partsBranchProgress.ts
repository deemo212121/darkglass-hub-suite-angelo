/**
 * Per-branch "done vs total" progress for the Parts hub's "Done" button
 * — e.g. "Asheville Parts: Collections done 4/10". Pulls each source's
 * CURRENT full state for the branch (not just what was in this Done
 * batch), so the manager sees the real remaining backlog, not only
 * what just got marked.
 *
 * Part Daily Pickup's real query is scoped to today's pickup date; if it
 * comes back empty (very possible — see PartDailyPickup.tsx), this falls
 * back to the same per-branch example rows the page itself would show,
 * for consistency.
 */
import { getPartsToReceive } from "@/lib/supabase/partReceive";
import { getPartsForDailyPickup } from "@/lib/supabase/partDailyPickup";
import { getPartsForDailyCollection } from "@/lib/supabase/partDailyCollection";
import { todayISO } from "@/lib/localDate";

/** One day's done / total per source — only days that have any parts. */
export interface BranchDayProgress {
  /** YYYY-MM-DD — PO date (Parts Received), ticket schedule date (Collections), today (Daily Pickup). "" = no date on the record. */
  date: string;
  receivedDone: number;
  receivedTotal: number;
  pickupDone: number;
  pickupTotal: number;
  collectionsDone: number;
  collectionsTotal: number;
}

export interface BranchProgress {
  branch: string;
  /** The same counts broken out per day (newest first), only days with data. */
  days: BranchDayProgress[];
  receivedDone: number;
  receivedTotal: number;
  pickupDone: number;
  pickupTotal: number;
  collectionsDone: number;
  collectionsTotal: number;
}


export async function getBranchProgress(branches: string[]): Promise<BranchProgress[]> {
  const [allReceive, allCollection, ...pickupResults] = await Promise.all([
    getPartsToReceive().catch(() => []),
    getPartsForDailyCollection({
      dateType: "Collect Date",
      startDate: "",
      endDate: "",
      notCollected: true,
      collected: true,
    }).catch(() => []),
    ...branches.map((b) => getPartsForDailyPickup({ location: b, pickupDate: todayISO() }).catch(() => [])),
  ]);

  return branches.map((branch, i) => {
    const receiveRows = allReceive.filter((r) => r.location === branch);
    const realPickup = pickupResults[i] ?? [];
    const pickupRows = realPickup;
    const collectionRows = allCollection.filter((r) => r.location === branch);

    // Per day: Parts Received by PO date, Collections by ticket schedule date,
    // Daily Pickup is today's list.
    const days = new Map<string, BranchDayProgress>();
    const day = (date: string) => {
      const key = (date || "").slice(0, 10);
      let d = days.get(key);
      if (!d) {
        d = { date: key, receivedDone: 0, receivedTotal: 0, pickupDone: 0, pickupTotal: 0, collectionsDone: 0, collectionsTotal: 0 };
        days.set(key, d);
      }
      return d;
    };
    for (const r of receiveRows) { const d = day(r.poDate); d.receivedTotal++; if (r.qtyReceived > 0) d.receivedDone++; }
    for (const r of collectionRows) { const d = day(r.scheduleDate); d.collectionsTotal++; if (r.collected) d.collectionsDone++; }
    for (const r of pickupRows) { const d = day(todayISO()); d.pickupTotal++; if (r.pickedUp) d.pickupDone++; }

    return {
      branch,
      days: Array.from(days.values()).sort((a, b) => (b.date || "").localeCompare(a.date || "")),
      receivedDone: receiveRows.filter((r) => r.qtyReceived > 0).length,
      receivedTotal: receiveRows.length,
      pickupDone: pickupRows.filter((r) => r.pickedUp).length,
      pickupTotal: pickupRows.length,
      collectionsDone: collectionRows.filter((r) => r.collected).length,
      collectionsTotal: collectionRows.length,
    };
  });
}

export function formatBranchProgressLine(p: BranchProgress): string {
  return `${p.branch} Parts: Collections done ${p.collectionsDone}/${p.collectionsTotal}, Daily Pickup done ${p.pickupDone}/${p.pickupTotal}, Parts Received done ${p.receivedDone}/${p.receivedTotal}`;
}
