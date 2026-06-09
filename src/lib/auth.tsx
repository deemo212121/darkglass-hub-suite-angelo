import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from "react";
import { initDatabase } from "./db-api";
import { getFirebaseAnalytics } from "./firebase";
import { initializeUserData } from "./userDataSync";

// Map email to role - includes all 10 dummy employees
const EMAIL_TO_ROLE: Record<string, string> = {
  // Admin accounts
  "admin@ahsolutions.com": "admin",
  "superadmin@ahsolutions.com": "superadmin",
  
  // Dummy employee accounts (10 employees)
  "john.richardson@ahsolutions.com": "admin",
  "sarah.mitchell@ahsolutions.com": "manager",
  "michael.chen@ahsolutions.com": "technician",
  "emily.watson@ahsolutions.com": "technician",
  "david.rodriguez@ahsolutions.com": "csr",
  "maria.santos@ahsolutions.com.ph": "finance",
  "juan.delacruz@ahsolutions.com.ph": "technician",
  "anna.reyes@ahsolutions.com.ph": "accounting",
  "carlos.gutierrez@ahsolutions.com.ph": "csr",
  "rosa.morales@ahsolutions.com.ph": "operations",
  
  // Legacy accounts
  "manager@ahsolutions.com": "manager",
  "tech@ahsolutions.com": "technician",
  "viewer@ahsolutions.com": "viewer",
  "finance@ahsolutions.com": "finance",
  "csr@ahsolutions.com": "csr",
  "hr@ahsolutions.com": "hr",
  "parts@ahsolutions.com": "parts",
};

function getRoleFromEmail(email: string | null): string | null {
  if (!email) return null;
  return EMAIL_TO_ROLE[email.toLowerCase()] || null;
}

type AuthState = {
  email: string | null;
  companyId: string | null;
  role: string | null;
  login: (email: string, companyId: string) => void;
  logout: () => void;
  ready: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const isLoggingOut = useRef(false);

  useEffect(() => {
    // Initialize database on app startup (client-side only)
    if (typeof window !== "undefined") {
      initDatabase().then(() => {
        void getFirebaseAnalytics();
        const savedEmail = localStorage.getItem("userEmail");
        const savedCompanyId = localStorage.getItem("userCompanyId");
        setEmail(savedEmail);
        setCompanyId(savedCompanyId);
        
        // Get user role from email mapping
        if (savedEmail) {
          const userRole = getRoleFromEmail(savedEmail);
          setRole(userRole);
          
          // Initialize user-specific data
          initializeUserData(savedEmail);
        }
        
        setReady(true);
      });
    } else {
      setReady(true);
    }
    
    const handler = (e: StorageEvent) => {
      // Skip storage updates during logout to prevent infinite loops
      if (isLoggingOut.current) return;
      
      // Only update state if the key actually changed (prevents infinite loops on logout)
      if (e.key === "userEmail" && e.newValue !== e.oldValue) {
        setEmail(e.newValue);
        setRole(getRoleFromEmail(e.newValue));
      }
      if (e.key === "userCompanyId" && e.newValue !== e.oldValue) {
        setCompanyId(e.newValue);
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const login = (e: string, c: string) => {
    isLoggingOut.current = false;
    localStorage.setItem("userEmail", e);
    localStorage.setItem("userCompanyId", c);
    setEmail(e);
    setCompanyId(c);
    
    // Get user role from email mapping
    const userRole = getRoleFromEmail(e);
    setRole(userRole);
    
    // Initialize user-specific data on login
    initializeUserData(e);
  };
  
  const logout = () => {
    isLoggingOut.current = true;
    localStorage.removeItem("userEmail");
    localStorage.removeItem("userCompanyId");
    setEmail(null);
    setCompanyId(null);
    setRole(null);
  };

  return (
    <AuthContext.Provider value={{ email, companyId, role, login, logout, ready }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
