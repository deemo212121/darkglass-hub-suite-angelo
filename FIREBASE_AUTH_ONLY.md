# Firebase - Authentication Only Setup

## 🎯 Scope Change

**Firebase will be used ONLY for:**
- ✅ User Authentication (Email/Password)
- ✅ Firestore (User profiles and session cache)

**Firebase will NOT be used for:**
- ❌ File Storage (removed due to cost concerns)
- ❌ Business data (tickets, parts, etc.)

**All file storage and business data will be handled by Supabase when ready.**

---

## 📊 Updated Architecture

```
┌──────────────────────────────────────────────────────┐
│              AH SOLUTIONS SYSTEM                     │
├──────────────────────────────────────────────────────┤
│                                                      │
│  FIREBASE (Auth Only)                               │
│  ├─ Authentication (Email/Password)                 │
│  └─ Firestore (User Cache)                          │
│     └─ users/{uid}                                   │
│        ├─ email, companyId, role                     │
│        ├─ displayName, isActive                      │
│        └─ createdAt, lastLogin                       │
│                                                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│  SUPABASE (Everything Else - When Ready)            │
│  ├─ Tickets                                          │
│  ├─ Parts                                            │
│  ├─ Visits                                           │
│  ├─ Employees                                        │
│  ├─ File Storage                                     │
│  │  ├─ Ticket images (before/after)                 │
│  │  ├─ Part images                                  │
│  │  ├─ Invoices/Receipts                            │
│  │  └─ Profile pictures                             │
│  └─ All other ERP data                              │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## 🗂️ Files Affected

### ✅ Keep (Authentication)
- `src/lib/firebase/config.ts` - Firebase initialization
- `src/lib/firebase/auth.ts` - Sign in/out, create user
- `src/lib/firebase/firestore.ts` - User profiles
- `firestore.rules` - Database security rules

### ❌ Remove/Ignore (Storage - Not Used)
- `src/lib/firebase/storage.ts` - **Not needed** (all storage goes to Supabase)
- `storage.rules` - **Not needed** (no Firebase Storage)
- Any storage-related imports or code

### 🔄 Update (Supabase Integration)
- `src/lib/supabase/client.ts` - Will handle file storage when ready
- `src/lib/supabase/mock.ts` - Mock for development

---

## 🔥 Firebase Services Needed

### 1. Authentication ✅
**Purpose:** User login and identity management

**Setup:**
1. Go to Firebase Console → Authentication
2. Enable Email/Password provider
3. Create test users

**Cost:** Free for unlimited users

### 2. Firestore ✅
**Purpose:** Store user profiles and session data ONLY

**Structure:**
```
users/{uid}
  ├─ uid: string
  ├─ email: string
  ├─ companyId: string (COMP001, COMP002, etc.)
  ├─ role: string (ADMIN, CSR, TECHNICIAN, etc.)
  ├─ displayName: string
  ├─ supabaseUserId: string
  ├─ isActive: boolean
  ├─ createdAt: timestamp
  └─ lastLogin: timestamp
```

**Cost:** Free up to 50K reads/day, 20K writes/day

### 3. Storage ❌ NOT USED
**Reason:** Cost concerns - all file storage will use Supabase Storage instead

---

## 🚀 Implementation Plan

### Phase 1: Firebase Authentication (Current)
- ✅ Configure Firebase project
- ✅ Set up Authentication
- ✅ Set up Firestore for user profiles
- ✅ Deploy Firestore security rules
- ⬜ Create test users
- ⬜ Integrate with login page

### Phase 2: Supabase Setup (Future)
- ⬜ Set up Supabase project
- ⬜ Create database schema (tickets, parts, etc.)
- ⬜ Set up Supabase Storage for files
- ⬜ Configure Row Level Security
- ⬜ Migrate data from localStorage

### Phase 3: Integration
- ⬜ Connect Firebase Auth with Supabase
- ⬜ Implement file upload to Supabase Storage
- ⬜ Replace localStorage with Supabase database
- ⬜ Test multi-company isolation

---

## 💰 Cost Breakdown

### Firebase (Free Tier)
- **Authentication:** Unlimited users ✅ FREE
- **Firestore:** 50K reads/day, 20K writes/day ✅ FREE
- **Storage:** ❌ NOT USED (saving costs)

### Supabase (When Implemented)
- **Database:** 500MB storage, unlimited API requests ✅ FREE
- **Storage:** 1GB file storage ✅ FREE
- **Auth:** Handled by Firebase (no cost here)

**Total Cost:** $0/month for both services on free tiers

---

## 📝 Code Usage

### Authentication Only

```typescript
import { signIn, signOut } from "@/lib/firebase/auth";
import { getUserProfile } from "@/lib/firebase/firestore";

// Login
const user = await signIn(email, password);
// Returns: { uid, email, companyId, role, displayName }

// Get user profile
const profile = await getUserProfile(user.uid);
// Returns full user data from Firestore

// Logout
await signOut();
```

### File Upload (Supabase - Future)

```typescript
// NOT using Firebase Storage
// All file uploads will use Supabase Storage

import { supabase } from "@/lib/supabase/client";

// Upload to Supabase Storage
const { data, error } = await supabase.storage
  .from('ticket-images')
  .upload(`${companyId}/${ticketId}/before.jpg`, file);
```

---

## ✅ What's Working Now

- ✅ Firebase project created (`ah-solutions-usapp`)
- ✅ Authentication service implemented
- ✅ Firestore user profile structure defined
- ✅ Security rules written
- ✅ Mock Supabase client ready
- ✅ Complete documentation

## ⏳ Next Steps

1. **Enable Firebase services** (Authentication + Firestore)
2. **Deploy Firestore security rules**
3. **Create test users**
4. **Test authentication flow**
5. **Integrate with login page** (replace mock auth)

---

## 📞 Resources

- **Firebase Console:** https://console.firebase.google.com/project/ah-solutions-usapp
- **Firebase Auth Docs:** https://firebase.google.com/docs/auth
- **Firestore Docs:** https://firebase.google.com/docs/firestore
- **Supabase Docs:** https://supabase.com/docs

---

**Summary:** Firebase handles authentication only. All files and business data go to Supabase. This keeps costs at $0/month.
