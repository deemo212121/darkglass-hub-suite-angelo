import { supabase } from "./client";

/**
 * Subscribes to any insert/update/delete on a table (optionally filtered,
 * e.g. `company_id=eq.{id}`) and invokes `onChange` on every event — same
 * postgres_changes pattern already used for messages/notifications (see
 * src/lib/supabase/messaging.ts). The table must be added to the
 * `supabase_realtime` publication (see 0037/0052 migrations) or this
 * silently never fires.
 *
 * Deliberately coarse-grained (refetch-on-any-change rather than patching
 * individual rows from the payload) — the HR dashboard's lists are cheap
 * to reload and this stays correct even when a change affects a joined
 * column the payload doesn't include.
 */
export function subscribeTableChanges(table: string, onChange: () => void, filter?: string): () => void {
  const channelName = `${table}-${filter ?? "all"}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sub = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      filter ? ({ event: "*", schema: "public", table, filter } as const) : ({ event: "*", schema: "public", table } as const),
      () => onChange()
    )
    .subscribe();
  return () => {
    try {
      supabase.removeChannel(sub);
    } catch {
      /* ignore */
    }
  };
}
