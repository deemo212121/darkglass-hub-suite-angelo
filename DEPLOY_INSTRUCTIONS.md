# Firebase Deployment Instructions

## ✅ Step 1: Update Environment (DONE)
Your `.env` file has been updated with the new Firebase project credentials.

## 🔥 Step 2: Enable Firebase Services

Go to Firebase Console: https://console.firebase.google.com/project/ah-solutions-usapp

### Enable Authentication
1. Click **Authentication** → **Get Started**
2. Enable **Email/Password** provider
3. **DO NOT** enable anonymous sign-in
4. Save

### Create Firestore Database
1. Click **Firestore Database** → **Create database**
2. Select **Production mode**
3. Choose location: **us-central1** (or closest to you)
4. Click **Enable**

### Enable Storage
1. Click **Storage** → **Get started**
2. Use **Production mode**
3. Choose same location as Firestore
4. Click **Done**

## 📋 Step 3: Initialize Firebase CLI

Open terminal in your project directory:

```bash
# Install Firebase CLI globally (if not already installed)
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize Firebase in your project
firebase init
```

When prompted, select:
- ✅ **Firestore** (Database rules and indexes)
- ✅ **Storage** (Storage rules)
- ❌ Hosting (not needed)
- ❌ Functions (not needed yet)

Then:
- **Firestore rules file**: Press Enter (use `firestore.rules`)
- **Firestore indexes file**: Press Enter (use `firestore.indexes.json`)
- **Storage rules file**: Press Enter (use `storage.rules`)
- **Project**: Select `ah-solutions-usapp`

## 🚀 Step 4: Deploy Security Rules

```bash
# Deploy Firestore rules
firebase deploy --only firestore:rules

# Deploy Storage rules
firebase deploy --only storage
```

You should see:
```
✔ Deploy complete!
```

## 👥 Step 5: Create Test Users

Go to Firebase Console → Authentication → Users → **Add user**

Create these accounts:

| Email | Password | Role |
|-------|----------|------|
| admin@ahsolutions.com | admin123 | ADMIN |
| manager@ahsolutions.com | manager123 | MANAGER |
| tech@ahsolutions.com | tech123 | TECHNICIAN |
| csr@ahsolutions.com | csr123 | CSR |
| superadmin@ahsolutions.com | super123 | SUPERADMIN |

## 📝 Step 6: Create User Profiles in Firestore

After creating each user, note their **UID** from the Authentication tab.

Go to **Firestore Database** → Click **Start collection**

Collection ID: `users`

For each user, create a document with their **UID** as the document ID:

**Example for admin@ahsolutions.com:**
```
Document ID: [paste the UID from Auth]

Fields:
- uid (string): [same UID]
- email (string): admin@ahsolutions.com
- companyId (string): COMP001
- role (string): ADMIN
- displayName (string): Admin User
- supabaseUserId (string): [leave empty]
- isActive (boolean): true
- createdAt (timestamp): [click "Set to current time"]
- lastLogin (timestamp): [click "Set to current time"]
```

Repeat for all 5 users with appropriate roles.

## ✅ Step 7: Test Your Setup

Start your dev server:
```bash
npm run dev
```

Open browser console (F12) and check for:
```
✅ Firebase initialized successfully
```

Try logging in with one of the test accounts.

## 🎉 Success!

You should now be able to:
- ✅ Sign in with test accounts
- ✅ Upload files to Firebase Storage
- ✅ Access user profiles from Firestore
- ✅ Multi-company isolation working

## 🔗 Quick Links

- **Firebase Console**: https://console.firebase.google.com/project/ah-solutions-usapp
- **Authentication**: https://console.firebase.google.com/project/ah-solutions-usapp/authentication/users
- **Firestore**: https://console.firebase.google.com/project/ah-solutions-usapp/firestore
- **Storage**: https://console.firebase.google.com/project/ah-solutions-usapp/storage

## ❓ Troubleshooting

**"Firebase not configured"**
→ Restart dev server after updating `.env`

**"Permission denied" on Firestore/Storage**
→ Make sure rules are deployed: `firebase deploy --only firestore:rules storage`

**"User profile not found"**
→ Check that user profile exists in Firestore `users/{uid}` collection

**"Invalid credentials"**
→ Make sure you created the user in Firebase Authentication first

---

**Next:** After deployment, see `FIREBASE_USAGE_GUIDE.md` for how to use Firebase in your code.
