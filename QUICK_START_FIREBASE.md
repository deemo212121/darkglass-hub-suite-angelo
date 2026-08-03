# Quick Start - Firebase Authentication

## 🚀 You're Now Using Firebase Authentication!

The app has been migrated from localStorage to production Firebase Authentication.

## Immediate Actions Required

### 1️⃣ Restart Your Dev Server (CRITICAL!)

```bash
# Stop the current dev server (Ctrl+C in terminal)
# Then restart:
bun run dev
# or
npm run dev
```

**Why?** Code changes don't take effect until server restarts.

### 2️⃣ Clear Your Browser Data

1. Open browser DevTools (F12)
2. Go to **Application** tab → **Local Storage**
3. Delete these items:
   - `userEmail`
   - `userCompanyId`
   - `ahs:lastEmail`
4. **Hard refresh**: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)

**Why?** Old localStorage auth data will conflict with Firebase.

### 3️⃣ Login with Firebase Credentials

Navigate to: http://localhost:8080

Use one of these accounts:
- **Email**: `jdage7@gmail.com`
- **Email**: `superadmin@ahsolutions.com`
- **Password**: Your actual Firebase password (not demo password)

## What to Expect

### ✅ Successful Login
Browser console will show:
```
✅ Firebase initialized successfully
🔐 Setting up Firebase Auth listener...
✅ Firebase user authenticated: your.email@example.com
✅ User profile loaded: { email, role, companyId, isActive }
```

You'll be redirected to `/home` automatically.

### ❌ Common Errors

**"Firebase not configured"**
- Check `.env` file has Firebase variables
- Restart dev server
- Check Firebase console for project status

**"Incorrect password"**
- Use your actual Firebase password
- Not a demo/any password anymore
- Reset password in Firebase Console if needed

**"User profile not found in Firestore"**
- User exists in Auth but not in Firestore database
- Use SuperAdmin dashboard to create user properly
- Or add document manually in Firestore

**"Maximum update depth exceeded"**
- Old code still running
- Restart dev server (step 1 above)
- Hard refresh browser (step 2 above)

## New Login System

### Old Way (localStorage) ❌
```typescript
// This no longer works
login(email, companyId)
```

### New Way (Firebase) ✅
```typescript
// Must use password
await login(email, password)
```

## Testing Your Setup

### Basic Test
1. Clear localStorage ✓
2. Navigate to http://localhost:8080 ✓
3. Click "Login" ✓
4. Enter Firebase credentials ✓
5. See console logs (F12) ✓
6. Redirected to /home ✓

### SuperAdmin Test
1. Login as superadmin ✓
2. Navigate to /superadmin ✓
3. See users and companies from Firebase ✓
4. Click "Add Company" ✓
5. Fill form and create company ✓
6. Click "Add New Admin" ✓
7. Create admin user ✓

## Firebase Console Access

Check your Firebase project:
- **URL**: https://console.firebase.google.com/project/ah-solutions-usapp
- **Authentication**: See login events
- **Firestore**: View users & companies
- **Rules**: Configure security

## Current Firebase Accounts

### SUPERADMIN Accounts
1. **jdage7@gmail.com**
   - Role: SUPERADMIN
   - Company: COMP001
   - Can manage all users and companies

2. **superadmin@ahsolutions.com**
   - Role: SUPERADMIN
   - Company: COMP001
   - Can manage all users and companies

## Creating New Users

### Via SuperAdmin Dashboard (Recommended)
1. Login as SUPERADMIN
2. Go to `/superadmin`
3. Click "Add Company" (if needed)
4. Click "Add New Admin"
5. Fill in all fields
6. Click "Create Admin"

This creates both:
- Firebase Authentication user
- Firestore user profile

### Via Firebase Console (Manual)
1. **Authentication**: Create user with email/password
2. **Firestore**: Create document in `users` collection:
   ```json
   {
     "uid": "from-firebase-auth",
     "email": "user@example.com",
     "displayName": "User Name",
     "companyId": "COMP001",
     "role": "ADMIN",
     "isActive": true,
     "phoneNumber": "",
     "employeeId": "",
     "department": "",
     "createdAt": "timestamp",
     "createdBy": "creator-uid",
     "updatedAt": "timestamp"
   }
   ```

## What Changed?

| Feature | Before (localStorage) | After (Firebase) |
|---------|----------------------|------------------|
| Authentication | None (fake) | Real passwords |
| User Storage | localStorage | Firestore |
| Sessions | Browser only | Firebase JWT |
| Security | None | Firebase Auth |
| Roles | Hardcoded | Firestore |
| Multi-device | No | Yes |
| Logout | Clear localStorage | Firebase signOut |

## Troubleshooting Commands

```bash
# Restart dev server
Ctrl+C
bun run dev

# Check Firebase status in browser console
F12 → Console tab

# View current user
localStorage.clear()  # in console
location.reload()     # in console

# Check environment variables
cat .env              # in terminal
```

## Next Steps

1. ✅ Restart server
2. ✅ Clear browser data
3. ✅ Login with Firebase
4. ✅ Test SuperAdmin dashboard
5. ⏭️ Create test users
6. ⏭️ Test other pages with new auth
7. ⏭️ Deploy Firestore security rules
8. ⏭️ Add password reset feature

## Documentation

- 📄 **FIREBASE_AUTH_MIGRATION.md** - Detailed technical docs
- 📄 **PRODUCTION_FIREBASE_READY.md** - Production deployment guide
- 📄 **FIREBASE_SETUP.md** - Original Firebase configuration

## Need Help?

### Check Console Logs
Press F12 → Console tab to see detailed error messages

### Common Solutions
1. Restart dev server (solves 80% of issues)
2. Clear localStorage (solves 15% of issues)
3. Check `.env` file (solves 4% of issues)
4. Check Firebase Console (solves 1% of issues)

### Still Stuck?
- Review error message in console
- Check FIREBASE_AUTH_MIGRATION.md
- Verify Firebase project is active
- Ensure user exists in both Auth and Firestore

---

## 🎉 You're Ready!

Follow steps 1-3 above and you'll be running on Firebase Authentication in minutes!
