import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { initDatabase } from "./db-api";
import { getFirebaseAnalytics } from "./firebase";
import { initializeUserData } from "./userDataSync";
import { onAuthStateChanged } from "firebase/auth";
import { auth, isFirebaseReady } from "./firebase/config";
import { getUserAccount, updateLastLogin } from "./firebase/users";
import { signIn as firebaseSignIn, signOut as firebaseSignOut } from "./firebase/auth";

type AuthState = {
  email: string | null;
  companyId: string | null;
  role: string | null;
  uid: string | null;
  displayName: string | null;
  isActive: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  ready: boolean;
  loading: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isActive, setIsActive] = useState<boolean>(false);
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
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
          if (firebaseUser) {
            console.log("✅ Firebase user authenticated:", firebaseUser.email);
            
            try {
              // Get user profile from Firestore
              const userProfile = await getUserAccount(firebaseUser.uid);
              
              if (userProfile) {
                console.log("✅ User profile loaded:", {
                  email: userProfile.email,
                  role: userProfile.role,
                  companyId: userProfile.companyId,
                  isActive: userProfile.isActive
                });

                // Update last login
                await updateLastLogin(firebaseUser.uid);

                // Set auth state
                setUid(firebaseUser.uid);
                setEmail(userProfile.email);
                setCompanyId(userProfile.companyId);
                setRole(userProfile.role);
                setDisplayName(userProfile.displayName);
                setIsActive(userProfile.isActive);

                // Initialize user-specific data
                if (userProfile.email) {
                  initializeUserData(userProfile.email);
                }
              } else {
                console.error("❌ User profile not found in Firestore for UID:", firebaseUser.uid);
                // Sign out if no profile exists
                await firebaseSignOut();
              }
            } catch (error) {
              console.error("❌ Error loading user profile:", error);
              await firebaseSignOut();
            }
          } else {
            console.log("🔓 No Firebase user authenticated");
            // Clear auth state
            setUid(null);
            setEmail(null);
            setCompanyId(null);
            setRole(null);
            setDisplayName(null);
            setIsActive(false);
          }
          
          setReady(true);
          setLoading(false);
        });

        // Cleanup listener on unmount
        return () => {
          console.log("🔒 Cleaning up Firebase Auth listener");
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
