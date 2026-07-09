# Firebase User Management System

## Overview

This document describes the complete Firebase-based user management system that stores all user accounts (superadmins, admins, technicians, CSRs, etc.) with company isolation.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    FIREBASE AUTHENTICATION                   │
├─────────────────────────────────────────────────────────────┤
│  • Email/Password Authentication                            │
│  • User UID (Primary Key)                                   │
│  • Secure Password Management                               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                      FIRESTORE DATABASE                      │
├─────────────────────────────────────────────────────────────┤
│  Collections:                                               │
│  1. users/{uid} - User profiles with roles                  │
│  2. companies/{companyId} - Company information             │
│  3. activityLogs/{logId} - Audit trail                      │
│  4. systemSettings/{settingId} - System configuration       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    FIREBASE STORAGE                          │
├─────────────────────────────────────────────────────────────┤
│  • Company-isolated file storage                            │
│  • Profile pictures, ticket images, documents               │
│  • Automatic security based on company membership           │
└─────────────────────────────────────────────────────────────┘
```

## User Roles

### 1. SUPERADMIN
- **Access:** All companies and all features
- **Capabilities:**
  - Create/manage companies
  - Create/manage all user accounts
  - Access all data across companies
  - System-wide settings and configuration
  - View all activity logs

### 2. ADMIN
- **Access:** Single company, all features
- **Capabilities:**
  - Create/manage users in their company (except SUPERADMIN/ADMIN roles)
  - Full access to company data
  - Manage company settings
  - View company activity logs
  - Cannot create other admins

### 3. MANAGER
- **Access:** Single company, management features
- **Capabilities:**
  - Manage tickets and assignments
  - View reports and analytics
  - Manage employees and schedules
  - Cannot manage user accounts

### 4. CSR (Customer Service Representative)
- **Access:** Single company, ticket management
- **Capabilities:**
  - Create and manage tickets
  - Schedule service calls
  - Customer communication
  - Cannot access payroll or financial data

### 5. TECHNICIAN
- **Access:** Single company, field operations
- **Capabilities:**
  - View assigned tickets
  - Update ticket status
  - Upload before/after photos
  - Track time and parts
  - Cannot see other technicians' data

### 6. DISPATCHER
- **Access:** Single company, scheduling
- **Capabilities:**
  - View all technicians and tickets
  - Assign tickets to technicians
  - Manage schedules
  - Route optimization

### 7. HR
- **Access:** Single company, human resources
- **Capabilities:**
  - Employee management
  - Payroll processing
  - Time card approval
  - Cannot access tickets

### 8. IT
- **Access:** Single company, technical support
- **Capabilities:**
  - System troubleshooting
  - User support
  - Integration management

### 9. PARTS
- **Access:** Single company, inventory
- **Capabilities:**
  - Parts inventory management
  - Purchase orders
  - Parts assignment to tickets

### 10. FINANCE
- **Access:** Single company, financial data
- **Capabilities:**
  - Financial reports
  - Billing and invoicing
  - Revenue analytics

## Firestore Data Structure

### Users Collection: `users/{uid}`

```typescript
{
  uid: string;                    // Firebase Auth UID
  email: string;                  // user@company.com
  displayName: string;            // "John Smith"
  companyId: string;              // "COMP1718123456"
  role: UserRole;                 // "ADMIN" | "TECHNICIAN" | etc.
  isActive: boolean;              // true/false
  phoneNumber?: string;           // "+1234567890"
  employeeId?: string;            // "EMP001"
  department?: string;            // "Field Services"
  createdAt: Timestamp;           // Account creation date
  createdBy: string;              // UID of creator
  updatedAt: Timestamp;           // Last update date
  lastLogin?: Timestamp;          // Last login timestamp
  supabaseUserId?: string;        // For future Supabase integration
  permissions?: string[];         // Additional granular permissions
}
```

### Companies Collection: `companies/{companyId}`

```typescript
{
  companyId: string;              // "COMP1718123456"
  companyName: string;            // "AH Solutions"
  address: string;                // "123 Main St"
  city: string;                   // "New York"
  state: string;                  // "NY"
  zipCode: string;                // "10001"
  phoneNumber: string;            // "+1234567890"
  email: string;                  // "info@ahsolutions.com"
  isActive: boolean;              // true/false
  subscriptionPlan?: string;      // "basic" | "professional" | "enterprise"
  subscriptionExpiresAt?: Timestamp;
  createdAt: Timestamp;
  createdBy: string;              // UID of creator
  settings?: {
    timezone?: string;            // "America/New_York"
    dateFormat?: string;          // "MM/DD/YYYY"
    currency?: string;            // "USD"
    [key: string]: any;
  };
}
```

## Security Rules

### Firestore Security Rules

The system implements role-based access control (RBAC) with the following principles:

1. **Authentication Required:** All operations require a valid authenticated user
2. **Company Isolation:** Users can only access data from their own company (except SUPERADMIN)
3. **Role-Based Permissions:** Operations are restricted based on user role
4. **Immutable Logs:** Activity logs cannot be modified or deleted

Key Rules:
- Users can read their own profile
- SUPERADMIN can read/write all data
- ADMIN can manage users in their company (except creating other admins)
- Regular users can only update limited fields in their profile
- Company data is isolated by companyId

### Storage Security Rules

File storage is automatically secured by:

1. **Company-based path isolation:** `/companies/{companyId}/...`
2. **Authentication check:** Only authenticated users
3. **Company membership:** Users can only access files from their company
4. **File type validation:** Only allowed file types (images, PDFs, documents)
5. **Size limits:** Maximum 10MB per file

## API Functions

### User Management

```typescript
// Create new user account
await createUserAccount({
  email: "tech@company.com",
  password: "securePassword123",
  displayName: "John Smith",
  companyId: "COMP1234567890",
  role: "TECHNICIAN",
  phoneNumber: "+1234567890",
  employeeId: "EMP001",
  department: "Field Services"
}, creatorUid);

// Get user by UID
const user = await getUserAccount(uid);

// Get all users in a company
const users = await getCompanyUsers(companyId);

// Get all users (SUPERADMIN only)
const allUsers = await getAllUsers();

// Update user
await updateUserAccount(uid, {
  displayName: "John Doe",
  phoneNumber: "+9876543210"
});

// Deactivate user (soft delete)
await deactivateUserAccount(uid);

// Activate user
await activateUserAccount(uid);

// Delete user (hard delete - use with caution)
await deleteUserAccount(uid);

// Get users by role
const technicians = await getUsersByRole(companyId, "TECHNICIAN");

// Check permission
const hasAccess = await hasPermission(uid, "ADMIN");
const hasAnyRole = await hasPermission(uid, ["ADMIN", "MANAGER"]);
```

### Company Management

```typescript
// Create new company
const companyId = await createCompany({
  companyName: "AH Solutions",
  address: "123 Main St",
  city: "New York",
  state: "NY",
  zipCode: "10001",
  phoneNumber: "+1234567890",
  email: "info@ahsolutions.com",
  isActive: true,
  subscriptionPlan: "professional"
}, creatorUid);

// Get company
const company = await getCompany(companyId);

// Get all companies (SUPERADMIN only)
const companies = await getAllCompanies();

// Update company
await updateCompany(companyId, {
  phoneNumber: "+9876543210",
  subscriptionPlan: "enterprise"
});
```

## User Management UI

A complete admin interface is provided in `UserManagementPage.tsx` with:

### Features:
- **User Table:** View all users with search and filter
- **Create User:** Add new users with role assignment
- **Edit User:** Update user information and roles
- **Activate/Deactivate:** Toggle user active status
- **Company Management:** Create and edit companies (SUPERADMIN only)
- **Role-based Access:** UI adapts based on current user's role

### Access Control:
- SUPERADMIN: Full access to all features
- ADMIN: Can manage users in their company
- Other roles: No access to user management

## Setup Instructions

### 1. Firebase Console Setup

1. Go to https://console.firebase.google.com/
2. Select your project: `ah-solutions-usapp`
3. Enable Authentication (Email/Password already enabled)
4. Create Firestore Database (already created)
5. Enable Storage (already enabled)

### 2. Deploy Security Rules

#### Deploy Firestore Rules:
```bash
firebase deploy --only firestore:rules
```

Or manually copy rules from `firestore.rules` to Firebase Console:
- Go to Firestore Database → Rules
- Paste the rules from `firestore.rules`
- Publish

#### Deploy Storage Rules:
```bash
firebase deploy --only storage
```

Or manually:
- Go to Storage → Rules
- Paste the rules from `storage.rules`
- Publish

### 3. Create Initial SuperAdmin

**Option A: Firebase Console (Recommended for first user)**

1. Go to Authentication → Users
2. Click "Add user"
3. Email: `superadmin@ahsolutions.com`
4. Password: (set a secure password)
5. Click "Add user"
6. Copy the UID

Then add to Firestore:
1. Go to Firestore Database
2. Create collection `companies` (if not exists)
3. Add document with ID `COMP001`:
   ```json
   {
     "companyId": "COMP001",
     "companyName": "AH Solutions",
     "address": "123 Main St",
     "city": "New York",
     "state": "NY",
     "zipCode": "10001",
     "phoneNumber": "+1234567890",
     "email": "info@ahsolutions.com",
     "isActive": true,
     "subscriptionPlan": "enterprise",
     "createdAt": (current timestamp),
     "createdBy": "system"
   }
   ```

4. Create collection `users` (if not exists)
5. Add document with the UID from step 6:
   ```json
   {
     "uid": "(paste UID here)",
     "email": "superadmin@ahsolutions.com",
     "displayName": "Super Admin",
     "companyId": "COMP001",
     "role": "SUPERADMIN",
     "isActive": true,
     "phoneNumber": "",
     "employeeId": "SA001",
     "department": "Administration",
     "createdAt": (current timestamp),
     "createdBy": "system",
     "updatedAt": (current timestamp)
   }
   ```

**Option B: Using Admin SDK (Backend)**

Create a Node.js script:

```typescript
import admin from 'firebase-admin';

// Initialize Firebase Admin
admin.initializeApp();

async function createSuperAdmin() {
  // Create Auth user
  const user = await admin.auth().createUser({
    email: 'superadmin@ahsolutions.com',
    password: 'SecurePassword123!',
    displayName: 'Super Admin'
  });

  // Create company
  await admin.firestore().collection('companies').doc('COMP001').set({
    companyId: 'COMP001',
    companyName: 'AH Solutions',
    address: '123 Main St',
    city: 'New York',
    state: 'NY',
    zipCode: '10001',
    phoneNumber: '+1234567890',
    email: 'info@ahsolutions.com',
    isActive: true,
    subscriptionPlan: 'enterprise',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: 'system'
  });

  // Create user profile
  await admin.firestore().collection('users').doc(user.uid).set({
    uid: user.uid,
    email: 'superadmin@ahsolutions.com',
    displayName: 'Super Admin',
    companyId: 'COMP001',
    role: 'SUPERADMIN',
    isActive: true,
    employeeId: 'SA001',
    department: 'Administration',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: 'system',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  console.log('SuperAdmin created:', user.uid);
}

createSuperAdmin();
```

### 4. Add User Management Route

Add to your router configuration:

```typescript
// In your route file
import UserManagementPage from "@/components/UserManagementPage";

// Add route
{
  path: "/admin/users",
  component: UserManagementPage,
}
```

### 5. Test the System

1. Login with superadmin credentials
2. Navigate to `/admin/users`
3. Create a test company
4. Create test users with different roles
5. Test login with different users
6. Verify role-based access control

## Best Practices

### Security
1. **Never expose Firebase Admin SDK credentials** in client code
2. **Always validate user roles** on both client and server
3. **Use Firestore Security Rules** as the primary security layer
4. **Audit user activities** using activity logs
5. **Implement rate limiting** for user creation

### User Management
1. **Soft delete by default:** Use `deactivateUserAccount()` instead of hard delete
2. **Require strong passwords:** Minimum 8 characters with complexity
3. **Verify email addresses:** Implement email verification flow
4. **Monitor failed login attempts:** Implement account lockout
5. **Regular access reviews:** Periodically review user permissions

### Company Isolation
1. **Always filter by companyId** in queries
2. **Validate company membership** before operations
3. **Use Firebase Storage rules** for automatic file isolation
4. **Test cross-company access** during development
5. **Document company boundaries** in your code

## Migration from Current System

If you have existing users in localStorage or another system:

1. **Export existing users** to CSV/JSON
2. **Create companies first** using `createCompany()`
3. **Batch create users** using `createUserAccount()`
4. **Map old user IDs** to new Firebase UIDs
5. **Update references** in your application
6. **Test thoroughly** before production deployment

## Troubleshooting

### Common Issues

**Problem:** "Firebase not configured"
- **Solution:** Verify `.env` file has all Firebase credentials
- Check `VITE_FIREBASE_*` variables are set

**Problem:** "Permission denied" in Firestore
- **Solution:** Deploy security rules from `firestore.rules`
- Check user's role and company membership

**Problem:** "Email already in use"
- **Solution:** User already exists in Firebase Auth
- Use "Forgot Password" flow or delete old account

**Problem:** "Weak password"
- **Solution:** Use minimum 6 characters (Firebase default)
- Implement custom validation for stronger passwords

## Next Steps

1. ✅ **Completed:** Firebase user management system
2. ✅ **Completed:** Company isolation and multi-tenancy
3. ✅ **Completed:** Role-based access control
4. ✅ **Completed:** Admin UI for user management
5. ⏭️ **Next:** Deploy security rules to Firebase
6. ⏭️ **Next:** Create initial superadmin account
7. ⏭️ **Next:** Integrate with existing auth system
8. ⏭️ **Next:** Add email verification flow
9. ⏭️ **Next:** Implement activity logging
10. ⏭️ **Next:** Connect to Supabase for business data

## Support

For issues or questions:
1. Check Firebase Console for error logs
2. Review Firestore Security Rules
3. Test with Firebase Emulator Suite
4. Check this documentation for API usage

---

**Version:** 1.0.0  
**Last Updated:** June 15, 2026  
**Status:** ✅ Ready for Deployment
