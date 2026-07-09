import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { getUserAccount } from "@/lib/firebase/users";

interface CompanyContextType {
  companyId: string | null;
  isSuperAdmin: boolean;
  loading: boolean;
  companyName: string | null;
}

const CompanyContext = createContext<CompanyContextType>({
  companyId: null,
  isSuperAdmin: false,
  loading: true,
  companyName: null,
});

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { uid, role } = useAuth();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCompanyContext() {
      if (!uid) {
        setCompanyId(null);
        setCompanyName(null);
        setLoading(false);
        return;
      }

      try {
        // SUPERADMIN can see all companies
        if (role?.toUpperCase() === "SUPERADMIN") {
          setCompanyId(null); // null = all companies
          setCompanyName("All Companies");
          setLoading(false);
          return;
        }

        // Get user's company from Firestore
        const user = await getUserAccount(uid);
        if (user) {
          setCompanyId(user.companyId);
          // Optionally fetch company name from companies collection
          setCompanyName(user.companyId);
        }
      } catch (error) {
        console.error("Error loading company context:", error);
      } finally {
        setLoading(false);
      }
    }

    loadCompanyContext();
  }, [uid, role]);

  return (
    <CompanyContext.Provider
      value={{
        companyId,
        isSuperAdmin: role?.toUpperCase() === "SUPERADMIN",
        loading,
        companyName,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

/**
 * Hook to access company context
 * 
 * Returns:
 * - companyId: The user's company ID (null for SUPERADMIN = all companies)
 * - isSuperAdmin: Whether the user is a SUPERADMIN
 * - loading: Whether company context is still loading
 * - companyName: The company name (or "All Companies" for SUPERADMIN)
 */
export function useCompanyContext() {
  const context = useContext(CompanyContext);
  if (!context) {
    throw new Error("useCompanyContext must be used within CompanyProvider");
  }
  return context;
}
