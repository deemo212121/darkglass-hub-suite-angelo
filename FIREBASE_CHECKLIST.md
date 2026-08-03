# Firebase Integration Checklist

Track your progress through the Firebase integration process.

## ✅ Phase 1: Setup & Configuration (COMPLETE)

- [x] Install Firebase package
- [x] Create Firebase configuration file (`src/lib/firebase/config.ts`)
- [x] Add environment variables to `.env`
- [x] Update `.env.example` with Supabase vars
- [x] Create authentication service (`src/lib/firebase/auth.ts`)
- [x] Create Firestore service (`src/lib/firebase/firestore.ts`)
- [x] Create Storage service (`src/lib/firebase/storage.ts`)
- [x] Create Supabase mock client (`src/lib/supabase/client.ts`)
- [x] Create Supabase mock implementation (`src/lib/supabase/mock.ts`)
- [x] Write Firestore security rules (`firestore.rules`)
- [x] Write Storage security rules (`storage.rules`)
- [x] Create setup documentation
- [x] Create deployment guide
- [x] Create usage guide
- [x] Create architecture documentation

**Status:** ✅ COMPLETE

---

## 🎯 Phase 2: Deploy Firebase (NEXT STEP)

### 2.1 Firebase CLI Setup

- [ ] Install Firebase CLI globally
  ```bash
  npm install -g firebase-tools
  ```

- [ ] Login to Firebase
  ```bash
  firebase login
  ```

- [ ] Verify Firebase project connection
  ```bash
  firebase projects:list
  ```

### 2.2 Deploy Security Rules

- [ ] Deploy Firestore rules
  ```bash
  firebase deploy --only firestore:rules
  ```

- [ ] Deploy Storage rules
  ```bash
  firebase deploy --only storage
  ```

- [ ] Verify rules in Firebase Console
  - [ ] Check Firestore rules tab
  - [ ] Check Storage rules tab

### 2.3 Create Test Users

Go to Firebase Console → Authentication → Users

- [ ] Create `admin@ahsolutions.com` (password: `admin123`)
- [ ] Create `manager@ahsolutions.com` (password: `manager123`)
- [ ] Create `tech@ahsolutions.com` (password: `tech123`)
- [ ] Create `csr@ahsolutions.com` (password: `csr123`)
- [ ] Create `superadmin@ahsolutions.com` (password: `super123`)

### 2.4 Create User Profiles in Firestore

Go to Firebase Console → Firestore Database → Start collection: `users`

For each user, create a document with their UID:

- [ ] `admin@ahsolutions.com` profile
  ```json
  {
    "uid": "...",
    "email": "admin@ahsolutions.com",
    "companyId": "COMP001",
    "role": "ADMIN",
    "displayName": "Admin User",
    "supabaseUserId": "",
    "isActive": true,
    "createdAt": [Timestamp],
    "lastLogin": [Timestamp]
  }
  ```

- [ ] `manager@ahsolutions.com` profile
- [ ] `tech@ahsolutions.com` profile
- [ ] `csr@ahsolutions.com` profile
- [ ] `superadmin@ahsolutions.com` profile

### 2.5 Test Firebase Connection

- [ ] Start dev server: `npm run dev`
- [ ] Check browser console for: `✅ Firebase initialized successfully`
- [ ] Verify no Firebase errors in console

**Status:** ⏳ PENDING

---

## 🔐 Phase 3: Integrate Authentication

### 3.1 Update Auth Provider

File: `src/lib/auth.tsx`

- [ ] Import Firebase auth functions
- [ ] Replace mock login with `signIn()` from Firebase
- [ ] Store Firebase user data in context
- [ ] Update logout to use Firebase `signOut()`
- [ ] Handle Firebase auth errors

### 3.2 Update Login Page

File: `src/routes/landing.tsx`

- [ ] Use Firebase auth in login form
- [ ] Display Firebase auth errors
- [ ] Handle loading states
- [ ] Test successful login
- [ ] Test failed login (wrong password)
- [ ] Test failed login (user not found)

### 3.3 Add Auth State Listener

- [ ] Use `onAuthStateChanged` in auth provider
- [ ] Update user state on auth changes
- [ ] Handle session persistence
- [ ] Test page reload maintains session

### 3.4 Testing

- [ ] Login with admin account
- [ ] Login with manager account
- [ ] Login with tech account
- [ ] Login with CSR account
- [ ] Login with superadmin account
- [ ] Test logout functionality
- [ ] Test "Remember me" (Firebase auto-persists)
- [ ] Test across different browsers
- [ ] Test in incognito mode

**Status:** ⏳ PENDING

---

## 📁 Phase 4: Add File Upload Features

### 4.1 Profile Picture Upload

- [ ] Create profile picture upload component
- [ ] Add to user settings page
- [ ] Test file selection
- [ ] Test file validation (type, size)
- [ ] Test upload progress
- [ ] Test displaying uploaded image
- [ ] Test updating profile picture

### 4.2 Ticket Before/After Images

File: `src/routes/ticket.$ticketNo.tsx`

- [ ] Add image upload button to ticket details
- [ ] Create before/after tabs
- [ ] Implement multi-file upload
- [ ] Test uploading multiple images
- [ ] Display uploaded images in gallery
- [ ] Test image deletion
- [ ] Test image download/view

### 4.3 Part Images

- [ ] Add image upload to part modal
- [ ] Test part image upload
- [ ] Display part images
- [ ] Test image deletion

### 4.4 Invoice & Receipt Upload

- [ ] Add invoice upload button
- [ ] Add receipt upload button
- [ ] Test PDF upload
- [ ] Test file size validation (10MB max)
- [ ] Display uploaded documents
- [ ] Test document download

### 4.5 Testing

- [ ] Upload profile picture (< 5MB)
- [ ] Try uploading oversized image (> 5MB) - should fail
- [ ] Try uploading wrong file type - should fail
- [ ] Upload ticket before images
- [ ] Upload ticket after images
- [ ] Upload part image
- [ ] Upload invoice PDF
- [ ] Upload receipt PDF
- [ ] Verify files in Firebase Console → Storage
- [ ] Verify correct folder structure
- [ ] Test cross-company isolation

**Status:** ⏳ PENDING

---

## 🔒 Phase 5: Security Verification

### 5.1 Firestore Rules Testing

- [ ] Test user can read own profile
- [ ] Test user CANNOT read other user's profile
- [ ] Test SuperAdmin can read all profiles
- [ ] Test unauthenticated access is blocked
- [ ] Test client-side writes are blocked

### 5.2 Storage Rules Testing

- [ ] Test user can upload to own company folder
- [ ] Test user CANNOT upload to other company folder
- [ ] Test user can read from own company folder
- [ ] Test user CANNOT read from other company folder
- [ ] Test SuperAdmin can access all companies
- [ ] Test unauthenticated access is blocked
- [ ] Test file type validation (JPEG, PNG, PDF only)
- [ ] Test file size validation (5MB images, 10MB docs)

### 5.3 Multi-Company Isolation

Create test company:

- [ ] Create COMP002 in Firestore
- [ ] Create test user for COMP002
- [ ] Upload files as COMP001 user
- [ ] Try accessing COMP001 files as COMP002 user - should fail
- [ ] Upload files as COMP002 user
- [ ] Verify files in separate folders
- [ ] Test SuperAdmin can access both

**Status:** ⏳ PENDING

---

## 🗄️ Phase 6: Supabase Integration (FUTURE)

### 6.1 Supabase Setup

- [ ] Create Supabase project
- [ ] Get Supabase URL and anon key
- [ ] Add to `.env`
- [ ] Install Supabase client: `npm install @supabase/supabase-js`

### 6.2 Replace Mock Client

File: `src/lib/supabase/client.ts`

- [ ] Import real Supabase client
- [ ] Replace mock with `createClient()`
- [ ] Test connection

### 6.3 Create Database Schema

- [ ] Create `tickets` table
- [ ] Create `parts` table
- [ ] Create `visits` table
- [ ] Create `employees` table
- [ ] Add Row Level Security (RLS) policies
- [ ] Test multi-company isolation

### 6.4 Data Migration

- [ ] Export tickets from localStorage
- [ ] Import to Supabase tickets table
- [ ] Export parts from localStorage
- [ ] Import to Supabase parts table
- [ ] Export visits from localStorage
- [ ] Import to Supabase visits table
- [ ] Verify data integrity

### 6.5 Update Application Code

- [ ] Replace localStorage ticket calls with Supabase
- [ ] Replace localStorage part calls with Supabase
- [ ] Replace localStorage visit calls with Supabase
- [ ] Add real-time subscriptions
- [ ] Test CRUD operations
- [ ] Test filters and sorting
- [ ] Test pagination

**Status:** ⏳ WAITING FOR SUPABASE

---

## 📊 Progress Summary

### Completed Phases
- ✅ Phase 1: Setup & Configuration (100%)

### In Progress
- ⏳ Phase 2: Deploy Firebase (0%)

### Pending
- ⏳ Phase 3: Integrate Authentication (0%)
- ⏳ Phase 4: Add File Upload Features (0%)
- ⏳ Phase 5: Security Verification (0%)
- ⏳ Phase 6: Supabase Integration (0%)

### Overall Progress
**17% Complete** (1 of 6 phases done)

---

## 🚀 Quick Commands Reference

```bash
# Firebase CLI
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules
firebase deploy --only storage
firebase projects:list

# Development
npm run dev
npm run build
npm run preview

# Firebase Console
# Open: https://console.firebase.google.com/project/adminhubsolutions
```

---

## 📝 Notes

- Firebase package already installed (v12.14.0)
- All service files created and ready
- Security rules written and ready to deploy
- Documentation complete
- No code changes needed for Phase 1

---

## ❓ Common Issues

### "Firebase not configured"
→ Check `.env` has all Firebase variables

### "Permission denied" on Firestore
→ Deploy rules: `firebase deploy --only firestore:rules`

### "Storage upload failed"
→ Deploy rules: `firebase deploy --only storage`

### "User profile not found"
→ Create user profile in Firestore users collection

---

**Next Action:** Start Phase 2 - Deploy Firebase Security Rules
