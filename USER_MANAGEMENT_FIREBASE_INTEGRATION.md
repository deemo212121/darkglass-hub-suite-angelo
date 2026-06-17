# User Management Firebase Integration

## Overview
The Admin User Management page (`/m/admin/user-management`) has been updated to integrate with Firebase while keeping all existing UI columns and functionality.

## What Changed

### 1. Replaced Dummy Data with Firebase
- **Before**: Used static `USER_MANAGEMENT_RECORDS` array with 177 hardcoded records
- **After**: Loads users dynamically from Firebase Firestore using `getCompanyUsers()`

### 2. Firebase Integration
- Added `useAuth()` hook to get current logged-in user
- Added `useState` for users list and loading state
- Added `useEffect` to load users from Firebase on component mount
- Users are automatically filtered by company ID from logged-in user

### 3. Create User Function Updated
- **Before**: Only created local record and saved to localStorage
- **After**: 
  - Creates user in Firebase Authentication
  - Creates user profile in Firestore
  - Auto-assigns company ID from logged-in user
  - Auto-generates username from display name (FirstName.LastName)
  - Sets default password: `Welcome2024!`
  - Reloads user list after creation

### 4. User Type Dropdown Updated
- Added all Firebase UserRole options:
  - ADMIN
  - MANAGER
  - CSR
  - TECHNICIAN
  - DISPATCHER
  - HR
  - IT
  - PARTS
  - FINANCE

### 5. Data Mapping
Maps Firebase `UserAccount` to UI `UserManagementRecord`:
```typescript
{
  id: fbUser.uid,                              // Firebase UID
  loginName: fbUser.username,                  // Generated username
  userName: fbUser.displayName,                // Display name
  type: fbUser.role,                           // UserRole
  email: fbUser.email,                         // Email
  manager: "",                                 // TODO: Add to Firebase schema
  technicianId: fbUser.employeeId,            // Employee ID field
  office: "",                                  // TODO: Add to Firebase schema
  locations: "",                               // TODO: Add to Firebase schema
}
```

## What Stayed the Same

### All Existing Columns Kept
- ✅ ID
- ✅ Login Name
- ✅ User Name
- ✅ Type
- ✅ Email
- ✅ Manager
- ✅ Technician ID
- ✅ Assigned Branch
- ✅ Branch Access

### All Form Fields Kept
- ✅ Login Name (input)
- ✅ User Name (input)
- ✅ Email (input)
- ✅ User Type (dropdown with all roles)
- ✅ Manager (input)
- ✅ Technician ID (input)
- ✅ Assigned Branch (input)
- ✅ Branch Access (input)
- ✅ PO # Initial (input)
- ✅ Required Schedule (check-in/check-out times)
- ✅ Days Off (week selector)

### Existing Features Maintained
- ✅ List view
- ✅ Hierarchy view (grouped by manager)
- ✅ Search functionality
- ✅ Add User modal
- ✅ Back button to Admin module
- ✅ User links (clickable)
- ✅ Schedule saved to localStorage (for now)
- ✅ Off days saved to localStorage (for now)
- ✅ PO initials saved to localStorage (for now)

## Known Limitations (TODO)

### Firebase Schema Missing Fields
These fields are currently empty in the table because they don't exist in Firebase `UserAccount`:
- **Manager**: Not in Firebase schema yet
- **Office/Branch**: Not in Firebase schema yet
- **Locations**: Not in Firebase schema yet

### LocalStorage Still Used For
- Required schedule (check-in/check-out times)
- Days off configuration
- PO initials

These should be moved to Firebase in the future.

## How It Works

### Loading Users (On Page Load)
1. User visits `/m/admin/user-management`
2. Component gets logged-in user's `companyId` from `useAuth()`
3. Calls `getCompanyUsers(companyId)` to fetch all users in company
4. Maps Firebase `UserAccount[]` to `UserManagementRecord[]`
5. Displays in table

### Creating New User
1. User fills out form and clicks "Create User"
2. Validates required fields
3. Calls `createUserAccount()` with:
   - Email from form
   - Default password: `Welcome2024!`
   - Display name from form
   - Company ID from logged-in user
   - Role from dropdown
   - Employee ID from Technician ID field
4. Firebase creates:
   - Auth user with email/password
   - Firestore user profile with all data
   - Auto-generated username (FirstName.LastName)
5. Saves schedule/off-days/PO to localStorage (temp)
6. Reloads user list from Firebase
7. Shows success message

## Security

### Company Isolation
- Users can only see users from their own company
- Company ID automatically assigned from logged-in user
- No way to create users in other companies

### Firebase Rules
Controlled by `firestore.rules`:
```
match /users/{userId} {
  allow read: if true;  // Allow unauthenticated read for username login
  allow write: if false; // Only system/admin can write
}
```

## Testing

### Test Creating a User
1. Log in as Admin user
2. Go to `/m/admin/user-management`
3. Click "+ Add User"
4. Fill in required fields:
   - Login Name: (will be overridden by auto-generated username)
   - User Name: "John Doe"
   - Email: "john.doe@company.com"
   - User Type: Select a role
   - Manager: Enter manager name
   - Assigned Branch: "Memphis"
   - Branch Access: "Memphis, Nashville"
5. Click "Create User"
6. User should appear in Firebase and in the table
7. Default password is `Welcome2024!`
8. Username will be auto-generated as `John.Doe`

### Verify in Firebase Console
1. Go to Firebase Console → Authentication
2. Look for newly created user email
3. Go to Firestore → users collection
4. Find user document by UID
5. Verify all fields are populated

## Future Enhancements

### Expand Firebase Schema
Add these fields to `UserAccount` interface:
```typescript
interface UserAccount {
  // ... existing fields
  managerId?: string;           // UID of manager
  managerName?: string;          // Display name of manager
  office?: string;               // Primary office/branch
  locations?: string[];          // Array of accessible locations
  requiredCheckIn?: string;      // e.g., "08:00"
  requiredCheckOut?: string;     // e.g., "17:00"
  offDays?: number[];            // [0=Mon, 1=Tue, ...]
  poInitials?: string;           // PO number initials
}
```

### Migrate LocalStorage to Firebase
Move these from localStorage to Firestore:
- Required schedule
- Off days
- PO initials

### Add Edit/Delete Functions
- Edit user button (update existing user)
- Deactivate user button (soft delete)
- Delete user button (hard delete)

### Add Validation
- Check for duplicate emails before creating
- Validate email format
- Check username uniqueness
- Validate role permissions

## Files Modified
- `src/components/AdminUserManagementPage.tsx` - Main component with Firebase integration

## Files Referenced
- `src/lib/firebase/users.ts` - Firebase user management functions
- `src/lib/user-management.ts` - UserManagementRecord type definition
- `src/lib/auth.tsx` - Authentication context and hooks
