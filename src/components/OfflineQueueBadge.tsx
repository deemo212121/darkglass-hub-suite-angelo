import { CloudOff } from "lucide-react";
import { useOfflineQueueSync } from "@/lib/offlineQueue";

/**
 * "N changes pending sync" dot for a user's own avatar — same absolutely-
 * positioned pattern as LocationSharingBadge.tsx, opposite corner so the
 * two never overlap when both are active at once. Also owns the actual
 * sync-on-reconnect wiring (useOfflineQueueSync) — mounting this component
 * is what starts draining the queue, not just displaying its state.
 */
export function OfflineQueueBadge() {
  const pending = useOfflineQueueSync();
  if (pending === 0) return null;
  return (
    <span
      className="absolute -bottom-0.5 -left-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-amber-500 ring-2 ring-white/90"
      title={`${pending} change${pending === 1 ? "" : "s"} waiting to sync`}
      aria-label={`${pending} change${pending === 1 ? "" : "s"} waiting to sync`}
    >
      <CloudOff className="h-2 w-2 text-white" aria-hidden="true" />
    </span>
  );
}
