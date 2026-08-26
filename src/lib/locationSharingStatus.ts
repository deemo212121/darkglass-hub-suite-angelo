/**
 * Lightweight broadcast of "am I currently sharing my live location" —
 * TechnicianLocationTracker.tsx (mounted once, globally, in __root.tsx) is
 * the only thing that actually watches position/uploads pings; this just
 * lets OTHER components (e.g. MobileTechApp.tsx's own header) reflect that
 * same boolean without a second copy of the tracking logic running, and
 * without restructuring __root.tsx into a context provider wrapping the
 * whole tree just for one flag.
 */
import { useEffect, useState } from "react";

type Listener = (sharing: boolean) => void;
let current = false;
const listeners = new Set<Listener>();

/** Called by TechnicianLocationTracker.tsx whenever its own `watching` state flips. */
export function setLocationSharingStatus(sharing: boolean): void {
  if (current === sharing) return;
  current = sharing;
  listeners.forEach((l) => l(current));
}

/** True while this device is actively sharing its live location. */
export function useLocationSharingStatus(): boolean {
  const [sharing, setSharing] = useState(current);
  useEffect(() => {
    const listener = (v: boolean) => setSharing(v);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return sharing;
}
