# Firebase Authentication Migration

## Overview
The application has been migrated from localStorage-based authentication to Firebase Authentication with Firestore user profiles.

## Changes Made

### 1. Authentication Provider (`src/lib/auth.tsx`)
**Before:**
- Used localStorage to store email and companyId
- Role determined by hardcoded email-to-role mapping
- No real authentication security

**After:**
- Uses Firebase Authentication for secure login/logout
- User profiles stored in Firestore with all user metadata
- Real-time auth state listener (`onAuthStateChanged`)
- Automatic session management by Firebase
- Role fetched from Firestore user document

**New Auth Context API:**
```typescript
{
  email: string | null;
  companyId: string | null;
  role: string | null;
  uid: string | null;          // NEW: Firebase user ID
  displayName: string | null;  // NEW: User display name
  isActive: boolean;            // NEW: Account active status
  login: (email: string, password: string) => Promise<void>;  // CHANGED: Now requires password
  logout: () => Promise<void>;  // CHANGED: Now async
  ready: boolean;
  loading: boolean;             // NEW: Loading state
}
```

### 2. Login Page (`src/routes/landing.tsx`)
**Before:**
- Email dropdown with preset test accounts
- Company ID selector
- Any password accepted (demo mode)
- Called `login(email, companyId)`

**After:**
- Email input field (no dropdown)
- Password field (required, real authentication)
- No company ID selector (fetched from Firestore)
- Calls `await login(email, password)`
- Shows Firebase-specific error messages
- Submitting state with disabled form during login

### 3. SuperAdmin Page (`src/routes/superadmin.tsx`)
**Before:**
- Would check localStorage role
- Navigate to "/" if not superadmin

**After:**
- Uses Firebase auth state from `useAuth()`
- Checks `isFirebaseReady()` before loading data
- Shows clear error if Firebase not configured
- Better error handling and logging

## Firebase User Management

### Current Firebase Users
The following accounts exist in Firebase Authentication and Firestore:

1. **jdage7@gmail.com**
   - UID: `2L0R1TKrgpcHp2tGWTFLa5d0zCf2`
   - Role: `SUPERADMIN`
   - Company: `COMP001`
   - Display Name: "Jhon Rulona"
   - Status: Active

2. **superadmin@ahsolutions.com**
   - UID: `YFNpbv1QNqb1Jap6gqWtHyoRi982`
   - Role: `SUPERADMIN`
   - Company: `COMP001`
   - Display Name: "Super Admin AH"
   - Status: Active

### Firestore Structure

**Collection: `users`**
Document ID = Firebase UID
```typescript
{
  uid: string;
  email: string;
  displayName: string;
  companyId: string;
  role: "SUPERADMIN" | "ADMIN" | "MANAGER" | "CSR" | "TECHNICIAN" | "DISPATCHER" | "HR" | "IT" | "PARTS" | "FINANCE";
  isActive: boolean;
  phoneNumber?: string;
  employeeId?: string;
  department?: string;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  lastLogin?: Timestamp;
}
```

**Collection: `companies`**
Document ID = companyId
```typescript
{
  companyId: string;
  companyName: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phoneNumber: string;
  email: string;
  isActive: boolean;
  subscriptionPlan?: "basic" | "professional" | "enterprise";
  createdAt: Timestamp;
  createdBy: string;
}
```

## How to Use

### For Development
1. **Restart the dev server** (important after code changes):
   ```bash
   # Stop current server (Ctrl+C)
   bun run dev
   # or
   npm run dev
   ```

2. **Clear localStorage** (if migrating from old system):
   - Open browser DevTools → Application → Local Storage
   - Clear all items or specifically:
     - `userEmail`
     - `userCompanyId`
     - `ahs:lastEmail`

3. **Login with Firebase credentials**:
   - Email: `jdage7@gmail.com` or `superadmin@ahsolutions.com`
   - Password: Your Firebase password

4. **Check browser console** for Firebase initialization logs:
   ```
   ✅ Firebase initialized successfully
   🔐 Setting up Firebase Auth listener...
   ✅ Firebase user authenticated: [email]
   ✅ User profile loaded: { email, role, companyId, isActive }
   ```

### Creating New Users
Use the SuperAdmin dashboard (`/superadmin`) to:
1. Create companies
2. Create admin users for those companies

Or use Firebase Console:
1. Create user in Firebase Authentication
2. Create matching document in Firestore `users` collection with all required fields

## Migration Checklist

- [x] Update `src/lib/auth.tsx` to use Firebase
- [x] Update `src/routes/landing.tsx` for Firebase login
- [x] Update `src/routes/superadmin.tsx` for async logout
- [x] Remove localStorage email/companyId dependencies
- [x] Add proper error handling
- [x] Add loading states
- [ ] Test all protected routes work with Firebase auth
- [ ] Update other pages that might use `login()` method
- [ ] Add password reset functionality
- [ ] Add email verification flow (optional)
- [ ] Update deployment instructions

## Security Improvements

1. **Real Authentication**: Users must have valid Firebase credentials
2. **Secure Sessions**: Firebase handles JWT tokens automatically
3. **Firestore Rules**: Configure security rules to restrict access by role
4. **No Client-Side Role Mapping**: Roles stored securely in Firestore
5. **Account Management**: Can activate/deactivate users in Firestore

## Firestore Security Rules (Recommended)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users collection
    match /users/{userId} {
      // Users can read their own profile
      allow read: if request.auth.uid == userId;
      
      // SUPERADMIN can read all users
      allow read: if request.auth != null && 
                     get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'SUPERADMIN';
      
      // Only SUPERADMIN can create/update/delete users
      allow write: if request.auth != null && 
                      get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'SUPERADMIN';
    }
    
    // Companies collection
    match /companies/{companyId} {
      // Users can read their own company
      allow read: if request.auth != null && 
                     get(/databases/$(database)/documents/users/$(request.auth.uid)).data.companyId == companyId;
      
      // SUPERADMIN can read all companies
      allow read: if request.auth != null && 
                     get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'SUPERADMIN';
      
      // Only SUPERADMIN can create/update/delete companies
      allow write: if request.auth != null && 
                      get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'SUPERADMIN';
    }
  }
}
```

## Testing

### Manual Testing Steps
1. Clear browser cache and localStorage
2. Navigate to `/landing`
3. Click "Login"
4. Enter valid Firebase credentials
5. Should redirect to `/home` after successful login
6. Navigate to `/superadmin`
7. Should see user management dashboard if SUPERADMIN
8. Click "Logout"
9. Should redirect to `/landing`
10. Refresh page - should stay logged out

### Error Scenarios to Test
1. Invalid email → "No account found with this email"
2. Wrong password → "Incorrect password"
3. Inactive account → "Account is inactive. Contact administrator."
4. Firebase not configured → "Firebase not configured. Cannot login."
5. Network error → Appropriate error message

## Troubleshooting

### "Firebase not configured" Error
- Check `.env` file has all required Firebase variables
- Restart dev server after modifying `.env`
- Check browser console for Firebase initialization errors

### "Maximum update depth exceeded" Error
- Old code is still running
- Restart dev server
- Hard refresh browser (Ctrl+Shift+R)

### "User profile not found in Firestore"
- User exists in Firebase Auth but not in Firestore
- Create matching document in Firestore `users` collection
- Use SuperAdmin dashboard to create users (creates both Auth + Firestore)

### Can't login after migration
- Clear localStorage in browser DevTools
- Use actual Firebase password (not demo "any password")
- Check user exists in both Firebase Authentication AND Firestore

## Next Steps

1. **Migrate other pages** that might call `login()` directly
2. **Add password reset** functionality
3. **Add email verification** on signup
4. **Update role-based route guards** to use Firebase auth
5. **Add session timeout** handling
6. **Implement refresh token** handling
7. **Add audit logging** for auth events
8. **Deploy Firestore security rules**
9. **Test with multiple concurrent users**
10. **Add "Remember me" token persistence** (optional)

## Breaking Changes

⚠️ **IMPORTANT**: The following code patterns no longer work:

```typescript
// ❌ OLD (no longer works)
login(email, companyId)
logout()

// ✅ NEW (required)
await login(email, password)
await logout()
```

Any component using `login()` or `logout()` must be updated to:
1. Use async/await
2. Provide password parameter for login
3. Handle errors with try/catch
4. Remove companyId parameter (fetched from Firestore)

## Support

For issues or questions:
1. Check browser console for detailed error logs
2. Verify Firebase configuration in `.env`
3. Check Firestore security rules
4. Review this migration document
5. Contact system administrator
