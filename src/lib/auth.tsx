import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { initDatabase } from "./db-api";
import { getFirebaseAnalytics } from "./firebase";

type AuthState = {
  email: string | null;
  companyId: string | null;
  login: (email: string, companyId: string) => void;
  logout: () => void;
  ready: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Initialize database on app startup (client-side only)
    if (typeof window !== "undefined") {
      initDatabase().then(() => {
        void getFirebaseAnalytics();
        setEmail(localStorage.getItem("userEmail"));
        setCompanyId(localStorage.getItem("userCompanyId"));
        setReady(true);
      });
    } else {
      setReady(true);
    }
    
    const handler = (e: StorageEvent) => {
      if (e.key === "userEmail") setEmail(e.newValue);
      if (e.key === "userCompanyId") setCompanyId(e.newValue);
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const login = (e: string, c: string) => {
    localStorage.setItem("userEmail", e);
    localStorage.setItem("userCompanyId", c);
    setEmail(e);
    setCompanyId(c);
  };
  const logout = () => {
    localStorage.removeItem("userEmail");
    localStorage.removeItem("userCompanyId");
    setEmail(null);
    setCompanyId(null);
  };

  return (
    <AuthContext.Provider value={{ email, companyId, login, logout, ready }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
