/**
 * Shares the ONE real GPS position TechnicianLocationTracker.tsx already
 * watches (and uploads to technician_location_pings) with any other
 * component that wants "where is this technician right now" client-side —
 * e.g. MobileTechApp.tsx's On-Site Check-In card — without opening a
 * second navigator.geolocation.watchPosition of its own.
 *
 * TechnicianLocationTracker is the only writer (via setLiveLocation);
 * everything else just reads. consentConfirmed/clockedIn are exposed
 * alongside position so a consumer can explain *why* there's no position
 * yet ("confirm location sharing" vs. "clock in first") instead of a
 * generic "no location" message — same three gates that component already
 * enforces before it ever calls watchPosition.
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export interface LiveLocationState {
  position: { lat: number; lng: number } | null;
  watching: boolean;
  consentConfirmed: boolean;
  clockedIn: boolean;
  /** True once the browser/OS has actually denied location permission (not just "no fix yet") — lets a consumer tell those two apart instead of showing a "waiting…" message that will never resolve. */
  permissionDenied: boolean;
}

interface LiveLocationContextValue extends LiveLocationState {
  setLiveLocation: (next: Partial<LiveLocationState>) => void;
}

const DEFAULT_STATE: LiveLocationState = {
  position: null,
  watching: false,
  consentConfirmed: false,
  clockedIn: false,
  permissionDenied: false,
};

const LiveLocationContext = createContext<LiveLocationContextValue>({
  ...DEFAULT_STATE,
  setLiveLocation: () => {},
});

export function LiveLocationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LiveLocationState>(DEFAULT_STATE);
  // Stable identity (useCallback, no deps) — otherwise a consumer effect
  // that depends on setLiveLocation would re-run every time this provider
  // re-renders, which happens on every call to setLiveLocation itself.
  const setLiveLocation = useCallback((next: Partial<LiveLocationState>) => {
    setState((prev) => ({ ...prev, ...next }));
  }, []);
  return (
    <LiveLocationContext.Provider value={{ ...state, setLiveLocation }}>
      {children}
    </LiveLocationContext.Provider>
  );
}

export function useLiveLocation(): LiveLocationContextValue {
  return useContext(LiveLocationContext);
}
