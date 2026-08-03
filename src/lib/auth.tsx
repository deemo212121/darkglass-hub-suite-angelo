import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { initDatabase } from "./db-api";
import { getFirebaseAnalytics } from "./firebase";
import { initializeUserData } from "./userDataSync";
import { onAuthStateChanged } from "firebase/auth";
import { auth, isFirebaseReady } from "./firebase/config";
import { getUserAccount, updateLastLogin } from "./firebase/users";
import { signIn as firebaseSignIn, signOut as firebaseSignOut } from "./firebase/auth";
import { refreshSupabaseSession, clearSupabaseSession } from "./supabase/client";
import { getProfileForLogin, touchLastLogin } from "./supabase/users";
import { getSupabaseCompanyLoginAlias } from "./supabase/companies";

type AuthState = {
  email: string | null;
  companyId: string | null;
  companyLoginAlias: string | null;
  role: string | null;
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
  const [uid, setUid] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isActive, setIsActive] = useState<boolean>(false);
  const [allowedLocations, setAllowedLocations] = useState<string[] | null>(null);
  const [mustChangePassword, setMustChangePasswordState] = useState(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  // Set by login() right before signing in, consumed by the very next
  // onAuthStateChanged firing — so only that one Supabase-token exchange
  // (the actual login page submit) gets recorded to login_events, not the
  // 45-min background refresh, the tab-focus refresh, or the initial
  // onAuthStateChanged firing from an already-persisted Firebase session on
  // page load (none of those are "at the login page").
  const pendingInteractiveLoginRef = useRef(false);

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
                refreshSupabaseSession(u).catch((e) =>
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
        // Also refresh when the tab regains focus — covers laptop sleep / long
        // idle where the interval may not have fired in time.
        const onVisible = () => {
          if (document.visibilityState === "visible") {
            const u = auth?.currentUser;
            if (u) refreshSupabaseSession(u).catch(() => {});
          }
        };
        document.addEventListener("visibilitychange", onVisible);
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
          if (firebaseUser) {
            console.log("✅ Firebase user authenticated:", firebaseUser.email);

            // Establish Supabase session (exchange Firebase token -> Supabase JWT)
            // so all Supabase queries are scoped to this user's company via RLS.
            const isInteractiveLogin = pendingInteractiveLoginRef.current;
            pendingInteractiveLoginRef.current = false;
            await refreshSupabaseSession(firebaseUser, { recordLogin: isInteractiveLogin });
            startTokenRefresh();
            
            try {
              // Get user profile from Supabase (source of truth). Fall back to
              // Firestore for legacy users not yet migrated.
              const sbProfile = await getProfileForLogin(firebaseUser.uid);

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
                  setDisplayName(sbProfile.displayName);
                  setIsActive(sbProfile.isActive);
                  setMustChangePasswordState(sbProfile.mustChangePassword);
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
          } else {
            console.log("🔓 No Firebase user authenticated");
            stopTokenRefresh();
            // Clear Supabase session
            clearSupabaseSession();
            // Clear auth state
            setUid(null);
            setEmail(null);
            setCompanyId(null);
            setCompanyLoginAlias(null);
            setRole(null);
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
    pendingInteractiveLoginRef.current = true;
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
      const authUser = await firebaseSignIn(email, password);
      void recordLoginLockoutOutcome(email, "recordSuccess");

      console.log("✅ Login successful:", {
        email: authUser.email,
        role: authUser.role,
        companyId: authUser.companyId
      });

      // State will be updated by onAuthStateChanged listener
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
      // Sign-in never went through, so onAuthStateChanged won't fire to
      // consume this — clear it now or it'd wrongly tag some later,
      // unrelated auth event (e.g. a background token refresh) as an
      // interactive login.
      pendingInteractiveLoginRef.current = false;
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
    }
  };

  return (
    <AuthContext.Provider value={{
      email,
      companyId,
      companyLoginAlias,
      role,
      uid,
      displayName,
      isActive,
      allowedLocations,
      mustChangePassword,
      clearMustChangePasswordFlag: () => setMustChangePasswordState(false),
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
