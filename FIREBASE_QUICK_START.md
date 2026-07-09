# Firebase Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Step 1: Verify Firebase Configuration ✅

Your Firebase is already configured in `.env`:
```
VITE_FIREBASE_PROJECT_ID=ah-solutions-usapp
```

### Step 2: Deploy Security Rules 🔒

**Option A: Using Firebase CLI (Recommended)**
```bash
# Install Firebase CLI if not installed
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize Firebase (if not done)
firebase init

# Deploy rules
firebase deploy --only firestore:rules,storage
```

**Option B: Manual Deployment**
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select project: `ah-solutions-usapp`
3. **Firestore Rules:**
   - Go to Firestore Database → Rules
   - Copy content from `firestore.rules`
   - Click "Publish"
4. **Storage Rules:**
   - Go to Storage → Rules
   - Copy content from `storage.rules`
   - Click "Publish"

### Step 3: Run Initial Setup 🎯

**Option A: Using Setup Page (Easiest)**
1. Navigate to `/firebase-setup` in your app
2. Click "Run Initial Setup"
3. Wait for completion
4. Copy the login credentials

**Option B: Using Browser Console**
```javascript
// Open browser console (F12)
// Run this command:
firebaseSetup.runCompleteSetup();

// Wait for completion, credentials will be displayed
```

**Option C: Manual Setup via Firebase Console**
See the detailed guide in `FIREBASE_USER_MANAGEMENT.md`

### Step 4: Login & Change Passwords 🔐

1. Login with superadmin credentials:
   - Email: `superadmin@ahsolutions.com`
   - Password: `Admin123!@#`

2. Go to `/admin/users`

3. **IMPORTANT:** Change all default passwords immediately!

4. Create your real users

### Step 5: Start Using the System 🎉

You now have:
- ✅ Firebase Authentication configured
- ✅ Firestore database with security rules
- ✅ Storage with company isolation
- ✅ Initial company created
- ✅ User accounts (superadmin, admin, manager, technician, CSR)
- ✅ Role-based access control

---

## 📁 What Was Created

### Files Created:
1. **`src/lib/firebase/users.ts`** - User and company management functions
2. **`src/lib/firebase/setup.ts`** - Initial setup utilities
3. **`src/components/UserManagementPage.tsx`** - Admin UI for user management
4. **`src/components/FirebaseSetupPage.tsx`** - Setup wizard UI
5. **`firestore.rules`** - Firestore security rules
6. **`storage.rules`** - Storage security rules

### Database Collections:
1. **`users/{uid}`** - User profiles with roles and company info
2. **`companies/{companyId}`** - Company information
3. **`activityLogs/{logId}`** - Audit trail (optional)
4. **`systemSettings/{settingId}`** - System config (optional)

---

## 🔑 Default Accounts Created

| Role | Email | Password | Access Level |
|------|-------|----------|--------------|
| SuperAdmin | superadmin@ahsolutions.com | Admin123!@# | All companies |
| Admin | admin@ahsolutions.com | Admin123! | Company admin |
| Manager | manager@ahsolutions.com | Manager123! | Management features |
| Technician | tech@ahsolutions.com | Tech123! | Field operations |
| CSR | csr@ahsolutions.com | CSR123! | Customer service |

⚠️ **CHANGE ALL PASSWORDS AFTER FIRST LOGIN!**

---

## 💻 Using the API

### Import Functions:
```typescript
import {
  createUserAccount,
  getUserAccount,
  getCompanyUsers,
  updateUserAccount,
  deactivateUserAccount,
  activateUserAccount,
  createCompany,
  getCompany,
  getAllCompanies,
  updateCompany,
} from "@/lib/firebase/users";

import {
  signIn,
  signOut,
  getCurrentUser,
} from "@/lib/firebase/auth";
```

### Create a User:
```typescript
const uid = await createUserAccount(
  {
    email: "john@company.com",
    password: "SecurePass123",
    displayName: "John Smith",
    companyId: "COMP1234567890",
    role: "TECHNICIAN",
    phoneNumber: "+1234567890",
    employeeId: "TECH005",
  },
  currentUserUid // Creator's UID
);
```

### Get Users in a Company:
```typescript
const users = await getCompanyUsers("COMP1234567890");
```

### Update User:
```typescript
await updateUserAccount(uid, {
  displayName: "John Doe",
  phoneNumber: "+9876543210",
  role: "MANAGER",
});
```

### Sign In:
```typescript
const user = await signIn("tech@company.com", "password123");
console.log(user.uid, user.role, user.companyId);
```

---

## 🔐 Security Features

### Company Isolation
- ✅ Users can only access data from their company
- ✅ SuperAdmin can access all companies
- ✅ Storage paths are company-specific
- ✅ Automatic enforcement via security rules

### Role-Based Access Control
- ✅ Each user has a role (SUPERADMIN, ADMIN, MANAGER, etc.)
- ✅ Permissions enforced at database level
- ✅ UI adapts based on user role
- ✅ Admin can manage users in their company

### File Security
- ✅ Files stored in `/companies/{companyId}/...`
- ✅ Only company members can access
- ✅ File type validation (images, PDFs, documents)
- ✅ Size limits (10MB per file)

---

## 🎯 Common Tasks

### Add a New User
1. Login as SuperAdmin or Admin
2. Go to `/admin/users`
3. Click "Add User"
4. Fill in details and select role
5. Click "Create User"

### Create a New Company (SuperAdmin Only)
1. Login as SuperAdmin
2. Go to `/admin/users`
3. Click "Add Company"
4. Fill in company details
5. Click "Create Company"
6. Create an admin user for the new company

### Deactivate a User
1. Go to `/admin/users`
2. Find the user
3. Click the deactivate button (user icon with X)
4. User can no longer login

### Change User Role
1. Go to `/admin/users`
2. Click edit button on user row
3. Select new role from dropdown
4. Click "Update User"

---

## 🛠️ Troubleshooting

### "Firebase not configured"
- Check `.env` file has all `VITE_FIREBASE_*` variables
- Restart dev server after changing `.env`

### "Permission denied" errors
- Deploy security rules from `firestore.rules` and `storage.rules`
- Check user's role and company membership
- Verify user is active

### "Email already in use"
- User already exists in Firebase Auth
- Use "Forgot Password" or delete old account

### Cannot create users
- Check you're logged in as SuperAdmin or Admin
- Admins can only create users in their company
- Check security rules are deployed

---

## 📚 Full Documentation

For complete details, see:
- **`FIREBASE_USER_MANAGEMENT.md`** - Complete system documentation
- **`FIREBASE_SETUP.md`** - Original setup guide
- **`firestore.rules`** - Security rules with comments
- **`storage.rules`** - Storage security rules

---

## 🤝 Support

If you need help:
1. Check Firebase Console for error logs
2. Review security rules in Firestore/Storage
3. Check browser console for detailed errors
4. Review this documentation

---

**Version:** 1.0.0  
**Last Updated:** June 15, 2026  
**Status:** ✅ Ready to Use
