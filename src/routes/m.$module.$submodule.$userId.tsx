import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { getModule, getSubModule } from "@/lib/modules";
import { getUserManagementRecord } from "@/lib/user-management";
import { LOCATIONS } from "@/lib/locations";
import { getUserByUsername, getCompanyUsers, type UserAccount } from "@/lib/firebase/users";
import { useAuth } from "@/lib/auth";

const TABS = [
  "General Information",
  "Branch Access",
  "Billing Information",
  "Account Information",
  "Vehicle Information",
  "Employee Information",
] as const;

const BRANCH_COLUMNS = ["Weekday", "Weekend", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const DAY_SCHEDULE_OPTIONS = ["AM + PM", "AM only", "PM only"] as const;
const QUARTER_MS = 90 * 24 * 60 * 60 * 1000;
const DAY_COLUMN_ACCESS: Record<string, "weekday" | "weekend"> = {
  Sunday: "weekend",
  Monday: "weekday",
  Tuesday: "weekday",
  Wednesday: "weekday",
  Thursday: "weekday",
  Friday: "weekday",
  Saturday: "weekend",
};
type BranchSettingRow = ReturnType<typeof defaultBranchSettings>;

function normalizeBranches(value: string) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function hashString(value: string) {
  return Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function buildDob(recordId: string) {
  const seed = hashString(recordId);
  const year = 1975 + (seed % 22);
  const month = String((seed % 12) + 1).padStart(2, "0");
  const day = String((seed % 28) + 1).padStart(2, "0");
  return `${month}/${day}/${year}`;
}

function buildHomeAddress(userName: string, office: string) {
  const seed = hashString(`${userName}${office}`);
  const streetNo = 100 + (seed % 800);
  const streets = ["Oak", "Maple", "Cedar", "Pine", "Hillcrest", "Sunset", "River", "Main"];
  const cities = [office, "Memphis", "Nashville", "Birmingham", "Atlanta"];
  const states = ["TN", "AL", "GA", "MS", "LA", "NC", "SC"];
  return `${streetNo} ${streets[seed % streets.length]} St, ${cities[seed % cities.length]}, ${states[seed % states.length]} 0000${seed % 9}`;
}

function buildEmergencyContacts(userName: string) {
  const seed = hashString(userName);
  const contacts = ["Spouse", "Parent", "Sibling", "Friend"];
  return [
    {
      name: `${userName.split(" ")[0] || "Primary"} Contact`,
      relationship: contacts[seed % contacts.length],
      phone: `555-${String(200 + (seed % 700)).padStart(3, "0")}-${String(1000 + (seed % 9000)).slice(-4)}`,
    },
    {
      name: `${userName.split(" ")[0] || "Secondary"} Backup`,
      relationship: contacts[(seed + 1) % contacts.length],
      phone: `555-${String(300 + ((seed + 17) % 600)).padStart(3, "0")}-${String(2000 + ((seed + 17) % 7000)).slice(-4)}`,
    },
  ];
}

function getBranchAccess(user: { type: string; office: string; locations: string }) {
  const type = user.type.toLowerCase();
  if (type.includes("admin") || type === "hr" || type === "manager" || type === "claim manager" || type === "part manager" || type.includes("super admin")) {
    return [...LOCATIONS];
  }
  if (type.includes("tech manager")) {
    const locations = normalizeBranches(user.locations);
    return locations.length ? locations : [user.office].filter(Boolean);
  }
  if (type.includes("technician")) {
    return [user.office].filter(Boolean);
  }
  const locations = normalizeBranches(user.locations);
  return locations.length ? locations : [user.office].filter(Boolean);
}

function getBranchAccessReason(userType: string) {
  const type = userType.toLowerCase();
  if (type.includes("admin") || type === "hr" || type === "manager" || type.includes("super admin")) return "Full branch access";
  if (type === "part manager") return "Part team leaders can see all branches";
  if (type.includes("tech manager")) return "Branch access is limited to assigned branches";
  if (type.includes("technician")) return "Branch access is limited to the assigned branch";
  return "Branch access follows the assigned locations";
}

function defaultBranchSettings(location: string, hasAccess: boolean) {
  return {
    weekday: hasAccess,
    weekend: hasAccess,
    sunday: hasAccess ? "AM + PM" : "AM only",
    monday: hasAccess ? "AM + PM" : "AM only",
    tuesday: hasAccess ? "AM + PM" : "AM only",
    wednesday: hasAccess ? "AM + PM" : "AM only",
    thursday: hasAccess ? "AM + PM" : "AM only",
    friday: hasAccess ? "AM + PM" : "AM only",
    saturday: hasAccess ? "AM + PM" : "AM only",
  };
}

function buildBranchSettings(branchAccess: string[]) {
  return Object.fromEntries(
    LOCATIONS.map((location) => [location, defaultBranchSettings(location, branchAccess.includes(location))]),
  ) as Record<string, BranchSettingRow>;
}

function loadBranchSettings(userId: string, branchAccess: string[]) {
  const defaults = buildBranchSettings(branchAccess);
  if (typeof window === "undefined") return defaults;

  const raw = window.localStorage.getItem(`ahs:branch-access:${userId}`);
  if (!raw) return defaults;

  try {
    const parsed = JSON.parse(raw) as Partial<Record<string, Partial<BranchSettingRow>>>;
    return Object.fromEntries(
      LOCATIONS.map((location) => {
        const fallback = defaults[location];
        const row = parsed[location];
        return [location, {
          weekday: typeof row?.weekday === "boolean" ? row.weekday : fallback.weekday,
          weekend: typeof row?.weekend === "boolean" ? row.weekend : fallback.weekend,
          sunday: typeof row?.sunday === "string" ? row.sunday : fallback.sunday,
          monday: typeof row?.monday === "string" ? row.monday : fallback.monday,
          tuesday: typeof row?.tuesday === "string" ? row.tuesday : fallback.tuesday,
          wednesday: typeof row?.wednesday === "string" ? row.wednesday : fallback.wednesday,
          thursday: typeof row?.thursday === "string" ? row.thursday : fallback.thursday,
          friday: typeof row?.friday === "string" ? row.friday : fallback.friday,
          saturday: typeof row?.saturday === "string" ? row.saturday : fallback.saturday,
        }];
      }),
    ) as Record<string, BranchSettingRow>;
  } catch {
    return defaults;
  }
}

function loadAssignedOffice(userId: string, fallbackOffice: string) {
  if (typeof window === "undefined") return fallbackOffice;
  return window.localStorage.getItem(`ahs:assigned-office:${userId}`) || fallbackOffice;
}

type EmployeeInfoState = {
  bankName: string;
  routingNumber: string;
  accountNumber: string;
  photoName: string;
  photoDataUrl: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zipCode: string;
  employeeId: string;
  employeeSsn: string;
  employeeSalary: string;
  birthDate: string;
  hireDate: string;
  terminateDate: string;
  employeeNote: string;
  attachments: string[];
};

type AccountInfoRow = {
  id: string;
  account: string;
  technicianId: string;
  technicianName: string;
  groupKey: string;
  techKey: string;
};

function formatTechnicianName(value: string) {
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 1].toUpperCase()},${parts[0].toUpperCase()}`;
  }
  return value.toUpperCase();
}

function buildAccountInfoDefaults(user: { id: string; userName: string }) {
  return [
    {
      id: "account-row-1",
      account: "SB",
      technicianId: user.id,
      technicianName: `${user.id} - ${formatTechnicianName(user.userName)}`,
      groupKey: "",
      techKey: "",
    },
    {
      id: "account-row-2",
      account: "SP",
      technicianId: "1290884",
      technicianName: "",
      groupKey: "GE_Memphis",
      techKey: "",
    },
  ] satisfies AccountInfoRow[];
}

function loadAccountInfo(user: { id: string; userName: string }) {
  const defaults = buildAccountInfoDefaults(user);
  if (typeof window === "undefined") return defaults;
  const raw = window.localStorage.getItem(`ahs:account-info:${user.id}`);
  if (!raw) return defaults;

  try {
    const parsed = JSON.parse(raw) as Partial<{ rows: AccountInfoRow[] }>;
    if (!Array.isArray(parsed.rows)) return defaults;
    return parsed.rows
      .filter((row): row is AccountInfoRow => Boolean(row && row.id))
      .map((row, index) => ({
        id: row.id || `account-row-${index + 1}`,
        account: row.account || "SB",
        technicianId: row.technicianId || "",
        technicianName: row.technicianName || "",
        groupKey: row.groupKey || "",
        techKey: row.techKey || "",
      }));
  } catch {
    return defaults;
  }
}

function saveAccountInfo(userId: string, rows: AccountInfoRow[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`ahs:account-info:${userId}`, JSON.stringify({ rows }));
}

function buildEmployeeInfoDefaults(user: { id: string; userName: string; office: string; email?: string | null }) {
  const seed = hashString(`${user.id}${user.userName}${user.office}`);
  const bankNames = ["First National Bank", "Community Trust", "Pioneer Federal", "Summit Bank"];
  const streetNames = ["Oak", "Maple", "Cedar", "Pine", "Hillcrest", "Sunset"];
  const cityNames = [user.office, "Memphis", "Nashville", "Birmingham", "Atlanta"];
  const stateCodes = ["TN", "AL", "GA", "MS", "NC", "SC"];
  return {
    bankName: bankNames[seed % bankNames.length],
    routingNumber: String(100000000 + (seed % 900000000)),
    accountNumber: String(10000000 + (seed % 90000000)),
    photoName: "",
    photoDataUrl: "",
    address1: `${100 + (seed % 800)} ${streetNames[seed % streetNames.length]} St`,
    address2: "",
    city: cityNames[seed % cityNames.length],
    state: stateCodes[seed % stateCodes.length],
    zipCode: String(10000 + (seed % 89999)),
    employeeId: user.id,
    employeeSsn: `${String(100 + (seed % 900))}-${String(10 + (seed % 90))}-${String(1000 + (seed % 9000))}`,
    employeeSalary: String(45000 + (seed % 40000)),
    birthDate: buildDob(user.id),
    hireDate: `01/${String((seed % 28) + 1).padStart(2, "0")}/2022`,
    terminateDate: "",
    employeeNote: "",
    attachments: [] as string[],
  } satisfies EmployeeInfoState;
}

function loadEmployeeInfo(user: { id: string; userName: string; office: string; email?: string | null }) {
  const defaults = buildEmployeeInfoDefaults(user);
  if (typeof window === "undefined") return defaults;
  const keys = [
    `ahs:employee-info:${user.id}`,
    user.email ? `ahs:employee-info-email:${user.email.trim().toLowerCase()}` : "",
  ].filter(Boolean) as string[];

  const raw = keys.map((key) => window.localStorage.getItem(key)).find(Boolean);
  if (!raw) return defaults;

  try {
    const parsed = JSON.parse(raw) as Partial<EmployeeInfoState>;
    return {
      ...defaults,
      ...parsed,
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments.filter((attachment) => typeof attachment === "string") : defaults.attachments,
    } satisfies EmployeeInfoState;
  } catch {
    return defaults;
  }
}

function formatEmployeeAddress(employeeInfo: EmployeeInfoState) {
  const firstLine = [employeeInfo.address1, employeeInfo.address2].filter(Boolean).join(" ");
  const secondLine = [employeeInfo.city, employeeInfo.state, employeeInfo.zipCode].filter(Boolean).join(" ");
  return [firstLine, secondLine].filter(Boolean).join(", ");
}

function saveEmployeeInfoToStorage(userId: string, email: string | undefined | null, employeeInfo: EmployeeInfoState) {
  if (typeof window === "undefined") return;
  const serialized = JSON.stringify(employeeInfo);
  window.localStorage.setItem(`ahs:employee-info:${userId}`, serialized);
  if (email) {
    window.localStorage.setItem(`ahs:employee-info-email:${email.trim().toLowerCase()}`, serialized);
  }
}

export const Route = createFileRoute("/m/$module/$submodule/$userId")({
  ssr: false,
  loader: async ({ params }) => {
    const module = getModule(params.module);
    const submodule = getSubModule(params.module, params.submodule);
    
    if (!module || !submodule || module.slug !== "admin" || submodule.slug !== "user-management") {
      throw notFound();
    }

    return { module, submodule, userId: params.userId };
  },
  component: UserDetailsPageTemp,
});

// Temporary simplified component while we migrate to Firebase
function UserDetailsPageTemp() {
  const { module, submodule, userId } = Route.useLoaderData();
  
  return (
    <>
      <AppHeader />
      <main className="flex-1 bg-slate-950 py-6">
        <div className="max-w-6xl mx-auto px-6">
          <div className="rounded-xl border border-white/15 bg-white/8 p-6 text-white backdrop-blur-md">
            <h1 className="text-2xl font-bold mb-4">User Details: {userId}</h1>
            <p className="text-slate-300 mb-6">
              User detail page is being migrated to Firebase and will be available soon.
            </p>
            <Link 
              to="/m/$module/$submodule" 
              params={{ module: module.slug, submodule: submodule.slug }} 
              className="btn btn-primary"
            >
              ← Back to User Management
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

// Original complex component - commented out for now
/*
function UserDetailsPage() {
  const { module, submodule, userId } = Route.useLoaderData();
  const auth = useAuth();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("General Information");
  const [showInfoCheck, setShowInfoCheck] = useState(false);
  
  // Initialize all hooks with default/empty values (these must always be called)
  const [savedAssignedOffice, setSavedAssignedOffice] = useState("");
  const [assignedOffice, setAssignedOffice] = useState("");
  const [savedBranchSettings, setSavedBranchSettings] = useState<Record<string, BranchSettingRow>>({});
  const [branchSettings, setBranchSettings] = useState<Record<string, BranchSettingRow>>({});
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [savedEmployeeInfo, setSavedEmployeeInfo] = useState<EmployeeInfoState | null>(null);
  const [employeeInfo, setEmployeeInfo] = useState<EmployeeInfoState | null>(null);
  const [showEmployeeSavePrompt, setShowEmployeeSavePrompt] = useState(false);
  const [savedAccountRows, setSavedAccountRows] = useState<AccountInfoRow[]>([]);
  const [accountRows, setAccountRows] = useState<AccountInfoRow[]>([]);
  const [showAccountSavePrompt, setShowAccountSavePrompt] = useState(false);
  
  // Load user from Firebase
  useEffect(() => {
    const loadUser = async () => {
      if (!auth.companyId) {
        setLoading(false);
        return;
      }
      
      try {
        // Get all company users and find the one matching the userId (username)
        const companyUsers = await getCompanyUsers(auth.companyId);
        const firebaseUser = companyUsers.find(
          (u) => u.username === userId || u.email.split('@')[0] === userId
        );
        
        if (!firebaseUser) {
          console.error("User not found:", userId);
          setLoading(false);
          return;
        }
        
        // Map to the format expected by the page
        const mappedUser = {
          id: firebaseUser.uid,
          loginName: firebaseUser.username || firebaseUser.email.split('@')[0],
          userName: firebaseUser.displayName,
          type: firebaseUser.role,
          email: firebaseUser.email,
          manager: "", // TODO: Add when available
          technicianId: "", // Separate from employeeId
          office: "Memphis", // TODO: Add when available, default for now
          locations: "", // TODO: Add when available
        };
        
        setUser(mappedUser);
        
        // Initialize user-specific state after user is loaded
        const office = mappedUser.office || "Memphis";
        setSavedAssignedOffice(loadAssignedOffice(mappedUser.id, office));
        setAssignedOffice(loadAssignedOffice(mappedUser.id, office));
        
        const access = getBranchAccess({ type: mappedUser.type, office, locations: mappedUser.locations });
        setSavedBranchSettings(loadBranchSettings(mappedUser.id, access));
        setBranchSettings(loadBranchSettings(mappedUser.id, access));
        
        setSavedEmployeeInfo(loadEmployeeInfo({ id: mappedUser.id, userName: mappedUser.userName, office, email: mappedUser.email }));
        setEmployeeInfo(loadEmployeeInfo({ id: mappedUser.id, userName: mappedUser.userName, office, email: mappedUser.email }));
        
        setSavedAccountRows(loadAccountInfo({ id: mappedUser.id, userName: mappedUser.userName }));
        setAccountRows(loadAccountInfo({ id: mappedUser.id, userName: mappedUser.userName }));
      } catch (error) {
        console.error("Error loading user:", error);
      } finally {
        setLoading(false);
      }
    };
    
    loadUser();
  }, [userId, auth.companyId]);
  
  // ALL useMemo hooks must be called before any conditional returns
  const poInitial = user ? user.userName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") : "";
  const isTechnicianRole = user ? /tech|technician/i.test(user.type) : false;
  const managerRecord = user?.manager ? getUserManagementRecord(user.manager) : undefined;
  const effectiveOffice = assignedOffice || user?.office || "";
  const branchAccess = useMemo(() => {
    if (!user) return [];
    return getBranchAccess({ type: user.type, office: effectiveOffice, locations: user.locations });
  }, [user, effectiveOffice]);
  
  const visibleBranches = useMemo(() => {
    return LOCATIONS.filter((location) => {
      const row = branchSettings[location];
      if (!row) return branchAccess.includes(location);
      return row.weekday || row.weekend;
    });
  }, [branchAccess, branchSettings]);
  
  const hasUnsavedBranchChanges = useMemo(() => {
    const officeChanged = assignedOffice !== savedAssignedOffice;
    const branchChanged = LOCATIONS.some((location) => {
      const current = branchSettings[location];
      const saved = savedBranchSettings[location];
      if (!current || !saved) return false;
      return JSON.stringify(current) !== JSON.stringify(saved);
    });
    return officeChanged || branchChanged;
  }, [assignedOffice, branchSettings, savedAssignedOffice, savedBranchSettings]);
  
  const hasUnsavedEmployeeChanges = useMemo(() => JSON.stringify(employeeInfo) !== JSON.stringify(savedEmployeeInfo), [employeeInfo, savedEmployeeInfo]);
  const hasUnsavedAccountChanges = useMemo(() => JSON.stringify(accountRows) !== JSON.stringify(savedAccountRows), [accountRows, savedAccountRows]);
  const employeeDetails = useMemo(() => {
    if (!user) return { dob: "", homeAddress: "", emergencyContacts: [], quarterlyReviewDue: "" };
    return {
      dob: employeeInfo?.birthDate || buildDob(user.id),
      homeAddress: employeeInfo ? formatEmployeeAddress(employeeInfo) : buildHomeAddress(user.userName, effectiveOffice),
      emergencyContacts: buildEmergencyContacts(user.userName),
      quarterlyReviewDue: new Date(Date.now() + QUARTER_MS).toLocaleDateString(),
    };
  }, [employeeInfo, user, effectiveOffice]);
  
  // NOW we can have conditional rendering (but not returns, use JSX conditionals)
  if (loading) {
    return (
      <>
        <AppHeader />
        <main className="flex-1 bg-slate-950 py-6">
          <div className="max-w-6xl mx-auto px-6">
            <div className="rounded-xl border border-white/15 bg-white/8 p-10 text-center text-white backdrop-blur-md">
              <div className="text-xl">Loading user details...</div>
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }
  
  if (!user) {
    return (
      <>
        <AppHeader />
        <main className="flex-1 bg-slate-950 py-6">
          <div className="max-w-6xl mx-auto px-6">
            <div className="rounded-xl border border-white/15 bg-white/8 p-10 text-center text-white backdrop-blur-md">
              <div className="text-xl mb-4">User not found</div>
              <Link to="/m/$module/$submodule" params={{ module: module.slug, submodule: submodule.slug }} className="btn btn-primary">
                Back to User Management
              </Link>
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const handleSaveBranchAccess = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`ahs:assigned-office:${user.id}`, assignedOffice);
      window.localStorage.setItem(`ahs:branch-access:${user.id}`, JSON.stringify(branchSettings));
    }
    setSavedAssignedOffice(assignedOffice);
    setSavedBranchSettings(branchSettings);
    setShowSavePrompt(false);
  };

  const requestSaveBranchAccess = () => {
    if (!hasUnsavedBranchChanges) return;
    setShowSavePrompt(true);
  };

  const handleSaveEmployeeInfo = () => {
    saveEmployeeInfoToStorage(user.id, user.email, employeeInfo);
    setSavedEmployeeInfo(employeeInfo);
    setShowEmployeeSavePrompt(false);
  };

  const requestSaveEmployeeInfo = () => {
    if (!hasUnsavedEmployeeChanges) return;
    setShowEmployeeSavePrompt(true);
  };

  const handleSaveAccountInfo = () => {
    saveAccountInfo(user.id, accountRows);
    setSavedAccountRows(accountRows);
    setShowAccountSavePrompt(false);
  };

  const requestSaveAccountInfo = () => {
    if (!hasUnsavedAccountChanges) return;
    setShowAccountSavePrompt(true);
  };

  const addAccountRow = () => {
    setAccountRows((current) => [
      ...current,
      {
        id: `account-row-${Date.now()}`,
        account: "SB",
        technicianId: "",
        technicianName: "",
        groupKey: "",
        techKey: "",
      },
    ]);
  };

  const deleteAccountRow = (rowId: string) => {
    setAccountRows((current) => current.filter((row) => row.id !== rowId));
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `ahs:employee-check:${user.id}`;
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      setShowInfoCheck(true);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { lastConfirmed?: string };
      const lastConfirmed = parsed.lastConfirmed ? new Date(parsed.lastConfirmed) : null;
      if (!lastConfirmed || Number.isNaN(lastConfirmed.getTime()) || Date.now() - lastConfirmed.getTime() >= QUARTER_MS) {
        setShowInfoCheck(true);
      }
    } catch {
      setShowInfoCheck(true);
    }
  }, [user.id]);

  const confirmInfoStillCurrent = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`ahs:employee-check:${user.id}`, JSON.stringify({ lastConfirmed: new Date().toISOString() }));
    }
    setShowInfoCheck(false);
  };

  return (
    <>
      <AppHeader />
      <main className="flex-1 bg-slate-950 py-6">
        <div className="max-w-6xl mx-auto px-6">
          <div className="rounded-xl border border-white/15 bg-white/8 p-5 text-white backdrop-blur-md">
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{module.label} / {submodule.title}</div>
                <h1 className="mt-1 text-3xl font-bold tracking-tight">{user.userName}</h1>
                <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-300">
                  <span className="rounded-full border border-white/10 bg-slate-900/80 px-3 py-1">{user.loginName}</span>
                  <span className="rounded-full border border-white/10 bg-slate-900/80 px-3 py-1">{user.type}</span>
                  <span className="rounded-full border border-white/10 bg-slate-900/80 px-3 py-1">Assigned Branch: {effectiveOffice}</span>
                </div>
              </div>
              <Link to="/m/$module/$submodule" params={{ module: module.slug, submodule: submodule.slug }} className="btn btn-primary">Back to list</Link>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2.5">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all ${activeTab === tab ? "border-blue-400/60 bg-blue-500/25 text-white" : "border-white/20 bg-slate-900/90 text-slate-300 hover:border-slate-200/30 hover:text-white"}`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="mt-5 rounded-xl border border-white/15 bg-white/8 p-5 text-white backdrop-blur-md">
            {activeTab === "General Information" && (
              <div className="space-y-5">
                <section className="rounded-lg border border-white/10 bg-slate-900/40 p-4">
                  <div className="mb-4 text-lg font-semibold text-blue-200">General Information</div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <InfoCard label="User ID" value={user.id} />
                    <InfoCard label="Status" value="Active" />
                    <InfoCard label="Login ID" value={user.loginName} />
                    <InfoCard label="User Type" value={user.type} />
                    <InfoCard label="User Name" value={user.userName} />
                    <InfoCard label="PO # Initial" value={poInitial || "—"} note="(This value will be used as a part of PO #)" />
                    <InfoCard label="Work Phone #" value="(phone #) / (extension)" />
                    <InfoCard
                      label="Password"
                      value={
                        <div className="space-y-1 text-slate-300 font-normal">
                          <div>minimum of 8 characters.</div>
                          <div>lowercase letters.</div>
                          <div>at least one uppercase letter.</div>
                          <div>at least one number.</div>
                          <div>not include your name, phone #, ID</div>
                        </div>
                      }
                    />
                    <InfoCard
                      label="Direct Manager (In case Tech, this is mandatory)"
                      value={
                        user.manager ? (
                          <Link
                            to="/m/$module/$submodule/$userId"
                            params={{ module: module.slug, submodule: submodule.slug, userId: managerRecord?.loginName ?? user.manager }}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-blue-300 hover:text-blue-200 hover:underline"
                          >
                            {user.manager}
                          </Link>
                        ) : (
                          "—"
                        )
                      }
                    />
                    <InfoCard label="Email" value={user.email || "—"} />
                    <InfoCard
                      label="Assigned Branch"
                      value={
                        <select
                          value={assignedOffice}
                          onChange={(event) => setAssignedOffice(event.target.value)}
                          aria-label="Assigned branch"
                          title="Assigned branch"
                          className="glass-input w-full text-sm"
                        >
                          {LOCATIONS.map((location) => (
                            <option key={`select-${location}`} value={location}>{location}</option>
                          ))}
                        </select>
                      }
                      note="Office location is the assigned branch."
                    />
                    <InfoCard label="Location for Email Report" value={user.locations} />
                    <InfoCard label="SMS Available" value="Yes" />
                    <InfoCard label="Chat available" value="Yes" />
                    <InfoCard label="Time Off Schedule" value="Sun Mon Tue Wed Thu Fri Sat" />
                    <InfoCard label="Zebra Printer Name" value="—" />
                    <InfoCard label="MFA - One-Time Password" value="Enabled" />
                  </div>
                </section>

                <section className="rounded-lg border border-white/10 bg-slate-900/40 p-4">
                  <div className="mb-4 text-lg font-semibold text-blue-200">Technician Information</div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <InfoCard label="Running Call" value={isTechnicianRole ? "Yes" : "No"} />
                    <InfoCard label="Technician ID" value={user.technicianId || "—"} />
                    <InfoCard label="Capacity AM" value={isTechnicianRole ? "4" : "—"} />
                    <InfoCard label="Capacity PM" value={isTechnicianRole ? "4" : "—"} />
                    <InfoCard label="Daily Route Start" value="Office" />
                    <InfoCard label="Daily Route End" value="Office" />
                    <InfoCard label="Office" value={effectiveOffice} />
                    <InfoCard label="Commission Rate" value={isTechnicianRole ? "0 %" : "—"} />
                    <InfoCard label="Tech. Payroll Tier" value={isTechnicianRole ? "Tier 1" : "—"} />
                    <InfoCard label="Technician Color" value={isTechnicianRole ? "Blue" : "—"} />
                    <InfoCard label="Product Type Permissions1" value="(blank permission means all permission)" />
                    <InfoCard label="Warranty Type Permissions1" value="(blank permission means all permission)" />
                    <InfoCard label="Repair Type Permissions1" value="(blank permission means all permission)" />
                  </div>
                </section>
              </div>
            )}

            {activeTab === "Branch Access" && (
              <div className="space-y-5">
                <section className="rounded-lg border border-white/10 bg-slate-900/40 p-4">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-blue-200">Branch Access</div>
                      <div className="mt-1 text-xs text-slate-400">Changes are editable directly and must be saved explicitly.</div>
                    </div>
                    <button type="button" onClick={requestSaveBranchAccess} disabled={!hasUnsavedBranchChanges} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-50">Save Changes</button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <InfoCard label="Assigned Branch" value={effectiveOffice} />
                    <InfoCard label="Access Scope" value={getBranchAccessReason(user.type)} />
                    <InfoCard label="Visible Branches" value={visibleBranches.join(", ") || "—"} />
                    <InfoCard label="Tech Manager Multi-Branch" value={visibleBranches.length > 1 ? "Enabled" : "No"} />
                  </div>
                </section>

                <section className="overflow-x-auto rounded-lg border border-white/10 bg-slate-900/40 p-0">
                  <table className="min-w-[1180px] w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5 text-left text-xs uppercase tracking-wide text-slate-400">
                        <th className="px-4 py-3">Location</th>
                        {BRANCH_COLUMNS.map((column) => <th key={column} className="px-4 py-3 whitespace-nowrap">{column}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {LOCATIONS.map((location, index) => {
                        const hasAccess = branchAccess.includes(location);
                        const row = branchSettings[location] ?? defaultBranchSettings(location, hasAccess);
                        return (
                          <tr key={`row-${location}`} className={hasAccess ? "bg-blue-500/10" : index % 2 === 0 ? "bg-white/[0.02]" : "bg-white/[0.04]"}>
                            <td className="px-4 py-3 font-medium text-white whitespace-nowrap">{location}</td>
                            <td className="px-4 py-3 align-middle">
                              <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-200">
                                <input
                                  type="checkbox"
                                  checked={row.weekday}
                                  onChange={(event) => {
                                    setBranchSettings((current) => ({
                                      ...current,
                                      [location]: { ...(current[location] ?? row), weekday: event.target.checked },
                                    }));
                                  }}
                                  className="accent-blue-500"
                                />
                                Weekday
                              </label>
                            </td>
                            <td className="px-4 py-3 align-middle">
                              <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-200">
                                <input
                                  type="checkbox"
                                  checked={row.weekend}
                                  onChange={(event) => {
                                    setBranchSettings((current) => ({
                                      ...current,
                                      [location]: { ...(current[location] ?? row), weekend: event.target.checked },
                                    }));
                                  }}
                                  className="accent-blue-500"
                                />
                                Weekend
                              </label>
                            </td>
                            {["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map((day) => {
                              const label = day.charAt(0).toUpperCase() + day.slice(1);
                              const accessKey = DAY_COLUMN_ACCESS[label];
                              const isEditable = accessKey === "weekday" ? row.weekday : row.weekend;
                              return (
                              <td key={`${location}-${day}`} className="px-4 py-3 align-middle whitespace-nowrap">
                                <select
                                  value={row[day as keyof typeof row] as string}
                                  onChange={(event) => {
                                    setBranchSettings((current) => ({
                                      ...current,
                                      [location]: { ...(current[location] ?? row), [day]: event.target.value },
                                    }));
                                  }}
                                  title={`${label} access for ${location}`}
                                  aria-label={`${label} access for ${location}`}
                                  disabled={!isEditable}
                                  className="glass-input w-full min-w-[110px] text-sm disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {DAY_SCHEDULE_OPTIONS.map((option) => (
                                    <option key={option} value={option}>{option}</option>
                                  ))}
                                </select>
                              </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              </div>
            )}

            {activeTab === "Billing Information" && (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <InfoCard label="Billing Status" value="Active" />
                <InfoCard label="Payout Method" value="Direct Deposit" />
                <InfoCard label="Rate Plan" value={user.type.includes("Tech") ? "Field Pay" : "Salary"} />
                <InfoCard label="Tax Profile" value="Configured" />
                <InfoCard label="Next Payout" value="05/30/2026" />
                <InfoCard label="Notes" value="Billing data loaded from the user profile." />
              </div>
            )}

            {activeTab === "Account Information" && (
              <div className="space-y-5">
                <section className="rounded-lg border border-white/10 bg-slate-900/40 p-4">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-blue-200">Account Information</div>
                      <div className="mt-1 text-xs text-slate-400">Account is a dropdown; the rest of the fields are editable textboxes.</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={addAccountRow} className="btn">Add</button>
                      <button type="button" onClick={requestSaveAccountInfo} disabled={!hasUnsavedAccountChanges} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-50">Save Account Information</button>
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-white/10 bg-slate-950/40">
                    <table className="min-w-[980px] w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10 bg-white/5 text-left text-xs uppercase tracking-wide text-slate-400">
                          <th className="px-4 py-3">Account</th>
                          <th className="px-4 py-3">Technician ID</th>
                          <th className="px-4 py-3">Technician Name (SB)</th>
                          <th className="px-4 py-3">Group Key (SP)</th>
                          <th className="px-4 py-3">Tech Key (SP)</th>
                          <th className="px-4 py-3">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {accountRows.map((row, index) => (
                          <tr key={row.id} className={index % 2 === 0 ? "bg-white/[0.02]" : "bg-white/[0.04]"}>
                            <td className="px-4 py-3 align-middle">
                              <select
                                value={row.account}
                                onChange={(event) => setAccountRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, account: event.target.value } : entry))}
                                title="Account type"
                                aria-label="Account type"
                                className="glass-input w-full min-w-[100px] text-sm"
                              >
                                <option value="SB">SB</option>
                                <option value="SP">SP</option>
                              </select>
                            </td>
                            <td className="px-4 py-3 align-middle">
                              <input
                                value={row.technicianId}
                                onChange={(event) => setAccountRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, technicianId: event.target.value } : entry))}
                                title="Technician ID"
                                placeholder="Technician ID"
                                className="glass-input w-full min-w-[160px] text-sm"
                              />
                            </td>
                            <td className="px-4 py-3 align-middle">
                              <input
                                value={row.technicianName}
                                onChange={(event) => setAccountRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, technicianName: event.target.value } : entry))}
                                title="Technician Name"
                                placeholder="Technician Name"
                                className="glass-input w-full min-w-[220px] text-sm"
                              />
                            </td>
                            <td className="px-4 py-3 align-middle">
                              <input
                                value={row.groupKey}
                                onChange={(event) => setAccountRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, groupKey: event.target.value } : entry))}
                                title="Group Key"
                                placeholder="Group Key"
                                className="glass-input w-full min-w-[180px] text-sm"
                              />
                            </td>
                            <td className="px-4 py-3 align-middle">
                              <input
                                value={row.techKey}
                                onChange={(event) => setAccountRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, techKey: event.target.value } : entry))}
                                title="Tech Key"
                                placeholder="Tech Key"
                                className="glass-input w-full min-w-[180px] text-sm"
                              />
                            </td>
                            <td className="px-4 py-3 align-middle">
                              <button type="button" onClick={() => deleteAccountRow(row.id)} className="btn">Delete</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            )}

            {activeTab === "Vehicle Information" && (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <InfoCard label="Vehicle" value={user.type === "Technician" || user.type.includes("Tech") ? "2019 Ford Transit" : "No assigned vehicle"} />
                <InfoCard label="Plate" value={user.type === "Technician" || user.type.includes("Tech") ? "AHS-2046" : "—"} />
                <InfoCard label="Insurance" value={user.type === "Technician" || user.type.includes("Tech") ? "Valid" : "—"} />
                <InfoCard label="Maintenance" value={user.type === "Technician" || user.type.includes("Tech") ? "Up to date" : "—"} />
              </div>
            )}

            {activeTab === "Employee Information" && (
              <div className="space-y-5">
                <section className="rounded-lg border border-white/10 bg-slate-900/40 p-4">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-blue-200">Employee Information</div>
                      <div className="mt-1 text-xs text-slate-400">Bank and personal information are editable and saved separately from branch access.</div>
                    </div>
                    <button type="button" onClick={requestSaveEmployeeInfo} disabled={!hasUnsavedEmployeeChanges} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-50">Save Employee Information</button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <InfoCard label="Employee ID" value={user.id} />
                    <InfoCard label="Supervisor" value={user.manager || "—"} />
                    <InfoCard label="Assigned Branch" value={effectiveOffice} />
                    <InfoCard label="Email" value={user.email || "—"} />
                    <InfoCard label="Date of Birth" value={employeeDetails.dob} />
                    <InfoCard label="Home Address" value={employeeDetails.homeAddress} />
                  </div>
                </section>

                <section className="rounded-lg border border-white/10 bg-slate-900/40 p-4">
                  <div className="mb-4 text-lg font-semibold text-blue-200">Bank Information</div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <label className="space-y-2 text-sm text-slate-200">
                      <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Bank Name</span>
                      <input value={employeeInfo.bankName} onChange={(event) => setEmployeeInfo((current) => ({ ...current, bankName: event.target.value }))} className="glass-input w-full" />
                    </label>
                    <label className="space-y-2 text-sm text-slate-200">
                      <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Routing Number</span>
                      <input value={employeeInfo.routingNumber} onChange={(event) => setEmployeeInfo((current) => ({ ...current, routingNumber: event.target.value }))} className="glass-input w-full" />
                    </label>
                    <label className="space-y-2 text-sm text-slate-200">
                      <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Account Number</span>
                      <input value={employeeInfo.accountNumber} onChange={(event) => setEmployeeInfo((current) => ({ ...current, accountNumber: event.target.value }))} className="glass-input w-full" />
                    </label>
                    <label className="space-y-2 text-sm text-slate-200 md:col-span-2 xl:col-span-3">
                      <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Photo</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) {
                            setEmployeeInfo((current) => ({ ...current, photoName: "", photoDataUrl: "" }));
                            return;
                          }
                          const reader = new FileReader();
                          reader.onload = () => {
                            setEmployeeInfo((current) => ({
                              ...current,
                              photoName: file.name,
                              photoDataUrl: typeof reader.result === "string" ? reader.result : "",
                            }));
                          };
                          reader.readAsDataURL(file);
                        }}
                        className="glass-input w-full file:mr-4 file:rounded-full file:border-0 file:bg-blue-500/20 file:px-4 file:py-2 file:text-sm file:text-white"
                      />
                      <div className="text-xs text-slate-400">{employeeInfo.photoName ? `Selected: ${employeeInfo.photoName}` : "No file chosen"}</div>
                    </label>
                  </div>
                </section>

                <section className="rounded-lg border border-white/10 bg-slate-900/40 p-4">
                  <div className="mb-4 text-lg font-semibold text-blue-200">Personal Information</div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <label className="space-y-2 text-sm text-slate-200 md:col-span-2 xl:col-span-3">
                      <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Address 1</span>
                      <input value={employeeInfo.address1} onChange={(event) => setEmployeeInfo((current) => ({ ...current, address1: event.target.value }))} className="glass-input w-full" />
                    </label>
                    <label className="space-y-2 text-sm text-slate-200 md:col-span-2 xl:col-span-3">
                      <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Address 2</span>
                      <input value={employeeInfo.address2} onChange={(event) => setEmployeeInfo((current) => ({ ...current, address2: event.target.value }))} className="glass-input w-full" />
                    </label>
                    <label className="space-y-2 text-sm text-slate-200">
                      <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">City</span>
                      <input value={employeeInfo.city} onChange={(event) => setEmployeeInfo((current) => ({ ...current, city: event.target.value }))} className="glass-input w-full" />
                    </label>
                    <label className="space-y-2 text-sm text-slate-200">
                      <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">State</span>
                      <input value={employeeInfo.state} onChange={(event) => setEmployeeInfo((current) => ({ ...current, state: event.target.value }))} className="glass-input w-full" />
                    </label>
                    <label className="space-y-2 text-sm text-slate-200">
                      <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Zip Code</span>
                      <input value={employeeInfo.zipCode} onChange={(event) => setEmployeeInfo((current) => ({ ...current, zipCode: event.target.value }))} className="glass-input w-full" />
                    </label>
                    <label className="space-y-2 text-sm text-slate-200">
                      <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Employee ID</span>
                      <input value={employeeInfo.employeeId} onChange={(event) => setEmployeeInfo((current) => ({ ...current, employeeId: event.target.value }))} className="glass-input w-full" />
                    </label>
                    <label className="space-y-2 text-sm text-slate-200">
                      <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Employee SSN</span>
                      <input value={employeeInfo.employeeSsn} onChange={(event) => setEmployeeInfo((current) => ({ ...current, employeeSsn: event.target.value }))} className="glass-input w-full" />
                    </label>
                    <label className="space-y-2 text-sm text-slate-200">
                      <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Employee Salary</span>
                      <input value={employeeInfo.employeeSalary} onChange={(event) => setEmployeeInfo((current) => ({ ...current, employeeSalary: event.target.value }))} className="glass-input w-full" />
                    </label>
                    <label className="space-y-2 text-sm text-slate-200">
                      <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Birth Date</span>
                      <input value={employeeInfo.birthDate} onChange={(event) => setEmployeeInfo((current) => ({ ...current, birthDate: event.target.value }))} placeholder="mm/dd/yyyy" className="glass-input w-full" />
                    </label>
                    <label className="space-y-2 text-sm text-slate-200">
                      <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Hire Date</span>
                      <input value={employeeInfo.hireDate} onChange={(event) => setEmployeeInfo((current) => ({ ...current, hireDate: event.target.value }))} placeholder="mm/dd/yyyy" className="glass-input w-full" />
                    </label>
                    <label className="space-y-2 text-sm text-slate-200">
                      <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Terminate Date</span>
                      <input value={employeeInfo.terminateDate} onChange={(event) => setEmployeeInfo((current) => ({ ...current, terminateDate: event.target.value }))} placeholder="mm/dd/yyyy" className="glass-input w-full" />
                    </label>
                    <label className="space-y-2 text-sm text-slate-200 md:col-span-2 xl:col-span-3">
                      <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Employee Note</span>
                      <textarea value={employeeInfo.employeeNote} onChange={(event) => setEmployeeInfo((current) => ({ ...current, employeeNote: event.target.value }))} className="glass-input min-h-[96px] w-full resize-y" />
                    </label>
                    <label className="space-y-2 text-sm text-slate-200 md:col-span-2 xl:col-span-3">
                      <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Attachments</span>
                      <input
                        type="file"
                        multiple
                        onChange={(event) => setEmployeeInfo((current) => ({
                          ...current,
                          attachments: Array.from(event.target.files || []).map((file) => file.name),
                        }))}
                        className="glass-input w-full file:mr-4 file:rounded-full file:border-0 file:bg-blue-500/20 file:px-4 file:py-2 file:text-sm file:text-white"
                      />
                      <div className="text-xs text-slate-400">
                        {employeeInfo.attachments.length ? employeeInfo.attachments.join(", ") : "No attachments selected"}
                      </div>
                    </label>
                  </div>
                </section>

                <section className="rounded-lg border border-white/10 bg-slate-900/40 p-4">
                  <div className="mb-4 text-lg font-semibold text-blue-200">Emergency Contacts</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {employeeDetails.emergencyContacts.map((contact, index) => (
                      <InfoCard
                        key={contact.name}
                        label={`Contact ${index + 1}`}
                        value={contact.name}
                        secondaryValue={<div className="space-y-1 text-slate-300"><div>{contact.relationship}</div><div>{contact.phone}</div></div>}
                      />
                    ))}
                  </div>
                </section>

                <section className="rounded-lg border border-white/10 bg-slate-900/40 p-4">
                  <div className="mb-4 text-lg font-semibold text-blue-200">Personal Information Review</div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <InfoCard label="Review Cycle" value="Every 3 months" />
                    <InfoCard label="Next Review" value={employeeDetails.quarterlyReviewDue} />
                    <InfoCard label="Reminder" value="A popup asks the employee to confirm their personal information still matches." />
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      </main>
      {showInfoCheck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-slate-900 p-5 text-white shadow-2xl">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Quarterly confirmation</div>
            <h2 className="mt-2 text-xl font-semibold">Is your personal information still the same?</h2>
            <p className="mt-2 text-sm text-slate-300">
              This confirmation appears every 3 months so you can verify your personal details, emergency contacts, and home address.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={confirmInfoStillCurrent} className="btn btn-primary">Yes, it is still the same</button>
              <Link to="/profile" className="btn">Update my profile</Link>
            </div>
          </div>
        </div>
      )}
      {showEmployeeSavePrompt && hasUnsavedEmployeeChanges && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-slate-900 p-5 text-white shadow-2xl">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Unsaved employee changes</div>
            <h2 className="mt-2 text-xl font-semibold">Save these employee information changes?</h2>
            <p className="mt-2 text-sm text-slate-300">
              Bank, address, date, and attachment details have been modified. Save now to keep those values.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={handleSaveEmployeeInfo} className="btn btn-primary">Save now</button>
              <button type="button" onClick={() => setShowEmployeeSavePrompt(false)} className="btn">Keep editing</button>
            </div>
          </div>
        </div>
      )}
      {showAccountSavePrompt && hasUnsavedAccountChanges && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-slate-900 p-5 text-white shadow-2xl">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Unsaved account changes</div>
            <h2 className="mt-2 text-xl font-semibold">Save these account information changes?</h2>
            <p className="mt-2 text-sm text-slate-300">
              The account rows have been modified. Save now to keep the updated account assignments.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={handleSaveAccountInfo} className="btn btn-primary">Save now</button>
              <button type="button" onClick={() => setShowAccountSavePrompt(false)} className="btn">Keep editing</button>
            </div>
          </div>
        </div>
      )}
      {showSavePrompt && hasUnsavedBranchChanges && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-slate-900 p-5 text-white shadow-2xl">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Unsaved changes</div>
            <h2 className="mt-2 text-xl font-semibold">Save these branch access changes?</h2>
            <p className="mt-2 text-sm text-slate-300">
              The branch access values have been modified. Save now to keep the updated permissions.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={handleSaveBranchAccess} className="btn btn-primary">Save now</button>
              <button type="button" onClick={() => setShowSavePrompt(false)} className="btn">Keep editing</button>
            </div>
          </div>
        </div>
      )}
      <Footer />
    </>
  );
}

function InfoCard({ label, value, note, secondaryValue }: { label: string; value: ReactNode; note?: string; secondaryValue?: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/90 px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white break-words">{value}</div>
      {secondaryValue !== undefined && <div className="mt-2 text-sm text-slate-300 break-words">{secondaryValue}</div>}
      {note && <div className="mt-2 text-xs text-slate-400">{note}</div>}
    </div>
  );
}

*/
