# Firebase Quick Start Checklist

Follow these steps in order to get Firebase up and running.

## ✅ Already Done

- [x] Created Firebase project: `ah-solutions-usapp`
- [x] Got Firebase configuration
- [x] Updated `.env` with new credentials
- [x] All Firebase service files created
- [x] Security rules files ready

## 🔥 Do This Now

### Step 1: Enable Firebase Services (5 minutes)

Go to: https://console.firebase.google.com/project/ah-solutions-usapp

- [ ] **Authentication**
  - [ ] Click Authentication → Get Started
  - [ ] Enable Email/Password
  - [ ] Save

- [ ] **Firestore Database**
  - [ ] Click Firestore Database → Create database
  - [ ] Production mode
  - [ ] Location: us-central1
  - [ ] Enable

- [ ] **Storage**
  - [ ] Click Storage → Get started
  - [ ] Production mode
  - [ ] Same location
  - [ ] Done

### Step 2: Install Firebase CLI (2 minutes)

Open terminal:
```bash
npm install -g firebase-tools
```

### Step 3: Login & Initialize (3 minutes)

```bash
# Login
firebase login

# Initialize (select Firestore + Storage, NOT Hosting/Functions)
firebase init
```

### Step 4: Deploy Rules (1 minute)

```bash
firebase deploy --only firestore:rules
firebase deploy --only storage
```

Look for: `✔ Deploy complete!`

### Step 5: Create Test Users (5 minutes)

Go to Authentication → Users → Add user

- [ ] admin@ahsolutions.com (password: admin123)
- [ ] superadmin@ahsolutions.com (password: super123)

### Step 6: Create User Profiles (5 minutes)

Go to Firestore Database → Start collection → `users`

- [ ] Create document for admin (use UID from Auth)
- [ ] Create document for superadmin (use UID from Auth)

**Document structure:**
```
uid: [UID from Auth]
email: [user email]
companyId: COMP001
role: ADMIN (or SUPERADMIN)
displayName: [User Name]
supabaseUserId: [empty]
isActive: true
createdAt: [current timestamp]
lastLogin: [current timestamp]
```

### Step 7: Test (2 minutes)

```bash
npm run dev
```

- [ ] Check console for: `✅ Firebase initialized successfully`
- [ ] Try logging in with admin@ahsolutions.com
- [ ] Check for successful login

## 🎉 Done!

If all steps are checked, Firebase is fully set up and working!

## 📚 What to Read Next

- `FIREBASE_USAGE_GUIDE.md` - Learn how to use Firebase in your code
- `DEPLOY_INSTRUCTIONS.md` - Detailed deployment instructions
- `FIREBASE_SETUP.md` - Complete architecture overview

## ⏱️ Total Time: ~23 minutes

---

**Having issues?** See `DEPLOY_INSTRUCTIONS.md` for troubleshooting.
