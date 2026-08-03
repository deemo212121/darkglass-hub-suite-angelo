# 👥 User Roles & Permissions System

## Overview

Complete role-based access control (RBAC) system with three levels:
1. **SUPERADMIN** - System administrator (creates companies & admins)
2. **ADMIN** - Company administrator (creates company users)
3. **Staff Roles** - Operational users (CSR, HR, Technician, etc.)

## User Hierarchy

```
┌─────────────────────────────────────────────────────┐
│ SUPERADMIN (System Level)                           │
│ - jdage7@gmail.com                                  │
│ - Creates companies & ADMIN accounts                │
└─────────────────────────────────────────────────────┘
                    │
                    ├── Company A (COMP001)
                    │   │
                    │   ├─ ADMIN (admin@companyA.com)
                    │   │  └─ Creates staff:
                    │   │     ├─ MANAGER (manager@companyA.com)
                    │   │     ├─ CSR (csr@companyA.com)
                    │   │     ├─ TECHNICIAN (tech@companyA.com)
                    │   │     ├─ HR (hr@companyA.com)
                    │   │     └─ FINANCE (finance@companyA.com)
                    │   
                    └── Company B (COMP002)
                        │
                        ├─ ADMIN (admin@companyB.com)
                        └─ Creates staff:
                           ├─ MANAGER (manager@companyB.com)
                           ├─ CSR (csr@companyB.com)
                           └─ TECHNICIAN (tech@companyB.com)
```

## User Roles Defined

### 1. SUPERADMIN
- **Purpose**: System administrator
- **Created by**: Manual setup (first user)
- **Company**: Special (can view all companies)
- **Can create**: Companies, ADMIN users
- **Cannot access**: Operational data (tickets, parts, etc.)
- **Dashboard**: `/superadmin`

### 2. ADMIN
- **Purpose**: Company administrator
- **Created by**: SUPERADMIN
- **Company**: Single company
- **Can create**: All staff roles for their company
- **Can access**: All company data
- **Dashboard**: Main app (full access)

### 3. MANAGER
- **Purpose**: Department/team manager
- **Created by**: ADMIN
- **Company**: Assigned company
- **Can access**: Tickets, employees, reports, work planner
- **Cannot access**: HR data, payroll, system settings

### 4. CSR (Customer Service Representative)
- **Purpose**: Handle customer tickets and calls
- **Created by**: ADMIN
- **Company**: Assigned company
- **Can access**: Tickets, customer info, create/edit tickets
- **Cannot access**: Parts inventory, payroll, reports

### 5. TECHNICIAN
- **Purpose**: Field technician
- **Created by**: ADMIN
- **Company**: Assigned company
- **Can access**: Assigned tickets, parts pickup/return, timecards
- **Cannot access**: All tickets, employee management, reports

### 6. DISPATCHER
- **Purpose**: Dispatch and schedule technicians
- **Created by**: ADMIN
- **Company**: Assigned company
- **Can access**: All tickets, work planner, technician schedules
- **Cannot access**: HR data, payroll

### 7. HR
- **Purpose**: Human resources management
- **Created by**: ADMIN
- **Company**: Assigned company
- **Can access**: Employees, payroll, timecards, HR reports
- **Cannot access**: Tickets, parts inventory

### 8. IT
- **Purpose**: IT support and system management
- **Created by**: ADMIN
- **Company**: Assigned company
- **Can access**: All modules, system settings (for their company)
- **Cannot access**: Other companies' data

### 9. PARTS
- **Purpose**: Parts inventory management
- **Created by**: ADMIN
- **Company**: Assigned company
- **Can access**: Parts inventory, purchase orders, parts reports
- **Cannot access**: Tickets details, employee management

### 10. FINANCE
- **Purpose**: Financial management
- **Created by**: ADMIN
- **Company**: Assigned company
- **Can access**: Purchase orders, payroll, financial reports
- **Cannot access**: Ticket operations, parts inventory

## Firebase User Document

```typescript
interface UserAccount {
  uid: string;                    // Firebase Auth UID
  email: string;                  // User email
  displayName: string;            // Full name
  companyId: string;              // Company they belong to
  role: UserRole;                 // Their role (see below)
  isActive: boolean;              // Account status
  phoneNumber?: string;           // Contact number
  employeeId?: string;            // Link to Supabase employee record
  department?: string;            // Department name
  permissions?: string[];         // Granular permissions
  createdAt: Timestamp;           // When created
  createdBy: string;              // UID of creator
  updatedAt: Timestamp;           // Last update
  lastLogin?: Timestamp;          // Last login time
}

type UserRole = 
  | "SUPERADMIN"     // System admin
  | "ADMIN"          // Company admin
  | "MANAGER"        // Manager
  | "CSR"            // Customer Service Rep
  | "TECHNICIAN"     // Field technician
  | "DISPATCHER"     // Dispatcher
  | "HR"             // HR staff
  | "IT"             // IT support
  | "PARTS"          // Parts manager
  | "FINANCE";       // Finance manager
```

## Permission System

### Granular Permissions (Optional)

In addition to roles, you can assign specific permissions:

```typescript
const permissions = [
  // Tickets
  "view_tickets",
  "create_tickets",
  "edit_tickets",
  "delete_tickets",
  "assign_tickets",
  
  // Employees
  "view_employees",
  "create_employees",
  "edit_employees",
  "delete_employees",
  
  // Parts
  "view_parts",
  "create_parts",
  "edit_parts",
  "delete_parts",
  "order_parts",
  
  // Reports
  "view_reports",
  "export_reports",
  
  // Financial
  "view_payroll",
  "edit_payroll",
  "view_purchase_orders",
  "approve_purchase_orders",
  
  // Admin
  "create_users",
  "edit_users",
  "delete_users",
  "manage_settings",
];
```

### Default Role Permissions

```typescript
const rolePermissions = {
  SUPERADMIN: ["manage_companies", "create_admins"],
  
  ADMIN: [
    "create_users",
    "view_tickets", "create_tickets", "edit_tickets", "delete_tickets",
    "view_employees", "create_employees", "edit_employees",
    "view_parts", "create_parts", "edit_parts",
    "view_reports", "export_reports",
    "view_payroll", "edit_payroll",
    "manage_settings"
  ],
  
  MANAGER: [
    "view_tickets", "create_tickets", "edit_tickets", "assign_tickets",
    "view_employees",
    "view_reports"
  ],
  
  CSR: [
    "view_tickets", "create_tickets", "edit_tickets"
  ],
  
  TECHNICIAN: [
    "view_tickets", // Only assigned tickets
    "view_parts", // Only for pickup/return
    "view_timecard"
  ],
  
  DISPATCHER: [
    "view_tickets", "assign_tickets",
    "view_employees",
    "view_work_planner"
  ],
  
  HR: [
    "view_employees", "create_employees", "edit_employees",
    "view_payroll", "edit_payroll",
    "view_timecard"
  ],
  
  IT: [
    "view_tickets", "create_tickets", "edit_tickets",
    "view_employees",
    "manage_settings"
  ],
  
  PARTS: [
    "view_parts", "create_parts", "edit_parts",
    "view_purchase_orders", "create_purchase_orders"
  ],
  
  FINANCE: [
    "view_purchase_orders", "approve_purchase_orders",
    "view_payroll",
    "view_reports", "export_reports"
  ]
};
```

## User Creation Flow

### SUPERADMIN Creates ADMIN

```typescript
// At /superadmin page
const createAdmin = async () => {
  const newAdmin = {
    email: "admin@companyA.com",
    password: "SecurePass123",
    displayName: "John Admin",
    companyId: "COMP001",
    role: "ADMIN",
    phoneNumber: "(555) 123-4567",
  };
  
  // Create in Firebase Auth + Firestore
  const uid = await createUserAccount(newAdmin, superAdminUid);
};
```

### ADMIN Creates Staff Users

```typescript
// At /users or /admin/users page
const createStaff = async () => {
  const { companyId } = useCompanyContext(); // Automatically gets ADMIN's company
  
  const newUser = {
    email: "csr@companyA.com",
    password: "TempPass123",
    displayName: "Jane CSR",
    companyId: companyId, // Same company as ADMIN
    role: "CSR",
    department: "Customer Service",
    phoneNumber: "(555) 456-7890",
  };
  
  // Create in Firebase Auth + Firestore
  const uid = await createUserAccount(newUser, adminUid);
};
```

## Route Protection

```typescript
// src/lib/permissions.ts

export function canAccessRoute(userRole: UserRole, route: string): boolean {
  const routePermissions = {
    '/superadmin': ['SUPERADMIN'],
    '/tickets': ['ADMIN', 'MANAGER', 'CSR', 'TECHNICIAN', 'DISPATCHER'],
    '/employees': ['ADMIN', 'MANAGER', 'HR'],
    '/parts': ['ADMIN', 'TECHNICIAN', 'PARTS'],
    '/payroll': ['ADMIN', 'HR', 'FINANCE'],
    '/reports': ['ADMIN', 'MANAGER', 'FINANCE'],
    '/settings': ['ADMIN', 'IT'],
  };
  
  return routePermissions[route]?.includes(userRole) ?? false;
}

// Usage in component
function TicketsPage() {
  const { role } = useAuth();
  const navigate = useNavigate();
  
  useEffect(() => {
    if (!canAccessRoute(role, '/tickets')) {
      navigate({ to: '/' });
    }
  }, [role, navigate]);
  
  return <div>Tickets Page</div>;
}
```

## UI Components

### Role Badge Component

```typescript
// src/components/RoleBadge.tsx
export function RoleBadge({ role }: { role: UserRole }) {
  const colors = {
    SUPERADMIN: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    ADMIN: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    MANAGER: "bg-green-500/20 text-green-300 border-green-500/30",
    CSR: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
    TECHNICIAN: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    DISPATCHER: "bg-pink-500/20 text-pink-300 border-pink-500/30",
    HR: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    IT: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
    PARTS: "bg-teal-500/20 text-teal-300 border-teal-500/30",
    FINANCE: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  };
  
  return (
    <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold border ${colors[role]}`}>
      {role}
    </span>
  );
}
```

## Implementation Checklist

### Phase 1: User Management for ADMIN
- [ ] Create `/users` or `/admin/users` page for ADMINs
- [ ] Add "+ Create User" button
- [ ] Create user creation modal with role dropdown
- [ ] List all users in company
- [ ] Edit/deactivate user functionality
- [ ] Role badge display

### Phase 2: Permission System
- [ ] Create `canAccessRoute()` helper
- [ ] Create `hasPermission()` helper
- [ ] Add route guards to all pages
- [ ] Add permission checks to actions (buttons, etc.)

### Phase 3: Data Filtering
- [ ] Update all Supabase queries to filter by `company_id`
- [ ] Ensure Technicians only see assigned tickets
- [ ] Ensure HR only sees HR-related data

### Phase 4: Testing
- [ ] Create test users for each role
- [ ] Test route access for each role
- [ ] Test data visibility for each role
- [ ] Test cross-company isolation

## Summary

✅ **All users stored in Firebase** (Auth + Firestore)
✅ **Three-level hierarchy**: SUPERADMIN → ADMIN → Staff
✅ **10 predefined roles** with clear permissions
✅ **Company isolation** enforced at database level
✅ **Granular permissions** for fine-tuned access control

Next: Shall I create the User Management page for ADMINs?
