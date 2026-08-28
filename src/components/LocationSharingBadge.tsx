import { MapPin } from "lucide-react";
import { useLocationSharingStatus } from "@/lib/locationSharingStatus";

/**
 * Small "your location is live" dot for a user's own avatar — replaces the
 * old floating "📍 Sharing location" pill (TechnicianLocationTracker.tsx),
 * which sat fixed at the bottom-left of the viewport and overlapped the
 * mobile bottom tab bar. Absolutely positioned, so the avatar it's placed
 * inside needs `relative` (or an ancestor does).
 */
export function LocationSharingBadge() {
  const sharing = useLocationSharingStatus();
  if (!sharing) return null;
  return (
    <span
      className="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-blue-500 ring-2 ring-white/90"
      title="Sharing your live location"
      aria-label="Sharing your live location"
    >
      <MapPin className="h-2 w-2 text-white" fill="currentColor" aria-hidden="true" />
    </span>
  );
}
