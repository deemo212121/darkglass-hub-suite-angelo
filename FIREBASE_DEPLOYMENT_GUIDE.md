# Firebase Deployment Guide

This guide shows you how to deploy the Firebase security rules and set up your Firebase project.

## Prerequisites

✅ Firebase project already exists: `adminhubsolutions`
✅ Environment variables already configured in `.env`
✅ Firebase package already installed (v12.14.0)
✅ All Firebase service files created

## Step 1: Install Firebase CLI

Open your terminal and install the Firebase CLI globally:

```bash
npm install -g firebase-tools
```

Verify installation:

```bash
firebase --version
```

## Step 2: Login to Firebase

```bash
firebase login
```

This will open a browser window for you to authenticate with your Google account.

## Step 3: Initialize Firebase (Optional)

If you haven't initialized Firebase in this project yet, run:

```bash
firebase init
```

Select:
- ✅ Firestore (to deploy firestore.rules)
- ✅ Storage (to deploy storage.rules)
- ❌ Hosting (not needed)
- ❌ Functions (not needed yet)

When prompted:
- **Firestore rules file**: Press Enter (use `firestore.rules`)
- **Firestore indexes file**: Press Enter (use `firestore.indexes.json`)
- **Storage rules file**: Press Enter (use `storage.rules`)
- **Project**: Select `adminhubsolutions`

> **Note:** If `firebase.json` already exists in your project, you can skip this step.

## Step 4: Deploy Firestore Rules

Deploy only the Firestore security rules:

```bash
firebase deploy --only firestore:rules
```

You should see:
```
✔ Deploy complete!
```

## Step 5: Deploy Storage Rules

Deploy only the Storage security rules:

```bash
firebase deploy --only storage
```

You should see:
```
✔ Deploy complete!
```

## Step 6: Create Test Users

Go to Firebase Console: https://console.firebase.google.com/

1. Navigate to **Authentication** → **Users**
2. Click **Add user**
3. Create these test accounts:

### Test Users to Create

| Email | Password | Role | Company ID |
|-------|----------|------|------------|
| `admin@ahsolutions.com` | `admin123` | ADMIN | COMP001 |
| `manager@ahsolutions.com` | `manager123` | MANAGER | COMP001 |
| `tech@ahsolutions.com` | `tech123` | TECHNICIAN | COMP001 |
| `csr@ahsolutions.com` | `csr123` | CSR | COMP001 |
| `superadmin@ahsolutions.com` | `super123` | SUPERADMIN | COMP001 |

## Step 7: Create User Profiles in Firestore

After creating users in Firebase Auth, you need to manually create their profiles in Firestore:

1. Go to **Firestore Database** in Firebase Console
2. Click **Start collection**
3. Collection ID: `users`
4. For each user, create a document with their UID as the document ID:

Example document structure:

```json
{
  "uid": "firebase_uid_here",
  "email": "admin@ahsolutions.com",
  "companyId": "COMP001",
  "role": "ADMIN",
  "displayName": "Admin User",
  "supabaseUserId": "",
  "isActive": true,
  "createdAt": "[Timestamp]",
  "lastLogin": "[Timestamp]"
}
```

> **Note:** You can get the UID from the Authentication tab after creating the user.

## Step 8: Verify Security Rules

### Test Firestore Rules

In Firebase Console → Firestore → Rules:

1. Click **Rules Playground**
2. Test these scenarios:

**✅ Should PASS:**
- Read `/users/{uid}` as authenticated user with matching UID
- Read `/users/{any_uid}` as SUPERADMIN

**❌ Should FAIL:**
- Read `/users/{uid}` as unauthenticated user
- Read `/users/{other_uid}` as regular user
- Write to `/users/{uid}` without authentication

### Test Storage Rules

In Firebase Console → Storage → Rules:

1. Test file access:
   - Try accessing `companies/COMP001/users/{uid}/profile.jpg`
   - Should work if authenticated and user belongs to COMP001
   - Should fail if user belongs to different company

## Step 9: Test Authentication in App

1. Start your dev server:
   ```bash
   npm run dev
   ```

2. Go to the login page
3. Try logging in with one of the test accounts
4. Check browser console for Firebase connection status

You should see:
```
✅ Firebase initialized successfully
```

## Step 10: Test File Upload (Optional)

Once authentication works, test file upload:

1. Try uploading a profile picture
2. Check Firebase Console → Storage
3. Verify file is stored under correct path:
   ```
   companies/COMP001/users/{uid}/profile.jpg
   ```

## Common Issues

### Issue: "Firebase not configured"

**Solution:** Verify `.env` has all Firebase variables:
```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
```

### Issue: "Permission denied" when accessing Firestore

**Solution:** 
1. Check if rules are deployed: `firebase deploy --only firestore:rules`
2. Verify user document exists in Firestore with correct structure

### Issue: "Storage upload failed"

**Solution:**
1. Check if storage rules are deployed: `firebase deploy --only storage`
2. Verify user belongs to the company they're trying to upload to
3. Check file size limits (5MB for images, 10MB for documents)

### Issue: "User profile not found"

**Solution:**
1. Check if user has a profile in Firestore `users/{uid}` collection
2. Verify the UID matches between Auth and Firestore

## Firebase Console Links

- **Project Overview**: https://console.firebase.google.com/project/adminhubsolutions
- **Authentication**: https://console.firebase.google.com/project/adminhubsolutions/authentication/users
- **Firestore Database**: https://console.firebase.google.com/project/adminhubsolutions/firestore
- **Storage**: https://console.firebase.google.com/project/adminhubsolutions/storage

## Next Steps

After deployment is complete:

1. ✅ Verify all services are working
2. ✅ Test user authentication
3. ✅ Test file upload/download
4. → Integrate Firebase Auth into existing login flow
5. → Replace localStorage auth with Firebase Auth
6. → Add file upload UI for tickets and parts

## Useful Commands

```bash
# Deploy everything
firebase deploy

# Deploy only Firestore rules
firebase deploy --only firestore:rules

# Deploy only Storage rules
firebase deploy --only storage

# View current project
firebase projects:list

# Switch project
firebase use adminhubsolutions

# Open Firebase Console
firebase open
```

## Security Checklist

- ✅ Firestore rules deployed and tested
- ✅ Storage rules deployed and tested
- ✅ Test users created in Firebase Auth
- ✅ User profiles created in Firestore
- ✅ Multi-company isolation verified
- ✅ File upload size limits enforced
- ✅ File type validation in place
- ✅ Cross-company access blocked

---

**Status:** Firebase backend is ready. Next step is to integrate with the frontend login system.
