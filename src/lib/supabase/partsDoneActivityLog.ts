/**
 * Write-through log of the Parts hub's "Done" button — backs the Parts
 * Order Dashboard's "Done Activity" tab. m.$module.tsx's confirmImDone
 * inserts one row here per branch, right alongside the real "Parts done"
 * notification send (see migration 0174's header comment for why this
 * doesn't just re-derive the log from the notification backends).
 *
 * Collections/Pickup/Received done-vs-total (migration 0175) are stored
 * as their own columns, not parsed back out of `summary`, so the Done
 * Activity tab can render them as real bullet points. `metrics` is
 * optional on logPartsDoneActivity/nullable on the row — rows logged
 * before 0175 only have `summary`, so the tab falls back to that.
 */
import { supabase } from "./client";

export interface PartsDoneActivityMetrics {
  collectionsDone: number;
  collectionsTotal: number;
  pickupDone: number;
  pickupTotal: number;
  receivedDone: number;
  receivedTotal: number;
}

export interface PartsDoneActivityRow {
  id: string;
  branch: string;
  summary: string;
  recipientCount: number;
  actorName: string | null;
  createdAt: string;
  metrics: PartsDoneActivityMetrics | null;
}

/** Best-effort — a logging failure should never block the actual "Done" notification send. */
export async function logPartsDoneActivity(params: {
  branch: string;
  summary: string;
  recipientCount: number;
  actorName?: string | null;
  metrics?: PartsDoneActivityMetrics;
}): Promise<void> {
  try {
    const { error } = await supabase.from("parts_done_activity_log").insert({
      branch: params.branch,
      summary: params.summary,
      recipient_count: params.recipientCount,
      actor_name: params.actorName || null,
      collections_done: params.metrics?.collectionsDone ?? null,
      collections_total: params.metrics?.collectionsTotal ?? null,
      pickup_done: params.metrics?.pickupDone ?? null,
      pickup_total: params.metrics?.pickupTotal ?? null,
      received_done: params.metrics?.receivedDone ?? null,
      received_total: params.metrics?.receivedTotal ?? null,
    });
    if (error) console.error("logPartsDoneActivity error:", error.message);
  } catch (err) {
    console.error("logPartsDoneActivity failed:", err);
  }
}

/** Most recent Done-button activity, newest first. */
export async function getPartsDoneActivity(limit = 200): Promise<PartsDoneActivityRow[]> {
  const { data, error } = await supabase
    .from("parts_done_activity_log")
    .select("id, branch, summary, recipient_count, actor_name, created_at, collections_done, collections_total, pickup_done, pickup_total, received_done, received_total")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("getPartsDoneActivity error:", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    branch: row.branch,
    summary: row.summary,
    recipientCount: row.recipient_count,
    actorName: row.actor_name,
    createdAt: row.created_at,
    metrics:
      row.collections_done === null || row.collections_total === null
        ? null
        : {
            collectionsDone: row.collections_done,
            collectionsTotal: row.collections_total,
            pickupDone: row.pickup_done ?? 0,
            pickupTotal: row.pickup_total ?? 0,
            receivedDone: row.received_done ?? 0,
            receivedTotal: row.received_total ?? 0,
          },
  }));
}
