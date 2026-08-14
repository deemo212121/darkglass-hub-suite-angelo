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
import { getPartsForDailyPickup, EXAMPLE_PICKUP_ROWS } from "@/lib/supabase/partDailyPickup";
import { getPartsForDailyCollection } from "@/lib/supabase/partDailyCollection";

export interface BranchProgress {
  branch: string;
  receivedDone: number;
  receivedTotal: number;
  pickupDone: number;
  pickupTotal: number;
  collectionsDone: number;
  collectionsTotal: number;
}

const TODAY = new Date().toISOString().slice(0, 10);

export async function getBranchProgress(branches: string[]): Promise<BranchProgress[]> {
  const [allReceive, allCollection, ...pickupResults] = await Promise.all([
    getPartsToReceive().catch(() => []),
    getPartsForDailyCollection({
      dateType: "Pickup Date",
      startDate: "",
      endDate: "",
      notCollected: true,
      collected: true,
    }).catch(() => []),
    ...branches.map((b) => getPartsForDailyPickup({ location: b, pickupDate: TODAY }).catch(() => [])),
  ]);

  return branches.map((branch, i) => {
    const receiveRows = allReceive.filter((r) => r.location === branch);
    const realPickup = pickupResults[i] ?? [];
    const pickupRows = realPickup.length > 0 ? realPickup : EXAMPLE_PICKUP_ROWS.filter((r) => r.location === branch);
    const collectionRows = allCollection.filter((r) => r.location === branch);

    return {
      branch,
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
