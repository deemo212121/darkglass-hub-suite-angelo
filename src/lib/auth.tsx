import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { initDatabase } from "./db-api";
import { getFirebaseAnalytics } from "./firebase";
import { initializeUserData } from "./userDataSync";
import { onAuthStateChanged } from "firebase/auth";
import { auth, isFirebaseReady } from "./firebase/config";
import { getUserAccount, updateLastLogin } from "./firebase/users";
import { signIn as firebaseSignIn, signOut as firebaseSignOut } from "./firebase/auth";
import { refreshSupabaseSession, clearSupabaseSession } from "./supabase/client";
import { getProfileForLogin, touchLastLogin } from "./supabase/users";

type AuthState = {
  email: string | null;
  companyId: string | null;
  role: string | null;
  uid: string | null;
  displayName: string | null;
  isActive: boolean;
  // Locations this user may access (from Work Plan). null = no restriction
  // (unrestricted role or no plan set). Empty array = restricted to nothing.
  allowedLocations: string[] | null;
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
  const [role, setRole] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isActive, setIsActive] = useState<boolean>(false);
  const [allowedLocations, setAllowedLocations] = useState<string[] | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);

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
            await refreshSupabaseSession(firebaseUser);
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
                } else {
                  await touchLastLogin(firebaseUser.uid);
                  setUid(firebaseUser.uid);
                  setEmail(sbProfile.email);
                  setCompanyId(sbProfile.companyId);
                  setRole(sbProfile.role);
                  setDisplayName(sbProfile.displayName);
                  setIsActive(sbProfile.isActive);
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
                  setUid(firebaseUser.uid);
                  setEmail(userProfile.email);
                  setCompanyId(userProfile.companyId);
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
            setRole(null);
            setDisplayName(null);
            setIsActive(false);
            setAllowedLocations(null);
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
    try {
      console.log("🔐 Attempting Firebase login for:", email);
      const authUser = await firebaseSignIn(email, password);
      
      console.log("✅ Login successful:", {
        email: authUser.email,
        role: authUser.role,
        companyId: authUser.companyId
      });

      // State will be updated by onAuthStateChanged listener
    } catch (error: any) {
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
    }
  };

  return (
    <AuthContext.Provider value={{ 
      email, 
      companyId, 
      role, 
      uid,
      displayName,
      isActive,
      allowedLocations,
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
