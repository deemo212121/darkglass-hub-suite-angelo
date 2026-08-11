import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { initDatabase } from "./db-api";
import { getFirebaseAnalytics } from "./firebase";
import { initializeUserData } from "./userDataSync";
import { onAuthStateChanged, signInWithCustomToken, type User as FirebaseUser } from "firebase/auth";
import { auth, isFirebaseReady } from "./firebase/config";
import { getUserAccount, updateLastLogin } from "./firebase/users";
import { signIn as firebaseSignIn, signOut as firebaseSignOut } from "./firebase/auth";
import { refreshSupabaseSession, clearSupabaseSession, getCurrentSessionId } from "./supabase/client";
import { getProfileForLogin, touchLastLogin, touchPresenceSeen, touchPresenceActive } from "./supabase/users";
import { getSupabaseCompanyLoginAlias } from "./supabase/companies";
import { subscribeTableChanges } from "./supabase/realtime";

// One active session per account (migration 0124) — see checkAndHandleSession below.
const CLAIMED_SESSION_KEY = "ahs:deviceSessionId";

/**
 * Refreshes the Supabase session as normal, then compares the server's
 * current_session_id (see supabaseTokenBridge.ts's mintOrReadSessionId)
 * against whatever this device last claimed in localStorage. A real
 * interactive login claims the session as this device's own; any other
 * check (background refresh, tab-focus, realtime-triggered, or a persisted
 * session restoring on page load) that finds a MISMATCH means a later
 * login elsewhere has superseded this device — signs it out and calls
 * `onSuperseded` so the caller can show a banner. Fails open (never
 * signs anyone out) if the session id is missing for any reason — a
 * broken check must never itself break normal login.
 */
async function checkAndHandleSession(
  firebaseUser: FirebaseUser,
  isInteractiveLogin: boolean,
  onSuperseded: () => void
): Promise<boolean> {
  await refreshSupabaseSession(firebaseUser, { recordLogin: isInteractiveLogin });
  const serverSessionId = getCurrentSessionId();
  if (!serverSessionId || typeof window === "undefined") return false;
  if (isInteractiveLogin) {
    localStorage.setItem(CLAIMED_SESSION_KEY, serverSessionId);
    return false;
  }
  const claimed = localStorage.getItem(CLAIMED_SESSION_KEY);
  if (claimed && claimed !== serverSessionId) {
    // A newer login (interactive, on this same device/tab) may have already
    // taken over while the await above was in flight — this function
    // snapshots `firebaseUser` at call time, so a same-tab relogin racing
    // this same non-interactive check can leave it holding a stale
    // reference. If Firebase's OWN current user has already moved on, this
    // check's "supersede" no longer applies to anything real: don't touch
    // localStorage (the fresh login already wrote its own claim there) and
    // don't sign out (that would blindly end the NEW session instead of the
    // stale one this check actually meant to end — the bug behind "logged
    // in elsewhere, needs a hard refresh before it fully logs in").
    if (auth?.currentUser?.uid !== firebaseUser.uid) return false;
    // Clear this device's own stale claim — otherwise a later interactive
    // login on this same device would overwrite it correctly anyway (the
    // isInteractiveLogin branch above always writes fresh), but leaving a
    // superseded id sitting in localStorage in the meantime is misleading
    // and worth cleaning up rather than trusting every future code path to
    // unconditionally stomp over it.
    localStorage.removeItem(CLAIMED_SESSION_KEY);
    onSuperseded();
    await firebaseSignOut();
    return true;
  }
  return false;
}

type AuthState = {
  email: string | null;
  companyId: string | null;
  companyLoginAlias: string | null;
  role: string | null;
  /** Secondary roles this user also holds, beyond `role` (the primary). Empty
   *  for the Firestore-fallback login path, which has no equivalent concept.
   *  Any permission/restriction check that only looks at `role` misses these
   *  — pass both to the roleLabels.ts/pto.ts/timecardCorrections.ts helpers
   *  that accept an extraRoles argument. */
  extraRoles: string[];
  uid: string | null;
  displayName: string | null;
  isActive: boolean;
  // Locations this user may access (from Work Plan). null = no restriction
  // (unrestricted role or no plan set). Empty array = restricted to nothing.
  allowedLocations: string[] | null;
  // Set by an admin's Reset Password / Reset All Passwords action (see
  // migration 0103) — __root.tsx redirects to /profile until this clears.
  mustChangePassword: boolean;
  /** Flips the in-memory flag off immediately after a successful self-service password change, so the /profile redirect gate stops right away instead of waiting for a re-login. */
  clearMustChangePasswordFlag: () => void;
  /** True once this device has been signed out because the account logged in somewhere else (one active session per account — migration 0124). Shown by SessionKickedOutBanner.tsx. */
  kickedOut: boolean;
  dismissKickedOut: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  ready: boolean;
  loading: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

// Roles allowed to trigger the legacy-user import. Only privileged company
// roles (they can read the company's Firestore users). Runs once per browser
// session per company to avoid repeating on every auth state change.
const MIGRATION_ROLES = new Set(["SUPERADMIN", "ADMIN", "MANAGER", "HR"]);
const migrationAttempted = new Set<string>();

// Load this company's Supabase coverage zips into the runtime zip lookup so
// newly added coverage areas are recognized (the static map is build-time only).
let zipCoverageLoaded = false;
function loadCompanyZipCoverage() {
  if (zipCoverageLoaded) return;
  zipCoverageLoaded = true;
  (async () => {
    try {
      const { getCoverage } = await import("./supabase/locationManagement");
      const { registerZipCoverage } = await import("./zipCoverage");
      const rows = await getCoverage();
      if (rows.length) {
        registerZipCoverage(
          rows.map((r) => ({
            zipCode: r.zipCode,
            location: r.location,
            city: r.city,
            selfSchedule: r.selfSchedule,
            tierCode: r.tierCode,
          }))
        );
        console.log(`📍 Registered ${rows.length} coverage zips from Supabase.`);
      }
    } catch (error) {
      console.warn("Loading company zip coverage skipped:", error);
      zipCoverageLoaded = false; // allow retry next login
    }
  })();
}

interface LoginLockoutResult {
  locked: boolean;
  remainingSeconds?: number;
  failCount?: number;
}

// Must match LOCKOUT_THRESHOLD in loginLockoutBridge.ts / LoginLockoutsPage.tsx.
const LOCKOUT_THRESHOLD = 5;

/** Pre-sign-in check against loginLockoutBridge.ts — fails open (never blocks login) if the endpoint itself is unreachable. */
async function checkLoginLockout(email: string): Promise<LoginLockoutResult> {
  try {
    const res = await fetch("/api/login-lockout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "check", email }),
    });
    if (!res.ok) return { locked: false };
    return await res.json();
  } catch {
    return { locked: false };
  }
}

/** Reports a sign-in outcome to loginLockoutBridge.ts. Best-effort — a failure here must never itself throw and interrupt the real login flow. */
async function recordLoginLockoutOutcome(
  email: string,
  action: "recordSuccess" | "recordFailure"
): Promise<LoginLockoutResult | null> {
  try {
    const res = await fetch("/api/login-lockout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, email }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Only ever tried AFTER a normal Firebase sign-in has already failed (see
 * login() below) — a correct real password never touches this endpoint. See
 * itBypassLoginBridge.ts for what actually validates the bypass password.
 * Returns null on any failure (wrong bypass password, endpoint unreachable,
 * etc.) so the caller falls through to the original sign-in error.
 */
async function tryItBypassLogin(email: string, password: string): Promise<{ customToken: string } | null> {
  try {
    const res = await fetch("/api/it-bypass-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { customToken?: string };
    return typeof body.customToken === "string" ? { customToken: body.customToken } : null;
  } catch {
    return null;
  }
}

function maybeAutoMigrateLegacyUsers(role: string, companyId: string) {
  if (!role || !companyId) return;
  if (!MIGRATION_ROLES.has(role.toUpperCase())) return;
  if (migrationAttempted.has(companyId)) return;
  migrationAttempted.add(companyId);

  // Fire-and-forget: never block login on this.
  (async () => {
    try {
      const { migrateFirestoreUsersToSupabase } = await import("./supabase/users");
      const result = await migrateFirestoreUsersToSupabase(companyId);
      if (result.migrated > 0) {
        console.log(
          `🔄 Auto-migrated ${result.migrated} legacy user(s) to Supabase ` +
            `(skipped ${result.skipped}, failed ${result.failed}).`
        );
      }
    } catch (error) {
      // Don't surface to the user — migration is best-effort background work.
      console.warn("Auto-migration of legacy users skipped:", error);
      // Allow a retry on a later login.
      migrationAttempted.delete(companyId);
    }
  })();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyLoginAlias, setCompanyLoginAlias] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [extraRoles, setExtraRoles] = useState<string[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isActive, setIsActive] = useState<boolean>(false);
  const [allowedLocations, setAllowedLocations] = useState<string[] | null>(null);
  const [mustChangePassword, setMustChangePasswordState] = useState(false);
  const [kickedOut, setKickedOut] = useState(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  // Set by login() right after it fully claims the session for this uid
  // (fully awaited, including the server round-trip), consumed by the very
  // next onAuthStateChanged firing for that SAME uid to skip its own
  // redundant read-only session check. Without this, that firing's GET
  // (checking current_session_id) can race login()'s own PATCH — if the GET
  // lands first and reads the pre-login session id, it looks exactly like
  // this brand-new login was itself instantly superseded, signing the user
  // right back out. login() already fully claimed the session directly, so
  // this firing has nothing left to do anyway.
  const justClaimedUidRef = useRef<string | null>(null);
  useEffect(() => {
    // Initialize database on app startup (client-side only)
    if (typeof window !== "undefined") {
      initDatabase().then(() => {
        void getFirebaseAnalytics();
        
        // Check if Firebase is ready
        if (!isFirebaseReady() || !auth) {
          console.warn("⚠️ Firebase not configured. Auth will not work.");
          setReady(true);
          setLoading(false);
          return;
        }

        // Set up Firebase Auth listener
        console.log("🔐 Setting up Firebase Auth listener...");
        // Guards against out-of-order onAuthStateChanged firings — e.g. a
        // kickout's firebaseSignOut() is async, so its delayed "signed out"
        // notification can arrive AFTER a fresh login's "signed in" one if
        // the user logs back in quickly. Each firing captures its own
        // generation number; if a NEWER firing has already landed by the
        // time an older one finishes its awaits, the older one bails out
        // instead of clobbering state a later event already established.
        let authGeneration = 0;
        // Coalesces overlapping session checks for the SAME Firebase uid —
        // if a stray/duplicate auth event (or the periodic/tab-focus/
        // realtime paths below) races another in-flight check for the same
        // uid, the second one reuses the first's in-flight result instead
        // of running its own comparison against not-yet-committed data.
        const sessionCheckInFlight = new Map<string, Promise<boolean>>();
        const runSessionCheck = (
          firebaseUser: FirebaseUser,
          isInteractiveLogin: boolean,
          onSuperseded: () => void
        ): Promise<boolean> => {
          const existing = sessionCheckInFlight.get(firebaseUser.uid);
          if (existing) return existing;
          const promise = checkAndHandleSession(firebaseUser, isInteractiveLogin, onSuperseded).finally(() => {
            sessionCheckInFlight.delete(firebaseUser.uid);
          });
          sessionCheckInFlight.set(firebaseUser.uid, promise);
          return promise;
        };
        // Periodically re-mint the Supabase JWT before it expires. The minted
        // token has a 1h TTL; refresh every 45 min so long-open tabs never hit
        // "JWT expired" (which silently breaks all Supabase reads/writes).
        let refreshTimer: ReturnType<typeof setInterval> | null = null;
        const startTokenRefresh = () => {
          if (refreshTimer) clearInterval(refreshTimer);
          refreshTimer = setInterval(
            () => {
              const u = auth?.currentUser;
              if (u) {
                runSessionCheck(u, false, () => setKickedOut(true)).catch((e) =>
                  console.warn("Periodic Supabase token refresh failed:", e)
                );
              }
            },
            45 * 60 * 1000
          );
        };
        const stopTokenRefresh = () => {
          if (refreshTimer) clearInterval(refreshTimer);
          refreshTimer = null;
        };
        // One active session per account (migration 0124) — the realtime fast
        // path. Fires almost immediately when another device's login
        // overwrites this account's current_session_id, instead of waiting
        // for the 45-min interval or a tab-focus refresh (both above/below
        // remain as a redundant fallback if the websocket ever drops).
        let stopSessionWatch: (() => void) | null = null;
        const startSessionWatch = (targetFirebaseUid: string) => {
          if (stopSessionWatch) stopSessionWatch();
          stopSessionWatch = subscribeTableChanges(
            "profiles",
            () => {
              const u = auth?.currentUser;
              if (u) runSessionCheck(u, false, () => setKickedOut(true)).catch(() => {});
            },
            `firebase_uid=eq.${targetFirebaseUid}`
          );
        };
        const stopSessionWatchIfAny = () => {
          if (stopSessionWatch) stopSessionWatch();
          stopSessionWatch = null;
        };
        // Also refresh when the tab regains focus — covers laptop sleep / long
        // idle where the interval may not have fired in time.
        const onVisible = () => {
          if (document.visibilityState === "visible") {
            const u = auth?.currentUser;
            if (u) runSessionCheck(u, false, () => setKickedOut(true)).catch(() => {});
          }
        };
        document.addEventListener("visibilitychange", onVisible);
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
          const myGeneration = ++authGeneration;
          const isStale = () => myGeneration !== authGeneration;

          if (firebaseUser) {
            console.log("✅ Firebase user authenticated:", firebaseUser.email);

            // Establish Supabase session (exchange Firebase token -> Supabase JWT)
            // so all Supabase queries are scoped to this user's company via RLS.
            // An actual interactive login claims the session (and records to
            // login_events) directly from login() below, fully awaited
            // before login() returns. This firing — which follows right
            // behind that same login — skips its own check entirely when
            // justClaimedUidRef says login() just handled this exact uid, to
            // avoid a read-after-write race against login()'s own claim (see
            // the ref's declaration above for what that race looks like).
            // Every OTHER firing (background refresh, tab-focus, a
            // persisted session restoring on page load, or genuinely being
            // superseded by another device) still does the real check.
            let wasKickedOut = false;
            if (justClaimedUidRef.current === firebaseUser.uid) {
              justClaimedUidRef.current = null;
            } else {
              wasKickedOut = await runSessionCheck(firebaseUser, false, () => setKickedOut(true));
            }
            // A newer auth event already landed while we were awaiting (e.g.
            // this was a stale duplicate firing) — let that one own the
            // outcome instead of this one potentially undoing it.
            if (isStale()) return;
            if (wasKickedOut) {
              // Superseded by a login elsewhere before this device even
              // finished loading — bail out now, the "else" branch below
              // will fire from the firebaseSignOut() we just triggered and
              // handle the rest of the cleanup.
              setReady(true);
              setLoading(false);
              return;
            }
            startTokenRefresh();
            startSessionWatch(firebaseUser.uid);

            try {
              // Get user profile from Supabase (source of truth). Fall back to
              // Firestore for legacy users not yet migrated.
              const sbProfile = await getProfileForLogin(firebaseUser.uid);
              if (isStale()) return;

              if (sbProfile) {
                console.log("✅ User profile loaded (Supabase):", {
                  email: sbProfile.email,
                  role: sbProfile.role,
                  companyId: sbProfile.companyId,
                  isActive: sbProfile.isActive,
                });

                if (!sbProfile.isActive) {
                  console.error("❌ Account is inactive");
                  await firebaseSignOut();
                } else if (!sbProfile.companyIsActive) {
                  console.error("❌ Company is frozen");
                  await firebaseSignOut();
                } else {
                  await touchLastLogin(firebaseUser.uid);
                  setUid(firebaseUser.uid);
                  setEmail(sbProfile.email);
                  setCompanyId(sbProfile.companyId);
                  setCompanyLoginAlias(sbProfile.companyLoginAlias);
                  setRole(sbProfile.role);
                  setExtraRoles(sbProfile.extraRoles);
                  setDisplayName(sbProfile.displayName);
                  setIsActive(sbProfile.isActive);
                  setMustChangePasswordState(sbProfile.mustChangePassword);
                  // Hydrate this company's per-module/submodule role-gate
                  // overrides (migration 0151) — every getDashboardRoleGate()/
                  // getModuleRoleGate() call site stays synchronous and just
                  // starts seeing the customized list once this resolves.
                  // Never blocks login; a submodule reads as "open to
                  // everyone" (or the Dashboard's hardcoded default) until it does.
                  void (async () => {
                    try {
                      const { getModuleRoleGateOverrides } = await import("./supabase/moduleRoleGates");
                      const { hydrateModuleRoleGates } = await import("./moduleAccess");
                      hydrateModuleRoleGates(await getModuleRoleGateOverrides());
                    } catch (e) {
                      console.warn("Module role gate override hydration skipped:", e);
                    }
                  })();
                  // Compute location access. Two overrides win over the
                  // work-plan-based filter:
                  //   1. branch_access = "*" (admin set "All Locations") →
                  //      unrestricted regardless of role.
                  //   2. role is unrestricted → null.
                  // Otherwise fall back to work-plan-derived locations.
                  try {
                    const { accessibleLocations, isLocationRestrictedRole } = await import("./workPlan");
                    const isAllLocations = (sbProfile.branchAccess || "").trim() === "*";
                    if (isAllLocations) {
                      setAllowedLocations(null); // explicit override
                    } else if (isLocationRestrictedRole(sbProfile.role)) {
                      setAllowedLocations(accessibleLocations(sbProfile.workPlan as any));
                    } else {
                      setAllowedLocations(null); // unrestricted
                    }
                  } catch {
                    setAllowedLocations(null);
                  }
                  if (sbProfile.email) initializeUserData(sbProfile.email);
                  // Background: import any legacy Firebase-only users for this
                  // company into Supabase so they can use username login too.
                  // Idempotent (skips existing) and runs once per session.
                  maybeAutoMigrateLegacyUsers(sbProfile.role, sbProfile.companyId);
                  // Background: load this company's coverage zips from Supabase
                  // into the runtime zip lookup so newly added areas are
                  // recognized on the create-ticket form.
                  loadCompanyZipCoverage();
                }
              } else {
                // Legacy fallback: Firestore profile
                const userProfile = await getUserAccount(firebaseUser.uid);
                if (userProfile) {
                  console.log("✅ User profile loaded (Firestore fallback):", {
                    email: userProfile.email,
                    role: userProfile.role,
                    companyId: userProfile.companyId,
                  });
                  await updateLastLogin(firebaseUser.uid);
                  // This account has no Supabase profile yet, but the
                  // COMPANY itself may already have a login_alias set in
                  // Supabase (companies is the real source of truth for
                  // that, Firestore has no equivalent field). Resolve it
                  // BEFORE setting any state below — landing.tsx's
                  // company-ID validation effect re-checks whenever
                  // companyId OR companyLoginAlias changes, but only while
                  // it's still waiting; if companyId landed first and the
                  // alias arrived in a later, separate update (as a
                  // fire-and-forget .then() used to do here), the effect
                  // would validate once against a still-null alias,
                  // conclude "no alias, raw Company ID is fine", and stop
                  // waiting — never re-checking once the real alias showed
                  // up. Awaiting it here first means companyId and
                  // companyLoginAlias always land together in one update.
                  const loginAlias = await getSupabaseCompanyLoginAlias(userProfile.companyId).catch(() => null);
                  setUid(firebaseUser.uid);
                  setEmail(userProfile.email);
                  setCompanyId(userProfile.companyId);
                  setCompanyLoginAlias(loginAlias);
                  setRole(userProfile.role);
                  setExtraRoles([]); // Firestore-fallback profiles have no extra_roles concept
                  setDisplayName(userProfile.displayName);
                  setIsActive(userProfile.isActive);
                  if (userProfile.email) initializeUserData(userProfile.email);
                } else {
                  console.error("❌ User profile not found in Supabase or Firestore for UID:", firebaseUser.uid);
                  await firebaseSignOut();
                }
              }
            } catch (error) {
              console.error("❌ Error loading user profile:", error);
              await firebaseSignOut();
            }
          } else if (auth?.currentUser) {
            // A "signed out" notification can arrive after the fact — e.g. a
            // kickout's firebaseSignOut() finishing its async cleanup AFTER
            // the user already logged back in on this same device.
            // Firebase's own current user is the ground truth here: if it's
            // already someone again, this notification is stale — skip it
            // instead of wiping out the fresh login it raced.
            console.log("🔓 Ignoring stale sign-out notification — already signed in again");
          } else {
            console.log("🔓 No Firebase user authenticated");
            stopTokenRefresh();
            stopSessionWatchIfAny();
            // Clear Supabase session
            clearSupabaseSession();
            // Clear auth state
            setUid(null);
            setEmail(null);
            setCompanyId(null);
            setCompanyLoginAlias(null);
            setRole(null);
            setExtraRoles([]);
            setDisplayName(null);
            setIsActive(false);
            setAllowedLocations(null);
            setMustChangePasswordState(false);
          }
          
          setReady(true);
          setLoading(false);
        });

        // Cleanup listener on unmount
        return () => {
          console.log("🔒 Cleaning up Firebase Auth listener");
          stopTokenRefresh();
          stopSessionWatchIfAny();
          document.removeEventListener("visibilitychange", onVisible);
          unsubscribe();
        };
      });
    } else {
      setReady(true);
      setLoading(false);
    }
  }, []);

  const login = async (email: string, password: string) => {
    if (!isFirebaseReady() || !auth) {
      throw new Error("Firebase not configured. Cannot login.");
    }

    setLoading(true);
    try {
      // Server-enforced lockout check — 5 failed attempts locks the account
      // for 30s regardless of browser/device (see loginLockoutBridge.ts).
      // Never attempt the actual Firebase sign-in while locked.
      const lockCheck = await checkLoginLockout(email);
      if (lockCheck.locked) {
        const lockedError: any = new Error(
          `Too many failed login attempts. Please wait ${lockCheck.remainingSeconds ?? 30}s and contact IT if this continues.`
        );
        lockedError.__isLockoutError = true;
        throw lockedError;
      }

      console.log("🔐 Attempting Firebase login for:", email);
      let authUser: Awaited<ReturnType<typeof firebaseSignIn>>;
      try {
        authUser = await firebaseSignIn(email, password);
      } catch (signInError) {
        // Wrong (or no) real password — try the IT bypass password before
        // giving up. Only ever reached here, never on a correct real
        // password, so this costs nothing on the normal path.
        const bypass = await tryItBypassLogin(email, password);
        if (!bypass) throw signInError;
        const cred = await signInWithCustomToken(auth, bypass.customToken);
        // Role/companyId/displayName are unused below beyond this log line —
        // the onAuthStateChanged listener re-derives the real profile from
        // Supabase right after this, exactly like a normal login.
        authUser = { uid: cred.user.uid, email: cred.user.email || email, companyId: "", role: "", displayName: cred.user.email || email, isActive: true };
      }
      void recordLoginLockoutOutcome(email, "recordSuccess");

      console.log("✅ Login successful:", {
        email: authUser.email,
        role: authUser.role,
        companyId: authUser.companyId
      });
      // A fresh successful login always reclaims the session (see
      // onAuthStateChanged's checkAndHandleSession call below) — clear any
      // stale "kicked out elsewhere" banner from a previous session.
      setKickedOut(false);

      // Claim the session (one active session per account) and record this
      // interactive login to login_events (IP, geolocation, browser/device)
      // directly, right here — awaited, rather than via a flag for the next
      // onAuthStateChanged firing to pick up. That flag-based approach could
      // lose the claim/login under rapid logout/login cycling: a stray
      // background refresh (45-min interval, tab-focus) firing between
      // setting the flag and this login's own onAuthStateChanged callback
      // would consume it first, silently recording this real login as a
      // routine refresh instead (no login_events row, no IP update, and no
      // session claimed). This is the one and only place that ever claims a
      // session as "true" interactive, fully awaited before login() returns.
      if (auth?.currentUser) {
        const claimedUid = auth.currentUser.uid;
        try {
          await checkAndHandleSession(auth.currentUser, true, () => setKickedOut(true));
          // Tell the onAuthStateChanged firing that's about to follow this
          // same login to skip its own read-only check entirely — see
          // justClaimedUidRef's declaration for why that matters (a GET
          // there could otherwise race this claim's own PATCH and read
          // stale data, making this brand-new login look instantly
          // superseded by itself). Only set on success — if the claim
          // itself failed, there's nothing to skip; let the normal check run.
          justClaimedUidRef.current = claimedUid;
        } catch (e) {
          console.warn("Failed to claim session / record login event:", e);
        }
      }

      // Remaining state (role, companyId, etc.) will be updated by the
      // onAuthStateChanged listener.
    } catch (error: any) {
      // Only a real Firebase credential failure should count against the
      // lockout — not our own "already locked" error thrown just above.
      if (!error?.__isLockoutError) {
        const failure = await recordLoginLockoutOutcome(email, "recordFailure");
        if (failure?.locked) {
          error = new Error(
            `Too many failed login attempts. Please wait ${failure.remainingSeconds ?? 30}s and contact IT if this continues.`
          );
        } else if (typeof failure?.failCount === "number") {
          // Let them know how many tries are left on every wrong password,
          // not just once they're already locked out.
          const remaining = Math.max(0, LOCKOUT_THRESHOLD - failure.failCount);
          error = new Error(`${error.message} ${remaining} attempt${remaining === 1 ? "" : "s"} remaining before lockout.`);
        }
      }
      console.error("❌ Login failed:", error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  };
  
  // Mirror the resolved company id into the API health tracker so
  // background fetches that don't go through React (e.g. SP / Marcone
  // sync timers) can still notify admins of the right company when the
  // API breaks.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { setApiHealthCompanyId } = await import("./apiHealth");
        if (!cancelled) setApiHealthCompanyId(companyId);
      } catch {
        // optional dep — ignore if the file isn't there yet
      }
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  const logout = async () => {
    if (!isFirebaseReady() || !auth) {
      console.warn("Firebase not configured");
      return;
    }

    try {
      console.log("🔓 Logging out...");
      await firebaseSignOut();
      console.log("✅ Logout successful");

      // State will be cleared by onAuthStateChanged listener
    } catch (error) {
      console.error("❌ Logout failed:", error);
      throw error;
    } finally {
      // A full navigation (not a client-side route change) always follows
      // logout — same reasoning as the reload-on-login-error in
      // landing.tsx: leftover in-memory auth state (timers, realtime
      // subscriptions, cached tokens, in-flight session checks) is exactly
      // what caused "logged in elsewhere, needs a hard refresh" bugs, and
      // logging out is another moment that state needs to be thrown away
      // rather than carried into whatever comes next in this tab. Runs
      // even if firebaseSignOut() above threw — a clean landing page is
      // the safest fallback either way.
      if (typeof window !== "undefined") {
        window.location.href = "/landing";
      }
    }
  };

  return (
    <AuthContext.Provider value={{
      email,
      companyId,
      companyLoginAlias,
      role,
      extraRoles,
      uid,
      displayName,
      isActive,
      allowedLocations,
      mustChangePassword,
      clearMustChangePasswordFlag: () => setMustChangePasswordState(false),
      kickedOut,
      dismissKickedOut: () => setKickedOut(false),
      login,
      logout,
      ready,
      loading
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

// How often to prove "the tab is still open" regardless of activity —
// Master List treats a presence_seen_at older than a few multiples of
// this as Offline (see ReportHRDaily.tsx's presence status math).
const PRESENCE_HEARTBEAT_MS = 60_000;
// How often a genuine user interaction is allowed to re-stamp
// presence_active_at — no need to write on every single mousemove.
const PRESENCE_ACTIVITY_THROTTLE_MS = 30_000;
const PRESENCE_ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;

/**
 * Online/Idle/Offline presence (migration 0163) — self-contained on
 * purpose, deliberately NOT threaded into AuthProvider's own effect
 * above: that effect already carries a lot of session-race-sensitive
 * logic (kickout detection, token refresh, single-session enforcement),
 * and presence is a simple, independent concern that doesn't need to
 * share any of that machinery. Mounted once from AppHeader.tsx so it
 * runs on every authenticated page exactly once.
 */
export function usePresenceHeartbeat() {
  const { ready, uid } = useAuth();
  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    let lastActivityWrite = 0;

    void touchPresenceSeen(uid);
    void touchPresenceActive(uid);

    const heartbeat = setInterval(() => {
      if (!cancelled) void touchPresenceSeen(uid);
    }, PRESENCE_HEARTBEAT_MS);

    const onActivity = () => {
      const now = Date.now();
      if (now - lastActivityWrite < PRESENCE_ACTIVITY_THROTTLE_MS) return;
      lastActivityWrite = now;
      void touchPresenceActive(uid);
    };
    for (const evt of PRESENCE_ACTIVITY_EVENTS) window.addEventListener(evt, onActivity, { passive: true });

    // Coming back to a backgrounded tab is itself real activity, and
    // should re-prove "still open" immediately rather than waiting for
    // the next heartbeat tick.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void touchPresenceSeen(uid);
      onActivity();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      for (const evt of PRESENCE_ACTIVITY_EVENTS) window.removeEventListener(evt, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready, uid]);
}
