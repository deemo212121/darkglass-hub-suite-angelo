# AH Solutions / USAPP - System Architecture

## Complete System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLIENT APPLICATION (React)                      │
│                                                                         │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────────────┐  │
│  │  Login Page    │  │  Home Panel    │  │  Ticket Management      │  │
│  │  landing.tsx   │  │  home.tsx      │  │  ticket.$ticketNo.tsx   │  │
│  └────────────────┘  └────────────────┘  └─────────────────────────┘  │
│                                                                         │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────────────┐  │
│  │  SuperAdmin    │  │  Work Planner  │  │  Part Orders           │  │
│  │  superadmin.tsx│  │  WorkPlanner   │  │  PartOrder.tsx         │  │
│  └────────────────┘  └────────────────┘  └─────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
          ┌─────────▼─────────┐    ┌─────────▼──────────┐
          │  src/lib/firebase  │    │  src/lib/supabase  │
          │                    │    │                    │
          │  ✅ IMPLEMENTED    │    │  🔶 MOCK (Future)  │
          └─────────┬──────────┘    └─────────┬──────────┘
                    │                          │
                    │                          │
    ┌───────────────┴───────────────┐         │
    │                               │         │
┌───▼──────────────┐    ┌──────────▼────┐    │
│                  │    │               │    │
│  FIREBASE        │    │  FIREBASE     │    │
│  AUTHENTICATION  │    │  STORAGE      │    │
│                  │    │               │    │
│  • Email/Pwd     │    │  • Images     │    │
│  • User UID      │    │  • Documents  │    │
│  • Sign In/Out   │    │  • PDFs       │    │
│                  │    │               │    │
└──────────────────┘    └───────────────┘    │
                                              │
┌──────────────────┐                          │
│                  │                          │
│  FIRESTORE       │                          │
│  DATABASE        │                          │
│                  │                          │
│  • User Cache    │                          │
│  • Session Data  │                          │
│  • Profile Info  │                          │
│                  │                          │
└──────────────────┘                          │
                                              │
                                   ┌──────────▼──────────┐
                                   │                     │
                                   │  SUPABASE           │
                                   │  (NOT READY YET)    │
                                   │                     │
                                   │  • Tickets          │
                                   │  • Parts            │
                                   │  • Visits           │
                                   │  • Employees        │
                                   │  • All ERP Data     │
                                   │                     │
                                   └─────────────────────┘
```

---

## Data Flow Diagrams

### 1. Authentication Flow

```
┌──────────────┐
│   User       │
│  Enters      │
│  Email/Pwd   │
└──────┬───────┘
       │
       ▼
┌──────────────────────────┐
│  Firebase Auth           │
│  signInWithEmailAndPass  │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│  Returns Firebase UID    │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│  Fetch from Firestore            │
│  users/{uid}                     │
│  Get: companyId, role, profile   │
└──────┬───────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│  Update lastLogin timestamp      │
└──────┬───────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│  Store in App State/Context      │
│  • email                         │
│  • companyId                     │
│  • role                          │
│  • uid                           │
└──────┬───────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│  Navigate to Dashboard           │
│  • SuperAdmin → /superadmin      │
│  • Regular User → /home          │
└──────────────────────────────────┘
```

### 2. File Upload Flow

```
┌──────────────┐
│   User       │
│  Selects     │
│  File        │
└──────┬───────┘
       │
       ▼
┌──────────────────────────┐
│  Client-Side Validation  │
│  • File type             │
│  • File size             │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│  Generate Storage Path           │
│  companies/{companyId}/...       │
└──────┬───────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│  Firebase Storage Upload         │
│  uploadBytes(ref, file)          │
└──────┬───────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│  Storage Rules Check             │
│  • Is user authenticated?        │
│  • User's companyId = path?      │
│  • File type allowed?            │
│  • File size within limit?       │
└──────┬───────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│  Get Download URL                │
│  getDownloadURL(ref)             │
└──────┬───────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│  Store URL in Database           │
│  (Supabase or localStorage)      │
└──────┬───────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│  Display to User                 │
└──────────────────────────────────┘
```

### 3. Multi-Company Isolation

```
┌───────────────────────────────────────────────────────┐
│                   COMPANY A (COMP001)                 │
├───────────────────────────────────────────────────────┤
│                                                       │
│  Users:                                               │
│  ├─ admin@companyA.com                                │
│  ├─ tech1@companyA.com                                │
│  └─ csr@companyA.com                                  │
│                                                       │
│  Storage:                                             │
│  └─ companies/COMP001/                                │
│     ├─ users/                                         │
│     ├─ tickets/                                       │
│     ├─ parts/                                         │
│     └─ documents/                                     │
│                                                       │
│  Database (Supabase):                                 │
│  └─ WHERE companyId = 'COMP001'                       │
│                                                       │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│                   COMPANY B (COMP002)                 │
├───────────────────────────────────────────────────────┤
│                                                       │
│  Users:                                               │
│  ├─ admin@companyB.com                                │
│  ├─ tech1@companyB.com                                │
│  └─ manager@companyB.com                              │
│                                                       │
│  Storage:                                             │
│  └─ companies/COMP002/                                │
│     ├─ users/                                         │
│     ├─ tickets/                                       │
│     ├─ parts/                                         │
│     └─ documents/                                     │
│                                                       │
│  Database (Supabase):                                 │
│  └─ WHERE companyId = 'COMP002'                       │
│                                                       │
└───────────────────────────────────────────────────────┘

        ❌ No cross-company access allowed
        ✅ SuperAdmin can access all companies
```

---

## Security Layers

### Layer 1: Firebase Authentication
```
┌─────────────────────────────────────┐
│  AUTHENTICATION REQUIRED            │
│                                     │
│  ✅ Valid email/password            │
│  ✅ Active account                  │
│  ❌ Anonymous access blocked        │
└─────────────────────────────────────┘
```

### Layer 2: Firestore Security Rules
```
┌─────────────────────────────────────┐
│  FIRESTORE ACCESS CONTROL           │
│                                     │
│  ✅ Read own profile (users/{uid})  │
│  ✅ SuperAdmin reads all            │
│  ❌ Write from client blocked       │
│  ❌ Cross-user access blocked       │
└─────────────────────────────────────┘
```

### Layer 3: Storage Security Rules
```
┌─────────────────────────────────────┐
│  STORAGE ACCESS CONTROL             │
│                                     │
│  ✅ Company path = user's company   │
│  ✅ File type validation            │
│  ✅ File size validation            │
│  ❌ Cross-company blocked           │
│  ✅ SuperAdmin exception            │
└─────────────────────────────────────┘
```

### Layer 4: Application Logic
```
┌─────────────────────────────────────┐
│  APP-LEVEL CHECKS                   │
│                                     │
│  ✅ Role-based UI rendering         │
│  ✅ Company ID in all requests      │
│  ✅ Client-side validation          │
│  ✅ Error handling                  │
└─────────────────────────────────────┘
```

---

## File Organization

### Firebase Files
```
src/lib/firebase/
├── config.ts         - Initialization & validation
├── auth.ts           - Authentication functions
├── firestore.ts      - User profile operations
└── storage.ts        - File upload/download
```

### Supabase Files (Mock)
```
src/lib/supabase/
├── client.ts         - Supabase interface
└── mock.ts           - Mock implementation
```

### Security Rules
```
project_root/
├── firestore.rules   - Firestore security
└── storage.rules     - Storage security
```

### Documentation
```
project_root/
├── FIREBASE_SETUP.md
├── FIREBASE_DEPLOYMENT_GUIDE.md
├── FIREBASE_USAGE_GUIDE.md
├── FIREBASE_INTEGRATION_SUMMARY.md
└── SYSTEM_ARCHITECTURE.md (this file)
```

---

## Component Integration Map

```
┌──────────────────────────────────────────────────────────┐
│  landing.tsx (Login)                                     │
│  ├─ Uses: firebase/auth → signIn()                       │
│  └─ Navigates to: /home or /superadmin                   │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  superadmin.tsx (SuperAdmin Dashboard)                   │
│  ├─ Uses: firebase/auth → signOut()                      │
│  ├─ Manages: Company admins                              │
│  └─ Data: localStorage (temp) → Supabase (future)        │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  ticket.$ticketNo.tsx (Ticket Details)                   │
│  ├─ Uses: firebase/storage → uploadTicketImage()         │
│  ├─ Uses: firebase/storage → uploadInvoice()             │
│  └─ Data: localStorage (temp) → Supabase (future)        │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  PartOrder.tsx (Part Orders)                             │
│  └─ Data: localStorage (temp) → Supabase (future)        │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  WorkPlannerPage.tsx (Work Planner)                      │
│  └─ Data: localStorage (temp) → Supabase (future)        │
└──────────────────────────────────────────────────────────┘
```

---

## Data Migration Path

### Current State (Phase 1)
```
┌─────────────────────┐
│   localStorage      │
│                     │
│  • Tickets          │
│  • Parts            │
│  • Visits           │
│  • Audit Entries    │
│  • Alert Messages   │
│  • PO Data          │
└─────────────────────┘
```

### Target State (Phase 5)
```
┌─────────────────────┐      ┌─────────────────────┐
│   Firestore         │      │   Supabase          │
│                     │      │                     │
│  • User Profiles    │      │  • Tickets          │
│  • Session Cache    │      │  • Parts            │
│                     │      │  • Visits           │
└─────────────────────┘      │  • Audit Log        │
                             │  • Employees        │
┌─────────────────────┐      │  • All ERP Data     │
│   Firebase Storage  │      │                     │
│                     │      └─────────────────────┘
│  • Profile Pictures │
│  • Ticket Images    │
│  • Part Images      │
│  • Invoices/Receipts│
└─────────────────────┘
```

---

## Technology Stack

### Frontend
- **Framework:** React 19.2.0
- **Router:** TanStack Router 1.168.25
- **State:** React Query 5.83.0
- **UI:** Radix UI + Tailwind CSS
- **Forms:** React Hook Form + Zod

### Backend Services
- **Auth:** Firebase Authentication (Email/Password)
- **User Cache:** Firestore (minimal)
- **File Storage:** Firebase Storage
- **Business Data:** Supabase (future)

### Development
- **Build Tool:** Vite 7.3.1
- **Language:** TypeScript 5.8.3
- **Package Manager:** npm (Bun lock present)

---

## Environment Variables

```env
# Google Maps
VITE_GOOGLE_MAPS_API_KEY=***

# Firebase (Authentication + Storage)
VITE_FIREBASE_API_KEY=***
VITE_FIREBASE_AUTH_DOMAIN=adminhubsolutions.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=adminhubsolutions
VITE_FIREBASE_STORAGE_BUCKET=adminhubsolutions.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=***
VITE_FIREBASE_APP_ID=***
VITE_FIREBASE_MEASUREMENT_ID=***

# Supabase (Business Data - Future)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

---

## Deployment Checklist

- [ ] Firebase CLI installed
- [ ] Logged into Firebase
- [ ] Firestore rules deployed
- [ ] Storage rules deployed
- [ ] Test users created in Firebase Auth
- [ ] User profiles created in Firestore
- [ ] Authentication tested
- [ ] File upload tested
- [ ] Cross-company isolation verified
- [ ] SuperAdmin access tested

---

## Future Enhancements

1. **Real-time Sync**
   - Supabase real-time subscriptions
   - Live updates for tickets/parts
   - Multi-user collaboration

2. **Advanced File Management**
   - Image compression before upload
   - Thumbnail generation
   - Batch upload/download

3. **Enhanced Security**
   - 2FA authentication
   - Session timeout
   - IP whitelisting

4. **Analytics**
   - Firebase Analytics integration
   - User behavior tracking
   - Performance monitoring

5. **Offline Support**
   - Service worker
   - IndexedDB caching
   - Sync when online

---

**System Status:** 🟢 Phase 1 Complete - Ready for Deployment
