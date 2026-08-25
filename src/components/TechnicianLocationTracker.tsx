/**
 * Background, no-visible-page location tracker — mounted once, globally,
 * in __root.tsx (same "always-mounted, renders null unless it has
 * something to show, unconditional" pattern as SuperSuperAdminGuard).
 *
 * Deliberately independent of both existing clock-in/out UIs
 * (TimeClockMenu.tsx's header widget and MobileTechApp.tsx's own inline
 * button) — rather than hook into either one specifically (and duplicate
 * "am I clocked in" logic in two places), this polls timecard_entries
 * directly via getEntryForDate, so it picks up a clock-in made through
 * either UI.
 *
 * Gated on: (1) the signed-in user actually being a technician (same
 * role check getCompanyTechnicians() uses), (2) having a confirmed
 * Location Consent document on file (hasConfirmedLocationConsent), and
 * (3) currently being clocked in (open timecard_entries row for today).
 * All three together mirror exactly what the signed Location Consent
 * agreement promises — see technicianLocationPings.ts's header and
 * migration 0189 for the database-level enforcement of the same rule.
 *
 * This is a plain web app (no PWA/service worker, no native wrapper), so
 * tracking only works while this tab is open and foregrounded — there is
 * no true background-tracking capability here.
 */
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getEntryForDate } from "@/lib/supabase/timecards";
import { hasConfirmedLocationConsent, upsertMyLocationPing, clearMyLocationPing } from "@/lib/supabase/technicianLocationPings";

const POLL_MS = 60_000;
const UPLOAD_THROTTLE_MS = 60_000;

function todayKey(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

function isTechnicianRole(role: string | null, extraRoles: string[]): boolean {
  const roles = [role, ...extraRoles].map((r) => (r || "").toUpperCase());
  return roles.includes("TECHNICIAN") || roles.includes("TECHNICIAN_MANAGER");
}

export function TechnicianLocationTracker() {
  const { ready, uid, role, extraRoles } = useAuth();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [clockedIn, setClockedIn] = useState(false);
  const [watching, setWatching] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const lastUploadRef = useRef(0);
  const promptHandledThisShiftRef = useRef(false);
  const loadedDateKeyRef = useRef<string>(todayKey());
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  const eligible = ready && !!uid && isTechnicianRole(role, extraRoles);

  // Resolve profile id + consent status once, when eligible.
  useEffect(() => {
    if (!eligible || !uid) return;
    let cancelled = false;
    getMyProfileId(uid).then(async (pid) => {
      if (cancelled || !pid) return;
      setProfileId(pid);
      const confirmed = await hasConfirmedLocationConsent(pid).catch(() => false);
      if (!cancelled) setConsentConfirmed(confirmed);
    });
    return () => {
      cancelled = true;
    };
  }, [eligible, uid]);

  const armed = eligible && !!profileId && consentConfirmed;

  // Poll "am I clocked in today" independently of either clock-in UI —
  // same cadence TimeClockButtons.tsx already uses for its own resync.
  useEffect(() => {
    if (!armed || !profileId) return;
    let cancelled = false;

    const check = () => {
      const dateKey = todayKey();
      loadedDateKeyRef.current = dateKey;
      getEntryForDate(profileId, dateKey)
        .then((entry) => {
          if (cancelled) return;
          setClockedIn(!!entry?.checkIn && !entry?.checkOut);
        })
        .catch((err) => console.error("[TechnicianLocationTracker] getEntryForDate failed:", err));
    };

    check();
    const interval = window.setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [armed, profileId]);

  const stopWatch = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setWatching(false);
  };

  const startWatch = () => {
    if (!navigator.geolocation || watchIdRef.current !== null || !profileId) return;
    setShowPrompt(false);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setWatching(true);
        const now = Date.now();
        if (now - lastUploadRef.current < UPLOAD_THROTTLE_MS) return;
        lastUploadRef.current = now;
        upsertMyLocationPing(
          profileId,
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy ?? null,
          new Date(pos.timestamp).toISOString()
        ).catch((err) => console.error("[TechnicianLocationTracker] upsertMyLocationPing failed:", err));
      },
      (err) => {
        // Permission denied or unavailable — best-effort feature, never
        // blocks clocking in/out either way.
        console.warn("[TechnicianLocationTracker] geolocation error:", err.message);
        if (err.code === err.PERMISSION_DENIED) stopWatch();
      },
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: 20_000 }
    );
  };

  const releaseWakeLock = () => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  };

  const requestWakeLock = () => {
    const wakeLock = (navigator as any).wakeLock;
    if (!wakeLock?.request || wakeLockRef.current) return;
    wakeLock
      .request("screen")
      .then((sentinel: any) => {
        wakeLockRef.current = sentinel;
        sentinel.addEventListener("release", () => {
          wakeLockRef.current = null;
        });
      })
      .catch(() => {
        // Battery Saver, OS-level denial, etc. — best-effort, tracking itself is unaffected.
      });
  };

  // Screen Wake Lock is released by the browser the instant the tab is
  // hidden, so it must be re-requested on every return to foreground —
  // this only keeps the screen from auto-locking while actively watching
  // AND visible; it can't survive the tab actually being backgrounded.
  useEffect(() => {
    if (!watching) {
      releaseWakeLock();
      return;
    }
    requestWakeLock();
    const onVisible = () => {
      if (document.visibilityState === "visible") requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [watching]);

  useEffect(() => () => releaseWakeLock(), []);

  // Start/stop tracking as the clocked-in state itself flips.
  useEffect(() => {
    if (!armed) return;
    if (!clockedIn) {
      promptHandledThisShiftRef.current = false;
      setShowPrompt(false);
      stopWatch();
      if (profileId) clearMyLocationPing(profileId).catch(() => {});
      return;
    }
    if (promptHandledThisShiftRef.current || !navigator.geolocation) return;
    promptHandledThisShiftRef.current = true;

    const permissions = (navigator as any).permissions;
    if (permissions?.query) {
      permissions
        .query({ name: "geolocation" })
        .then((status: PermissionStatus) => {
          if (status.state === "granted") startWatch();
          else if (status.state === "prompt") setShowPrompt(true);
          // "denied" — skip silently, don't nag.
        })
        .catch(() => setShowPrompt(true));
    } else {
      // Permissions API unavailable (some Safari versions) — err toward
      // showing the friendly explanation before the native prompt.
      setShowPrompt(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, clockedIn, profileId]);

  // Stop watching on unmount, whatever state we're in.
  useEffect(() => () => stopWatch(), []);

  if (showPrompt) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-4">
        <div className="panel max-w-sm p-5">
          <h2 className="font-semibold text-sm">Share your location while clocked in?</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            You signed the Employee Mobile App Location Sharing Consent Agreement, which lets AHS see your live location strictly between clock-in and clock-out — for dispatching, routing, and timekeeping. You're never tracked off the clock.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn text-xs px-3 py-1.5" onClick={() => setShowPrompt(false)}>Not now</button>
            <button type="button" className="btn btn-primary text-xs px-3 py-1.5" onClick={startWatch}>Share Location</button>
          </div>
        </div>
      </div>
    );
  }

  if (watching) {
    return (
      <div className="fixed bottom-3 left-3 z-50 flex items-center gap-1.5 rounded-full border border-blue-400/30 bg-blue-500/15 px-2.5 py-1 text-[11px] font-medium text-blue-300 shadow-lg">
        📍 Sharing location
      </div>
    );
  }

  return null;
}
