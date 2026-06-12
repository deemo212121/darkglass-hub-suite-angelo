# Firebase Setup for AH Solutions / USAPP

**Status:** ✅ Phase 1 Complete - Ready for Deployment

## 📚 Documentation Navigation

This is the main setup guide. For specific tasks, see:

- **🚀 Quick Start:** [`FIREBASE_README.md`](./FIREBASE_README.md) - 5-minute overview
- **📋 Step-by-Step:** [`FIREBASE_DEPLOYMENT_GUIDE.md`](./FIREBASE_DEPLOYMENT_GUIDE.md) - Deploy Firebase
- **💻 Code Examples:** [`FIREBASE_USAGE_GUIDE.md`](./FIREBASE_USAGE_GUIDE.md) - How to use Firebase in code
- **✅ Progress Tracking:** [`FIREBASE_CHECKLIST.md`](./FIREBASE_CHECKLIST.md) - Track your progress
- **📊 Architecture:** [`SYSTEM_ARCHITECTURE.md`](./SYSTEM_ARCHITECTURE.md) - System diagrams
- **📝 Summary:** [`FIREBASE_INTEGRATION_SUMMARY.md`](./FIREBASE_INTEGRATION_SUMMARY.md) - What's completed

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    AH SOLUTIONS SYSTEM                      │
├─────────────────────────────────────────────────────────────┤
│  Firebase (Identity + Files)    │  Supabase (Business Data) │
├──────────────────────────────────┼───────────────────────────┤
│  • Authentication (Email/Pass)   │  • Tickets                │
│  • Firestore (User Cache Only)   │  • Parts                  │
│  • Storage (Images/Docs)          │  • ERP Logic              │
│                                   │  • Employees              │
└─────────────────────────────────────────────────────────────┘
```

## Firebase Project Setup

### 1. Create Firebase Project
1. Go to https://console.firebase.google.com/
2. Click "Add project"
3. Project name: `ah-solutions-usapp`
4. Enable Google Analytics (optional)
5. Create project

### 2. Enable Authentication
1. Go to Authentication → Sign-in method
2. Enable **Email/Password** provider
3. **DO NOT** enable anonymous sign-in
4. Save

### 3. Create Firestore Database
1. Go to Firestore Database
2. Click "Create database"
3. Start in **production mode** (we'll set custom rules)
4. Choose your location (e.g., `us-central1`)
5. Create

### 4. Enable Storage
1. Go to Storage
2. Click "Get Started"
3. Start in **production mode**
4. Choose same location as Firestore
5. Done

### 5. Get Firebase Config
1. Go to Project Settings (gear icon)
2. Scroll to "Your apps"
3. Click web icon (</>)
4. Register app: `ah-solutions-web`
5. Copy the Firebase config object

### 6. Add Config to .env
Create/update `.env` file with Firebase credentials:

```env
# Firebase Configuration
VITE_FIREBASE_API_KEY="AIzaSyAWhEAxjUpTAWsKiYLYr6faHzfFklK_jVs"
VITE_FIREBASE_AUTH_DOMAIN="ah-solutions-usapp.firebaseapp.com"
VITE_FIREBASE_PROJECT_ID="ah-solutions-usapp"
VITE_FIREBASE_STORAGE_BUCKET="ah-solutions-usapp.firebasestorage.app"
VITE_FIREBASE_MESSAGING_SENDER_ID="764674735133"
VITE_FIREBASE_APP_ID="1:764674735133:web:6947dd486f0760c2815af4"

# Supabase Configuration (for future use)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

## Firestore Structure (MINIMAL - User Cache Only)

```
users/{uid}
  ├─ uid: string                 // Firebase UID
  ├─ email: string               // user@company.com
  ├─ companyId: string           // COMP001
  ├─ role: string                // "ADMIN" | "CSR" | "TECHNICIAN" etc.
  ├─ supabaseUserId: string      // UUID from Supabase
  ├─ isActive: boolean           // Account status
  ├─ createdAt: timestamp        // Account creation
  ├─ lastLogin: timestamp        // Last login time
  └─ displayName: string         // User's name
```

**RULES:**
- ✅ ONLY store user session + role mapping
- ❌ NO tickets, parts, or business data
- ✅ Mirror Supabase user table

## Firebase Storage Structure

```
companies/
  └─ {companyId}/
      ├─ users/
      │   └─ {uid}/
      │       └─ profile.jpg
      ├─ tickets/
      │   └─ {ticketId}/
      │       ├─ before/
      │       │   ├─ image1.jpg
      │       │   └─ image2.jpg
      │       └─ after/
      │           ├─ image1.jpg
      │           └─ image2.jpg
      ├─ parts/
      │   └─ {partId}/
      │       └─ image.jpg
      └─ documents/
          ├─ invoices/
          │   └─ {ticketId}_invoice.pdf
          └─ receipts/
              └─ {ticketId}_receipt.pdf
```

**RULES:**
- ✅ Every file tied to companyId
- ✅ Path-based isolation
- ❌ No cross-company access
- ✅ Only authenticated users

## Authentication Flow

```
┌─────────────┐
│ User Login  │
│ (email/pwd) │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ Firebase Auth   │
│ Returns UID     │
└──────┬──────────┘
       │
       ▼
┌─────────────────────────┐
│ Fetch Firestore        │
│ users/{uid}            │
│ Get: companyId, role   │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Load from Supabase     │
│ Filter by companyId    │
│ Use role for access    │
└─────────────────────────┘
```

## Security Rules

### Firestore Rules
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Only authenticated users
    match /users/{uid} {
      // Users can read their own document
      allow read: if request.auth != null && request.auth.uid == uid;
      // Only system can write (via Admin SDK or Cloud Functions)
      allow write: if false;
    }
  }
}
```

### Storage Rules
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Get user's company from Firestore
    function getUserCompany() {
      return firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data.companyId;
    }
    
    // Check if user is authenticated
    function isAuthenticated() {
      return request.auth != null;
    }
    
    // Companies folder - isolated by companyId
    match /companies/{companyId}/{allPaths=**} {
      allow read: if isAuthenticated() && getUserCompany() == companyId;
      allow write: if isAuthenticated() && getUserCompany() == companyId;
    }
  }
}
```

## NPM Packages Required

```bash
npm install firebase
```

## Files Created ✅

1. ✅ `src/lib/firebase/config.ts` - Firebase initialization with environment validation
2. ✅ `src/lib/firebase/auth.ts` - Authentication functions (signIn, signOut, createUser)
3. ✅ `src/lib/firebase/firestore.ts` - Firestore user profile operations
4. ✅ `src/lib/firebase/storage.ts` - Storage operations for images and documents
5. ✅ `src/lib/supabase/client.ts` - Supabase client interface (using mock until ready)
6. ✅ `src/lib/supabase/mock.ts` - Mock Supabase implementation
7. ✅ `firestore.rules` - Firestore security rules
8. ✅ `storage.rules` - Firebase Storage security rules
9. ✅ `.env.example` - Updated with Supabase environment variables

## Migration Plan

### Phase 1: Firebase Setup ✅ COMPLETE
- ✅ Firebase config with validation
- ✅ Authentication service (signIn, signOut, createUser)
- ✅ Firestore user cache operations
- ✅ Storage service with file upload/download
- ✅ Supabase mock client
- ✅ Security rules (Firestore + Storage)
- ✅ Environment configuration
- ✅ Firebase package already installed (v12.14.0)

### Phase 2: Deploy Firebase Rules (NEXT STEP)
- Deploy Firestore rules to Firebase Console
- Deploy Storage rules to Firebase Console
- Create initial test users in Firebase Auth
- Verify security rules are working

### Phase 3: Integrate Auth (READY TO START)
- Replace mock auth in `src/lib/auth.tsx` with Firebase Auth
- Update login flow in `src/routes/landing.tsx`
- Store user sessions in Firestore
- Test with existing user accounts

### Phase 4: Add Storage Features
- Add image upload UI for tickets (before/after)
- Add document upload UI (invoices, receipts)
- Add profile picture upload
- Test file permissions

### Phase 5: Supabase Integration (Future - When Ready)
- Replace localStorage with Supabase
- Migrate tickets/parts data structure
- Implement real-time sync
- Test multi-company isolation

## Testing

### Test Users (to be created in Firebase Console)
```
admin@ahsolutions.com - ADMIN role
manager@ahsolutions.com - MANAGER role
tech@ahsolutions.com - TECHNICIAN role
csr@ahsolutions.com - CSR role
```

### Test Companies
```
COMP001 - AH Solutions Main
COMP002 - Test Company
```

## Security Checklist

- ✅ Email/password only (no anonymous)
- ✅ Firestore: user cache only
- ✅ Storage: company-based isolation
- ✅ No cross-company access
- ✅ Path-based permissions
- ✅ Authentication required for all operations
- ✅ No business data in Firebase

## Next Steps

1. Create Firebase project
2. Add credentials to `.env`
3. Deploy Firestore rules
4. Deploy Storage rules
5. Create test users
6. Test authentication flow
7. Test file upload
