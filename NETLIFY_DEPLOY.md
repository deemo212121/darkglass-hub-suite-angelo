# Netlify Deployment Guide

Deploy your AH Solutions app to Netlify with Firebase integration.

## 🚀 Quick Deploy

### Step 1: Connect to GitHub

1. Go to [Netlify](https://app.netlify.com/)
2. Click **Add new site** → **Import an existing project**
3. Choose **GitHub**
4. Select repository: `rulonajhon/darkglass-hub-suite`
5. Select branch: `main`

### Step 2: Configure Build Settings

**Build command:**
```
npm run build
```

**Publish directory:**
```
dist
```

**Base directory:** (leave empty)

### Step 3: Add Environment Variables

Click **Show advanced** → **Add environment variable**

Add these variables:

```
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here

VITE_FIREBASE_API_KEY=your_firebase_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id

VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

### Step 4: Deploy

Click **Deploy site**

Wait 2-3 minutes for build to complete.

## 🔧 Post-Deployment

### Update Firebase Authorized Domains

1. Go to [Firebase Console](https://console.firebase.google.com/project/ah-solutions-usapp/authentication/settings)
2. Click **Settings** → **Authorized domains**
3. Add your Netlify domain:
   - `your-site-name.netlify.app`
   - If you have custom domain, add that too

### Test Your Deployment

1. Visit your Netlify URL
2. Try logging in with test account
3. Check browser console for Firebase connection
4. Test file upload

## 📝 Netlify Configuration File

Create `netlify.toml` in project root for better control:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[build.environment]
  NODE_VERSION = "20"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
```

## 🔄 Automatic Deploys

Netlify will automatically deploy when you push to `main` branch.

To disable:
1. Go to Site settings → Build & deploy
2. Click **Stop auto publishing**

## 🌐 Custom Domain

1. Go to Site settings → Domain management
2. Click **Add custom domain**
3. Follow DNS setup instructions
4. Add domain to Firebase authorized domains

## ❓ Troubleshooting

### Build fails with "command not found"
→ Make sure `package.json` has correct build script

### Firebase not working on Netlify
→ Check environment variables are set correctly

### Login redirects fail
→ Add Netlify domain to Firebase authorized domains

### Images not loading
→ Check Firebase Storage rules are deployed

## 🎉 Success!

Your app is now live on Netlify with Firebase backend!

---

**Live URL:** Will be `https://your-site-name.netlify.app`
