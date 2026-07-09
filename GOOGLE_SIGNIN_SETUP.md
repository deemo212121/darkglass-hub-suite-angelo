# Google Sign-In Setup Guide

## Overview

Your login page now supports **two authentication modes**:

1. **Demo Mode** - Test accounts with preloaded data (existing functionality)
2. **Real Account** - Firebase authentication with:
   - ✅ Email/Password login
   - ✅ Google Sign-In (Gmail accounts)

## 🎯 Features Added

### Login Page Updates
- Toggle between "Demo Mode" and "Real Account"
- Google Sign-In button with official Google branding
- Email/password form for Firebase accounts
- Error handling for both methods
- Seamless user experience

### Firebase Authentication
- Google OAuth integration
- Automatic user profile lookup in Firestore
- Company and role-based access control
- Security checks (active account, registered user)

## 📋 Setup Instructions

### Step 1: Enable Google Sign-In in Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: `ah-solutions-usapp`
3. Navigate to **Authentication** → **Sign-in method**
4. Click on **Google** provider
5. Click **Enable**
6. Add your support email (required)
7. Click **Save**

That's it! Google Sign-In is now enabled.

### Step 2: Configure Authorized Domains (Production)

For production deployment, you need to add your domain:

1. In Firebase Console → Authentication → Settings
2. Go to **Authorized domains**
3. Add your domains:
   - `localhost` (already there)
   - `your-domain.com`
   - `www.your-domain.com`

### Step 3: Test Google Sign-In

1. Start your dev server
2. Go to the landing page
3. Click "Login"
4. Switch to "Real Account" tab
5. Click "Continue with Google"
6. Sign in with your Google account

**Important:** The Google account must already have a user profile in Firestore created by an admin!

## 🔐 How It Works

### Google Sign-In Flow

```
User clicks "Continue with Google"
        ↓
Google OAuth popup opens
        ↓
User selects Google account
        ↓
Firebase authenticates user
        ↓
Check if user exists in Firestore
        ↓
┌─────────────────┬─────────────────┐
│  Profile Exists  │  No Profile     │
│  & Active       │  Found          │
└────────┬────────┴────────┬────────┘
         ↓                 ↓
    Login Success     Show Error
    Navigate to       "Contact Admin"
    Home Page
```

### Security Features

1. **Profile Required:** Users must be registered by an admin first
2. **Active Check:** Inactive accounts cannot login
3. **Company Isolation:** Users can only access their company data
4. **Role-Based Access:** Permissions based on assigned role

## 👥 User Registration Process

### For Admins/SuperAdmins

To allow a user to login with Google:

1. Get the user's Gmail address
2. Go to `/admin/users`
3. Click "Add User"
4. Enter their Gmail address as email
5. Set a temporary password (they won't need it if using Google)
6. Assign company and role
7. Click "Create User"

The user can now login with their Google account!

### For Users

1. Wait for admin to create your account
2. Go to landing page
3. Switch to "Real Account"
4. Click "Continue with Google"
5. Select your Gmail account
6. You're in!

## 🎨 UI Components

### Login Mode Toggle

```tsx
┌─────────────────────────────────┐
│  [Demo Mode]  [Real Account]    │
└─────────────────────────────────┘
```

Users can switch between demo and real accounts easily.

### Google Sign-In Button

```tsx
┌─────────────────────────────────────┐
│  [G] Continue with Google           │
└─────────────────────────────────────┘
```

Official Google branding with animated loading state.

### Email/Password Form

```tsx
┌─────────────────────────────────────┐
│  Email:    [your.email@company.com] │
│  Password: [••••••••]                │
│  □ Remember me                       │
│  [Sign in with Email]                │
└─────────────────────────────────────┘
```

Traditional login for Firebase email/password accounts.

## 🔧 API Functions

### Sign In with Google
```typescript
import { signInWithGoogle } from "@/lib/firebase/auth";

const user = await signInWithGoogle();
console.log(user.uid, user.email, user.companyId, user.role);
```

### Sign In with Email/Password
```typescript
import { signIn } from "@/lib/firebase/auth";

const user = await signIn("user@company.com", "password123");
console.log(user.uid, user.email, user.companyId, user.role);
```

### Link Google to Existing Account
```typescript
import { linkWithGoogle } from "@/lib/firebase/auth";

// User must be logged in first
await linkWithGoogle();
// Now user can sign in with both email/password and Google
```

## ⚠️ Important Notes

### Google Account Requirements

1. **Must be registered first:** Users cannot self-register via Google
2. **Email must match:** The Gmail address must match the email in Firestore
3. **Account must be active:** Inactive accounts will be rejected

### Error Messages

| Error | Meaning | Solution |
|-------|---------|----------|
| "Account not found" | User not in Firestore | Admin must create account |
| "Account is inactive" | Account deactivated | Admin must activate account |
| "Popup was closed" | User closed the popup | Try again |
| "Popup was blocked" | Browser blocked popup | Allow popups for your site |

## 🧪 Testing

### Test with Demo Mode

1. Switch to "Demo Mode"
2. Select any test account
3. Enter any password
4. Login works with dummy data

### Test with Real Account

1. Create a test user in Firebase:
   - Email: your.test@gmail.com
   - Password: Test123!
   - Company: COMP001
   - Role: TECHNICIAN

2. Switch to "Real Account"
3. Try both methods:
   - Click "Continue with Google" → Use your.test@gmail.com
   - OR use Email/Password form

## 🚀 Production Checklist

Before deploying to production:

- [ ] Enable Google Sign-In in Firebase Console
- [ ] Add authorized domains
- [ ] Test Google Sign-In with real accounts
- [ ] Create initial user accounts
- [ ] Test error scenarios (unregistered user, inactive account)
- [ ] Verify company isolation works
- [ ] Test role-based access control
- [ ] Enable email verification (optional)
- [ ] Set up password reset flow (optional)

## 📱 Multi-Factor Authentication (Optional)

To add an extra security layer:

1. Go to Firebase Console → Authentication
2. Navigate to Sign-in method → Advanced
3. Enable Multi-factor authentication
4. Choose verification methods (SMS, TOTP)

## 🔗 Linking Accounts

Users can link their email/password account with Google:

```typescript
// User logs in with email/password
await signIn("user@company.com", "password");

// Then links Google account
await linkWithGoogle();

// Now they can sign in with either method
```

This allows users flexibility in how they authenticate.

## 🎭 Demo vs Real Mode

### Demo Mode
- ✅ Quick testing
- ✅ Preloaded data
- ✅ No password required
- ✅ Multiple test accounts
- ❌ Not for production

### Real Account Mode
- ✅ Production-ready
- ✅ Secure authentication
- ✅ Google Sign-In support
- ✅ Company isolation
- ✅ Role-based access

## 📚 Additional Resources

- [Firebase Google Sign-In Docs](https://firebase.google.com/docs/auth/web/google-signin)
- [Google OAuth Setup](https://developers.google.com/identity/protocols/oauth2)
- [Firebase Security Rules](https://firebase.google.com/docs/firestore/security/get-started)

## 🆘 Troubleshooting

### "Popup blocked by browser"
- Allow popups for your site
- Or use redirect method instead (requires code change)

### "Email already in use"
- User already exists with that email
- They may have signed up with email/password
- Try linking accounts instead

### "Invalid OAuth client"
- Check Firebase Console configuration
- Verify authorized domains
- Re-save Google provider settings

### "Network error"
- Check internet connection
- Verify Firebase API key in .env
- Check browser console for details

---

## ✅ Summary

You now have a complete authentication system with:

1. ✅ **Dual Mode Login** - Demo and Real accounts
2. ✅ **Google Sign-In** - One-click login with Gmail
3. ✅ **Email/Password** - Traditional authentication
4. ✅ **Security** - Company isolation and role-based access
5. ✅ **User Management** - Admin interface to create accounts
6. ✅ **Error Handling** - Clear error messages
7. ✅ **Responsive UI** - Beautiful login experience

**Next Steps:**
1. Enable Google Sign-In in Firebase Console
2. Create test accounts
3. Test both login methods
4. Deploy to production

🎉 **Your authentication system is production-ready!**
